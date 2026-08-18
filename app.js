// ============================================================
// CONFIG
// ============================================================
// Raid & event data: ScrapedDuck — scrapes LeekDuck.com directly (with
// permission), updated every few minutes. Far more current than generic
// "gamemaster snapshot" APIs.
// Docs: https://github.com/bigfoott/ScrapedDuck/wiki
const RAIDS_URL = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/raids.json';
const EVENTS_URL = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json';

// Type chart & weather-boost table: these are fixed game mechanics that
// barely ever change, so a slower-moving community API is fine here.
// Docs: https://pogoapi.net/documentation
const POGOAPI_BASE = 'https://pogoapi.net/api/v1/';

const TIER_CANONICAL_ORDER = ['1-Star Raids', '3-Star Raids', '5-Star Raids', 'Mega Raids', 'Elite Raids'];

const TYPE_COLORS = {
  Normal: '#A8A878', Fire: '#F08030', Water: '#6890F0', Electric: '#F8D030',
  Grass: '#78C850', Ice: '#98D8D8', Fighting: '#C03028', Poison: '#A040A0',
  Ground: '#E0C068', Flying: '#A890F0', Psychic: '#F85888', Bug: '#A8B820',
  Rock: '#B8A038', Ghost: '#705898', Dragon: '#7038F8', Dark: '#705848',
  Steel: '#B8B8D0', Fairy: '#EE99AC'
};

const TYPE_TH = {
  Normal: 'ธรรมดา', Fire: 'ไฟ', Water: 'น้ำ', Electric: 'ไฟฟ้า', Grass: 'พืช',
  Ice: 'น้ำแข็ง', Fighting: 'ต่อสู้', Poison: 'พิษ', Ground: 'พื้นดิน',
  Flying: 'บิน', Psychic: 'จิต', Bug: 'แมลง', Rock: 'หิน', Ghost: 'ผี',
  Dragon: 'มังกร', Dark: 'มืด', Steel: 'เหล็ก', Fairy: 'นางฟ้า'
};

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ============================================================
// STATE
// ============================================================
let raidList = [];          // flat array from ScrapedDuck
let tierOrder = [];         // tiers actually present, in canonical order
let typeChart = null;       // from pogoapi type_effectiveness.json
let currentTier = null;
let searchQuery = '';
let selectedTypes = new Set();

// ============================================================
// CLOCK — always Thailand time, per project convention
// ============================================================
function tickClock() {
  const el = document.getElementById('clock');
  const now = new Date();
  el.textContent = now.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}
setInterval(tickClock, 1000);
tickClock();

// Global (simultaneous-everywhere) event timestamps end in "Z" (true UTC) —
// convert those properly. Events without "Z" already represent each
// region's own local wall-clock time, which for us IS Bangkok time, so we
// display the digits as written instead of re-interpreting them.
function formatEventDate(iso) {
  if (!iso) return '';
  if (iso.endsWith('Z')) {
    return new Date(iso).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }) + ' น. (เวลาไทย)';
  }
  const [datePart, timePart] = iso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':');
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d} ${months[m - 1]} ${y}, ${hh}:${mm} น.`;
}

// Turns an event's start/end string into a real comparable Date, using the
// same "Z = true UTC, no-Z = literal Bangkok wall clock" rule as formatEventDate.
function toComparableDate(iso) {
  if (!iso) return null;
  return iso.endsWith('Z') ? new Date(iso) : new Date(iso + '+07:00');
}

// ============================================================
// BOOTSTRAP — one combined load instead of firing requests one by one
// ============================================================
async function bootstrap() {
  setStatus('กำลังดึงข้อมูลบอสเรดจาก LeekDuck, อีเวนต์ และตารางธาตุ…');
  toggleSpin(true);

  try {
    const [raidsRes, eventsRes] = await Promise.all([fetch(RAIDS_URL), fetch(EVENTS_URL)]);
    if (!raidsRes.ok || !eventsRes.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับผิดปกติ');

    const [raids, events] = await Promise.all([raidsRes.json(), eventsRes.json()]);
    raidList = raids;

    // Everything below is best-effort: weather boosts, the type chart, and
    // the name->type lookup all come from a second, independent service
    // (pogoapi.net). If that service is slow, rate-limited, or briefly
    // down, raid bosses / events must still render — only
    // the weather panel and the weakness-lookup modal should degrade.
    let weather = null;
    try {
      const weatherRes = await fetch(POGOAPI_BASE + 'weather_boosts.json');
      if (weatherRes.ok) weather = await weatherRes.json();
    } catch (e) { console.warn('weather_boosts.json failed:', e); }

    try {
      const typeRes = await fetch(POGOAPI_BASE + 'type_effectiveness.json');
      if (typeRes.ok) typeChart = await typeRes.json();
    } catch (e) { console.warn('type_effectiveness.json failed:', e); }

    // Figure out which tiers actually exist right now, in a sensible order
    const present = new Set(raidList.map(b => b.tier));
    tierOrder = TIER_CANONICAL_ORDER.filter(t => present.has(t));
    // catch anything unexpected (e.g. a new tier name LeekDuck introduces later)
    present.forEach(t => { if (!tierOrder.includes(t)) tierOrder.push(t); });
    if (!currentTier || !tierOrder.includes(currentTier)) currentTier = tierOrder[0] || null;

    renderTierTabs();
    renderTypeFilterRow();
    renderBossGrid();
    // Each of these is independent — a bug or bad data in one section
    // should never prevent the sections after it from rendering.
    safeRender('Community Day', () => renderCommunityDay(events));
    safeRender('Weather', () => renderWeather(weather));

    setStatus('เชื่อมต่อสำเร็จ — ข้อมูลตรงจาก LeekDuck.com · กดที่การ์ดบอสเพื่อดูจุดอ่อน');
    document.getElementById('lastUpdated').textContent =
      new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
  } catch (err) {
    console.error(err);
    setStatus('โหลดข้อมูลไม่สำเร็จ ลองกดปุ่มรีเฟรชอีกครั้ง');
    document.getElementById('bossGrid').innerHTML =
      '<p class="muted">ไม่สามารถโหลดข้อมูลบอสเรดได้ในตอนนี้</p>';
  } finally {
    toggleSpin(false);
  }
}

function safeRender(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`Render failed for "${label}":`, err);
  }
}

function setStatus(text) {
  document.getElementById('statusLine').textContent = text;
}

function toggleSpin(on) {
  document.getElementById('refreshBtn').classList.toggle('spinning', on);
}

// ============================================================
// FILTERS (name search + type chips)
// ============================================================
function renderTypeFilterRow() {
  const row = document.getElementById('typeFilterRow');
  row.innerHTML = '';
  Object.keys(TYPE_COLORS).forEach(type => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'type-filter-chip' + (selectedTypes.has(type) ? ' active' : '');
    chip.style.background = TYPE_COLORS[type];
    chip.textContent = type;
    chip.title = TYPE_TH[type] || type;
    chip.addEventListener('click', () => {
      if (selectedTypes.has(type)) selectedTypes.delete(type);
      else selectedTypes.add(type);
      renderTypeFilterRow();
      onFiltersChanged();
    });
    row.appendChild(chip);
  });
}

function onFiltersChanged() {
  const active = searchQuery.trim() !== '' || selectedTypes.size > 0;
  document.getElementById('clearFilters').hidden = !active;
  document.getElementById('filterNote').hidden = !active;
  document.getElementById('tierTabs').style.opacity = active ? '0.4' : '1';
  document.getElementById('tierTabs').style.pointerEvents = active ? 'none' : 'auto';
  renderBossGrid();
}

document.getElementById('nameSearch').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  onFiltersChanged();
});

document.getElementById('clearFilters').addEventListener('click', () => {
  searchQuery = '';
  selectedTypes.clear();
  document.getElementById('nameSearch').value = '';
  renderTypeFilterRow();
  onFiltersChanged();
});

// ============================================================
// RAID TIERS + GRID
// ============================================================
function renderTierTabs() {
  const wrap = document.getElementById('tierTabs');
  wrap.innerHTML = '';

  tierOrder.forEach(tier => {
    const count = raidList.filter(b => b.tier === tier).length;
    const btn = document.createElement('button');
    btn.className = 'tier-tab' + (tier === currentTier ? ' active' : '');
    btn.textContent = `${tier} (${count})`;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => {
      currentTier = tier;
      renderTierTabs();
      renderBossGrid();
    });
    wrap.appendChild(btn);
  });
}

function getVisibleBosses() {
  const filtersActive = searchQuery.trim() !== '' || selectedTypes.size > 0;
  const q = searchQuery.trim().toLowerCase();

  if (!filtersActive) {
    return raidList.filter(b => b.tier === currentTier).map(b => ({ boss: b, tier: b.tier }));
  }

  return raidList
    .filter(b => {
      const nameMatch = !q || b.name.toLowerCase().includes(q);
      const bossTypes = (b.types || []).map(t => capitalize(t.name));
      const typeMatch = selectedTypes.size === 0 || bossTypes.some(t => selectedTypes.has(t));
      return nameMatch && typeMatch;
    })
    .map(b => ({ boss: b, tier: b.tier }));
}

function renderBossGrid() {
  const grid = document.getElementById('bossGrid');
  if (!raidList.length) return;

  const entries = getVisibleBosses();
  const filtersActive = searchQuery.trim() !== '' || selectedTypes.size > 0;

  if (entries.length === 0) {
    grid.innerHTML = filtersActive
      ? '<p class="muted">ไม่พบโปเกมอนที่ตรงกับตัวกรอง ลองเปลี่ยนคำค้นหาหรือธาตุดู</p>'
      : '<p class="muted">ยังไม่มีข้อมูลบอสระดับนี้ในตอนนี้</p>';
    return;
  }

  grid.innerHTML = '';
  entries.forEach(({ boss, tier }) => {
    const card = document.createElement('button');
    card.className = 'boss-card';
    card.setAttribute('type', 'button');
    card.setAttribute('aria-haspopup', 'dialog');

    const typeNames = (boss.types || []).map(t => capitalize(t.name));
    const typesHtml = typeNames.map(t =>
      `<span class="type-chip" style="background:${TYPE_COLORS[t] || '#999'}">${t}</span>`
    ).join('');

    const weatherChips = (boss.boostedWeather || []).map(w =>
      `<span class="weather-chip">${capitalize(w.name)}</span>`
    ).join('');

    const cp = boss.combatPower || {};
    const normal = cp.normal || {};
    const boosted = cp.boosted || {};

    card.innerHTML = `
      ${filtersActive ? `<span class="tier-badge">${tier}</span>` : ''}
      <div class="boss-card-top">
        <img class="boss-sprite" loading="lazy"
             src="${boss.image}"
             onerror="this.style.visibility='hidden'"
             alt="${boss.name}">
        <div class="boss-name-block">
          <div class="boss-name" title="${boss.name}">${boss.name}</div>
          ${boss.canBeShiny ? '<div class="boss-shiny">✦ อาจเป็นเชนี่ได้</div>' : ''}
        </div>
      </div>
      <div class="type-row">${typesHtml}</div>
      <div class="cp-row">
        <span>CP ปกติ: <b>${normal.min ?? '?'}–${normal.max ?? '?'}</b></span>
        <span>CP ตอนอากาศบูสต์: <b>${boosted.min ?? '?'}–${boosted.max ?? '?'}</b></span>
      </div>
      ${weatherChips ? `<div class="weather-row">${weatherChips}</div>` : ''}
      <div class="tap-hint">แตะเพื่อดูจุดอ่อน →</div>
    `;
    card.addEventListener('click', () => openBossModal(boss, typeNames));
    grid.appendChild(card);
  });
}

// ============================================================
// TYPE EFFECTIVENESS — combine dual types the way the games do
// ============================================================
function computeMatchups(defenderTypes) {
  const attackTypes = Object.keys(TYPE_COLORS);
  const rows = attackTypes.map(atk => {
    let multiplier = 1;
    defenderTypes.forEach(def => {
      const raw = typeChart && typeChart[atk] ? typeChart[atk][def] : undefined;
      multiplier *= raw !== undefined ? parseFloat(raw) : 1;
    });
    return { type: atk, multiplier: Math.round(multiplier * 1000) / 1000 };
  });

  const weaknesses = rows.filter(r => r.multiplier > 1).sort((a, b) => b.multiplier - a.multiplier);
  const resistances = rows.filter(r => r.multiplier < 1 && r.multiplier > 0).sort((a, b) => a.multiplier - b.multiplier);
  const immunities = rows.filter(r => r.multiplier === 0);

  return { weaknesses, resistances, immunities };
}

function matchupPill(row) {
  const label = TYPE_TH[row.type] || row.type;
  return `<span class="matchup-pill" style="border-color:${TYPE_COLORS[row.type]}">
      <span class="type-chip" style="background:${TYPE_COLORS[row.type]}">${row.type}</span>
      <span class="matchup-th">${label}</span>
      <span class="matchup-x">×${row.multiplier}</span>
    </span>`;
}

// ============================================================
// BOSS DETAIL MODAL
// ============================================================
const modalEl = document.getElementById('bossModal');
const modalBody = document.getElementById('modalBody');

function openBossModal(boss, typeNames) {
  const chartReady = !!typeChart;
  const knownTypes = chartReady && typeNames && typeNames.length > 0;
  const { weaknesses, resistances, immunities } = knownTypes
    ? computeMatchups(typeNames)
    : { weaknesses: [], resistances: [], immunities: [] };

  const weakHtml = !chartReady
    ? '<span class="muted">โหลดตารางธาตุไม่สำเร็จตอนนี้ ลองกดรีเฟรชที่มุมขวาบนแล้วเปิดใหม่</span>'
    : !knownTypes
    ? '<span class="muted">ไม่ทราบธาตุของบอสตัวนี้ (แหล่งข้อมูลไม่ได้แนบธาตุมาให้)</span>'
    : weaknesses.length ? weaknesses.map(matchupPill).join('') : '<span class="muted">ไม่มีจุดอ่อนธาตุเด่นชัด</span>';

  const resistHtml = !knownTypes
    ? ''
    : resistances.length ? resistances.map(matchupPill).join('') : '<span class="muted">ไม่มีธาตุที่ต้านได้เป็นพิเศษ</span>';

  const immuneHtml = knownTypes && immunities.length ? immunities.map(matchupPill).join('') : '';

  const typesHtml = knownTypes
    ? typeNames.map(t => `<span class="type-chip lg" style="background:${TYPE_COLORS[t] || '#999'}">${t} · ${TYPE_TH[t] || ''}</span>`).join('')
    : '';

  const cp = boss.combatPower || {};
  const normal = cp.normal || {};
  const boosted = cp.boosted || {};
  const hasCp = normal.min !== undefined || boosted.min !== undefined;

  modalBody.innerHTML = `
    <div class="modal-head">
      <img class="modal-sprite" src="${boss.image}" onerror="this.style.visibility='hidden'" alt="${boss.name}">
      <div>
        <h3>${boss.name}</h3>
        <div class="type-row">${typesHtml}</div>
      </div>
    </div>

    <div class="modal-section">
      <h4>⚔ ใช้ธาตุนี้ตีจะโดนแรงขึ้น (จุดอ่อน)</h4>
      <div class="matchup-row">${weakHtml}</div>
    </div>

    ${resistHtml ? `
    <div class="modal-section">
      <h4>🛡 บอสต้านธาตุพวกนี้ได้ (โจมตีแล้วไม่ค่อยเจ็บ)</h4>
      <div class="matchup-row">${resistHtml}</div>
    </div>` : ''}

    ${immuneHtml ? `
    <div class="modal-section">
      <h4>🚫 ไม่โดนธาตุนี้เลย (ภูมิคุ้มกัน)</h4>
      <div class="matchup-row">${immuneHtml}</div>
    </div>` : ''}

    ${hasCp ? `
    <div class="modal-section">
      <h4>📊 CP โดยประมาณ</h4>
      <div class="cp-row modal-cp">
        <span>ปกติ: <b>${normal.min ?? '?'}–${normal.max ?? '?'}</b></span>
        <span>อากาศบูสต์: <b>${boosted.min ?? '?'}–${boosted.max ?? '?'}</b></span>
        ${boss.canBeShiny ? '<span class="boss-shiny">✦ ตัวนี้อาจเป็นเชนี่ได้</span>' : ''}
      </div>
    </div>` : (boss.canBeShiny ? `<div class="modal-section"><span class="boss-shiny">✦ ตัวนี้อาจเป็นเชนี่ได้</span></div>` : '')}
  `;

  modalEl.classList.add('open');
  modalEl.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.getElementById('modalCloseBtn').focus();
}

function closeBossModal() {
  modalEl.classList.remove('open');
  modalEl.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

document.getElementById('modalCloseBtn').addEventListener('click', closeBossModal);
modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeBossModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalEl.classList.contains('open')) closeBossModal();
});

// ============================================================
// COMMUNITY DAY (from ScrapedDuck events.json)
// ============================================================
function renderCommunityDay(events) {
  const body = document.getElementById('cdayBody');
  const cdays = (events || []).filter(e => e.eventType === 'community-day');

  if (cdays.length === 0) {
    body.innerHTML = '<p class="muted">ไม่มีข้อมูล Community Day ในขณะนี้</p>';
    return;
  }

  const now = new Date();
  // Prefer one that's ongoing or coming up soon; otherwise fall back to the most recent past one.
  // Fails open: an unparseable/missing end date counts as "still relevant" rather than being dropped.
  const upcoming = cdays
    .filter(e => { const end = toComparableDate(e.end); return !end || isNaN(end) || end >= now; })
    .sort((a, b) => {
      const da = toComparableDate(a.start), db = toComparableDate(b.start);
      const va = da && !isNaN(da) ? da.getTime() : Infinity;
      const vb = db && !isNaN(db) ? db.getTime() : Infinity;
      return va - vb;
    });
  const target = upcoming[0] || cdays.sort((a, b) => {
    const da = toComparableDate(a.start), db = toComparableDate(b.start);
    const va = da && !isNaN(da) ? da.getTime() : -Infinity;
    const vb = db && !isNaN(db) ? db.getTime() : -Infinity;
    return vb - va;
  })[0];

  const extra = (target.extraData && target.extraData.communityday) || {};
  const spawns = (extra.spawns || []).map(p =>
    `<span class="pill gold"><img class="pill-icon" src="${p.image}" alt=""> ${p.name}</span>`
  ).join('');
  const bonuses = (extra.bonuses || []).map(b =>
    `<span class="pill"><img class="pill-icon" src="${b.image}" alt=""> ${b.text}</span>`
  ).join('');
  const shinies = (extra.shinies || []).map(s =>
    `<span class="pill"><img class="pill-icon" src="${s.image}" alt=""> ${s.name}</span>`
  ).join('');

  const dateLabel = target.start
    ? (target.end ? `${formatEventDate(target.start)} – ${formatEventDate(target.end)}` : formatEventDate(target.start))
    : 'ยังไม่ประกาศวันที่แน่ชัด';

  body.innerHTML = `
    <div>
      <h3 class="cday-title">${target.name}</h3>
      <div class="cday-dates">${dateLabel}</div>
    </div>
    <div class="cday-grid">
      <div class="cday-block">
        <h4>โปเกมอนที่ออกเยอะเป็นพิเศษ</h4>
        <div class="pill-row">${spawns || '<span class="pill">ยังไม่ประกาศ</span>'}</div>
      </div>
      <div class="cday-block">
        <h4>โบนัสช่วงอีเวนต์</h4>
        <div class="pill-row">${bonuses || '<span class="pill">ยังไม่ประกาศ</span>'}</div>
      </div>
    </div>
    ${shinies ? `
    <div class="cday-block">
      <h4>เชนี่ที่มีโอกาสเจอในรอบนี้</h4>
      <div class="pill-row">${shinies}</div>
    </div>` : ''}
    ${target.link ? `<a class="cday-link" href="${target.link}" target="_blank" rel="noopener">ดูรายละเอียดเต็มบน LeekDuck →</a>` : ''}
  `;
}

// ============================================================
// WEATHER BOOSTS
// ============================================================
function renderWeather(weather) {
  const grid = document.getElementById('weatherGrid');
  if (!weather) {
    grid.innerHTML = '<p class="muted">โหลดตารางสภาพอากาศไม่สำเร็จตอนนี้ ลองกดรีเฟรชอีกครั้ง</p>';
    return;
  }
  grid.innerHTML = '';

  Object.entries(weather).forEach(([condition, types]) => {
    const chips = types.map(t =>
      `<span class="type-chip" style="background:${TYPE_COLORS[t] || '#999'}">${t}</span>`
    ).join(' ');
    const card = document.createElement('div');
    card.className = 'weather-card';
    card.innerHTML = `<h5>${condition}</h5><div class="type-row">${chips}</div>`;
    grid.appendChild(card);
  });
}

// ============================================================
// EVENTS
// ============================================================
document.getElementById('refreshBtn').addEventListener('click', bootstrap);

bootstrap();
