// Har qanday jiddiy xatoni ekranga chiqarish (bo'sh oyna qolib ketmasligi uchun).
// Tashqi/begona manbadan kelgan, aniqlik bermaydigan "Script error." kabi
// xabarlarni e'tiborsiz qoldiramiz — ular haqiqiy ilova xatosi emas va
// butun ekranni bekorga bosib qo'ymasligi kerak.
window.addEventListener('error', (e) => {
  if (!e.error || !e.error.stack) {
    console.error('E\'tiborsiz qoldirilgan xato:', e.message);
    return;
  }
  showFatalError(e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  // Agar bu api() orqali chiqqan, allaqachon toast bilan ko'rsatilgan xato bo'lsa —
  // ekranni bekorga bo'shatib yubormaymiz, shunchaki logga yozamiz
  if (e.reason && e.reason.alreadyToasted) {
    console.error('Xato (toast orqali ko\'rsatildi):', e.reason.message);
    e.preventDefault();
    return;
  }
  showFatalError(e.reason);
});
function showFatalError(err) {
  const msg = (err && err.stack) ? err.stack : String(err);
  const box = document.getElementById('app') || document.body;
  box.innerHTML = `<div style="padding:20px;font-family:monospace;font-size:12px;white-space:pre-wrap;color:#e5484d;background:#fff;">XATOLIK:\n${msg}\n\n</div>
    <div style="padding:0 20px;"><button class="btn" onclick="location.reload()">🔄 Qayta yuklash</button></div>`;
}

// Telegram ba'zi tarmoqlarda sekin/ishlamay qolishi mumkin bo'lgan telegram.org
// skriptiga qaramay ishlashi uchun, initData'ni to'g'ridan-to'g'ri URL'dan ham
// ushlab olamiz (Telegram buni Mini App ochganda location.hash orqali yuboradi)
let TG_INIT_DATA_FALLBACK = '';
try {
  const rawHash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (rawHash.includes('tgWebAppData=')) {
    const params = new URLSearchParams(rawHash);
    const data = params.get('tgWebAppData');
    if (data) TG_INIT_DATA_FALLBACK = data;
    // O'zimizning ichki marshrutlashimiz (go('/groups') va h.k.) bilan
    // to'qnashmasligi uchun Telegram qo'shib bergan hashni tozalaymiz
    history.replaceState(null, '', location.pathname + location.search);
  }
} catch (e) {
  console.error('initData hash tahlili xatosi:', e);
}

let tg = null;
try {
  tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
} catch (e) {
  console.error('Telegram WebApp init xatosi:', e);
}

const el = document.getElementById('app');
let GROUPS_CACHE = [];

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': (tg && tg.initData) ? tg.initData : TG_INIT_DATA_FALLBACK,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error || 'Xatolik yuz berdi');
    const err = new Error(data.error || 'Xatolik');
    err.alreadyToasted = true; // bu xato haqida foydalanuvchiga toast orqali aytildi — ekranni bekor bo'shatmaymiz
    throw err;
  }
  return data;
}

function go(hash) { location.hash = hash; }

function topbar(title, backHash) {
  return `<div class="topbar">
    ${backHash ? `<div class="back" onclick="go('${backHash}')">←</div>` : ''}
    <h1>${title}</h1>
  </div>`;
}

function catBadge(cat) {
  return cat === 'Milliy sertifikat'
    ? `<span class="badge ms">Milliy sertifikat</span>`
    : `<span class="badge att">Attestatsiya</span>`;
}

// Mini App'ni kim ochganini bir marta tekshiramiz — agar admin bo'lmasa
// (masalan, BotFather'dagi umumiy menyu tugmasi orqali boshqa o'quvchi ochib
// qo'ysa), hech qanday boshqaruv tugmasini ko'rsatmaymiz
let ADMIN_CHECKED = false;
let IS_ADMIN = true;
async function ensureAdmin() {
  if (ADMIN_CHECKED) return IS_ADMIN;
  try {
    const res = await fetch('/api/whoami', {
      headers: { 'X-Telegram-Init-Data': (tg && tg.initData) ? tg.initData : TG_INIT_DATA_FALLBACK },
    });
    IS_ADMIN = res.status !== 403;
  } catch (e) {
    console.error('Admin tekshiruvi xatosi:', e);
    IS_ADMIN = true; // tarmoq xatosi bo'lsa, haqiqiy adminni bekorga bloklamaymiz
  }
  ADMIN_CHECKED = true;
  return IS_ADMIN;
}
function renderBlocked() {
  el.innerHTML = `<div style="padding:60px 20px;text-align:center;">
    <div style="font-size:40px;margin-bottom:12px;">🔒</div>
    <div style="font-weight:600;font-size:15.5px;margin-bottom:6px;">Ruxsat yo'q</div>
    <div style="color:var(--hint);font-size:13.5px;">Bu ilova faqat administrator uchun.</div>
  </div>`;
}

// ---------------- ROUTER ----------------
window.addEventListener('hashchange', render);
// Skript sahifa oxirida joylashgani uchun DOM allaqachon tayyor — shu zahoti chizamiz
// (DOMContentLoaded hodisasi allaqachon o'tib ketgan bo'lishi mumkin, shuning uchun unga tayanmaymiz)
render();

async function render() {
  const isAdmin = await ensureAdmin();
  if (!isAdmin) return renderBlocked();

  const hash = location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);
  // Xatolar shu yerda "tutib qolinsin" (ekranni bekorga bo'shatib yubormasin) —
  // api() xatoni allaqachon toast orqali ko'rsatadi, shuning uchun bu yerda
  // faqat logga yozamiz va navigatsiyani davom ettiramiz.
  try {
    if (parts.length === 0) return await renderMenu();
    if (parts[0] === 'create-group') return await renderCreateGroup();
    if (parts[0] === 'groups' && parts.length === 1) return await renderGroupsList();
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'edit') return await renderEditGroup(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'add-member') return await renderAddMember(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'bulk-add') return await renderBulkAdd(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'broadcast') return await renderBroadcast(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'kick-debtors') return await renderKickDebtors(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'non-repliers') return await renderNonRepliers(parts[1]);
    if (parts[0] === 'groups' && parts[1]) return await renderGroupDetail(parts[1]);
    if (parts[0] === 'debtors') return await renderDebtors();
    if (parts[0] === 'paid') return await renderPaid();
  } catch (e) {
    console.error(e);
  }
}

// ---------------- MENU ----------------
async function renderMenu() {
  el.innerHTML = `${topbar("To'lov nazorati")}
    <div class="menu-grid">
      <div class="menu-card" onclick="go('/create-group')">
        <div class="icon">➕</div><div class="label">Guruh yaratish</div>
      </div>
      <div class="menu-card" onclick="go('/groups')">
        <div class="icon">👥</div><div class="label">Guruhlar</div>
        <div class="count" id="cnt-groups">...</div>
      </div>
      <div class="menu-card" onclick="go('/debtors')">
        <div class="icon">🔴</div><div class="label">Qarzdorlar</div>
        <div class="count" id="cnt-debtors">...</div>
      </div>
      <div class="menu-card" onclick="go('/paid')">
        <div class="icon">🟢</div><div class="label">To'langanlar</div>
        <div class="count" id="cnt-paid">...</div>
      </div>
    </div>`;
  const groups = await api('GET', '/groups');
  GROUPS_CACHE = groups;
  document.getElementById('cnt-groups').textContent = groups.length + ' ta guruh';
  const totalDebt = groups.reduce((s, g) => s + Number(g.debtor_count), 0);
  const totalMembers = groups.reduce((s, g) => s + Number(g.member_count), 0);
  document.getElementById('cnt-debtors').textContent = totalDebt + ' ta o\'quvchi';
  document.getElementById('cnt-paid').textContent = (totalMembers - totalDebt) + ' ta o\'quvchi';
}

// ---------------- GURUH YARATISH ----------------
function renderCreateGroup() {
  el.innerHTML = `${topbar('Guruh yaratish', '/')}
    <div class="card">
      <div class="field"><label>Guruh nomi</label><input id="f-name" placeholder="75-baza guruh MS"></div>
      <div class="field"><label>Toifa</label>
        <select id="f-cat">
          <option value="Attestatsiya">Attestatsiya</option>
          <option value="Milliy sertifikat">Milliy sertifikat</option>
        </select>
      </div>
      <div class="field"><label>Guruh ID (Telegram chat_id, masalan -1001234567890)</label><input id="f-chatid" placeholder="-100..." inputmode="numeric"></div>
      <div class="field"><label>Oylik to'lov sanasi (kuni, 1-28)</label><input id="f-day" type="number" min="1" max="28" placeholder="8"></div>
      <div class="field"><label>Oylik to'lov summasi (ixtiyoriy)</label><input id="f-price" type="number" placeholder="150000"></div>
    </div>
    <div class="card">
      <div class="field"><label>Dars boshlanish sanasi (ixtiyoriy)</label><input id="f-startdate" type="date"></div>
      <p style="color:var(--hint);font-size:12px;margin:-4px 0 10px;">Agar shu sanani kiritsangiz, link orqali (yoki qo'lda) qo'shilgan o'quvchilar AVTOMATIK to'lagan sifatida ro'yxatga olinadi — chunki linkni faqat to'lov qilganlarga berasiz.</p>
      <div class="field"><label>To'lov turi</label>
        <select id="f-ptype" onchange="toggleOneTimeField()">
          <option value="monthly">Oylik</option>
          <option value="one_time">Bir martalik (masalan, imtihongacha)</option>
        </select>
      </div>
      <div class="field" id="f-onetime-wrap" style="display:none;"><label>Qaysi sanagacha to'lov amal qiladi</label><input id="f-onetime" type="date"></div>
    </div>
    <button class="btn" onclick="submitCreateGroup()">Yaratish</button>
    <p style="color:var(--hint);font-size:12.5px;padding:0 4px;">Eslatma: botni shu guruhga admin qilib qo'shganingizga ishonch hosil qiling — aks holda a'zolarni avtomatik ko'ra olmaydi.</p>`;
}

function toggleOneTimeField() {
  const t = document.getElementById('f-ptype').value;
  document.getElementById('f-onetime-wrap').style.display = t === 'one_time' ? '' : 'none';
}

async function submitCreateGroup() {
  const name = document.getElementById('f-name').value.trim();
  const category = document.getElementById('f-cat').value;
  const chat_id = document.getElementById('f-chatid').value.trim();
  const payment_day = Number(document.getElementById('f-day').value);
  const price = Number(document.getElementById('f-price').value) || 0;
  const start_date = document.getElementById('f-startdate').value || null;
  const payment_type = document.getElementById('f-ptype').value;
  const one_time_until = document.getElementById('f-onetime').value || null;
  if (!name || !chat_id || !payment_day) return toast("Nom, guruh ID va to'lov sanasini to'ldiring");
  if (payment_type === 'one_time' && start_date && !one_time_until) {
    return toast("Bir martalik to'lov uchun qaysi sanagacha ekanini kiriting");
  }
  const g = await api('POST', '/groups', { name, category, chat_id, payment_day, price, start_date, payment_type, one_time_until });
  toast('Guruh yaratildi');
  go('/groups/' + g.id);
}

// ---------------- GURUHLAR RO'YXATI ----------------
async function renderGroupsList() {
  el.innerHTML = `${topbar('Guruhlar', '/')}<div id="list">Yuklanmoqda...</div>`;
  const groups = await api('GET', '/groups');
  GROUPS_CACHE = groups;
  if (!groups.length) {
    document.getElementById('list').innerHTML = `<div class="empty">Hali guruh yo'q.<br><br><button class="btn" onclick="go('/create-group')">Birinchi guruhni yaratish</button></div>`;
    return;
  }
  function groupCard(g) {
    return `<div class="card group-row" onclick="go('/groups/${g.id}')" style="cursor:pointer">
      <div>
        <div class="name">${g.name}</div>
        <div class="meta">${g.member_count} a'zo</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${Number(g.debtor_count) > 0 ? `<span class="badge debt">${g.debtor_count} qarzdor</span>` : `<span class="badge ok">to'liq</span>`}
        <span class="chev">›</span>
      </div>
    </div>`;
  }

  // Attestatsiya va Milliy Sertifikat guruhlari alohida to'plamda ko'rsatiladi
  const att = groups.filter((g) => g.category !== 'Milliy sertifikat');
  const ms = groups.filter((g) => g.category === 'Milliy sertifikat');
  document.getElementById('list').innerHTML = `
    ${att.length ? `<div class="section-title">${catBadge('Attestatsiya')} (${att.length})</div>${att.map(groupCard).join('')}` : ''}
    ${ms.length ? `<div class="section-title">${catBadge('Milliy sertifikat')} (${ms.length})</div>${ms.map(groupCard).join('')}` : ''}
  `;
}

// ---------------- GURUH DETAIL ----------------
async function renderGroupDetail(id) {
  el.innerHTML = `${topbar('Yuklanmoqda...', '/groups')}<div id="body"></div>`;
  const [groups, members] = await Promise.all([api('GET', '/groups'), api('GET', `/groups/${id}/members`)]);
  const g = groups.find((x) => String(x.id) === String(id));
  if (!g) return;
  document.querySelector('.topbar h1').textContent = g.name;

  const debtors = members.filter((m) => m.is_debtor);
  const paid = members.filter((m) => !m.is_debtor);

  function memberHtml(m) {
    return `<div class="member-card">
      <div class="member-top">
        <div class="member-name">${m.first_name || 'Nomsiz'}${m.username ? `<span class="member-username">@${m.username}</span>` : ''}</div>
        <span class="status-pill ${m.is_debtor ? 'debt' : 'ok'}">${m.status_text}</span>
      </div>
      ${m.months_paid_label ? `<div class="months-paid-label">${m.months_paid_label}</div>` : ''}
      ${!m.started_bot ? `<div class="no-bot-warning">🔒 Botga /start bosmagan — avto xabar yubora olmaymiz, qarzdorligi shu ro'yxatda ko'rinib turadi</div>` : ''}
      <div class="member-actions">
        <button class="icon-btn minus" onclick="memberUnpay(${m.id})" title="1 oy ayirish">−</button>
        <button class="icon-btn plus" onclick="memberPay(${m.id})" title="1 oylik to'lov qo'shish">+</button>
        <span class="actions-divider"></span>
        <button class="icon-btn" onclick="editMemberDay(${m.id}, ${m.payment_day || g.payment_day})" title="To'lov sanasi${m.payment_day ? ` (individual: ${m.payment_day})` : ''}">📅</button>
        ${chatLink(m) ? `<button class="icon-btn" onclick="window.open('${chatLink(m)}','_blank')" title="Yozish">✉️</button>` : ''}
        <button class="icon-btn danger-ghost" onclick="removeMember(${m.id})" title="Ro'yxatdan olib tashlash">🗑</button>
      </div>
    </div>`;
  }

  document.getElementById('body').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>${catBadge(g.category)} <span class="badge" style="background:rgba(0,0,0,0.05)">Har oy ${g.payment_day}-sana</span></div>
        <div style="display:flex;gap:6px;">
          <button class="btn small secondary" onclick="go('/groups/${id}/edit')">Tahrirlash</button>
        </div>
      </div>
      ${g.price > 0 ? `<div class="meta" style="margin-top:6px;">Narx: ${Number(g.price).toLocaleString()} so'm/oy</div>` : ''}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
      <button class="btn secondary" onclick="go('/groups/${id}/add-member')">➕ A'zo qo'shish</button>
      <button class="btn secondary" onclick="go('/groups/${id}/broadcast')">✉️ Xabar yozish</button>
    </div>
    <button class="btn secondary" onclick="postDebtorsList(${id})" ${debtors.length ? '' : 'disabled style="opacity:0.5"'}>📋 Qarzdorlar ro'yxatini guruhga yuborish</button>
    <button class="btn danger" onclick="go('/groups/${id}/kick-debtors')" ${debtors.length ? '' : 'disabled style="opacity:0.5"'}>🚫 Qarzdorlarni guruhdan chiqarish (${debtors.length})</button>

    <div class="section-title">Qarzdorlar (${debtors.length})</div>
    ${debtors.length ? debtors.map(memberHtml).join('') : `<div class="empty">Qarzdor yo'q 🎉</div>`}

    <div class="section-title">To'laganlar (${paid.length})</div>
    ${paid.length ? paid.map(memberHtml).join('') : `<div class="empty">Hali hech kim to'lamagan</div>`}
  `;
}

async function postDebtorsList(groupId) {
  if (!confirm("Qarzdorlar ro'yxati guruhga oddiy xabar sifatida yuborilsinmi?")) return;
  const res = await api('POST', `/groups/${groupId}/post-debtors-list`);
  toast(`Guruhga yuborildi (${res.count} ta qarzdor)`);
}

// Ro'yxatni joyida yangilaydi, lekin sahifa boshiga "qalqib" ketmasligi uchun
// joriy scroll pozitsiyasini saqlab, render() tugagach qaytarib qo'yadi
async function renderKeepScroll() {
  const y = window.scrollY;
  await render();
  // Yangi DOM joylashguncha (reflow) bir lahza kutamiz — aks holda ba'zi
  // brauzer/webview'larda scrollTo hali eski (qisqaroq) balandlikka qarab
  // ishlab, to'liq ishlamasligi mumkin
  requestAnimationFrame(() => window.scrollTo(0, y));
}

async function memberPay(id) {
  const m = await api('POST', `/members/${id}/pay`);
  toast("To'lov qo'shildi: " + m.status_text);
  renderKeepScroll();
}
async function memberUnpay(id) {
  await api('POST', `/members/${id}/unpay`);
  toast('Bekor qilindi');
  renderKeepScroll();
}
async function removeMember(id) {
  if (!confirm("Bu a'zoni ro'yxatdan olib tashlaymi? (guruhdan chiqarilmaydi, faqat ro'yxatdan)")) return;
  await api('DELETE', `/members/${id}`);
  renderKeepScroll();
}
async function editMemberDay(id, current) {
  const val = prompt("Shu a'zo uchun to'lov sanasi (1-28):", current);
  if (!val) return;
  await api('PUT', `/members/${id}`, { payment_day: Number(val) });
  toast('Sana yangilandi');
  renderKeepScroll();
}
async function deleteGroup(id) {
  await api('DELETE', `/groups/${id}`);
  toast("Guruh o'chirildi");
  go('/groups');
}

// ---------------- GURUH TAHRIRLASH ----------------
async function renderEditGroup(id) {
  const groups = await api('GET', '/groups');
  const g = groups.find((x) => String(x.id) === String(id));
  if (!g) return go('/groups');
  el.innerHTML = `${topbar('Guruhni tahrirlash', '/groups/' + id)}
    <div class="card">
      <div class="field"><label>Nom</label><input id="f-name" value="${g.name}"></div>
      <div class="field"><label>Toifa</label>
        <select id="f-cat">
          <option value="Attestatsiya" ${g.category === 'Attestatsiya' ? 'selected' : ''}>Attestatsiya</option>
          <option value="Milliy sertifikat" ${g.category === 'Milliy sertifikat' ? 'selected' : ''}>Milliy sertifikat</option>
        </select>
      </div>
      <div class="field"><label>To'lov sanasi</label><input id="f-day" type="number" min="1" max="28" value="${g.payment_day}"></div>
      <div class="field"><label>Narx</label><input id="f-price" type="number" value="${g.price}"></div>
    </div>
    <div class="card">
      <div class="field"><label>Dars boshlanish sanasi (ixtiyoriy)</label><input id="f-startdate" type="date" value="${g.start_date || ''}"></div>
      <p style="color:var(--hint);font-size:12px;margin:-4px 0 10px;">Shu sana kiritilgan bo'lsa, link orqali (yoki qo'lda) qo'shilgan o'quvchilar avtomatik to'lagan sifatida ro'yxatga olinadi.</p>
      <div class="field"><label>To'lov turi</label>
        <select id="f-ptype" onchange="toggleOneTimeField()">
          <option value="monthly" ${g.payment_type !== 'one_time' ? 'selected' : ''}>Oylik</option>
          <option value="one_time" ${g.payment_type === 'one_time' ? 'selected' : ''}>Bir martalik (masalan, imtihongacha)</option>
        </select>
      </div>
      <div class="field" id="f-onetime-wrap" style="${g.payment_type === 'one_time' ? '' : 'display:none;'}"><label>Qaysi sanagacha to'lov amal qiladi</label><input id="f-onetime" type="date" value="${g.one_time_until || ''}"></div>
    </div>
    <button class="btn" onclick="submitEditGroup(${id})">Saqlash</button>

    <div id="delete-zone" style="text-align:center;margin-top:22px;">
      <span class="link-ghost-danger" onclick="showDeleteConfirm(${id})">Guruhni o'chirish</span>
    </div>`;
}

// Tasodifan bosilib ketmasligi uchun — kichik, chetga surilgan tugma, bosilganda
// aniq ikki tugmali (Ha / Yo'q) tasdiqlash chiqadi, oddiy browser confirm() emas
function showDeleteConfirm(id) {
  document.getElementById('delete-zone').innerHTML = `
    <div class="card" style="border:1px solid var(--danger);">
      <p style="font-size:13.5px;margin:0 0 10px;">Guruhni butunlay o'chirasizmi? Barcha a'zolar va to'lov tarixi ham o'chib ketadi. Buni ortga qaytarib bo'lmaydi.</p>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary" style="margin-top:0;" onclick="go('/groups/${id}/edit')">Yo'q, bekor</button>
        <button class="btn danger" style="margin-top:0;" onclick="deleteGroup(${id})">Ha, o'chirilsin</button>
      </div>
    </div>`;
}
async function submitEditGroup(id) {
  const name = document.getElementById('f-name').value.trim();
  const category = document.getElementById('f-cat').value;
  const payment_day = Number(document.getElementById('f-day').value);
  const price = Number(document.getElementById('f-price').value) || 0;
  const start_date = document.getElementById('f-startdate').value || null;
  const payment_type = document.getElementById('f-ptype').value;
  const one_time_until = document.getElementById('f-onetime').value || null;
  if (payment_type === 'one_time' && start_date && !one_time_until) {
    return toast("Bir martalik to'lov uchun qaysi sanagacha ekanini kiriting");
  }
  await api('PUT', `/groups/${id}`, { name, category, payment_day, price, start_date, payment_type, one_time_until });
  toast('Saqlandi');
  go('/groups/' + id);
}

// ---------------- A'ZO QO'SHISH ----------------
function renderAddMember(groupId) {
  el.innerHTML = `${topbar("A'zo qo'shish", '/groups/' + groupId)}
    <div class="card">
      <div class="field"><label>Ism</label><input id="f-fname" placeholder="Masalan: Dilnoza"></div>
      <div class="field"><label>Username (@siz, bo'lmasa bo'sh qoldiring)</label><input id="f-uname" placeholder="dilnoza_x"></div>
      <div class="field"><label>Telegram ID (ixtiyoriy, ammo bo'lsa yaxshi)</label><input id="f-tgid" inputmode="numeric" placeholder="123456789"></div>
      <button class="btn" onclick="submitAddMember(${groupId})">Qo'shish</button>
    </div>
    <button class="btn secondary" onclick="go('/groups/${groupId}/bulk-add')">📋 Ro'yxatdan ko'plab qo'shish</button>
    <p style="color:var(--hint);font-size:12.5px;padding:0 4px;">Eslatma: Telegram botlarga guruhning to'liq a'zolar ro'yxatini bermaydi. Bot guruhda kim yozsa yoki yangi qo'shilsa — avtomatik qo'shib boradi. Username bo'lmagan o'quvchilar uchun — agar Telegram ID'sini bilsangiz (masalan @userinfobot orqali) shu yerga kiritib qo'ying: shunda avto-xabar yuborish va kerak bo'lsa guruhdan chiqarish ham ishlaydi. ID bilmasangiz ham ism bilan qo'shing — o'quvchi botga /start bossa (yoki guruhda biron narsa yozsa), ID avtomatik aniqlanadi.</p>`;
}
async function submitAddMember(groupId) {
  const first_name = document.getElementById('f-fname').value.trim();
  const username = document.getElementById('f-uname').value.trim();
  const telegram_id = document.getElementById('f-tgid').value.trim();
  if (!first_name && !username && !telegram_id) return toast('Ism, username yoki ID kiriting');
  await api('POST', `/groups/${groupId}/members`, { first_name, username, telegram_id: telegram_id || null });
  toast("A'zo qo'shildi");
  go('/groups/' + groupId);
}

// ---------------- KO'PLAB A'ZO QO'SHISH ----------------
function renderBulkAdd(groupId) {
  el.innerHTML = `${topbar("Ro'yxatdan qo'shish", '/groups/' + groupId + '/add-member')}
    <div class="card">
      <div class="field">
        <label>Har bir qatorga bitta o'quvchi yozing</label>
        <textarea id="f-bulk" rows="10" placeholder="Dilnoza @dilnoza_x
Aziz 123456789
Laylo @laylo_m 987654321
Sardor"></textarea>
      </div>
      <button class="btn" onclick="submitBulkAdd(${groupId})">Hammasini qo'shish</button>
    </div>
    <p style="color:var(--hint);font-size:12.5px;padding:0 4px;">Har qatorga: ism, @username va/yoki Telegram ID (raqamlar) — xohlagan kombinatsiyada, yoki shunchaki ism. Username bo'lmagan o'quvchilar uchun ID yozib qo'yish tavsiya etiladi (@userinfobot orqali bilib olish mumkin) — shunda avto-xabar va kerak bo'lsa chiqarish ham ishlaydi. ID'ni bilmasangiz ham ism bilan qo'shing — o'quvchi botga /start bossa, ID avtomatik aniqlanadi (agar username'i kiritilgan bo'lsa).</p>`;
}
async function submitBulkAdd(groupId) {
  const text = document.getElementById('f-bulk').value;
  if (!text.trim()) return toast("Ro'yxatni to'ldiring");
  const res = await api('POST', `/groups/${groupId}/members/bulk`, { text });
  toast(`${res.addedCount} ta qo'shildi${res.skipped.length ? `, ${res.skipped.length} ta o'tkazib yuborildi` : ''}`);
  go('/groups/' + groupId);
}

// ---------------- XABAR YOZISH ----------------
function renderBroadcast(groupId) {
  el.innerHTML = `${topbar('Qarzdorlarga xabar', '/groups/' + groupId)}
    <div class="card">
      <div class="field">
        <label>Xabar matni (qarzdorlarning hammasiga yuboriladi)</label>
        <textarea id="f-msg" placeholder="Assalomu alaykum! Iltimos, shu oyning to'lovini amalga oshiring..."></textarea>
      </div>
      <button class="btn" onclick="submitBroadcast(${groupId})">Yuborish</button>
    </div>
    <button class="btn secondary" onclick="go('/groups/${groupId}/non-repliers')">Javob yozmaganlarni ko'rish</button>`;
}
async function submitBroadcast(groupId) {
  const message = document.getElementById('f-msg').value.trim();
  if (!message) return toast('Xabar matnini yozing');
  const res = await api('POST', `/groups/${groupId}/broadcast`, { message });
  const sentCount = res.results.filter((r) => r.sent).length;
  const failCount = res.results.length - sentCount;
  toast(`Yuborildi: ${sentCount} ta${failCount ? `, yuborilmadi: ${failCount} ta` : ''}`);
  go('/groups/' + groupId);
}

// ---------------- QARZDORLARNI CHIQARISH ----------------
async function renderKickDebtors(groupId) {
  el.innerHTML = `${topbar('Qarzdorlarni chiqarish', '/groups/' + groupId)}<div id="body">Yuklanmoqda...</div>`;
  const members = await api('GET', `/groups/${groupId}/members`);
  const debtors = members.filter((m) => m.is_debtor);
  if (!debtors.length) {
    document.getElementById('body').innerHTML = `<div class="empty">Qarzdor yo'q</div>`;
    return;
  }
  document.getElementById('body').innerHTML = `
    <p style="font-size:13.5px;color:var(--hint);padding:0 2px;">Chiqarilmasligi kerak bo'lganlarni belgilang (mustasno):</p>
    <div class="card">
      ${debtors.map((m) => `
        <label class="checkbox-row">
          <input type="checkbox" value="${m.id}" class="exclude-chk">
          <span>${m.first_name} ${m.username ? '@' + m.username : ''} — <span style="color:var(--danger)">${m.status_text}</span></span>
        </label>`).join('')}
    </div>
    <button class="btn danger" onclick="confirmKickDebtors(${groupId})">Qolganlarini guruhdan chiqarish</button>`;
}
async function confirmKickDebtors(groupId) {
  const excludeIds = [...document.querySelectorAll('.exclude-chk:checked')].map((c) => Number(c.value));
  if (!confirm("Tanlanmagan qarzdorlar guruhdan chiqariladi. Davom etasizmi?")) return;
  const res = await api('POST', `/groups/${groupId}/kick-debtors`, { excludeIds });
  showKickResults(res.results);
  go('/groups/' + groupId);
}

// Har bir a'zo bo'yicha natijani ko'rsatish — chiqarilganlar va
// chiqarilmaganlar (va SABABI) aniq ko'rinsin, jim qolib ketmasin
function showKickResults(results) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  if (!failed.length) {
    toast(`${ok.length} ta a'zo guruhdan chiqarildi`);
    return;
  }
  const lines = failed.map((f) => `• ${f.name || 'Nomsiz'}: ${f.error}`).join('\n');
  alert(`${ok.length} ta chiqarildi.\n\nChiqarilmadi (${failed.length}):\n${lines}`);
}

// ---------------- JAVOB YOZMAGANLAR ----------------
async function renderNonRepliers(groupId) {
  el.innerHTML = `${topbar('Javob yozmaganlar', '/groups/' + groupId)}<div id="body">Yuklanmoqda...</div>`;
  const data = await api('GET', `/groups/${groupId}/broadcasts/latest`);
  if (!data) {
    document.getElementById('body').innerHTML = `<div class="empty">Hali xabar yuborilmagan</div>`;
    return;
  }
  const nonRepliers = data.recipients.filter((r) => !r.replied);
  const repliers = data.recipients.filter((r) => r.replied);
  document.getElementById('body').innerHTML = `
    <p style="font-size:12.5px;color:var(--hint);padding:0 2px;">So'nggi xabar: "${escapeHtml(data.broadcast.message).slice(0, 80)}${data.broadcast.message.length > 80 ? '…' : ''}"</p>
    <div class="section-title">Javob bermaganlar (${nonRepliers.length})</div>
    ${nonRepliers.length ? `<div class="card">${nonRepliers.map((r) => `
      <label class="checkbox-row">
        <input type="checkbox" value="${r.member_id}" class="exclude-chk2">
        <span>${r.first_name} ${r.username ? '@' + r.username : ''}</span>
      </label>`).join('')}</div>
      <p style="font-size:13px;color:var(--hint);padding:0 2px;">Chiqarilmasligi kerak bo'lganlarni belgilang:</p>
      <button class="btn danger" onclick="confirmKickNonRepliers(${groupId})">Belgilanmaganlarni guruhdan chiqarish</button>`
      : `<div class="empty">Hammasi javob bergan ✅</div>`}
    <div class="section-title">Javob berganlar (${repliers.length})</div>
    ${repliers.length ? `<div class="card">${repliers.map((r) => `<div class="checkbox-row">${r.first_name} ${r.username ? '@' + r.username : ''}</div>`).join('')}</div>` : `<div class="empty">—</div>`}
  `;
}
async function confirmKickNonRepliers(groupId) {
  const excludeIds = [...document.querySelectorAll('.exclude-chk2:checked')].map((c) => Number(c.value));
  if (!confirm("Tanlanmagan, javob bermagan a'zolar guruhdan chiqariladi. Davom etasizmi?")) return;
  const res = await api('POST', `/groups/${groupId}/kick-non-repliers`, { excludeIds });
  showKickResults(res.results);
  go('/groups/' + groupId);
}

// ---------------- GLOBAL QARZDORLAR / TO'LAGANLAR ----------------
async function renderDebtors() {
  el.innerHTML = `${topbar('Qarzdorlar', '/')}<div id="body">Yuklanmoqda...</div>`;
  const rows = await api('GET', '/debtors');
  renderGlobalList(rows, 'Qarzdor yo\'q 🎉');
}
async function renderPaid() {
  el.innerHTML = `${topbar("To'langanlar", '/')}<div id="body">Yuklanmoqda...</div>`;
  const rows = await api('GET', '/paid');
  renderGlobalList(rows, 'Hali hech kim to\'lamagan');
}
function renderGlobalList(rows, emptyText) {
  if (!rows.length) {
    document.getElementById('body').innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }
  const byGroup = {};
  rows.forEach((r) => { (byGroup[r.group_name] ||= []).push(r); });
  document.getElementById('body').innerHTML = Object.entries(byGroup).map(([gname, members]) => `
    <div class="section-title">${gname}</div>
    ${members.map((m) => `
      <div class="member-card">
        <div class="member-top">
          <div class="member-name">${m.first_name}${m.username ? `<span class="member-username">@${m.username}</span>` : ''}</div>
          <span class="status-pill ${m.is_debtor ? 'debt' : 'ok'}">${m.status_text}</span>
        </div>
        ${m.months_paid_label ? `<div class="months-paid-label">${m.months_paid_label}</div>` : ''}
        ${!m.started_bot ? `<div class="no-bot-warning">🔒 Botga /start bosmagan</div>` : ''}
        ${chatLink(m) ? `<div class="member-actions"><button class="icon-btn" onclick="window.open('${chatLink(m)}','_blank')" title="Yozish">✉️</button></div>` : ''}
      </div>`).join('')}
  `).join('');
}

// Shaxsiy yozishmaga o'tish tugmasi — username bo'lsa t.me/username,
// bo'lmasa lekin Telegram ID ma'lum bo'lsa (masalan start bosgandan keyin)
// tg://user?id= orqali ham ochish mumkin (chunki admin shu bilan bir guruhda)
function chatLink(m) {
  if (m.username) return `https://t.me/${m.username}`;
  if (m.telegram_id) return `tg://user?id=${m.telegram_id}`;
  return null;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
