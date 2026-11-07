const express = require('express');
const { adminAuthMiddleware } = require('./auth');
const {
  addOneMonth, subtractOneMonth, isDebtor, statusText, monthsPaidLabel, initialPaidStatus, nextCycleStart,
} = require('./payments');
const { logPayment } = require('./ledger');

function createApi(pool, bot) {
  const router = express.Router();
  const ADMIN_ID = Number(process.env.ADMIN_ID);
  router.use(adminAuthMiddleware(process.env.BOT_TOKEN, ADMIN_ID));

  // groupPaymentDay — shu a'zoning guruhidagi umumiy to'lov sanasi (individual
  // sana bo'lmasa, "nechta oylik to'lov qilingan"ni hisoblash uchun kerak)
  function memberView(m, groupPaymentDay, groupPrice) {
    const pd = m.payment_day || groupPaymentDay || m.g_payment_day || m.group_payment_day;
    const price = groupPrice != null ? Number(groupPrice) : (m.g_price != null ? Number(m.g_price) : (m.group_price != null ? Number(m.group_price) : null));
    const partialPaid = Number(m.partial_paid || 0);
    const remaining = price ? Math.max(price - partialPaid, 0) : null;
    // Qisman to'lagan, lekin hali TO'LIQ to'lamagan a'zo ham qarzdor hisoblanadi —
    // garchi paid_until kelajakda bo'lsa ham (masalan guruhga qo'shilganda
    // avtomatik "to'langan" deb belgilangan bo'lsa-da, aslida hammasini
    // to'lamagan bo'lsa, u hali ham qarzdorlar ro'yxatida ko'rinishi kerak)
    const isPartialDebtor = partialPaid > 0 && (!price || partialPaid < price);
    const effectiveDebtor = isDebtor(m.paid_until) || isPartialDebtor;
    return {
      id: m.id,
      telegram_id: m.telegram_id,
      username: m.username,
      first_name: m.first_name,
      payment_day: m.payment_day,
      paid_until: m.paid_until,
      started_bot: m.started_bot,
      is_debtor: effectiveDebtor,
      status_text: isPartialDebtor ? "Qisman to'langan — qarzdor" : statusText(m),
      months_paid_label: (pd && !isPartialDebtor) ? monthsPaidLabel(m.paid_until, m.cycle_start, pd) : null,
      price: price || null,
      partial_paid: partialPaid,
      remaining,
    };
  }

  // SQL darajasida "qarzdor" sharti — memberView()dagi is_debtor mantig'i bilan
  // bir xil bo'lishi SHART (groups jadvali bilan JOIN qilingan so'rovlarda
  // ishlatiladi: m = members, g = groups)
  // "Bugun" O'zbekiston vaqti bo'yicha hisoblanadi (server UTC'da ishlaydi —
  // Toshkent soati bilan farq bo'lganda, masalan tunda, sana noto'g'ri
  // chiqib ketmasligi uchun)
  const TODAY_TASHKENT_SQL = `(now() AT TIME ZONE 'Asia/Tashkent')::date`;
  const DEBTOR_COND = `(m.paid_until IS NULL OR m.paid_until < ${TODAY_TASHKENT_SQL} OR (m.partial_paid > 0 AND (g.price IS NULL OR g.price = 0 OR m.partial_paid < g.price)))`;

  // Mini App ochilganda — shu odam admin ekanligini tekshirish uchun.
  // (Pastdagi barcha route'lar baribir adminAuthMiddleware bilan himoyalangan —
  // bu shunchaki frontend uchun erta va aniq tekshiruv.)
  router.get('/whoami', (req, res) => res.json({ ok: true }));

  // ---------- GURUHLAR ----------
  router.get('/groups', async (req, res) => {
    const { rows } = await pool.query(`
      SELECT g.*,
        COUNT(m.id) FILTER (WHERE m.removed = false) AS member_count,
        COUNT(m.id) FILTER (WHERE m.removed = false AND ${DEBTOR_COND}) AS debtor_count
      FROM groups g
      LEFT JOIN members m ON m.group_id = g.id
      GROUP BY g.id ORDER BY g.created_at DESC
    `);
    res.json(rows);
  });

  router.post('/groups', async (req, res) => {
    const { name, chat_id, category, payment_day, price, start_date, payment_type, one_time_until } = req.body;
    if (!name || !chat_id || !payment_day) return res.status(400).json({ error: 'Nom, guruh ID va to\'lov sanasi kerak' });
    const pType = payment_type === 'one_time' ? 'one_time' : 'monthly';
    try {
      const { rows } = await pool.query(
        `INSERT INTO groups (name, chat_id, category, payment_day, price, start_date, payment_type, one_time_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [name, chat_id, category || 'Attestatsiya', payment_day, price || 0, start_date || null, pType, one_time_until || null]
      );
      res.json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: 'Bu guruh ID allaqachon qo\'shilgan' });
      throw e;
    }
  });

  router.put('/groups/:id', async (req, res) => {
    const { name, category, payment_day, price, start_date, payment_type, one_time_until } = req.body;
    const pType = payment_type === 'one_time' ? 'one_time' : (payment_type === 'monthly' ? 'monthly' : null);
    const { rows } = await pool.query(
      `UPDATE groups SET name=COALESCE($2,name), category=COALESCE($3,category),
       payment_day=COALESCE($4,payment_day), price=COALESCE($5,price),
       start_date=COALESCE($6,start_date), payment_type=COALESCE($7,payment_type),
       one_time_until=COALESCE($8,one_time_until)
       WHERE id=$1 RETURNING *`,
      [req.params.id, name, category, payment_day, price, start_date || null, pType, one_time_until || null]
    );
    res.json(rows[0]);
  });

  router.delete('/groups/:id', async (req, res) => {
    await pool.query('DELETE FROM groups WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  // ---------- A'ZOLAR ----------
  router.get('/groups/:id/members', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT m.*, g.payment_day AS g_payment_day, g.price AS g_price FROM members m
       JOIN groups g ON g.id=m.group_id
       WHERE m.group_id=$1 AND m.removed=false ORDER BY m.first_name`,
      [req.params.id]
    );
    res.json(rows.map((m) => memberView(m, m.g_payment_day, m.g_price)));
  });

  router.post('/groups/:id/members', async (req, res) => {
    const { username, telegram_id, first_name } = req.body;
    if (!username && !telegram_id && !first_name) return res.status(400).json({ error: "Ism, username yoki ID kerak" });
    const cleanUsername = username ? String(username).replace('@', '') : null;
    const cleanTelegramId = telegram_id ? String(telegram_id).replace(/\D/g, '') : null;
    const { rows: groupRows } = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    const group = groupRows[0];
    // Agar guruhda "dars boshlanish sanasi" sozlangan bo'lsa — yangi qo'shilgan
    // a'zo DARHOL to'lagan sifatida belgilanadi (link/qo'lda qo'shish — to'lov
    // qilganlargagina qo'shiladi deb hisoblanadi). Mavjud a'zo bo'lsa (conflict),
    // uning to'lov holati tegilmaydi.
    const { cycleStart, paidUntil } = initialPaidStatus(group);
    try {
      const { rows } = await pool.query(
        `INSERT INTO members (group_id, telegram_id, username, first_name, cycle_start, paid_until)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (group_id, telegram_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, removed=false
         RETURNING *`,
        [req.params.id, cleanTelegramId || null, cleanUsername, first_name || cleanUsername || 'Nomsiz', cycleStart, paidUntil]
      );
      // ESLATMA: "dars boshlanish sanasi" bo'yicha avtomatik to'langan deb
      // belgilashda to'lov tarixiga HECH NARSA yozilmaydi — bu faqat taxmin
      // (link faqat to'lov qilganlarga berilgan degan ishonch), aniq summa
      // emas. Agar keyinchalik bu a'zo aslida qisman to'lagani ma'lum bo'lsa
      // (💰 tugmasi orqali), o'sha YAGONA harakat "tushgan pul" deb hisoblanadi
      // — shunda ikki marta hisoblanib ketmaydi.
      res.json(memberView(rows[0], group && group.payment_day, group && group.price));
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: "Bu Telegram ID allaqachon shu guruhda bor" });
      throw e;
    }
  });

  // Ko'plab a'zoni bir vaqtda qo'shish — har bir qatorda "Ism @username",
  // "Ism 123456789" (Telegram ID), "Ism @username 123456789", shunchaki
  // "@username", shunchaki ID yoki shunchaki ism bo'lishi mumkin
  router.post('/groups/:id/members/bulk', async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Ro'yxat bo'sh" });

    const { rows: groupRows } = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    const group = groupRows[0];
    const { cycleStart, paidUntil } = initialPaidStatus(group);

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const added = [];
    const skipped = [];

    for (const line of lines) {
      const unameMatch = line.match(/@([a-zA-Z0-9_]{3,})/);
      const idMatch = line.match(/\b(\d{5,})\b/);
      const username = unameMatch ? unameMatch[1] : null;
      const telegramId = idMatch ? idMatch[1] : null;
      let nameOnly = line;
      if (unameMatch) nameOnly = nameOnly.replace(unameMatch[0], '');
      if (idMatch) nameOnly = nameOnly.replace(idMatch[0], '');
      nameOnly = nameOnly.trim();
      const first_name = nameOnly || username || 'Nomsiz';

      if (telegramId) {
        const { rows: existingId } = await pool.query(
          `SELECT id FROM members WHERE group_id=$1 AND removed=false AND telegram_id=$2`,
          [req.params.id, telegramId]
        );
        if (existingId.length) {
          skipped.push({ line, reason: 'Bu Telegram ID allaqachon ro\'yxatda' });
          continue;
        }
      } else if (username) {
        const { rows: existingUname } = await pool.query(
          `SELECT id FROM members WHERE group_id=$1 AND removed=false AND lower(username)=lower($2)`,
          [req.params.id, username]
        );
        if (existingUname.length) {
          skipped.push({ line, reason: 'Bu username allaqachon ro\'yxatda' });
          continue;
        }
      }

      try {
        await pool.query(
          `INSERT INTO members (group_id, telegram_id, username, first_name, cycle_start, paid_until) VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.id, telegramId, username, first_name, cycleStart, paidUntil]
        );
        added.push(line);
      } catch (e) {
        skipped.push({ line, reason: e.message });
      }
    }

    res.json({ addedCount: added.length, skipped });
  });

  router.put('/members/:id', async (req, res) => {
    const { payment_day, first_name } = req.body;
    const { rows: beforeRows } = await pool.query('SELECT * FROM members WHERE id=$1', [req.params.id]);
    const before = beforeRows[0];
    if (!before) return res.status(404).json({ error: 'Topilmadi' });

    let cycleStart = before.cycle_start;
    let paidUntil = before.paid_until;
    let partialPaid = before.partial_paid;
    // Agar shu a'zoning to'lov sanasi (kuni) o'zgartirilsa — bu YANGI sikl
    // boshlanishi deb hisoblanadi: joriy oydagi shu sanadan boshlab hisoblanadi
    // va a'zo QARZDOR holatiga qaytariladi (chunki eski to'lov sanasi endi
    // noto'g'ri). Agar aslida to'lagan bo'lsa, admin shundan keyin "+"
    // tugmasini bosib qo'yadi. Eski siklga tegishli qisman to'lov ham
    // tozalanadi (yangi sikl — yangi hisob).
    if (payment_day && Number(payment_day) !== before.payment_day) {
      cycleStart = nextCycleStart(Number(payment_day));
      paidUntil = null;
      partialPaid = 0;
    }

    const { rows } = await pool.query(
      `UPDATE members SET payment_day=$2, first_name=COALESCE($3,first_name),
       cycle_start=$4, paid_until=$5, partial_paid=$6 WHERE id=$1 RETURNING *`,
      [req.params.id, payment_day || null, first_name, cycleStart, paidUntil, partialPaid]
    );
    const m = rows[0];
    const { rows: groupRows } = await pool.query('SELECT payment_day, price FROM groups WHERE id=$1', [m.group_id]);
    res.json(memberView(m, groupRows[0] && groupRows[0].payment_day, groupRows[0] && groupRows[0].price));
  });

  // Qisman to'lovni yangilash (masalan 399 minglikdan 200 ming to'lagan bo'lsa)
  router.put('/members/:id/partial-paid', async (req, res) => {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "Summa noto'g'ri" });
    const { rows: beforeRows } = await pool.query('SELECT * FROM members WHERE id=$1', [req.params.id]);
    const before = beforeRows[0];
    if (!before) return res.status(404).json({ error: 'Topilmadi' });
    const { rows } = await pool.query(
      'UPDATE members SET partial_paid=$2 WHERE id=$1 RETURNING *',
      [req.params.id, Math.round(amount)]
    );
    const m = rows[0];
    // Faqat ORTGAN qism "yangi tushgan pul" sifatida to'lov tarixiga yoziladi
    // (masalan oldin 200k, endi 300k deb kiritilsa — 100k yoziladi; kamaytirilsa
    // — salbiy summa bilan tuzatish sifatida yoziladi)
    const delta = Math.round(amount) - Number(before.partial_paid || 0);
    await logPayment(pool, { memberId: m.id, groupId: m.group_id, amount: delta, kind: 'qisman_tolov' });
    const { rows: groupRows } = await pool.query('SELECT payment_day, price FROM groups WHERE id=$1', [m.group_id]);
    res.json(memberView(m, groupRows[0] && groupRows[0].payment_day, groupRows[0] && groupRows[0].price));
  });

  router.delete('/members/:id', async (req, res) => {
    await pool.query('UPDATE members SET removed=true WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  router.post('/members/:id/pay', async (req, res) => {
    const { rows } = await pool.query('SELECT m.*, g.payment_day AS g_payment_day, g.price AS g_price FROM members m JOIN groups g ON g.id=m.group_id WHERE m.id=$1', [req.params.id]);
    const m = rows[0];
    if (!m) return res.status(404).json({ error: 'Topilmadi' });
    const pd = m.payment_day || m.g_payment_day;
    const { cycleStart, paidUntil } = addOneMonth(m, pd);
    // Davr to'liq to'langan deb belgilanganda, shu siklga tegishli qisman
    // to'lov hisobi ham tozalanadi (endi to'liq to'langan)
    const upd = await pool.query(
      'UPDATE members SET paid_until=$2, cycle_start=$3, partial_paid=0 WHERE id=$1 RETURNING *',
      [req.params.id, paidUntil, cycleStart]
    );
    // To'lov tarixiga — narxdan avval qisman to'langan summa ayirib, endi
    // "tushgan" qolgan qism yoziladi (qisman to'lov allaqachon alohida
    // yozilgan edi — qayta hisoblanmasligi uchun)
    if (m.g_price) {
      const delta = Math.max(Number(m.g_price) - Number(m.partial_paid || 0), 0);
      await logPayment(pool, { memberId: m.id, groupId: m.group_id, amount: delta, kind: 'toliq_tolov' });
    }
    res.json(memberView(upd.rows[0], pd, m.g_price));
  });

  router.post('/members/:id/unpay', async (req, res) => {
    const { rows } = await pool.query('SELECT m.*, g.payment_day AS g_payment_day, g.price AS g_price FROM members m JOIN groups g ON g.id=m.group_id WHERE m.id=$1', [req.params.id]);
    const m = rows[0];
    if (!m) return res.status(404).json({ error: 'Topilmadi' });
    const pd = m.payment_day || m.g_payment_day;
    const { cycleStart, paidUntil } = subtractOneMonth(m, pd);
    const upd = await pool.query('UPDATE members SET paid_until=$2, cycle_start=$3 WHERE id=$1 RETURNING *', [req.params.id, paidUntil, cycleStart]);
    // Bekor qilish — oldin "to'liq to'lov" sifatida yozilgan summani
    // tuzatish (salbiy yozuv) sifatida qaytaradi
    if (m.g_price) {
      await logPayment(pool, { memberId: m.id, groupId: m.group_id, amount: -Number(m.g_price), kind: 'bekor_qilish' });
    }
    res.json(memberView(upd.rows[0], pd, m.g_price));
  });

  // ---------- BOSH SAHIFA STATISTIKASI ----------
  // Muddati o'tgan (joriy) qarz summasi va shu oy yig'ilgan pul — bosh
  // sahifadagi ikkita asosiy ko'rsatkich uchun
  router.get('/stats', async (req, res) => {
    const { rows: debtRows } = await pool.query(`
      SELECT COALESCE(SUM(
        CASE WHEN g.price > 0 THEN GREATEST(g.price - m.partial_paid, 0) ELSE 0 END
      ), 0) AS overdue_debt
      FROM members m JOIN groups g ON g.id=m.group_id
      WHERE m.removed=false AND ${DEBTOR_COND}
    `);
    const { rows: collectedRows } = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) AS collected_this_month
      FROM payment_log
      WHERE (created_at AT TIME ZONE 'Asia/Tashkent') >= date_trunc('month', now() AT TIME ZONE 'Asia/Tashkent')
    `);
    res.json({
      overdue_debt: Number(debtRows[0].overdue_debt),
      collected_this_month: Number(collectedRows[0].collected_this_month),
    });
  });

  // ---------- QARZDORLAR / TO'LAGANLAR (umumiy) ----------
  router.get('/debtors', async (req, res) => {
    const { rows } = await pool.query(`
      SELECT m.*, g.name AS group_name, g.category, g.payment_day AS group_payment_day, g.price AS group_price
      FROM members m JOIN groups g ON g.id=m.group_id
      WHERE m.removed=false AND ${DEBTOR_COND}
      ORDER BY g.name, m.first_name
    `);
    res.json(rows.map((m) => ({ ...memberView(m, m.group_payment_day, m.group_price), group_name: m.group_name, category: m.category })));
  });

  router.get('/paid', async (req, res) => {
    const { rows } = await pool.query(`
      SELECT m.*, g.name AS group_name, g.category, g.payment_day AS group_payment_day, g.price AS group_price
      FROM members m JOIN groups g ON g.id=m.group_id
      WHERE m.removed=false AND NOT ${DEBTOR_COND}
      ORDER BY g.name, m.first_name
    `);
    res.json(rows.map((m) => ({ ...memberView(m, m.group_payment_day, m.group_price), group_name: m.group_name, category: m.category })));
  });

  // ---------- QARZDORLAR RO'YXATINI GURUHGA YUBORISH (oddiy matn) ----------
  router.post('/groups/:id/post-debtors-list', async (req, res) => {
    const { rows: groupRows } = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    const group = groupRows[0];
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });

    const { rows: debtors } = await pool.query(
      `SELECT m.* FROM members m JOIN groups g ON g.id=m.group_id
       WHERE m.group_id=$1 AND m.removed=false AND ${DEBTOR_COND} ORDER BY m.first_name`,
      [req.params.id]
    );

    if (!debtors.length) {
      return res.status(400).json({ error: "Qarzdor yo'q — yuborish shart emas" });
    }

    const today = new Date();
    const dateStr = `${today.getDate()}-${['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'][today.getMonth()]}`;
    const lines = debtors.map((m, i) => {
      const name = m.first_name || 'Nomsiz';
      const uname = m.username ? ` (@${m.username})` : '';
      return `${i + 1}. ${name}${uname} — ${statusText(m)}`;
    });
    const text = `📋 Qarzdorlar ro'yxati (${dateStr}):\n\n${lines.join('\n')}`;

    try {
      await bot.telegram.sendMessage(group.chat_id, text);
      res.json({ ok: true, count: debtors.length });
    } catch (e) {
      res.status(400).json({ error: "Guruhga yuborib bo'lmadi: " + e.message });
    }
  });

  // ---------- BARCHA GURUHLARGA UMUMIY XABAR (masalan, iqtibos/eslatma) ----------
  router.post('/broadcast-all', async (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Xabar matni kerak' });

    const { rows: groups } = await pool.query('SELECT * FROM groups ORDER BY name');
    if (!groups.length) return res.status(400).json({ error: "Hali guruh yo'q" });

    const results = [];
    for (const g of groups) {
      try {
        await bot.telegram.sendMessage(g.chat_id, message);
        results.push({ group_id: g.id, name: g.name, ok: true });
      } catch (e) {
        console.error(`Umumiy xabarni guruhga yuborishda xato (guruh ${g.id}, chat ${g.chat_id}):`, e.message);
        results.push({ group_id: g.id, name: g.name, ok: false, error: e.message });
      }
    }
    res.json({ results });
  });

  // ---------- QARZDORLARNI GURUHDAN CHIQARISH ----------
  router.post('/groups/:id/kick-debtors', async (req, res) => {
    const excludeIds = new Set((req.body.excludeIds || []).map(Number));
    const { rows: groupRows } = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    const group = groupRows[0];
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });

    const { rows: debtors } = await pool.query(
      `SELECT m.* FROM members m JOIN groups g ON g.id=m.group_id
       WHERE m.group_id=$1 AND m.removed=false AND ${DEBTOR_COND}`,
      [req.params.id]
    );

    const results = [];
    for (const m of debtors) {
      if (excludeIds.has(m.id)) continue;
      if (!m.telegram_id) {
        // Telegram ID noma'lum bo'lsa (hali /start bosmagan, ID avtomatik
        // aniqlanmagan) — Telegram API orqali chiqarib bo'lmaydi. Buni
        // jim o'tkazib yubormasdan, aniq sababini qaytaramiz.
        results.push({ id: m.id, name: m.first_name, ok: false, error: "Telegram ID noma'lum (hali botga /start bosmagan) — guruhdan qo'lda chiqarishingiz kerak" });
        continue;
      }
      try {
        await bot.telegram.banChatMember(group.chat_id, m.telegram_id);
        await bot.telegram.unbanChatMember(group.chat_id, m.telegram_id, { only_if_banned: true });
        await pool.query('UPDATE members SET removed=true WHERE id=$1', [m.id]);
        results.push({ id: m.id, name: m.first_name, ok: true });
      } catch (e) {
        console.error(`Qarzdorni guruhdan chiqarishda xato (member ${m.id}, chat ${group.chat_id}):`, e.message);
        results.push({ id: m.id, name: m.first_name, ok: false, error: e.message });
      }
    }
    res.json({ results });
  });

  // ---------- QARZDORLARGA XABAR YOZISH ----------
  router.post('/groups/:id/broadcast', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Xabar matni kerak' });

    const { rows: debtors } = await pool.query(
      `SELECT m.* FROM members m JOIN groups g ON g.id=m.group_id
       WHERE m.group_id=$1 AND m.removed=false AND ${DEBTOR_COND}`,
      [req.params.id]
    );

    const { rows: bRows } = await pool.query(
      'INSERT INTO broadcasts (group_id, message) VALUES ($1,$2) RETURNING *',
      [req.params.id, message]
    );
    const broadcast = bRows[0];

    const results = [];
    for (const m of debtors) {
      let sent = false, error = null;
      if (m.telegram_id && m.started_bot) {
        try {
          await bot.telegram.sendMessage(m.telegram_id, message);
          sent = true;
        } catch (e) {
          error = e.message;
        }
      } else {
        error = 'Bu o\'quvchi botga /start bosmagan — xabar yubora olmaymiz';
      }
      await pool.query(
        'INSERT INTO broadcast_recipients (broadcast_id, member_id, sent, error) VALUES ($1,$2,$3,$4)',
        [broadcast.id, m.id, sent, error]
      );
      results.push({ member_id: m.id, name: m.first_name, sent, error });
    }

    res.json({ broadcast_id: broadcast.id, results });
  });

  router.get('/groups/:id/broadcasts/latest', async (req, res) => {
    const { rows: bRows } = await pool.query(
      'SELECT * FROM broadcasts WHERE group_id=$1 ORDER BY sent_at DESC LIMIT 1',
      [req.params.id]
    );
    if (!bRows.length) return res.json(null);
    const broadcast = bRows[0];
    const { rows } = await pool.query(
      `SELECT br.*, m.first_name, m.username, m.id as member_id
       FROM broadcast_recipients br JOIN members m ON m.id=br.member_id
       WHERE br.broadcast_id=$1 AND br.sent=true ORDER BY br.replied, m.first_name`,
      [broadcast.id]
    );
    res.json({ broadcast, recipients: rows });
  });

  // ---------- JAVOB YOZMAGANLARNI CHIQARISH ----------
  router.post('/groups/:id/kick-non-repliers', async (req, res) => {
    const excludeIds = new Set((req.body.excludeIds || []).map(Number));
    const { rows: groupRows } = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    const group = groupRows[0];
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });

    const { rows: bRows } = await pool.query(
      'SELECT * FROM broadcasts WHERE group_id=$1 ORDER BY sent_at DESC LIMIT 1',
      [req.params.id]
    );
    if (!bRows.length) return res.json({ results: [] });
    const broadcast = bRows[0];

    const { rows: nonRepliers } = await pool.query(
      `SELECT m.* FROM broadcast_recipients br JOIN members m ON m.id=br.member_id
       WHERE br.broadcast_id=$1 AND br.sent=true AND br.replied=false`,
      [broadcast.id]
    );

    const results = [];
    for (const m of nonRepliers) {
      if (excludeIds.has(m.id)) continue;
      if (!m.telegram_id) {
        results.push({ id: m.id, name: m.first_name, ok: false, error: "Telegram ID noma'lum (hali botga /start bosmagan) — guruhdan qo'lda chiqarishingiz kerak" });
        continue;
      }
      try {
        await bot.telegram.banChatMember(group.chat_id, m.telegram_id);
        await bot.telegram.unbanChatMember(group.chat_id, m.telegram_id, { only_if_banned: true });
        await pool.query('UPDATE members SET removed=true WHERE id=$1', [m.id]);
        results.push({ id: m.id, name: m.first_name, ok: true });
      } catch (e) {
        console.error(`Javob bermaganni guruhdan chiqarishda xato (member ${m.id}, chat ${group.chat_id}):`, e.message);
        results.push({ id: m.id, name: m.first_name, ok: false, error: e.message });
      }
    }
    res.json({ results });
  });

  return router;
}

module.exports = { createApi };
