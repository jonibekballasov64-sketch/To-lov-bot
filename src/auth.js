const crypto = require('crypto');

// Telegram WebApp initData'ni tekshirish (soxta so'rovlarning oldini olish)
function validateInitData(initData, botToken) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckArr = [];
  for (const [key, value] of [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    dataCheckArr.push(`${key}=${value}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userStr = params.get('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

function adminAuthMiddleware(botToken, adminId) {
  return (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];
    const user = validateInitData(initData, botToken);
    if (!user || user.id !== adminId) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    req.tgUser = user;
    next();
  };
}

module.exports = { validateInitData, adminAuthMiddleware };
