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
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', createApi(pool, bot));

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server ${port} portda ishlayapti`));

  // Webhook o'rniga oddiy polling (Railway uchun eng oson usul)
  bot.launch();
  console.log('Bot ishga tushdi');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((e) => {
  console.error('Ishga tushmadi:', e);
  process.exit(1);
});
