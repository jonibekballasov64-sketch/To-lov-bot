const { Telegraf, Markup } = require('telegraf');

const ADMIN_ID = Number(process.env.ADMIN_ID);

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
      // Oddiy o'quvchi botga /start bosdi — endi unga xabar yuborish mumkin bo'ladi
      await markStartedBot(pool, fromId, ctx.from.username, ctx.from.first_name);
      return ctx.reply("Salom! Botga xush kelibsiz.");
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
        // O'quvchi botga shaxsiy yozdi — "javob yozdi" deb belgilaymiz
        await markStartedBot(pool, ctx.from.id, ctx.from.username, ctx.from.first_name);
        await markReplied(pool, ctx.from.id);
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
