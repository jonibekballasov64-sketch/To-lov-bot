// To'lov holati va sanalar bilan ishlash uchun yordamchi funksiyalar

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Keyingi to'lov kuni (payment_day) ga mos boshlang'ich sana topish
function nextCycleStart(paymentDay) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(paymentDay, 28)));
  return d.toISOString().slice(0, 10);
}

// member uchun effektiv to'lov kuni (individual bo'lsa o'sha, bo'lmasa guruhniki)
function effectivePaymentDay(member, group) {
  return member.payment_day || group.payment_day;
}

// "1 oylik to'lov qilindi" bosilganda yangi paid_until hisoblash
function addOneMonth(paidUntil, paymentDay) {
  const today = todayISO();
  const base = paidUntil && paidUntil >= today ? paidUntil : nextCycleStart(paymentDay);
  return addMonths(base, 1);
}

// "- 1 oylik" bosilganda ortga qaytarish
function subtractOneMonth(paidUntil, paymentDay) {
  if (!paidUntil) return null;
  const result = addMonths(paidUntil, -1);
  const floor = nextCycleStart(paymentDay);
  return result <= floor ? null : result;
}

function isDebtor(paidUntil) {
  if (!paidUntil) return true;
  return paidUntil < todayISO();
}

function statusText(member) {
  if (!member.paid_until) return "To'lov qilinmagan";
  const until = new Date(member.paid_until + 'T00:00:00Z');
  const from = new Date(until);
  from.setUTCMonth(from.getUTCMonth() - 1);
  const fmt = (d) => `${d.getUTCDate()}-${MONTHS_UZ[d.getUTCMonth()]}`;
  return `${fmt(from)}dan ${fmt(until)}gacha`;
}

const MONTHS_UZ = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

module.exports = {
  todayISO, addMonths, nextCycleStart, effectivePaymentDay,
  addOneMonth, subtractOneMonth, isDebtor, statusText,
};
