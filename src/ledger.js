// To'lov tarixi (ledger) yordamchisi — "Bu oy yig'ilgan" statistikasi uchun
// har safar haqiqatda pul tushgan/bekor qilingan deb hisoblanganda shu yerga
// yoziladi. amount 0 yoki noma'lum (null/NaN) bo'lsa — yozilmaydi (masalan,
// guruhda narx umuman kiritilmagan bo'lsa, summani hisoblab bo'lmaydi).
async function logPayment(pool, { memberId, groupId, amount, kind }) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return;
  try {
    await pool.query(
      'INSERT INTO payment_log (member_id, group_id, amount, kind) VALUES ($1,$2,$3,$4)',
      [memberId || null, groupId || null, Math.round(n), kind]
    );
  } catch (e) {
    // To'lov tarixi ikkinchi darajali ma'lumot — yozib bo'lmasa ham asosiy
    // amal (to'lovni belgilash) muvaffaqiyatsiz bo'lib qolmasligi kerak
    console.error("To'lov tarixiga yozishda xato:", e.message);
  }
}

module.exports = { logPayment };
