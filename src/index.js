require('dotenv').config();
const path = require('path');
const express = require('express');
const { pool, migrate } = require('./db');
const { createBot } = require('./bot');
const { createApi } = require('./api');

async function main() {
  await migrate();

  const bot = createBot(pool);
  const app = express();
  app.use(express.json());
  // Telegram Mini App ba'zan eski JS/CSS'ni keshdan ko'rsatadi — buni butunlay o'chirib qo'yamiz
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  }));
  app.use('/api', createApi(pool, bot));

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server ${port} portda ishlayapti`));

  // Webhook o'rniga oddiy polling (Railway uchun eng oson usul).
  // MUHIM: bot.launch() xato bersa ham (masalan "409 Conflict: ikki joyda ishlayapti"
  // — redeploy paytida eski va yangi versiya bir lahza ustma-ust tushganda chiqadi),
  // bu butun serverni (va Mini App'ni) yiqitib yubormasligi kerak. Shuning uchun
  // xatoni shu yerda ushlab, faqat logga yozamiz va bir necha soniyadan keyin
  // qayta urinib ko'ramiz — server esa doim ishlab turadi.
  function startBotPolling(attempt = 1) {
    bot.launch().catch((err) => {
      console.error(`Bot polling xatosi (${attempt}-urinish):`, err.message || err);
      const delay = Math.min(5000 * attempt, 30000);
      setTimeout(() => startBotPolling(attempt + 1), delay);
    });
  }
  startBotPolling();
  console.log('Bot ishga tushirildi (server undan mustaqil ishlayveradi)');

  process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}

main().catch((e) => {
  console.error('Ishga tushmadi:', e);
  process.exit(1);
});

// Qolgan har qanday kutilmagan xato ham serverni yiqitmasin
process.on('unhandledRejection', (err) => {
  console.error('Kutilmagan xato (unhandledRejection):', err);
});
process.on('uncaughtException', (err) => {
  console.error('Kutilmagan xato (uncaughtException):', err);
});
