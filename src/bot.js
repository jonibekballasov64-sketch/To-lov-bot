const { Telegraf, Markup } = require('telegraf');
const { addNMonths, statusText } = require('./payments');

const ADMIN_ID = Number(process.env.ADMIN_ID);
const ADMIN_CONTACT = '@Filolog_N';
const CARD_NUMBER = process.env.CARD_NUMBER || '';
const CARD_HOLDER = process.env.CARD_HOLDER || '';

function createBot(pool) {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // --- /start ---
  bot.start(async (ctx) => {
    const fromId = ctx.from.id;

    if (ctx.chat.type === 'private' && fromId === ADMIN_ID) {
      const url = process.env.WEBAPP_URL;
      return ctx.reply(
        "Xush kelibsiz! To'lov nazorati Mini App'ni oching:",
        Markup.inlineKeyboard([Markup.button.webApp("📋 Boshqaruv panelini ochish", url)])
      );
    }

    if (ctx.chat.type === 'private') {
      await markStartedBot(pool, fromId, ctx.from.username, ctx.from.first_name);
      return sendPaymentStart(ctx, pool);
    }
  });

  // O'quvchi istagan vaqtda qayta ko'rish uchun
  bot.command('tolov', async (ctx) => {
    if (ctx.chat.type === 'private' && ctx.from.id !== ADMIN_ID) {
      // /start bosmasdan to'g'ridan-to'g'ri /tolov yozgan bo'lsa ham,
      // username bo'yicha ID'si shu yerda ham to'ldirilishi kerak
      await markStartedBot(pool, ctx.from.id, ctx.from.username, ctx.from.first_name);
      return sendPaymentStart(ctx, pool);
    }
  });

  // --- Guruh uchun to'lov tanlandi — karta ko'rsatiladi, oylik so'raladi ---
  // MUHIM: karta raqami alohida, o'chmaydigan xabar sifatida yuboriladi —
  // keyingi qadamlar uni ustidan yozib (edit) tashlamaydi, shunda o'quvchi
  // karta bank ilovasiga o'tgandan keyin ham uni topa oladi.
  bot.action(/^pmonsel:(\d+)$/, async (ctx) => {
    try {
      const memberId = Number(ctx.match[1]);
      if (!CARD_NUMBER) {
        await ctx.answerCbQuery();
        return ctx.reply(`To'lov kartasi hali sozlanmagan. Iltimos, ${ADMIN_CONTACT} ga yozing.`);
      }
      // Avvalgi xabardagi tugmani olib tashlaymiz (matnini o'chirmaymiz)
      await safeClearMarkup(ctx);
      await ctx.answerCbQuery();

      // Karta raqami — alohida, doim ko'rinib turadigan xabar, bir bosib
      // nusxalanadigan (HTML <code>) formatda
      const cardText = `💳 To'lovni quyidagi kartaga o'tkazing:\n\n<code>${escapeHtml(formatCard(CARD_NUMBER))}</code>${CARD_HOLDER ? `\n(${escapeHtml(CARD_HOLDER)} nomiga)` : ''}\n\n👆 Karta raqamini bir bosib nusxalashingiz mumkin.`;
      await ctx.replyWithHTML(cardText);

      // Oylik tanlash — bu alohida xabar, keyinroq faqat shuning tugmasi olib tashlanadi
      await ctx.reply(
        "Necha oylik to'lov qilmoqchisiz?",
        Markup.inlineKeyboard([
          [Markup.button.callback('1 oylik', `pmon:${memberId}:1`), Markup.button.callback('2 oylik', `pmon:${memberId}:2`)],
        ])
      );
    } catch (e) {
      console.error('pmonsel xato:', e.message);
    }
  });

  // --- Oylik tanlandi — chek kutiladi ---
  bot.action(/^pmon:(\d+):(\d+)$/, async (ctx) => {
    try {
      const memberId = Number(ctx.match[1]);
      const months = Number(ctx.match[2]);

      await pool.query(`UPDATE payment_requests SET status='cancelled' WHERE member_id=$1 AND status='awaiting_receipt'`, [memberId]);
      await pool.query(
        `INSERT INTO payment_requests (member_id, months, status) VALUES ($1,$2,'awaiting_receipt')`,
        [memberId, months]
      );

      // Faqat shu ("necha oylik") xabarning tugmasini olib tashlaymiz —
      // karta raqami xabari tegilmaydi, u shu yerda qoladi
      await safeClearMarkup(ctx);
      await ctx.answerCbQuery('Tanlandi');

      const text = `✅ ${months} oylik to'lov tanlandi.\n\nTo'lovni amalga oshirgach, chekning (to'lov tasdiqlovchi skrinshot yoki rasm) o'zini shu yerga yuboring.\n\n⚠️ Diqqat: cheklar admin tomonidan tekshiriladi. Tasdiqlangandan keyin to'lov hisobga olinadi. Soxta chek yuborgan aniqlansa, guruhdan chetlatiladi.\n\n❓ Savollar bo'lsa: ${ADMIN_CONTACT}`;
      await ctx.reply(text);
    } catch (e) {
      console.error('pmon xato:', e.message);
    }
  });

  // --- Admin: chekni tasdiqlash ---
  bot.action(/^apay:(\d+)$/, async (ctx) => {
    try {
      if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Ruxsat yo'q");
      const reqId = Number(ctx.match[1]);
      const { rows } = await pool.query('SELECT * FROM payment_requests WHERE id=$1', [reqId]);
      const reqRow = rows[0];
      if (!reqRow || reqRow.status !== 'pending_review') {
        return ctx.answerCbQuery('Bu so\'rov allaqachon hal qilingan');
      }

      const { rows: mRows } = await pool.query(
        'SELECT m.*, g.payment_day AS g_payment_day, g.name AS group_name FROM members m JOIN groups g ON g.id=m.group_id WHERE m.id=$1',
        [reqRow.member_id]
      );
      const member = mRows[0];
      if (!member) return ctx.answerCbQuery('Topilmadi');

      const pd = member.payment_day || member.g_payment_day;
      const { cycleStart, paidUntil } = addNMonths(member, pd, reqRow.months);
      await pool.query('UPDATE members SET paid_until=$2, cycle_start=$3 WHERE id=$1', [member.id, paidUntil, cycleStart]);
      await pool.query(`UPDATE payment_requests SET status='approved' WHERE id=$1`, [reqId]);

      await safeEditCaption(ctx, '\n\n✅ TASDIQLANDI');
      await ctx.answerCbQuery('Tasdiqlandi');

      if (member.telegram_id) {
        const newStatus = statusText({ paid_until: paidUntil, cycle_start: cycleStart });
        await ctx.telegram.sendMessage(
          member.telegram_id,
          `✅ To'lovingiz tasdiqlandi! ${reqRow.months} oylik hisobga olindi.\n\n📌 Yangi holatingiz: ${newStatus}`
        ).catch((e) => console.error('Studentga xabar yuborilmadi:', e.message));
      }
    } catch (e) {
      console.error('apay xato:', e.message);
    }
  });

  // --- Admin: chekni rad etish ---
  bot.action(/^rpay:(\d+)$/, async (ctx) => {
    try {
      if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Ruxsat yo'q");
      const reqId = Number(ctx.match[1]);
      const { rows } = await pool.query('SELECT * FROM payment_requests WHERE id=$1', [reqId]);
      const reqRow = rows[0];
      if (!reqRow || reqRow.status !== 'pending_review') {
        return ctx.answerCbQuery('Bu so\'rov allaqachon hal qilingan');
      }

      await pool.query(`UPDATE payment_requests SET status='rejected' WHERE id=$1`, [reqId]);
      await safeEditCaption(ctx, '\n\n❌ RAD ETILDI');
      await ctx.answerCbQuery('Rad etildi');

      const { rows: mRows } = await pool.query('SELECT * FROM members WHERE id=$1', [reqRow.member_id]);
      const member = mRows[0];
      if (member && member.telegram_id) {
        await ctx.telegram.sendMessage(
          member.telegram_id,
          `❌ Afsuski, yuborgan chekingiz tasdiqlanmadi. Iltimos, to'lovni to'g'ri amalga oshirib qayta urinib ko'ring (/tolov) yoki savol bo'lsa ${ADMIN_CONTACT} ga yozing.`
        ).catch((e) => console.error('Studentga xabar yuborilmadi:', e.message));
      }
    } catch (e) {
      console.error('rpay xato:', e.message);
    }
  });

  // --- Guruhdagi har qanday xabar: a'zoni avtomatik ro'yxatga olish ---
  bot.on('message', async (ctx, next) => {
    try {
      if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        // Admin (men, botni boshqargan odam) o'quvchi sifatida ro'yxatga
        // qo'shilib qolmasligi kerak — guruhda u yozsa ham e'tiborsiz qoldiramiz
        if (ctx.from.id !== ADMIN_ID) {
          await autoRegisterMember(pool, ctx.chat.id, ctx.from);
        }

        // Yangi qo'shilganlarni ham ro'yxatga olish
        const newMembers = ctx.message?.new_chat_members;
        if (newMembers && newMembers.length) {
          for (const nm of newMembers) {
            if (!nm.is_bot && nm.id !== ADMIN_ID) await autoRegisterMember(pool, ctx.chat.id, nm);
          }
        }
      } else if (ctx.chat.type === 'private' && ctx.from.id !== ADMIN_ID) {
        await markStartedBot(pool, ctx.from.id, ctx.from.username, ctx.from.first_name);

        if (ctx.message.photo && ctx.message.photo.length) {
          // Bu "chek" (to'lov skrinshoti) — admin kutgan so'rovga bog'laymiz
          await handleReceiptPhoto(ctx, pool);
        } else {
          await markReplied(pool, ctx.from.id);
        }
      }
    } catch (e) {
      console.error('message handler xato:', e.message);
    }
    return next();
  });

  // --- Guruh ID'sini bilish uchun: shu komandani guruhda yozish kifoya ---
  bot.command('guruhid', async (ctx) => {
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
      return ctx.reply(`Guruh ID: ${ctx.chat.id}`);
    }
    return ctx.reply("Bu komanda faqat guruhlarda ishlaydi.");
  });

  bot.catch((err) => console.error('Bot xatosi:', err));

  return bot;
}

// --- O'quvchiga holat va "To'lov qilish" tugmasini ko'rsatish ---
async function sendPaymentStart(ctx, pool) {
  const { rows: memberships } = await pool.query(
    `SELECT m.*, g.name AS group_name FROM members m JOIN groups g ON g.id=m.group_id
     WHERE m.telegram_id=$1 AND m.removed=false ORDER BY g.name`,
    [ctx.from.id]
  );

  if (!memberships.length) {
    return ctx.reply("Salom! 👋 Siz hozircha hech qanday guruh ro'yxatida emassiz. Agar bu xato bo'lsa, o'qituvchingizga ("+ADMIN_CONTACT+") xabar bering.");
  }

  if (memberships.length === 1) {
    return sendMembershipStatus(ctx, memberships[0]);
  }

  const lines = memberships.map((m) => `• ${m.group_name} — ${m.paid_until ? statusText(m) : "to'lov qilinmagan"}`);
  const text = `Assalomu alaykum, ${ctx.from.first_name || ''}! 👋\n\nSiz quyidagi guruhlarda ro'yxatdasiz:\n\n${lines.join('\n')}\n\nQaysi guruh uchun to'lov qilmoqchisiz?`;
  const buttons = memberships.map((m) => [Markup.button.callback(m.group_name, `pmonsel:${m.id}`)]);
  return ctx.reply(text, Markup.inlineKeyboard(buttons));
}

async function sendMembershipStatus(ctx, membership) {
  const statusLine = membership.paid_until ? statusText(membership) : "Hozircha to'lov qilinmagan.";
  const text = `Assalomu alaykum, ${ctx.from.first_name || ''}! 👋\n\nSiz "${membership.group_name}" guruhidasiz.\n\n📌 Holatingiz: ${statusLine}\n\nTo'lovni amalga oshirish uchun pastdagi tugmani bosing.`;
  return ctx.reply(text, Markup.inlineKeyboard([
    [Markup.button.callback("💳 To'lov qilish", `pmonsel:${membership.id}`)],
  ]));
}

// --- Chek (rasm) qabul qilinganda — admin kutgan so'rovga bog'lab, adminga yuborish ---
async function handleReceiptPhoto(ctx, pool) {
  const { rows } = await pool.query(
    `SELECT pr.*, m.first_name, m.username, m.telegram_id, g.name AS group_name
     FROM payment_requests pr
     JOIN members m ON m.id = pr.member_id
     JOIN groups g ON g.id = m.group_id
     WHERE m.telegram_id = $1 AND pr.status = 'awaiting_receipt'
     ORDER BY pr.created_at DESC LIMIT 1`,
    [ctx.from.id]
  );
  const pending = rows[0];
  if (!pending) {
    return ctx.reply(`Avval "💳 To'lov qilish" tugmasini bosib, necha oylik ekanini tanlang (/tolov).`);
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  await pool.query(`UPDATE payment_requests SET status='pending_review', telegram_file_id=$2 WHERE id=$1`, [pending.id, photo.file_id]);

  const caption = `🧾 Yangi to'lov cheki\n\n👤 ${pending.first_name || 'Nomsiz'}${pending.username ? ` (@${pending.username})` : ''}\n🆔 ${ctx.from.id}\n👥 Guruh: ${pending.group_name}\n🗓 ${pending.months} oylik to'lov\n\nTasdiqlaysizmi?`;
  try {
    const sent = await ctx.telegram.sendPhoto(ADMIN_ID, photo.file_id, {
      caption,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Tasdiqlash', callback_data: `apay:${pending.id}` },
          { text: '❌ Rad etish', callback_data: `rpay:${pending.id}` },
        ]],
      },
    });
    await pool.query(`UPDATE payment_requests SET admin_message_id=$2 WHERE id=$1`, [pending.id, sent.message_id]);
    await ctx.reply("✅ Chekingiz qabul qilindi. Admin tekshirib, tasdiqlagandan so'ng to'lovingiz hisobga olinadi. Iltimos, kuting.");
  } catch (e) {
    console.error('Chekni adminga yuborishda xato:', e.message);
    await ctx.reply(`Chekni yuborishda xatolik yuz berdi. Iltimos, to'g'ridan-to'g'ri ${ADMIN_CONTACT} ga yuboring.`);
  }
}

// Caption oxiriga admin qarori natijasini qo'shib, tugmalarni olib tashlaymiz
async function safeEditCaption(ctx, suffix) {
  try {
    const msg = ctx.update.callback_query.message;
    const newCaption = (msg.caption || '') + suffix;
    await ctx.telegram.editMessageCaption(msg.chat.id, msg.message_id, undefined, newCaption, {
      reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {
    console.error('Caption tahrirlashda xato:', e.message);
  }
}

function formatCard(num) {
  return String(num).replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Callback tugma bosilgan xabarning faqat tugmasini olib tashlaydi,
// matnini (masalan, karta raqamini) tegmay qoldiradi
async function safeClearMarkup(ctx) {
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (e) {
    // e'tiborsiz — xabar allaqachon o'zgargan/eski bo'lishi mumkin
  }
}

async function autoRegisterMember(pool, chatId, user) {
  const { rows } = await pool.query('SELECT id FROM groups WHERE chat_id = $1', [chatId]);
  if (!rows.length) return; // bu guruh mini appda ro'yxatdan o'tmagan
  const groupId = rows[0].id;

  await pool.query(
    `INSERT INTO members (group_id, telegram_id, username, first_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, telegram_id)
     DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, removed = false`,
    [groupId, user.id, user.username || null, user.first_name || '']
  );
}

async function markStartedBot(pool, telegramId, username, firstName) {
  // Agar bu odam avval faqat username bilan (ID'siz, chunki username'i bor
  // edi lekin guruhda yozmagan edi) qo'shilgan bo'lsa — start bosganda uning
  // haqiqiy Telegram ID'si endi ma'lum bo'ladi va shu yerga yozib qo'yamiz.
  // Shundan keyin avto-xabar va avto-chiqarish ham ishlay boshlaydi.
  if (username) {
    await pool.query(
      `UPDATE members SET telegram_id = $1, started_bot = true,
         first_name = COALESCE($3, first_name)
       WHERE telegram_id IS NULL AND lower(username) = lower($2)`,
      [telegramId, username, firstName || null]
    );
  }
  await pool.query(
    `UPDATE members SET started_bot = true,
       username = COALESCE($2, username), first_name = COALESCE($3, first_name)
     WHERE telegram_id = $1`,
    [telegramId, username || null, firstName || null]
  );
}

async function markReplied(pool, telegramId) {
  await pool.query(
    `UPDATE broadcast_recipients br
     SET replied = true, replied_at = now()
     FROM members m
     WHERE br.member_id = m.id AND m.telegram_id = $1 AND br.sent = true AND br.replied = false`,
    [telegramId]
  );
}

module.exports = { createBot, ADMIN_ID };
