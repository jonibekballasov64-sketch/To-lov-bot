const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

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
      'X-Telegram-Init-Data': tg ? tg.initData : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error || 'Xatolik yuz berdi');
    throw new Error(data.error || 'Xatolik');
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

// ---------------- ROUTER ----------------
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

async function render() {
  const hash = location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);
  try {
    if (parts.length === 0) return renderMenu();
    if (parts[0] === 'create-group') return renderCreateGroup();
    if (parts[0] === 'groups' && parts.length === 1) return renderGroupsList();
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'edit') return renderEditGroup(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'add-member') return renderAddMember(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'broadcast') return renderBroadcast(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'kick-debtors') return renderKickDebtors(parts[1]);
    if (parts[0] === 'groups' && parts[1] && parts[2] === 'non-repliers') return renderNonRepliers(parts[1]);
    if (parts[0] === 'groups' && parts[1]) return renderGroupDetail(parts[1]);
    if (parts[0] === 'debtors') return renderDebtors();
    if (parts[0] === 'paid') return renderPaid();
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
      <button class="btn" onclick="submitCreateGroup()">Yaratish</button>
    </div>
    <p style="color:var(--hint);font-size:12.5px;padding:0 4px;">Eslatma: botni shu guruhga admin qilib qo'shganingizga ishonch hosil qiling — aks holda a'zolarni avtomatik ko'ra olmaydi.</p>`;
}

async function submitCreateGroup() {
  const name = document.getElementById('f-name').value.trim();
  const category = document.getElementById('f-cat').value;
  const chat_id = document.getElementById('f-chatid').value.trim();
  const payment_day = Number(document.getElementById('f-day').value);
  const price = Number(document.getElementById('f-price').value) || 0;
  if (!name || !chat_id || !payment_day) return toast("Nom, guruh ID va to'lov sanasini to'ldiring");
  const g = await api('POST', '/groups', { name, category, chat_id, payment_day, price });
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
  document.getElementById('list').innerHTML = groups.map((g) => `
    <div class="card group-row" onclick="go('/groups/${g.id}')" style="cursor:pointer">
      <div>
        <div class="name">${g.name}</div>
        <div class="meta">${catBadge(g.category)} &nbsp; ${g.member_count} a'zo</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${Number(g.debtor_count) > 0 ? `<span class="badge debt">${g.debtor_count} qarzdor</span>` : `<span class="badge ok">to'liq</span>`}
        <span class="chev">›</span>
      </div>
    </div>`).join('');
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
        <div>
          <div class="member-name">${m.first_name || 'Nomsiz'} ${m.username ? `<span class="member-username">@${m.username}</span>` : ''}</div>
          <div class="member-status ${m.is_debtor ? 'debt' : 'ok'}">${m.status_text}${m.payment_day ? ` · individual sana: ${m.payment_day}` : ''}</div>
        </div>
      </div>
      <div class="member-actions">
        <button class="round-btn minus" onclick="memberUnpay(${m.id})">−</button>
        <button class="round-btn plus" onclick="memberPay(${m.id})">+</button>
        <button class="btn small secondary" onclick="editMemberDay(${m.id}, ${m.payment_day || g.payment_day})">Sana</button>
        ${m.username ? `<button class="btn small secondary" onclick="window.open('https://t.me/${m.username}','_blank')">Yozish</button>` : ''}
        <button class="round-btn open" onclick="removeMember(${m.id})" title="Ro'yxatdan olib tashlash">✕</button>
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
    <button class="btn danger" onclick="go('/groups/${id}/kick-debtors')" ${debtors.length ? '' : 'disabled style="opacity:0.5"'}>🚫 Qarzdorlarni guruhdan chiqarish (${debtors.length})</button>

    <div class="section-title">Qarzdorlar (${debtors.length})</div>
    ${debtors.length ? debtors.map(memberHtml).join('') : `<div class="empty">Qarzdor yo'q 🎉</div>`}

    <div class="section-title">To'laganlar (${paid.length})</div>
    ${paid.length ? paid.map(memberHtml).join('') : `<div class="empty">Hali hech kim to'lamagan</div>`}

    <div class="section-title">Guruhni boshqarish</div>
    <button class="btn danger" onclick="deleteGroup(${id})">🗑 Guruhni o'chirish</button>
  `;
}

async function memberPay(id) {
  const m = await api('POST', `/members/${id}/pay`);
  toast("To'lov qo'shildi: " + m.status_text);
  render();
}
async function memberUnpay(id) {
  await api('POST', `/members/${id}/unpay`);
  toast('Bekor qilindi');
  render();
}
async function removeMember(id) {
  if (!confirm("Bu a'zoni ro'yxatdan olib tashlaymi? (guruhdan chiqarilmaydi, faqat ro'yxatdan)")) return;
  await api('DELETE', `/members/${id}`);
  render();
}
async function editMemberDay(id, current) {
  const val = prompt("Shu a'zo uchun to'lov sanasi (1-28):", current);
  if (!val) return;
  await api('PUT', `/members/${id}`, { payment_day: Number(val) });
  toast('Sana yangilandi');
  render();
}
async function deleteGroup(id) {
  if (!confirm("Guruhni butunlay o'chirasizmi? Barcha a'zolar va to'lov tarixi ham o'chadi.")) return;
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
      <button class="btn" onclick="submitEditGroup(${id})">Saqlash</button>
    </div>`;
}
async function submitEditGroup(id) {
  const name = document.getElementById('f-name').value.trim();
  const category = document.getElementById('f-cat').value;
  const payment_day = Number(document.getElementById('f-day').value);
  const price = Number(document.getElementById('f-price').value) || 0;
  await api('PUT', `/groups/${id}`, { name, category, payment_day, price });
  toast('Saqlandi');
  go('/groups/' + id);
}

// ---------------- A'ZO QO'SHISH ----------------
function renderAddMember(groupId) {
  el.innerHTML = `${topbar("A'zo qo'shish", '/groups/' + groupId)}
    <div class="card">
      <div class="field"><label>Ism</label><input id="f-fname" placeholder="Masalan: Dilnoza"></div>
      <div class="field"><label>Username (@siz)</label><input id="f-uname" placeholder="dilnoza_x"></div>
      <button class="btn" onclick="submitAddMember(${groupId})">Qo'shish</button>
    </div>
    <p style="color:var(--hint);font-size:12.5px;padding:0 4px;">Eslatma: Telegram botlarga guruhning to'liq a'zolar ro'yxatini bermaydi. Bot guruhda kim yozsa yoki yangi qo'shilsa — avtomatik qo'shib boradi. Eski, hali yozmagan a'zolarni shu yerdan qo'lda qo'shing.</p>`;
}
async function submitAddMember(groupId) {
  const first_name = document.getElementById('f-fname').value.trim();
  const username = document.getElementById('f-uname').value.trim();
  if (!first_name && !username) return toast('Ism yoki username kiriting');
  await api('POST', `/groups/${groupId}/members`, { first_name, username });
  toast("A'zo qo'shildi");
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
  const ok = res.results.filter((r) => r.ok).length;
  toast(`${ok} ta a'zo guruhdan chiqarildi`);
  go('/groups/' + groupId);
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
  const ok = res.results.filter((r) => r.ok).length;
  toast(`${ok} ta a'zo chiqarildi`);
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
          <div>
            <div class="member-name">${m.first_name} ${m.username ? `<span class="member-username">@${m.username}</span>` : ''}</div>
            <div class="member-status ${m.is_debtor ? 'debt' : 'ok'}">${m.status_text}</div>
          </div>
          ${m.username ? `<button class="btn small secondary" onclick="window.open('https://t.me/${m.username}','_blank')">Yozish</button>` : ''}
        </div>
      </div>`).join('')}
  `).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
