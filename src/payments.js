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

// "1 oylik to'lov qilindi" bosilganda — a'zoning joriy holatiga (paid_until,
// cycle_start) qarab yangi paid_until va cycle_start hisoblash.
// MUHIM: agar davom etayotgan to'lov sikli bo'lsa (paid_until bugungidan katta),
// sikl BOSHLANGAN SANA (cycle_start) o'zgarmaydi — faqat oxirgi sana 1 oyga
// suriladi. Yangi sikl faqat to'lov umuman yo'q yoki muddati o'tgan bo'lsagina
// boshlanadi.
function addOneMonth(member, paymentDay) {
  const today = todayISO();
  const paidUntil = member.paid_until;
  const freshCycle = !paidUntil || paidUntil < today;
  if (freshCycle) {
    const cycleStart = nextCycleStart(paymentDay);
    return { cycleStart, paidUntil: addMonths(cycleStart, 1) };
  }
  const cycleStart = member.cycle_start || nextCycleStart(paymentDay);
  return { cycleStart, paidUntil: addMonths(paidUntil, 1) };
}

// "- 1 oylik" bosilganda ortga qaytarish — cycle_start ham mos ravishda saqlanadi
// yoki (sikl butunlay tugasa) tozalanadi
function subtractOneMonth(member, paymentDay) {
  if (!member.paid_until) return { cycleStart: null, paidUntil: null };
  const cycleStart = member.cycle_start || nextCycleStart(paymentDay);
  const result = addMonths(member.paid_until, -1);
  if (result <= cycleStart) return { cycleStart: null, paidUntil: null };
  return { cycleStart, paidUntil: result };
}

function isDebtor(paidUntil) {
  if (!paidUntil) return true;
  return paidUntil < todayISO();
}

// Ko'rinadigan "sana oralig'i" — sikl boshlangan sanadan (cycle_start, agar
// bo'lsa) joriy paid_until'gacha. Eski (cycle_start yozilmagan) a'zolar uchun
// faqat oxirgi 1 oylik oraliqni ko'rsatamiz.
function statusText(member) {
  if (!member.paid_until) return "To'lov qilinmagan";
  const until = new Date(member.paid_until + 'T00:00:00Z');
  let from;
  if (member.cycle_start) {
    from = new Date(member.cycle_start + 'T00:00:00Z');
  } else {
    from = new Date(until);
    from.setUTCMonth(from.getUTCMonth() - 1);
  }
  const fmt = (d) => `${d.getUTCDate()}-${MONTHS_UZ[d.getUTCMonth()]}`;
  return `${fmt(from)}dan ${fmt(until)}gacha`;
}

// Nechta oylik to'lov qilib qo'yilganini hisoblash — sikl boshlangan sanadan
// (cycle_start) paid_until'gacha bo'lgan to'liq oylar soni
function monthsPaid(paidUntil, cycleStart, paymentDay) {
  if (!paidUntil) return 0;
  const start = cycleStart || nextCycleStart(paymentDay);
  const s = new Date(start + 'T00:00:00Z');
  const u = new Date(paidUntil + 'T00:00:00Z');
  const months = (u.getUTCFullYear() - s.getUTCFullYear()) * 12 + (u.getUTCMonth() - s.getUTCMonth());
  return Math.max(months, 0);
}

function monthsPaidLabel(paidUntil, cycleStart, paymentDay) {
  const n = monthsPaid(paidUntil, cycleStart, paymentDay);
  if (n <= 0) return null;
  return `${n} oylik to'lov qilingan`;
}

const MONTHS_UZ = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

module.exports = {
  todayISO, addMonths, nextCycleStart, effectivePaymentDay,
  addOneMonth, subtractOneMonth, isDebtor, statusText,
  monthsPaid, monthsPaidLabel,
};
