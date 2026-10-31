const { Pool, types } = require('pg');

// DATE ustunlarini JS Date obyektiga emas, 'YYYY-MM-DD' string sifatida qaytarish
// (aks holda server vaqt zonasi sabab sanalar 1 kunga siljib ketishi mumkin)
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      chat_id BIGINT UNIQUE NOT NULL,
      category TEXT NOT NULL DEFAULT 'Attestatsiya',
      payment_day INT NOT NULL DEFAULT 1,
      price BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      telegram_id BIGINT,
      username TEXT,
      first_name TEXT,
      payment_day INT,
      paid_until DATE,
      cycle_start DATE,
      started_bot BOOLEAN NOT NULL DEFAULT false,
      removed BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(group_id, telegram_id)
    );

    CREATE TABLE IF NOT EXISTS broadcasts (
      id SERIAL PRIMARY KEY,
      group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS broadcast_recipients (
      id SERIAL PRIMARY KEY,
      broadcast_id INT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      member_id INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      sent BOOLEAN NOT NULL DEFAULT false,
      error TEXT,
      replied BOOLEAN NOT NULL DEFAULT false,
      replied_at TIMESTAMPTZ
    );

    ALTER TABLE members ADD COLUMN IF NOT EXISTS cycle_start DATE;

    CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id);
    `);

  // Admin (botni boshqargan odam) oldin xato tarzda o'quvchi sifatida
  // ro'yxatga tushib qolgan bo'lsa — bu yerda tozalaymiz
  const adminId = Number(process.env.ADMIN_ID);
  if (adminId) {
    await pool.query('UPDATE members SET removed = true WHERE telegram_id = $1 AND removed = false', [adminId]);
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_members_telegram_id ON members(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_member ON broadcast_recipients(member_id);
  `);
  console.log('DB migratsiya tayyor');
}

module.exports = { pool, migrate };
