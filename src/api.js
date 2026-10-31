const express = require('express');
const { adminAuthMiddleware } = require('./auth');
const {
  addOneMonth, subtractOneMonth, isDebtor, statusText, monthsPaidLabel,
} = require('./payments');

function createApi(pool, bot) {
  const router = express.Router();
  const ADMIN_ID = Number(process.env.ADMIN_ID);
  router.use(adminAuthMiddleware(process.env.BOT_TOKEN, ADMIN_ID));

  // groupPaymentDay — shu a'zoning guruhidagi umumiy to'lov sanasi (individual
  // sana bo'lmasa, "nechta oylik to'lov qilingan"ni hisoblash uchun kerak)
  function memberView(m, groupPaymentDay) {
    const pd = m.payment_day || groupPaymentDay || m.g_payment_day || m.group_payment_day;
    return {
      id: m.id,
      telegram_id: m.telegram_id,
      username: m.username,
      first_name: m.first_name,
      payment_day: m.payment_day,
      paid_until: m.paid_until,
      started_bot: m.started_bot,
      is_debtor: isDebtor(m.paid_until),
      status_text: statusText(m),
      months_paid_label: pd ? monthsPaidLabel(m.paid_until, m.cycle_start, pd) : null,
    };
  }

  // Mini App ochilganda — shu odam admin ekanligini tekshirish uchun.
  // (Pastdagi barcha route'lar baribir adminAuthMiddleware bilan himoyalangan —
  // bu shunchaki frontend uchun erta va aniq tekshiruv.)
  router.get('/whoami', (req, res) => res.json({ ok: true }));

  // ---------- GURUHLAR ----------
  router.get('/groups', async (req, res) => {
    const { rows } = await pool.query(`
      SELECT g.*,
        COUNT(m.id) FILTER (WHERE m.removed = false) AS member_count,
        COUNT(m.id) FILTER (WHERE m.removed = false AND (m.paid_until IS NULL OR m.paid_until < CURRENT_DATE)) AS debtor_count
      FROM groups g
      LEFT JOIN members m ON m.group_id = g.id
      GROUP BY g.id ORDER BY g.created_at DESC
    `);
    res.json(rows);
  });

  router.post('/groups', async (req, res) => {
    const { name, chat_id, category, payment_day, price } = req.body;
    if (!name || !chat_id || !payment_day) return res.status(400).json({ error: 'Nom, guruh ID va to\'lov sanasi kerak' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO groups (name, chat_id, category, payment_day, price) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, chat_id, category || 'Attestatsiya', payment_day, price || 0]
      );
      res.json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: 'Bu guruh ID allaqachon qo\'shilgan' });
      throw e;
    }
  });

  router.put('/groups/:id', async (req, res) => {
    const { name, category, payment_day, price } = req.body;
    const { rows } = await pool.query(
      `UPDATE groups SET name=COALESCE($2,name), category=COALESCE($3,category),
       payment_day=COALESCE($4,payment_day), price=COALESCE($5,price) WHERE id=$1 RETURNING *`,
      [req.params.id, name, category, payment_day, price]
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
      `SELECT m.*, g.payment_day AS g_payment_day FROM members m
       JOIN groups g ON g.id=m.group_id
       WHERE m.group_id=$1 AND m.removed=false ORDER BY m.first_name`,
      [req.params.id]
    );
    res.json(rows.map((m) => memberView(m, m.g_payment_day)));
  });

  router.post('/groups/:id/members', async (req, res) => {
    const { username, telegram_id, first_name } = req.body;
    if (!username && !telegram_id) return res.status(400).json({ error: 'Username yoki ID kerak' });
    const cleanUsername = username ? String(username).replace('@', '') : null;
    const { rows: groupRows } = await pool.query('SELECT payment_day FROM groups WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `INSERT INTO members (group_id, telegram_id, username, first_name)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (group_id, telegram_id) DO UPDATE SET username=EXCLUDED.username, removed=false
       RETURNING *`,
      [req.params.id, telegram_id || null, cleanUsername, first_name || cleanUsername || 'Nomsiz']
    );
    res.json(memberView(rows[0], groupRows[0] && groupRows[0].payment_day));
  });

  // Ko'plab a'zoni bir vaqtda qo'shish — har bir qatorda "Ism @username" yoki
  // shunchaki "@username" yoki shunchaki ism bo'lishi mumkin
  router.post('/groups/:id/members/bulk', async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Ro'yxat bo'sh" });

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const added = [];
    const skipped = [];

    for (const line of lines) {
      const match = line.match(/@([a-zA-Z0-9_]{3,})/);
      const username = match ? match[1] : null;
      const nameOnly = line.replace(/@([a-zA-Z0-9_]{3,})/, '').trim();
      const first_name = nameOnly || username || 'Nomsiz';

      if (username) {
        const { rows: existing } = await pool.query(
          `SELECT id FROM members WHERE group_id=$1 AND removed=false AND lower(username)=lower($2)`,
          [req.params.id, username]
        );
        if (existing.length) {
          skipped.push({ line, reason: 'Bu username allaqachon ro\'yxatda' });
          continue;
        }
      }

      try {
        await pool.query(
          `INSERT INTO members (group_id, telegram_id, username, first_name) VALUES ($1,NULL,$2,$3)`,
          [req.params.id, username, first_name]
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
    const { rows } = await pool.query(
      'UPDATE members SET payment_day=$2, first_name=COALESCE($3,first_name) WHERE id=$1 RETURNING *',
      [req.params.id, payment_day || null, first_name]
    );
    const m = rows[0];
    const { rows: groupRows } = await pool.query('SELECT payment_day FROM groups WHERE id=$1', [m.group_id]);
    res.json(memberView(m, groupRows[0] && groupRows[0].payment_day));
  });

  router.delete('/members/:id', async (req, res) => {
    await pool.query('UPDATE members SET removed=true WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  router.post('/members/:id/pay', async (req, res) => {
    const { rows } = await pool.query('SELECT m.*, g.payment_day AS g_payment_day FROM members m JOIN groups g ON g.id=m.group_id WHERE m.id=$1', [req.params.id]);
    const m = rows[0];
    if (!m) return res.status(404).json({ error: 'Topilmadi' });
    const pd = m.payment_day || m.g_payment_day;
    const { cycleStart, paidUntil } = addOneMonth(m, pd);
    const upd = await pool.query('UPDATE members SET paid_until=$2, cycle_start=$3 WHERE id=$1 RETURNING *', [req.params.id, paidUntil, cycleStart]);
    res.json(memberView(upd.rows[0], pd));
  });

  router.post('/members/:id/unpay', async (req, res) => {
    const { rows } = await pool.query('SELECT m.*, g.payment_day AS g_payment_day FROM members m JOIN groups g ON g.id=m.group_id WHERE m.id=$1', [req.params.id]);
    const m = rows[0];
    if (!m) return res.status(404).json({ error: 'Topilmadi' });
    const pd = m.payment_day || m.g_payment_day;
    const { cycleStart, paidUntil } = subtractOneMonth(m, pd);
    const upd = await pool.query('UPDATE members SET paid_until=$2, cycle_start=$3 WHERE id=$1 RETURNING *', [req.params.id, paidUntil, cycleStart]);
    res.json(memberView(upd.rows[0], pd));
  });

  // ---------- QARZDORLAR / TO'LAGANLAR (umumiy) ----------
  router.get('/debtors', async (req, res) => {
    const { rows } = await pool.query(`
      SELECT m.*, g.name AS group_name, g.category, g.payment_day AS group_payment_day
      FROM members m JOIN groups g ON g.id=m.group_id
      WHERE m.removed=false AND (m.paid_until IS NULL OR m.paid_until < CURRENT_DATE)
      ORDER BY g.name, m.first_name
    `);
    res.json(rows.map((m) => ({ ...memberView(m, m.group_payment_day), group_name: m.group_name, category: m.category })));
  });

  router.get('/paid', async (req, res) => {
    const { rows } = await pool.query(`
      SELECT m.*, g.name AS group_name, g.category, g.payment_day AS group_payment_day
      FROM members m JOIN groups g ON g.id=m.group_id
      WHERE m.removed=false AND m.paid_until >= CURRENT_DATE
      ORDER BY g.name, m.first_name
    `);
    res.json(rows.map((m) => ({ ...memberView(m, m.group_payment_day), group_name: m.group_name, category: m.category })));
  });

  // ---------- QARZDORLARNI GURUHDAN CHIQARISH ----------
  router.post('/groups/:id/kick-debtors', async (req, res) => {
    const excludeIds = new Set((req.body.excludeIds || []).map(Number));
    const { rows: groupRows } = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    const group = groupRows[0];
    if (!group) return res.status(404).json({ error: 'Guruh topilmadi' });

    const { rows: debtors } = await pool.query(
      `SELECT * FROM members WHERE group_id=$1 AND removed=false AND (paid_until IS NULL OR paid_until < CURRENT_DATE)`,
      [req.params.id]
    );

    const results = [];
    for (const m of debtors) {
      if (excludeIds.has(m.id) || !m.telegram_id) continue;
      try {
        await bot.telegram.banChatMember(group.chat_id, m.telegram_id);
        await bot.telegram.unbanChatMember(group.chat_id, m.telegram_id, { only_if_banned: true });
        await pool.query('UPDATE members SET removed=true WHERE id=$1', [m.id]);
        results.push({ id: m.id, ok: true });
      } catch (e) {
        results.push({ id: m.id, ok: false, error: e.message });
      }
    }
    res.json({ results });
  });

  // ---------- QARZDORLARGA XABAR YOZISH ----------
  router.post('/groups/:id/broadcast', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Xabar matni kerak' });

    const { rows: debtors } = await pool.query(
      `SELECT * FROM members WHERE group_id=$1 AND removed=false AND (paid_until IS NULL OR paid_until < CURRENT_DATE)`,
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
      if (excludeIds.has(m.id) || !m.telegram_id) continue;
      try {
        await bot.telegram.banChatMember(group.chat_id, m.telegram_id);
        await bot.telegram.unbanChatMember(group.chat_id, m.telegram_id, { only_if_banned: true });
        await pool.query('UPDATE members SET removed=true WHERE id=$1', [m.id]);
        results.push({ id: m.id, ok: true });
      } catch (e) {
        results.push({ id: m.id, ok: false, error: e.message });
      }
    }
    res.json({ results });
  });

  return router;
}

module.exports = { createApi };
