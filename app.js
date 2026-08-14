// ============================================================
// CONFIG
// ============================================================
// PoGo API — community-run, public, read-only JSON. No key needed.
// Docs: https://pogoapi.net/documentation
const API_BASE = 'https://pogoapi.net/api/v1/';

// Sprite images (public community sprite mirror, used by many fan tools)
const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

const TIER_ORDER = ['1', '2', '3', '4', '5', '6', 'mega'];
const TIER_LABEL = { '1': 'Tier 1', '2': 'Tier 2', '3': 'Tier 3', '4': 'Tier 4', '5': 'Tier 5', '6': 'Tier 6', mega: 'Mega' };

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

// ============================================================
// STATE
// ============================================================
let raidData = null;
let typeChart = null;       // from type_effectiveness.json
let currentTier = '1';
let showPrevious = false;

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

function formatBangkokDate(dateStr) {
  // dateStr like "2026-08-14" — treat as a calendar date, display in Thai locale
  const d = new Date(dateStr + 'T00:00:00+07:00');
  return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });
}

// ============================================================
// BOOTSTRAP — one combined load instead of firing requests one by one
// ============================================================
async function bootstrap() {
  setStatus('กำลังดึงข้อมูลบอสเรด, อีเวนต์, สภาพอากาศ และตารางธาตุ…');
  toggleSpin(true);

  try {
    const [raidRes, cdayRes, weatherRes, typeRes] = await Promise.all([
      fetch(API_BASE + 'raid_bosses.json'),
      fetch(API_BASE + 'community_days.json'),
      fetch(API_BASE + 'weather_boosts.json'),
      fetch(API_BASE + 'type_effectiveness.json')
    ]);

    if (!raidRes.ok || !cdayRes.ok || !weatherRes.ok || !typeRes.ok) {
      throw new Error('เซิร์ฟเวอร์ตอบกลับผิดปกติ');
    }

    const [raid, cdays, weather, types] = await Promise.all([
      raidRes.json(), cdayRes.json(), weatherRes.json(), typeRes.json()
    ]);

    raidData = raid;
    typeChart = types;

    renderTierTabs();
    renderBossGrid();
    renderCommunityDay(cdays);
    renderWeather(weather);

    setStatus('เชื่อมต่อสำเร็จ — กดที่การ์ดบอสตัวไหนก็ได้เพื่อดูจุดอ่อน');
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

function setStatus(text) {
  document.getElementById('statusLine').textContent = text;
}

function toggleSpin(on) {
  document.getElementById('refreshBtn').classList.toggle('spinning', on);
}

// ============================================================
// RAID TIERS
// ============================================================
function renderTierTabs() {
  const wrap = document.getElementById('tierTabs');
  wrap.innerHTML = '';
  const bucket = showPrevious ? raidData.previous : raidData.current;

  TIER_ORDER.forEach(tier => {
    const count = (bucket && bucket[tier]) ? bucket[tier].length : 0;
    const btn = document.createElement('button');
    btn.className = 'tier-tab' + (tier === currentTier ? ' active' : '');
    btn.textContent = `${TIER_LABEL[tier]} (${count})`;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => {
      currentTier = tier;
      renderTierTabs();
      renderBossGrid();
    });
    wrap.appendChild(btn);
  });
}

function renderBossGrid() {
  const grid = document.getElementById('bossGrid');
  if (!raidData) return;

  const bucket = showPrevious ? raidData.previous : raidData.current;
  const bosses = (bucket && bucket[currentTier]) ? bucket[currentTier] : [];

  if (bosses.length === 0) {
    grid.innerHTML = '<p class="muted">ยังไม่มีข้อมูลบอสระดับนี้ในตอนนี้</p>';
    return;
  }

  grid.innerHTML = '';
  bosses.forEach(boss => {
    const card = document.createElement('button');
    card.className = 'boss-card';
    card.setAttribute('type', 'button');
    card.setAttribute('aria-haspopup', 'dialog');

    const types = (boss.type || []).map(t =>
      `<span class="type-chip" style="background:${TYPE_COLORS[t] || '#999'}">${t}</span>`
    ).join('');

    const weatherChips = (boss.boosted_weather || []).map(w =>
      `<span class="weather-chip">${w}</span>`
    ).join('');

    card.innerHTML = `
      <div class="boss-card-top">
        <img class="boss-sprite" loading="lazy"
             src="${SPRITE_BASE}${boss.id}.png"
             onerror="this.style.visibility='hidden'"
             alt="${boss.name}">
        <div class="boss-name-block">
          <div class="boss-name" title="${boss.name}">${boss.name}</div>
          ${boss.possible_shiny ? '<div class="boss-shiny">✦ อาจเป็นเชนี่ได้</div>' : ''}
        </div>
      </div>
      <div class="type-row">${types}</div>
      <div class="cp-row">
        <span>CP ปกติ: <b>${boss.min_unboosted_cp}–${boss.max_unboosted_cp}</b></span>
        <span>CP ตอนอากาศบูสต์: <b>${boss.min_boosted_cp}–${boss.max_boosted_cp}</b></span>
      </div>
      ${weatherChips ? `<div class="weather-row">${weatherChips}</div>` : ''}
      <div class="tap-hint">แตะเพื่อดูจุดอ่อน →</div>
    `;
    card.addEventListener('click', () => openBossModal(boss));
    grid.appendChild(card);
  });
}

document.getElementById('prevToggle').addEventListener('change', (e) => {
  showPrevious = e.target.checked;
  renderTierTabs();
  renderBossGrid();
});

// ============================================================
// TYPE EFFECTIVENESS — combine dual types the way the games do
// ============================================================
// typeChart[attackingType][defendingType] = multiplier (string, e.g. "1.6")
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

function openBossModal(boss) {
  if (!typeChart) return;

  const { weaknesses, resistances, immunities } = computeMatchups(boss.type || []);

  const weakHtml = weaknesses.length
    ? weaknesses.map(matchupPill).join('')
    : '<span class="muted">ไม่มีจุดอ่อนธาตุเด่นชัด</span>';

  const resistHtml = resistances.length
    ? resistances.map(matchupPill).join('')
    : '<span class="muted">ไม่มีธาตุที่ต้านได้เป็นพิเศษ</span>';

  const immuneHtml = immunities.length
    ? immunities.map(matchupPill).join('')
    : '';

  const typesHtml = (boss.type || []).map(t =>
    `<span class="type-chip lg" style="background:${TYPE_COLORS[t] || '#999'}">${t} · ${TYPE_TH[t] || ''}</span>`
  ).join('');

  modalBody.innerHTML = `
    <div class="modal-head">
      <img class="modal-sprite" src="${SPRITE_BASE}${boss.id}.png" onerror="this.style.visibility='hidden'" alt="${boss.name}">
      <div>
        <h3>${boss.name}</h3>
        <div class="type-row">${typesHtml}</div>
      </div>
    </div>

    <div class="modal-section">
      <h4>⚔ ใช้ธาตุนี้ตีจะโดนแรงขึ้น (จุดอ่อน)</h4>
      <div class="matchup-row">${weakHtml}</div>
    </div>

    <div class="modal-section">
      <h4>🛡 บอสต้านธาตุพวกนี้ได้ (โจมตีแล้วไม่ค่อยเจ็บ)</h4>
      <div class="matchup-row">${resistHtml}</div>
    </div>

    ${immuneHtml ? `
    <div class="modal-section">
      <h4>🚫 ไม่โดนธาตุนี้เลย (ภูมิคุ้มกัน)</h4>
      <div class="matchup-row">${immuneHtml}</div>
    </div>` : ''}

    <div class="modal-section">
      <h4>📊 CP โดยประมาณ</h4>
      <div class="cp-row modal-cp">
        <span>ปกติ: <b>${boss.min_unboosted_cp}–${boss.max_unboosted_cp}</b></span>
        <span>อากาศบูสต์: <b>${boss.min_boosted_cp}–${boss.max_boosted_cp}</b></span>
        ${boss.possible_shiny ? '<span class="boss-shiny">✦ ตัวนี้อาจเป็นเชนี่ได้</span>' : ''}
      </div>
    </div>
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
modalEl.addEventListener('click', (e) => {
  if (e.target === modalEl) closeBossModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalEl.classList.contains('open')) closeBossModal();
});

// ============================================================
// COMMUNITY DAY
// ============================================================
function renderCommunityDay(cdays) {
  const body = document.getElementById('cdayBody');
  if (!Array.isArray(cdays) || cdays.length === 0) {
    body.innerHTML = '<p class="muted">ไม่มีข้อมูล Community Day ในขณะนี้</p>';
    return;
  }

  // Pick the most recent by community_day_number
  const latest = cdays.slice().sort((a, b) => b.community_day_number - a.community_day_number)[0];

  const bonuses = (latest.bonuses || []).map(b => `<span class="pill">${b}</span>`).join('');
  const boosted = (latest.boosted_pokemon || []).map(p => `<span class="pill gold">${p}</span>`).join('');
  const moves = (latest.event_moves || []).map(m =>
    `<div class="move-item"><b>${m.pokemon}</b> เรียนรู้ท่า <b>${m.move}</b> (${m.move_type === 'charged' ? 'ท่าพลัง' : 'ท่าไว'})</div>`
  ).join('') || '<div class="move-item">ไม่มีท่าพิเศษในรอบนี้</div>';

  const dateLabel = latest.start_date === latest.end_date
    ? formatBangkokDate(latest.start_date)
    : `${formatBangkokDate(latest.start_date)} – ${formatBangkokDate(latest.end_date)}`;

  body.innerHTML = `
    <div>
      <h3 class="cday-title">Community Day #${latest.community_day_number}</h3>
      <div class="cday-dates">${dateLabel}</div>
    </div>
    <div class="cday-grid">
      <div class="cday-block">
        <h4>โปเกมอนพิเศษ</h4>
        <div class="pill-row">${boosted || '<span class="pill">ไม่ระบุ</span>'}</div>
      </div>
      <div class="cday-block">
        <h4>โบนัสช่วงอีเวนต์</h4>
        <div class="pill-row">${bonuses || '<span class="pill">ไม่ระบุ</span>'}</div>
      </div>
    </div>
    <div class="cday-block">
      <h4>ท่าพิเศษที่หาได้ในช่วงนี้</h4>
      ${moves}
    </div>
  `;
}

// ============================================================
// WEATHER BOOSTS
// ============================================================
function renderWeather(weather) {
  const grid = document.getElementById('weatherGrid');
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
