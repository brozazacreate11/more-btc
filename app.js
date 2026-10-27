'use strict';
/* More BTC: всичко работи в браузъра. Личните данни са само в localStorage на устройството. */
const APP_VERSION = '4'; // същият номер като CACHE в sw.js

// ============================================================ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const DAY = 86400000;
const today = () => Math.floor(Date.now() / DAY);
const pad = n => String(n).padStart(2, '0');
const dDate = d => new Date(d * DAY);
const fmtDate = d => { const x = dDate(d); return `${pad(x.getUTCDate())}.${pad(x.getUTCMonth() + 1)}.${x.getUTCFullYear()}`; };
const fmtMonY = d => { const x = dDate(d); return `${pad(x.getUTCMonth() + 1)}.${x.getUTCFullYear()}`; };
const isoToDay = s => Math.floor(Date.parse(s + 'T00:00:00Z') / DAY);
const dayToIso = d => dDate(d).toISOString().slice(0, 10);
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const MONTHS = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
const WEEKDAYS = ['Пон', 'Вт', 'Ср', 'Чет', 'Пет', 'Съб', 'Нед'];

const nf = (n, dec = 0) => Number(n).toLocaleString('bg-BG', { minimumFractionDigits: dec, maximumFractionDigits: dec });
function money(n, cur = 'USD', dec) {
  if (n == null || !isFinite(n)) return '—';
  if (dec == null) dec = Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 1 ? 2 : 4;
  const s = nf(Math.abs(n), dec), neg = n < 0 ? '−' : '';
  return cur === 'EUR' ? `${neg}${s} €` : `${neg}$${s}`;
}
const pct = (n, dec = 2) => (n == null || !isFinite(n)) ? '—' : (n >= 0 ? '+' : '−') + nf(Math.abs(n), dec) + '%';
const fmtBtc = n => nf(n, n === 0 ? 0 : Math.abs(n) < 0.01 ? 8 : Math.abs(n) < 1 ? 6 : 4);
// Число от поле за въвеждане. Приема и запетая, и точка (0,01 или 0.01), интервали, минус, € $ %.
// Полетата са type="text", защото на iPhone с български език type="number" не приема запетая.
function num(v) {
  let s = String(v ?? '').trim().replace(/[\s  '€$%]/g, '').replace(/[−–]/g, '-');
  if (!s) return NaN;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); // 1.234,5 или 1,234.5
  else if (lc > -1) s = s.indexOf(',') !== lc ? s.replace(/,/g, '') : s.replace(',', '.');        // 1,234,567 или 0,01
  return Number(s);
}
// стойност за показване в поле: с десетична запетая и без излишни нули
const fmtIn = n => n ? (+n).toFixed(8).replace(/\.?0+$/, '').replace('.', ',') : '';
const fmtShort = (v, cur = 'USD') => {
  const a = Math.abs(v); let s;
  if (a >= 1e12) s = nf(v / 1e12, 2) + ' трлн'; else if (a >= 1e9) s = nf(v / 1e9, 1) + ' млрд';
  else if (a >= 1e6) s = nf(v / 1e6, 1) + ' млн'; else if (a >= 1e4) s = nf(v / 1e3, 0) + 'k';
  else if (a >= 1) s = nf(v, a >= 100 ? 0 : 2); else s = nf(v, 3);
  return cur === 'EUR' ? s + ' €' : cur === 'USD' ? '$' + s : s;
};
const cls = (el, n) => { el.classList.remove('up', 'down'); if (n != null && isFinite(n)) el.classList.add(n >= 0 ? 'up' : 'down'); };

const LS = {
  get(k, d) { try { const v = localStorage.getItem('morebtc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('morebtc.' + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem('morebtc.' + k); } catch { } },
};
const settings = Object.assign({ key: '', holdings: 848000, scale: 'log' }, LS.get('settings', {}));
const saveSettings = () => LS.set('settings', settings);

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

// binary search: first index with arr[i] >= x
function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

// ============================================================ data
const B = { d: [], p: [], d0: 0 };   // BTC USD, дневни, без пропуски
const M = { d: [], p: [] };          // MSTR USD, търговски дни
const FX = { d: [], p: [], d0: 0 };  // EUR→USD, без пропуски
const FNG = new Map();               // ден → стойност
const FNGs = { d: [], v: [] };

function contiguous(pairs, target) {
  pairs.sort((a, b) => a[0] - b[0]);
  const d0 = pairs[0][0], d1 = Math.max(pairs[pairs.length - 1][0], today());
  target.d0 = d0; target.d = []; target.p = [];
  let j = 0, last = pairs[0][1];
  for (let day = d0; day <= d1; day++) {
    while (j < pairs.length && pairs[j][0] <= day) { last = pairs[j][1]; j++; }
    target.d.push(day); target.p.push(last);
  }
}
const btcAt = day => B.p[clamp(day - B.d0, 0, B.p.length - 1)];
function fxAt(day) {
  if (day >= today() && Live.fx) return Live.fx;
  return FX.p[clamp(day - FX.d0, 0, FX.p.length - 1)];
}
function mstrAt(day) { // последна цена в или преди деня
  if (day >= today() && Live.mstr) return Live.mstr;
  const i = lowerBound(M.d, day + 1) - 1; return i >= 0 ? M.p[i] : null;
}
const priceAt = (asset, day) => asset === 'MSTR' ? mstrAt(day) : btcAt(day);
const fngAt = day => FNG.has(day) ? FNG.get(day) : FNG.has(day - 1) ? FNG.get(day - 1) : null;

async function loadData() {
  const [btc, mstr, fx] = await Promise.all([getJSON('data/btc.json'), getJSON('data/mstr.json'), getJSON('data/eurusd.json')]);
  const bmap = new Map(btc.d);
  try { // допълни последните дни от Binance (ако файлът е остарял)
    const kl = await getJSON('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=90');
    for (const k of kl) bmap.set(Math.floor(k[0] / DAY), +k[4]);
  } catch { }
  contiguous([...bmap.entries()], B);
  M.d = mstr.d.map(x => x[0]); M.p = mstr.d.map(x => x[1]);
  contiguous(fx.d, FX);
  try {
    const f = await getJSON('https://api.alternative.me/fng/?limit=0');
    const arr = f.data.map(x => [Math.floor(+x.timestamp / 86400), +x.value]).sort((a, b) => a[0] - b[0]);
    LS.set('fngCache', arr);
    fillFng(arr);
  } catch { fillFng(LS.get('fngCache', [])); }
}
function fillFng(arr) { FNG.clear(); FNGs.d = []; FNGs.v = []; for (const [d, v] of arr) { FNG.set(d, v); FNGs.d.push(d); FNGs.v.push(v); } }

// ============================================================ indicators
const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'].map(isoToDay);
const GENESIS = isoToDay('2009-01-03');
const I = {};
let RB = null; // rainbow параметри
let CY = null; // цикли

function sma(p, n) { const o = new Array(p.length).fill(null); let s = 0; for (let i = 0; i < p.length; i++) { s += p[i]; if (i >= n) s -= p[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(p, n = 14) {
  const o = new Array(p.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < p.length; i++) {
    const ch = p[i] - p[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return o;
}
// седмичен RSI (седмици до неделя); текущата седмица ползва последната цена
function rsiWeekly(days, p, n = 14) {
  const o = new Array(p.length).fill(null);
  let last = null, g = 0, l = 0, cnt = 0, sg = 0, sl = 0;
  for (let i = 0; i < p.length; i++) {
    const isClose = ((days[i] % 7) + 7) % 7 === 3; // ден 0 = четвъртък → 3 = неделя
    if (last === null) { if (isClose) last = p[i]; continue; }
    const ch = p[i] - last, up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    let G = null, L = null;
    if (cnt < n) { if (cnt + 1 === n) { G = (sg + up) / n; L = (sl + dn) / n; } }
    else { G = (g * (n - 1) + up) / n; L = (l * (n - 1) + dn) / n; }
    if (G != null) o[i] = L === 0 ? 100 : 100 - 100 / (1 + G / L);
    if (isClose) {
      if (cnt < n) { sg += up; sl += dn; cnt++; if (cnt === n) { g = sg / n; l = sl / n; } } else { g = G; l = L; }
      last = p[i];
    }
  }
  return o;
}

function fitRainbow() {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < B.d.length; i++) {
    const x = Math.log10(B.d[i] - GENESIS), y = Math.log10(B.p[i]);
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  const fit = d => a + b * Math.log10(d - GENESIS);
  let mn = Infinity, mx = -Infinity; const from = isoToDay('2013-01-01');
  for (let i = 0; i < B.d.length; i++) if (B.d[i] >= from) { const r = Math.log10(B.p[i]) - fit(B.d[i]); mn = Math.min(mn, r); mx = Math.max(mx, r); }
  mn -= 0.04; mx += 0.04;
  const edges = Array.from({ length: 10 }, (_, k) => mn + (mx - mn) * k / 9);
  RB = { a, b, fit, mn, mx, edges };
}
const RB_NAMES = ['Огромна разпродажба', 'КУПУВАЙ!', 'Натрупвай', 'Все още евтино', 'HODL!', 'Балон ли е?', 'FOMO расте', 'Продавай. Сериозно.', 'Максимален балон'];
const RB_COLORS = ['#6d28d9', '#2563eb', '#0891b2', '#16a34a', '#84cc16', '#eab308', '#f97316', '#ef4444', '#b91c1c'];
const rbBand = (d, p) => { const r = Math.log10(p) - RB.fit(d); return clamp(Math.floor((r - RB.mn) / (RB.mx - RB.mn) * 9), 0, 8); };

function computeCycles() {
  const idx = d => clamp(d - B.d0, 0, B.p.length - 1);
  const cycles = HALVINGS.map((h, k) => {
    const end = k + 1 < HALVINGS.length ? HALVINGS[k + 1] : B.d[B.d.length - 1] + 1;
    // върхът е в първите ~800 дни след халвинга (исторически 372–548), дъното до ~1200-ия ден;
    // иначе ръстът точно преди следващия халвинг (напр. март 2024) се брои погрешно за връх
    const last = Math.min(end, B.d[B.d.length - 1] + 1);
    let top = -1, topD = h;
    for (let d = h; d < Math.min(last, h + 800); d++) { const v = B.p[idx(d)]; if (v > top) { top = v; topD = d; } }
    let bot = Infinity, botD = topD;
    for (let d = topD; d < Math.min(last, h + 1200); d++) { const v = B.p[idx(d)]; if (v < bot) { bot = v; botD = d; } }
    let pb = Infinity, pbD = h; // дъното на предишния мечи пазар (исторически 376–542 дни преди халвинга)
    for (let d = Math.max(B.d0, h - 560); d <= h; d++) { const v = B.p[idx(d)]; if (v < pb) { pb = v; pbD = d; } }
    return { k, year: dDate(h).getUTCFullYear(), h, hp: B.p[idx(h)], end, done: k + 1 < HALVINGS.length, top, topD, bot, botD, pb, pbD };
  });
  const done = cycles.filter(c => c.done).slice(-2);
  const topT = Math.round(done.reduce((s, c) => s + c.topD - c.h, 0) / done.length);
  const botT = Math.round(done.reduce((s, c) => s + c.botD - c.h, 0) / done.length);
  CY = { cycles, topT, botT, len: 1458, cur: cycles[cycles.length - 1] };
  CY.colors = { 2024: '#22c55e', 2020: '#a855f7', 2016: '#f59e0b', 2012: '#3b82f6' };
}
function halvingBefore(d) { let h = null; for (const x of HALVINGS) if (x <= d) h = x; return h; }
function cycleScore(t) {
  const { topT, botT, len } = CY;
  if (t <= topT) return 40 + 60 * t / topT;
  if (t <= botT) return 100 - 100 * (t - topT) / (botT - topT);
  return Math.min(40, 40 * (t - botT) / (len - botT));
}
function phaseOf(t) {
  const { topT, botT } = CY;
  if (t < 180) return ['Ранна фаза след халвинга', 'Исторически добро време за натрупване преди растежа.'];
  if (t < topT - 75) return ['Бичи пазар', 'Растеж. Исторически върхът идва около ' + topT + ' дни след халвинга.'];
  if (t < topT + 75) return ['Зона на исторически връх', 'Исторически тук е била най-високата цена. Внимание, време за частична печалба.'];
  if (t < botT - 120) return ['Мечи пазар', 'Спад след върха. Исторически дъното идва около ' + botT + ' дни след халвинга.'];
  if (t < botT + 120) return ['Зона на историческо дъно', 'Исторически най-доброто време за натрупване в цикъла.'];
  return ['Натрупване преди халвинга', 'Възстановяване. Исторически добро време за натрупване.'];
}

function computeIndicators() {
  I.sma200 = sma(B.p, 200);
  I.wma200 = sma(B.p, 1400);
  const s111 = sma(B.p, 111), s350 = sma(B.p, 350);
  I.pi = s111.map((v, i) => v && s350[i] ? v / (2 * s350[i]) : null);
  I.rsiD = rsi(B.p, 14);
  I.rsiW = rsiWeekly(B.d, B.p, 14);
  fitRainbow();
  computeCycles();
  I.score = B.p.map((_, i) => scoreAt(i).score);
}
const lerpLog = (m, a, b) => (Math.log(m) - Math.log(a)) / (Math.log(b) - Math.log(a)) * 100;
function scoreAt(i) {
  const p = B.p[i], d = B.d[i], c = [];
  const r = Math.log10(p) - RB.fit(d);
  c.push({ n: 'Rainbow', v: clamp((r - RB.mn) / (RB.mx - RB.mn) * 100), t: RB_NAMES[rbBand(d, p)] });
  if (I.sma200[i]) { const m = p / I.sma200[i]; c.push({ n: 'Mayer Multiple', v: clamp(lerpLog(m, 0.6, 2.4)), t: nf(m, 2) }); }
  if (I.wma200[i]) { const m = p / I.wma200[i]; c.push({ n: 'Цена / 200W MA', v: clamp(lerpLog(m, 1, 4.5)), t: '×' + nf(m, 2) }); }
  if (I.rsiW[i] != null) c.push({ n: 'Седмичен RSI', v: clamp((I.rsiW[i] - 30) / 60 * 100), t: nf(I.rsiW[i], 0) });
  const f = fngAt(d); if (f != null) c.push({ n: 'Fear & Greed', v: f, t: String(f) });
  const h = halvingBefore(d); if (h != null) c.push({ n: 'Позиция в цикъла', v: clamp(cycleScore(d - h)), t: (d - h) + ' дни' });
  if (I.pi[i]) c.push({ n: 'Pi Cycle Top', v: clamp((I.pi[i] - 0.35) / 0.65 * 100), t: nf(I.pi[i] * 100, 0) + '%' });
  return { score: c.reduce((s, x) => s + x.v, 0) / c.length, comps: c };
}
const scoreOnDay = d => I.score[clamp(d - B.d0, 0, I.score.length - 1)];
function scoreLabel(s) {
  if (s < 20) return 'Силна зона за натрупване';
  if (s < 40) return 'Натрупвай';
  if (s < 60) return 'Неутрално / HODL';
  if (s < 80) return 'Внимание, частична печалба';
  return 'Зона за продажба';
}
const scoreColor = s => `hsl(${Math.round(220 - clamp(s) * 2.2)}, 85%, 55%)`;

// ============================================================ live prices
const Live = { btcUsd: null, btcEur: null, openUsd: null, openEur: null, fx: null, mstr: null, mstrPc: null, mcap: null, shares: null, lastBtc: 0, lastMstr: 0, height: null };
let dirty = true, cbWs = null, fhWs = null;

function connectCoinbase() {
  try { cbWs && cbWs.close(); } catch { }
  const ws = cbWs = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD', 'BTC-EUR'], channels: ['ticker'] }));
  ws.onmessage = e => {
    const m = JSON.parse(e.data); if (m.type !== 'ticker') return;
    if (m.product_id === 'BTC-USD') { Live.btcUsd = +m.price; Live.openUsd = +m.open_24h; } else { Live.btcEur = +m.price; Live.openEur = +m.open_24h; }
    if (Live.btcUsd && Live.btcEur) Live.fx = Live.btcUsd / Live.btcEur;
    Live.lastBtc = Date.now(); dirty = true;
  };
  ws.onclose = () => { if (cbWs === ws) setTimeout(() => document.visibilityState === 'visible' && connectCoinbase(), 3000); };
  ws.onerror = () => ws.close();
}
async function pollBtc() { // резервен вариант, ако WebSocket мълчи
  if (Date.now() - Live.lastBtc < 10000) return;
  try {
    const [u, e] = await Promise.all(['USD', 'EUR'].map(c => getJSON(`https://api.coinbase.com/v2/prices/BTC-${c}/spot`)));
    Live.btcUsd = +u.data.amount; Live.btcEur = +e.data.amount; Live.fx = Live.btcUsd / Live.btcEur;
    if (!Live.openUsd) { Live.openUsd = btcAt(today() - 1); Live.openEur = Live.openUsd / fxAt(today() - 1); }
    dirty = true;
  } catch { }
}
function connectFinnhub() {
  try { fhWs && fhWs.close(); } catch { }
  fhWs = null;
  if (!settings.key) return;
  const ws = fhWs = new WebSocket('wss://ws.finnhub.io?token=' + encodeURIComponent(settings.key));
  ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', symbol: 'MSTR' }));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'trade' && m.data && m.data.length) { Live.mstr = m.data[m.data.length - 1].p; Live.lastMstr = Date.now(); dirty = true; }
  };
  ws.onclose = () => { if (fhWs === ws) setTimeout(() => document.visibilityState === 'visible' && connectFinnhub(), 5000); };
  ws.onerror = () => ws.close();
}
async function pollMstr() {
  if (!settings.key) { // без ключ: последна дневна цена от файла
    Live.mstr = M.p[M.p.length - 1]; Live.mstrPc = M.p[M.p.length - 2]; dirty = true; return;
  }
  try {
    const q = await getJSON(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${encodeURIComponent(settings.key)}`);
    if (q.c) { if (Date.now() - Live.lastMstr > 30000) Live.mstr = q.c; Live.mstrPc = q.pc; dirty = true; }
    if (!Live.mcap) {
      const pr = await getJSON(`https://finnhub.io/api/v1/stock/profile2?symbol=MSTR&token=${encodeURIComponent(settings.key)}`);
      Live.shares = pr.shareOutstanding ? pr.shareOutstanding * 1e6 : null; Live.mcap = pr.marketCapitalization ? pr.marketCapitalization * 1e6 : null;
    }
    $('#keyStatus').textContent = '✅ Ключът работи';
  } catch { $('#keyStatus').textContent = '⚠️ Ключът не работи или е достигнат лимитът'; }
}
async function pollHeight() { try { Live.height = +(await (await fetch('https://mempool.space/api/blocks/tip/height')).text()); dirty = true; } catch { } }

function syncTodayIntoHistory() { // живата цена става последната точка в историята
  if (!Live.btcUsd) return false;
  const t = today(); let changed = false;
  while (B.d[B.d.length - 1] < t) { B.d.push(B.d[B.d.length - 1] + 1); B.p.push(B.p[B.p.length - 1]); changed = true; }
  B.p[t - B.d0] = Live.btcUsd;
  return changed;
}

// ============================================================ market view
let prevBtc = null;
function renderMarket() {
  const t = today(), i = B.p.length - 1;
  const usd = Live.btcUsd ?? B.p[i], eur = Live.btcEur ?? usd / fxAt(t);
  const el = $('#btcUsd'); el.textContent = money(usd, 'USD', 0);
  if (prevBtc != null && usd !== prevBtc) { el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(usd > prevBtc ? 'flash-up' : 'flash-down'); setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 600); }
  prevBtc = usd;
  $('#btcEur').textContent = money(eur, 'EUR', 0);
  const open = Live.openUsd || B.p[i - 1], ch = (usd / open - 1) * 100;
  const c = $('#btcChg'); c.textContent = pct(ch) + ' 24ч'; c.className = 'chip ' + (ch >= 0 ? 'up' : 'down');
  let ath = 0, athD = 0; for (let k = 0; k < B.p.length; k++) if (B.p[k] > ath) { ath = B.p[k]; athD = B.d[k]; }
  $('#athTxt').textContent = `${money(ath, 'USD', 0)} (${fmtDate(athD)})`;
  const dd = $('#ddTxt'); dd.textContent = pct((usd / ath - 1) * 100, 1); cls(dd, usd / ath - 1);

  // MSTR
  const mp = Live.mstr ?? M.p[M.p.length - 1], mpc = Live.mstrPc ?? M.p[M.p.length - 2];
  $('#mstrUsd').textContent = money(mp, 'USD', 2);
  $('#mstrEur').textContent = money(mp / (Live.fx || fxAt(t)), 'EUR', 2);
  const mch = (mp / mpc - 1) * 100, mc = $('#mstrChg'); mc.textContent = pct(mch) + ' днес'; mc.className = 'chip ' + (mch >= 0 ? 'up' : 'down');
  const nav = settings.holdings * usd;
  if (Live.shares) {
    const mcap = Live.shares * mp;
    $('#mnavTxt').textContent = nf(mcap / nav, 2);
    $('#bpsTxt').textContent = nf(settings.holdings / Live.shares * 1e8, 0) + ' сат.';
  } else { $('#mnavTxt').textContent = '—'; $('#bpsTxt').textContent = '—'; }
  $('#mstrNote').innerHTML = settings.key ? (Date.now() - Live.lastMstr < 120000 ? 'Наживо (Finnhub)' : 'Finnhub · извън търговските часове показва последната цена')
    : 'Последна дневна цена. <a href="#" data-open-settings>Добави Finnhub ключ</a> за реално време и mNAV.';

  // Сигнал
  const sc = scoreAt(i);
  $('#scoreNum').textContent = Math.round(sc.score);
  $('#scoreNum').style.color = scoreColor(sc.score);
  $('#scoreLabel').textContent = scoreLabel(sc.score);
  $('#scoreSub').textContent = '0 = максимално изгодно за купуване · 100 = прегрят пазар';
  $('#scoreMarker').style.left = clamp(sc.score) + '%';
  $('#scoreComp').innerHTML = sc.comps.map(x => `<span>${x.n}</span><span class="muted mono">${x.t}</span><div class="bar"><i style="width:${Math.max(4, x.v)}%;background:${scoreColor(x.v)}"></i></div>`).join('');

  // Цикъл
  const cur = CY.cur, tH = t - cur.h, [ph, phTxt] = phaseOf(tH);
  $('#phaseTxt').textContent = ph;
  $('#cycleHint').textContent = phTxt;
  $('#daysSinceH').textContent = nf(tH);
  $('#lastHTxt').textContent = 'Халвинг ' + fmtDate(cur.h);
  const nextH = 1050000, left = Live.height ? nextH - Live.height : null;
  const estNext = left != null ? t + Math.round(left * 10 / 1440) : cur.h + CY.len;
  $('#nextHTxt').textContent = fmtMonY(estNext);
  $('#blocksLeft').textContent = left != null ? `≈ ${nf(estNext - t)} дни · ${nf(left)} блока` : `≈ ${nf(estNext - t)} дни`;
  $('#cTop').textContent = money(cur.top, 'USD', 0);
  $('#cTopS').textContent = `${fmtDate(cur.topD)} · ден ${cur.topD - cur.h}`;
  $('#cBot').textContent = money(cur.bot, 'USD', 0);
  $('#cBotS').textContent = `${pct((cur.bot / cur.top - 1) * 100, 0)} · ${fmtDate(cur.botD)} (досега)`;
  const len = estNext - cur.h, P = x => clamp(x / len * 100, 0, 100);
  $('#cycleBar').innerHTML = `<div class="fill" style="width:100%"></div>
    <div class="tick" style="left:${P(CY.topT)}%">връх ~${CY.topT}д</div>
    <div class="tick" style="left:${P(CY.botT)}%">дъно ~${CY.botT}д</div>
    <div class="now" style="left:${P(tH)}%"><span>днес</span></div>`;

  // Индикатори
  const f = fngAt(t) ?? FNGs.v[FNGs.v.length - 1];
  const fTxt = f == null ? '—' : f < 25 ? 'Силен страх' : f < 45 ? 'Страх' : f < 56 ? 'Неутрално' : f < 76 ? 'Алчност' : 'Силна алчност';
  const box = (k, v, s, col) => `<div class="stat"><div class="k">${k}</div><div class="v" ${col ? `style="color:${col}"` : ''}>${v}</div><div class="s">${s}</div></div>`;
  const rd = I.rsiD[i], rw = I.rsiW[i], may = usd / I.sma200[i], w2 = I.wma200[i], pi = I.pi[i];
  const rsiS = r => r == null ? '' : r >= 70 ? 'Прекупен' : r <= 30 ? 'Препродаден' : 'Неутрален';
  $('#indStats').innerHTML = [
    box('Fear & Greed', f ?? '—', fTxt, f != null ? scoreColor(f) : null),
    box('RSI дневен', rd != null ? nf(rd, 0) : '—', rsiS(rd), rd != null ? scoreColor(clamp((rd - 30) / 40 * 100)) : null),
    box('RSI седмичен', rw != null ? nf(rw, 0) : '—', rsiS(rw), rw != null ? scoreColor(clamp((rw - 30) / 60 * 100)) : null),
    box('Mayer Multiple', nf(may, 2), may < 0.8 ? 'Под 0.8 = исторически евтино' : may > 2.4 ? 'Над 2.4 = прегрято' : 'Цена / 200-дн. средна', scoreColor(clamp(lerpLog(may, 0.6, 2.4)))),
    box('200W MA', money(w2, 'USD', 0), `Цената е ${pct((usd / w2 - 1) * 100, 0)} над нея`),
    box('200D MA', money(I.sma200[i], 'USD', 0), usd > I.sma200[i] ? 'Над нея = бичи режим' : 'Под нея = мечи режим'),
    box('Pi Cycle Top', nf(pi * 100, 0) + '%', '100% = исторически сигнал за връх', scoreColor(clamp((pi - 0.35) / 0.65 * 100))),
    box('Rainbow зона', RB_NAMES[rbBand(t, usd)], 'Лог. регресия', RB_COLORS[rbBand(t, usd)]),
  ].join('');
}

// ============================================================ charts
Chart.defaults.color = '#8b91a0';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.font.size = 11;
Chart.register({
  id: 'lines',
  afterDatasetsDraw(chart, _a, o) {
    const { ctx, chartArea: a, scales } = chart;
    ctx.save(); ctx.font = '10px ' + Chart.defaults.font.family; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    for (const l of o.v || []) {
      const x = scales.x.getPixelForValue(l.x); if (x < a.left || x > a.right) continue;
      ctx.strokeStyle = l.c || '#777'; ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
      ctx.fillStyle = l.c || '#999'; ctx.fillText(l.t || '', x + 4, a.top + 11);
    }
    for (const l of o.h || []) {
      const y = scales.y.getPixelForValue(l.y); if (y < a.top || y > a.bottom) continue;
      ctx.strokeStyle = l.c || '#777'; ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
      ctx.fillStyle = l.c || '#999'; ctx.fillText(l.t || '', a.left + 4, y - 4);
    }
    ctx.restore();
  },
});
const charts = {};
function mk(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); return charts[id]; }
const isLog = () => settings.scale === 'log';
function niceLogTick(fmt) {
  return function (v) {
    if (this.type !== 'logarithmic') return fmt(v);
    const m = v / 10 ** Math.floor(Math.log10(v) + 1e-9);
    return [1, 2, 5].some(x => Math.abs(m - x) < 1e-6) ? fmt(v) : '';
  };
}
function opts({ y = {}, x = {}, tooltipTitle, legend = false, yFmt = v => fmtShort(v, 'USD'), labelFmt } = {}) {
  return {
    animation: false, responsive: true, maintainAspectRatio: false, parsing: false, normalized: true,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      legend: { display: legend, labels: { boxWidth: 12, boxHeight: 3 } },
      decimation: { enabled: true, algorithm: 'lttb', samples: 700 },
      tooltip: {
        callbacks: {
          title: it => it.length ? (tooltipTitle ? tooltipTitle(it[0].parsed.x) : fmtDate(it[0].parsed.x)) : '',
          label: c => ` ${c.dataset.label}: ${labelFmt ? labelFmt(c.parsed.y, c) : yFmt(c.parsed.y)}`,
        },
      },
    },
    scales: {
      x: Object.assign({ type: 'linear', bounds: 'data', ticks: { maxTicksLimit: 7, callback: v => fmtMonY(v) }, grid: { display: false } }, x),
      y: Object.assign({ type: isLog() ? 'logarithmic' : 'linear', ticks: { callback: niceLogTick(yFmt), maxTicksLimit: 8 }, position: 'right' }, y),
    },
  };
}
const xy = (d, p, from = -Infinity, step = 1) => { const o = []; for (let i = 0; i < d.length; i += step) if (d[i] >= from && p[i] != null) o.push({ x: d[i], y: p[i] }); return o; };
const rangeFrom = y => y === 's' ? isoToDay('2020-08-11') : (+y ? today() - 365 * +y : -Infinity);
const getRange = key => $(`.seg[data-range="${key}"] button.on`).dataset.y;
const halvingLines = () => HALVINGS.map(h => ({ x: h, t: String(dDate(h).getUTCFullYear()), c: 'rgba(247,147,26,.7)' }));

function chartPrice() {
  const from = rangeFrom(getRange('price'));
  const ov = Object.fromEntries($$('[data-ov]').map(x => [x.dataset.ov, x.checked]));
  const ds = [{
    label: 'BTC', data: xy(B.d, B.p, from), borderColor: '#f7931a', borderWidth: 1.8, pointRadius: 0,
    segment: ov.signal ? { borderColor: c => scoreColor(scoreOnDay(c.p0.parsed.x)) } : undefined,
  }];
  if (ov.wma200) ds.push({ label: '200W MA', data: xy(B.d, I.wma200, from), borderColor: '#e5e7eb', borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0 });
  if (ov.sma200) ds.push({ label: '200D MA', data: xy(B.d, I.sma200, from), borderColor: '#a855f7', borderWidth: 1.2, pointRadius: 0 });
  const o = opts(); o.plugins.lines = { v: ov.halvings ? halvingLines() : [] };
  mk('cPrice', { type: 'line', data: { datasets: ds }, options: o });
  $('#lgPrice').innerHTML = (ov.signal ? `<span><i style="background:linear-gradient(90deg,${scoreColor(0)},${scoreColor(50)},${scoreColor(100)})"></i>Цена, оцветена по сигнала (синьо = натрупване, червено = продажба)</span>` : '<span><i style="background:#f7931a"></i>Цена</span>')
    + (ov.wma200 ? '<span><i style="background:#e5e7eb"></i>200-седмична средна (исторически „под“ е дъно)</span>' : '')
    + (ov.sma200 ? '<span><i style="background:#a855f7"></i>200-дневна средна</span>' : '')
    + (ov.halvings ? '<span><i style="background:rgba(247,147,26,.7)"></i>Пунктир = халвинг</span>' : '');
}

const CYCLE_HINTS = {
  halving: 'Всеки цикъл започва от деня на халвинга (= 1×). Вижда се колко пъти е нараснала цената и кога е бил върхът.',
  bottom: 'Всеки цикъл започва от дъното на предишния мечи пазар (= 1×). Показва растежа от дъно до дъно.',
  top: 'Всеки цикъл започва от върха (= 1×). Показва колко дълбоко и колко дълго пада цената след връх.',
};
function chartCycles() {
  const mode = $('#cycleMode button.on').dataset.m;
  $('#cycleModeHint').textContent = CYCLE_HINTS[mode];
  const ds = [], lg = [];
  const names = { 2012: '2012–2016', 2016: '2016–2020', 2020: '2020–2024', 2024: '2024– (сега)' };
  for (const c of [...CY.cycles].reverse()) {
    const anchor = mode === 'halving' ? c.h : mode === 'bottom' ? c.pb : c.topD;
    const next = CY.cycles[c.k + 1];
    let end = mode === 'halving' ? c.end : mode === 'bottom' ? (next ? next.pb : today()) : (next ? next.topD : today());
    end = Math.min(end, today());
    const base = btcAt(anchor), data = [];
    for (let d = anchor; d <= end; d += 2) data.push({ x: d - anchor, y: btcAt(d) / base });
    const col = CY.colors[c.year], isCur = c.year === 2024;
    ds.push({ label: names[c.year], data, borderColor: col, borderWidth: isCur ? 3 : 1.6, pointRadius: 0, order: isCur ? 0 : 1 });
    lg.push(`<span><i style="background:${col}"></i>${names[c.year]}</span>`);
  }
  const o = opts({ yFmt: v => nf(v, v < 10 ? 2 : 0) + '×', labelFmt: (v) => `${nf(v, 2)}× (${pct((v - 1) * 100, 0)})` });
  o.scales.x.ticks.callback = v => v + 'д';
  o.scales.x.title = { display: true, text: mode === 'halving' ? 'дни след халвинга' : mode === 'bottom' ? 'дни след дъното' : 'дни след върха' };
  o.plugins.tooltip.callbacks.title = it => it.length ? `Ден ${it[0].parsed.x}` : '';
  o.interaction = { mode: 'index', intersect: false, axis: 'x' };
  o.plugins.decimation.enabled = false;
  const cur = CY.cur, tNow = mode === 'halving' ? today() - cur.h : mode === 'bottom' ? today() - cur.pb : today() - cur.topD;
  o.plugins.lines = { v: [{ x: tNow, t: 'днес', c: '#22c55e' }] };
  mk('cCycles', { type: 'line', data: { datasets: ds }, options: o });
  $('#lgCycles').innerHTML = lg.reverse().join('');
}

function chartRainbow() {
  const from = isoToDay('2010-09-01'), to = today() + 365 * 3, ds = [];
  for (let k = 0; k <= 9; k++) {
    const data = [];
    for (let d = from; d <= to; d += 7) data.push({ x: d, y: 10 ** (RB.fit(d) + RB.edges[k]) });
    ds.push({ label: k ? RB_NAMES[k - 1] : 'дъно', data, borderWidth: 0, pointRadius: 0, fill: k ? '-1' : false, backgroundColor: k ? RB_COLORS[k - 1] + 'b0' : 'transparent' });
  }
  ds.push({ label: 'BTC', data: xy(B.d, B.p, from), borderColor: '#fff', borderWidth: 1.5, pointRadius: 0 });
  const o = opts();
  o.plugins.tooltip.filter = c => c.dataset.label === 'BTC';
  o.plugins.lines = { v: [{ x: today(), t: 'днес', c: '#fff' }] };
  mk('cRainbow', { type: 'line', data: { datasets: ds }, options: o });
  const b = rbBand(today(), B.p[B.p.length - 1]);
  $('#rbNow').textContent = RB_NAMES[b]; $('#rbNow').style.color = RB_COLORS[b];
  $('#lgRainbow').innerHTML = RB_NAMES.map((n, k) => `<span><i class="sq" style="background:${RB_COLORS[k]}"></i>${n}</span>`).reverse().join('');
}

function chartMstr() {
  const mode = $('#mstrMode button.on').dataset.m, from = rangeFrom(getRange('mstr'));
  const i0 = lowerBound(M.d, from === -Infinity ? isoToDay('2010-01-01') : from);
  const dd = M.d.slice(i0), mp = M.p.slice(i0), bp = dd.map(btcAt);
  let ds, o, hint;
  if (mode === 'norm') {
    ds = [
      { label: 'MSTR', data: dd.map((d, k) => ({ x: d, y: mp[k] / mp[0] * 100 })), borderColor: '#ef4444', borderWidth: 1.6, pointRadius: 0 },
      { label: 'BTC', data: dd.map((d, k) => ({ x: d, y: bp[k] / bp[0] * 100 })), borderColor: '#f7931a', borderWidth: 1.6, pointRadius: 0 },
    ];
    const r1 = (mp[mp.length - 1] / mp[0] - 1) * 100, r2 = (bp[bp.length - 1] / bp[0] - 1) * 100;
    hint = `От ${fmtDate(dd[0])}: MSTR ${pct(r1, 0)}, BTC ${pct(r2, 0)}. И двете започват от 100.`;
    o = opts({ legend: true, yFmt: v => nf(v, 0), labelFmt: v => nf(v, 1) });
  } else if (mode === 'mstrbtc') {
    ds = [{ label: 'MSTR в сатоши', data: dd.map((d, k) => ({ x: d, y: mp[k] / bp[k] * 1e8 })), borderColor: '#ef4444', borderWidth: 1.6, pointRadius: 0, fill: true, backgroundColor: 'rgba(239,68,68,.08)' }];
    hint = 'Цена на 1 MSTR акция в сатоши. Расте ли, MSTR бие BTC. Пада ли, BTC е по-добрата инвестиция.';
    o = opts({ yFmt: v => fmtShort(v, '') + ' sat' });
  } else {
    ds = [{ label: 'MSTR акции за 1 BTC', data: dd.map((d, k) => ({ x: d, y: bp[k] / mp[k] })), borderColor: '#f7931a', borderWidth: 1.6, pointRadius: 0, fill: true, backgroundColor: 'rgba(247,147,26,.08)' }];
    hint = 'Колко MSTR акции купува 1 BTC. Високо значи MSTR е евтина спрямо BTC и е време да сменяш BTC→MSTR. Ниско значи обратното.';
    o = opts({ yFmt: v => nf(v, v < 10 ? 2 : 0) });
  }
  $('#mstrHint').textContent = hint;
  mk('cMstr', { type: 'line', data: { datasets: ds }, options: o });
}

function chartRsi() {
  const from = rangeFrom(getRange('rsi'));
  const o = opts({ y: { type: 'linear', min: 0, max: 100 }, yFmt: v => nf(v, 0), legend: true });
  o.plugins.lines = { h: [{ y: 70, t: '70 прекупен', c: '#ef4444' }, { y: 30, t: '30 препродаден', c: '#3b82f6' }] };
  mk('cRsi', { type: 'line', data: { datasets: [
    { label: 'Дневен RSI', data: xy(B.d, I.rsiD, from), borderColor: 'rgba(247,147,26,.55)', borderWidth: 1, pointRadius: 0 },
    { label: 'Седмичен RSI', data: xy(B.d, I.rsiW, from), borderColor: '#a855f7', borderWidth: 2, pointRadius: 0 },
  ] }, options: o });
}
function chartFng() {
  const from = FNGs.d[0];
  const o = opts({ y: { type: 'linear', min: 0, max: 100, position: 'left' }, yFmt: v => nf(v, 0), legend: true });
  o.scales.y2 = { type: isLog() ? 'logarithmic' : 'linear', position: 'right', grid: { display: false }, ticks: { callback: niceLogTick(v => fmtShort(v, 'USD')) } };
  o.plugins.tooltip.callbacks.label = c => ` ${c.dataset.label}: ${c.dataset.yAxisID === 'y2' ? money(c.parsed.y, 'USD', 0) : c.parsed.y}`;
  mk('cFng', { type: 'line', data: { datasets: [
    { label: 'Fear & Greed', data: FNGs.d.map((d, k) => ({ x: d, y: FNGs.v[k] })), borderColor: '#22c55e', borderWidth: 1, pointRadius: 0, segment: { borderColor: c => scoreColor(c.p1.parsed.y) } },
    { label: 'BTC', data: xy(B.d, B.p, from), borderColor: 'rgba(255,255,255,.7)', borderWidth: 1.3, pointRadius: 0, yAxisID: 'y2' },
  ] }, options: o });
}
function chartScore() {
  const from = isoToDay('2012-01-01');
  const o = opts(); o.plugins.lines = { v: halvingLines() };
  mk('cScoreP', { type: 'line', data: { datasets: [{ label: 'BTC', data: xy(B.d, B.p, from), borderWidth: 2, pointRadius: 0, segment: { borderColor: c => scoreColor(scoreOnDay(c.p0.parsed.x)) } }] }, options: o });
  const o2 = opts({ y: { type: 'linear', min: 0, max: 100 }, yFmt: v => nf(v, 0) });
  o2.plugins.lines = { h: [{ y: 80, t: 'продажба', c: '#ef4444' }, { y: 20, t: 'натрупване', c: '#3b82f6' }] };
  mk('cScore', { type: 'line', data: { datasets: [{ label: 'Сигнал', data: xy(B.d, I.score, from, 3), borderWidth: 1.5, pointRadius: 0, segment: { borderColor: c => scoreColor(c.p1.parsed.y) } }] }, options: o2 });
}
function renderCharts() { chartPrice(); chartCycles(); chartRainbow(); chartMstr(); chartRsi(); chartFng(); chartScore(); }

// ============================================================ DCA engine
function lastDayOf(asset) { return asset === 'MSTR' ? M.d[M.d.length - 1] : B.d[B.d.length - 1]; }
function buyIndex(asset, target, endDay) { // индекс/цена в деня или следващия наличен (до 5 дни)
  if (asset === 'BTC') return target <= B.d[B.d.length - 1] ? { day: target, p: btcAt(target) } : null;
  const k = lowerBound(M.d, target);
  if (k >= M.d.length || M.d[k] - target > 5 || M.d[k] > endDay) return null;
  return { day: M.d[k], p: M.p[k] };
}
function regime(day, f) {
  const i = clamp(day - B.d0, 0, B.p.length - 1);
  if (f === 'bear') return I.sma200[i] != null && B.p[i] < I.sma200[i];
  if (f === 'bull') return I.sma200[i] != null && B.p[i] >= I.sma200[i];
  return true;
}
function dca({ asset = 'BTC', amount = 100, cur = 'EUR', dom = 20, from, to, mult = () => 1 }) {
  const endDay = Math.min(to, lastDayOf(asset));
  const buys = []; let inv = 0, units = 0;
  const f = dDate(from); let y = f.getUTCFullYear(), m = f.getUTCMonth();
  for (let guard = 0; guard < 600; guard++) {
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const target = Math.floor(Date.UTC(y, m, dom === 'last' ? dim : Math.min(+dom, dim)) / DAY);
    if (target > endDay) break;
    if (target >= from) {
      const b = buyIndex(asset, target, endDay);
      if (b) {
        const k = mult(b.day);
        if (k > 0) {
          const amt = amount * k, fx = fxAt(b.day), usd = cur === 'EUR' ? amt * fx : amt, u = usd / b.p;
          inv += amt; units += u;
          buys.push({ day: b.day, pUsd: b.p, price: cur === 'EUR' ? b.p / fx : b.p, amt, units: u, k });
        }
      }
    }
    if (++m > 11) { m = 0; y++; }
  }
  const endP = endDay >= today() ? (asset === 'BTC' ? (Live.btcUsd ?? btcAt(endDay)) : (Live.mstr ?? mstrAt(endDay))) : priceAt(asset, endDay);
  const fxE = fxAt(endDay), valueUsd = units * endP, value = cur === 'EUR' ? valueUsd / fxE : valueUsd;
  return { buys, inv, units, avg: units ? inv / units : 0, value, pnl: value - inv, pnlPct: inv ? (value / inv - 1) * 100 : 0, endDay, endP: cur === 'EUR' ? endP / fxE : endP };
}
function dcaWeekly(asset, wd, from, to) { // wd: 0=пон..6=нед
  let usd = 0, units = 0; const endDay = Math.min(to, lastDayOf(asset));
  let d = from; while (((d + 3) % 7 + 7) % 7 !== wd) d++; // ден 0 (четв.) → wd 3
  for (; d <= endDay; d += 7) { const b = buyIndex(asset, d, endDay); if (b) { usd += 100; units += 100 / b.p; } }
  return units ? usd / units : null;
}

// ============================================================ calculators
function fillDays(sel, def = 20) {
  sel.innerHTML = Array.from({ length: 28 }, (_, k) => `<option value="${k + 1}" ${k + 1 === def ? 'selected' : ''}>${k + 1}-во число</option>`).join('') + '<option value="last">Последен ден</option>';
}
const statBox = (k, v, s = '', c = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${c}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

function calcDca() {
  const asset = $('#dAsset').value, cur = $('#dCur').value, filter = $('#dFilter').value, thr = isFinite(num($('#dThr').value)) ? num($('#dThr').value) : 30;
  $('#dThrWrap').hidden = !(filter === 'fear' || filter === 'score');
  const mult = filter === 'bear' ? d => regime(d, 'bear') ? 1 : 0
    : filter === 'fear' ? d => { const f = fngAt(d); return f != null && f <= thr ? 1 : 0; }
    : filter === 'score' ? d => scoreOnDay(d) <= thr ? 1 : 0 : () => 1;
  const r = dca({ asset, cur, amount: num($('#dAmt').value) || 0, dom: $('#dDom').value, from: isoToDay($('#dFrom').value), to: isoToDay($('#dTo').value), mult });
  const unit = asset === 'BTC' ? 'BTC' : 'акции';
  const sats = asset === 'BTC' && r.inv ? nf(r.units * 1e8 / r.inv, 0) : null;
  $('#dRes').innerHTML = [
    statBox('Общо вложено', money(r.inv, cur), `${r.buys.length} покупки`),
    statBox('Натрупано', asset === 'BTC' ? fmtBtc(r.units) + ' BTC' : nf(r.units, 3) + ' ' + unit, sats ? sats + ' сат. за 1 ' + (cur === 'EUR' ? '€' : '$') : ''),
    statBox('Средна цена', money(r.avg, cur), `Цена в края: ${money(r.endP, cur)}`),
    statBox('Стойност сега', money(r.value, cur), fmtDate(r.endDay)),
    statBox('Печалба / загуба', money(r.pnl, cur), '', r.pnl >= 0 ? 'up' : 'down'),
    statBox('Доходност', pct(r.pnlPct), '', r.pnl >= 0 ? 'up' : 'down'),
  ].join('');
  if (!r.buys.length) { mk('cDca', { type: 'line', data: { datasets: [] }, options: opts() }); mk('cDcaAvg', { type: 'line', data: { datasets: [] }, options: opts() }); $('#dTable').innerHTML = '<p class="muted">Няма покупки в този период.</p>'; return; }
  // времева линия: вложено vs стойност
  const inv = [], val = [], pr = [], av = []; let j = 0, ci = 0, cu = 0;
  const step = r.endDay - r.buys[0].day > 1500 ? 4 : 2;
  for (let d = r.buys[0].day; d <= r.endDay; d += step) {
    while (j < r.buys.length && r.buys[j].day <= d) { ci += r.buys[j].amt; cu += r.buys[j].units; j++; }
    const p = priceAt(asset, d), pc = cur === 'EUR' ? p / fxAt(d) : p;
    inv.push({ x: d, y: ci }); val.push({ x: d, y: cu * pc }); pr.push({ x: d, y: pc }); av.push({ x: d, y: ci / cu });
  }
  const o = opts({ legend: true, y: { type: 'linear' }, yFmt: v => fmtShort(v, cur), labelFmt: v => money(v, cur) });
  mk('cDca', { type: 'line', data: { datasets: [
    { label: 'Стойност', data: val, borderColor: '#f7931a', backgroundColor: 'rgba(247,147,26,.12)', fill: true, borderWidth: 2, pointRadius: 0 },
    { label: 'Вложено', data: inv, borderColor: '#9ca3af', borderWidth: 1.5, pointRadius: 0, stepped: true },
  ] }, options: o });
  const o2 = opts({ legend: true, yFmt: v => fmtShort(v, cur), labelFmt: v => money(v, cur) });
  mk('cDcaAvg', { type: 'line', data: { datasets: [
    { label: 'Цена', data: pr, borderColor: 'rgba(255,255,255,.6)', borderWidth: 1.2, pointRadius: 0 },
    { label: 'Твоята средна цена', data: av, borderColor: '#22c55e', borderWidth: 2, pointRadius: 0 },
  ] }, options: o2 });
  $('#dTable').innerHTML = `<table><tr><th>Дата</th><th>Цена</th><th>Сума</th><th>${unit}</th></tr>${r.buys.map(b => `<tr><td>${fmtDate(b.day)}</td><td>${money(b.price, cur)}</td><td>${money(b.amt, cur)}</td><td>${asset === 'BTC' ? fmtBtc(b.units) : nf(b.units, 4)}</td></tr>`).join('')}</table>`;
}

function calcBestDay() {
  const asset = $('#bAsset').value, from = isoToDay($('#bFrom').value), to = isoToDay($('#bTo').value), f = $('#bFilter').value;
  const mult = f === 'all' ? () => 1 : d => regime(d, f) ? 1 : 0;
  const res = Array.from({ length: 28 }, (_, k) => dca({ asset, cur: 'USD', dom: k + 1, from, to, mult }).avg).map((v, k) => ({ dom: k + 1, avg: v })).filter(x => x.avg > 0);
  if (!res.length) { $('#bBest').textContent = 'Няма данни за този период.'; return; }
  const mean = res.reduce((s, x) => s + x.avg, 0) / res.length;
  const sorted = [...res].sort((a, b) => a.avg - b.avg), best = sorted.slice(0, 3).map(x => x.dom), worst = sorted.slice(-3).map(x => x.dom);
  const b0 = sorted[0], w0 = sorted[sorted.length - 1];
  $('#bBest').innerHTML = `🏆 Най-изгоден ден: <b>${b0.dom}-о число</b> (средна цена ${money(b0.avg)}, ${pct((b0.avg / mean - 1) * 100)} спрямо средното). Най-неизгоден: <b>${w0.dom}-о</b> (${pct((w0.avg / mean - 1) * 100)}). Разликата между най-добрия и най-лошия ден е ${nf((w0.avg / b0.avg - 1) * 100, 1)}%. Малки разлики (под ~2%) обикновено са случайни. Сравни няколко периода, преди да решиш.`;
  const o = opts({ y: { type: 'linear' }, yFmt: v => pct(v, 1), labelFmt: (v, c) => `${pct(v, 2)} (средна ${money(res[c.dataIndex].avg)})` });
  o.scales.x = { type: 'category', grid: { display: false } };
  o.plugins.tooltip.callbacks.title = it => it.length ? it[0].label + '-о число' : '';
  o.plugins.decimation.enabled = false; o.parsing = true;
  mk('cBestDay', { type: 'bar', data: { labels: res.map(x => x.dom), datasets: [{ label: 'Спрямо средното', data: res.map(x => (x.avg / mean - 1) * 100),
    backgroundColor: res.map(x => best.includes(x.dom) ? '#22c55e' : worst.includes(x.dom) ? '#ef4444' : '#4b5563'), borderRadius: 4 }] }, options: o });
  const wd = WEEKDAYS.map((_, k) => dcaWeekly(asset, k, from, to)).map(v => v ?? NaN);
  const wmean = wd.filter(isFinite).reduce((s, v, _, a) => s + v / a.length, 0), wmin = Math.min(...wd.filter(isFinite));
  const o2 = opts({ y: { type: 'linear' }, yFmt: v => pct(v, 1), labelFmt: v => pct(v, 2) });
  o2.scales.x = { type: 'category', grid: { display: false } }; o2.plugins.decimation.enabled = false; o2.parsing = true;
  o2.plugins.tooltip.callbacks.title = it => it.length ? it[0].label : '';
  mk('cBestWd', { type: 'bar', data: { labels: WEEKDAYS, datasets: [{ label: 'Спрямо средното', data: wd.map(v => (v / wmean - 1) * 100), backgroundColor: wd.map(v => v === wmin ? '#22c55e' : '#4b5563'), borderRadius: 4 }] }, options: o2 });
}

function monthCloses(asset) { // [{y, m, close}] последна цена за месеца
  const out = []; const D = asset === 'MSTR' ? M.d : B.d, P = asset === 'MSTR' ? M.p : B.p;
  let key = null;
  for (let i = 0; i < D.length; i++) {
    const x = dDate(D[i]), k = x.getUTCFullYear() * 12 + x.getUTCMonth();
    if (k !== key) { out.push({ y: x.getUTCFullYear(), m: x.getUTCMonth(), close: P[i] }); key = k; } else out[out.length - 1].close = P[i];
  }
  if (asset === 'BTC' && Live.btcUsd) out[out.length - 1].close = Live.btcUsd;
  if (asset === 'MSTR' && Live.mstr && out[out.length - 1].y * 12 + out[out.length - 1].m === new Date().getUTCFullYear() * 12 + new Date().getUTCMonth()) out[out.length - 1].close = Live.mstr;
  return out;
}
const heatBg = v => v == null ? 'transparent' : v >= 0 ? `rgba(34,197,94,${clamp(0.12 + v / 60, 0.12, 0.85)})` : `rgba(239,68,68,${clamp(0.12 - v / 45, 0.12, 0.85)})`;
function calcMonths() {
  const asset = $('#mAsset button.on').dataset.a, mc = monthCloses(asset);
  const rows = new Map(); const yearly = new Map();
  for (let k = 1; k < mc.length; k++) {
    const r = (mc[k].close / mc[k - 1].close - 1) * 100;
    if (!rows.has(mc[k].y)) rows.set(mc[k].y, Array(12).fill(null));
    rows.get(mc[k].y)[mc[k].m] = r;
  }
  const startY = asset === 'BTC' ? 2011 : 2015;
  for (let k = 0; k < mc.length; k++) if (mc[k].m === 11 || k === mc.length - 1) {
    const prev = mc.findLast((x, j) => j < k && x.m === 11 && x.y === mc[k].y - 1);
    if (prev) yearly.set(mc[k].y, (mc[k].close / prev.close - 1) * 100);
  }
  const years = [...rows.keys()].filter(y => y >= startY).sort((a, b) => b - a);
  let h = `<table class="heat"><tr><th>Година</th>${MONTHS.map(m => `<th>${m}</th>`).join('')}<th>Година</th></tr>`;
  for (const y of years) {
    h += `<tr><td>${y}</td>${rows.get(y).map(v => `<td style="background:${heatBg(v)}">${v == null ? '' : nf(v, 0) + '%'}</td>`).join('')}<td style="background:${heatBg(yearly.get(y) != null ? yearly.get(y) / 4 : null)};font-weight:700">${yearly.has(y) ? nf(yearly.get(y), 0) + '%' : ''}</td></tr>`;
  }
  const col = m => years.map(y => rows.get(y)[m]).filter(v => v != null);
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length, med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  h += `<tr><td><b>Средно</b></td>${MONTHS.map((_, m) => { const a = col(m); const v = a.length ? avg(a) : null; return `<td style="background:${heatBg(v)}"><b>${v == null ? '' : nf(v, 1) + '%'}</b></td>`; }).join('')}<td></td></tr>`;
  h += `<tr><td><b>Медиана</b></td>${MONTHS.map((_, m) => { const v = med(col(m)); return `<td style="background:${heatBg(v)}">${v == null ? '' : nf(v, 1) + '%'}</td>`; }).join('')}<td></td></tr>`;
  h += `<tr><td><b>% плюсови</b></td>${MONTHS.map((_, m) => { const a = col(m); const v = a.length ? a.filter(x => x > 0).length / a.length * 100 : null; return `<td style="background:${v == null ? '' : heatBg((v - 50) / 2)}">${v == null ? '' : nf(v, 0) + '%'}</td>`; }).join('')}<td></td></tr></table>`;
  $('#mHeat').innerHTML = h;
  // по година в цикъла
  const hy = HALVINGS.map(x => dDate(x).getUTCFullYear());
  const types = ['Година на халвинга', '1 г. след халвинга', '2 г. след (обикн. мечи пазар)', '3 г. след (преди халвинга)'];
  let t = `<table><tr><th>Фаза</th>${hy.map(y => `<th>Цикъл ${y}</th>`).join('')}<th>Средно</th></tr>`;
  types.forEach((name, k) => {
    const vals = hy.map(y => yearly.get(y + k));
    const v2 = vals.filter(v => v != null && !(hy[hy.length - 1] + k === new Date().getUTCFullYear() && false));
    t += `<tr><td>${name}</td>${vals.map((v, j) => `<td class="${v == null ? '' : v >= 0 ? 'up' : 'down'}">${v == null ? '—' : pct(v, 0)}${hy[j] + k === new Date().getUTCFullYear() ? ' <span class="muted">(досега)</span>' : ''}</td>`).join('')}<td><b>${v2.length ? pct(avg(v2), 0) : '—'}</b></td></tr>`;
  });
  $('#mCycleYears').innerHTML = t + '</table>';
}

function calcStrat() {
  const cur = $('#sCur').value, amount = num($('#sAmt').value) || 0, dom = $('#sDom').value, from = isoToDay($('#sFrom').value), to = isoToDay($('#sTo').value);
  const fngMult = d => { const f = fngAt(d); if (f == null) return 1; return f < 25 ? 2 : f < 45 ? 1.5 : f < 55 ? 1 : f < 75 ? 0.5 : 0.25; };
  const scMult = d => { const s = scoreOnDay(d); return s < 20 ? 3 : s < 40 ? 2 : s < 60 ? 1 : s < 80 ? 0.5 : 0; };
  const strats = [
    ['Обикновен DCA', () => 1], ['Fear & Greed', fngMult], ['По сигнала', scMult], ['Само мечи пазар ×2', d => regime(d, 'bear') ? 2 : 0],
  ].map(([n, f]) => ({ n, r: dca({ asset: 'BTC', cur, amount, dom, from, to, mult: f }) }));
  // идеал: всичко на дъното
  const base = strats[0].r; let minP = Infinity, minD = from;
  for (let d = from; d <= Math.min(to, today()); d++) { const p = btcAt(d) / (cur === 'EUR' ? fxAt(d) : 1); if (p < minP) { minP = p; minD = d; } }
  const ideal = { inv: base.inv, units: base.inv / minP, avg: minP }; ideal.value = ideal.units * base.endP; ideal.pnlPct = (ideal.value / ideal.inv - 1) * 100;
  strats.push({ n: `Купи дъното (${fmtDate(minD)})`, r: ideal, ideal: true });
  const sym = cur === 'EUR' ? '€' : '$';
  const bestSats = Math.max(...strats.filter(s => !s.ideal && s.r.inv).map(s => s.r.units / s.r.inv));
  $('#sTable').innerHTML = `<table><tr><th>Стратегия</th><th>Вложено</th><th>BTC</th><th>Средна цена</th><th>Сат. за 1 ${sym}</th><th>Стойност</th><th>Доходност</th></tr>${strats.map(s => {
    const sp = s.r.inv ? s.r.units / s.r.inv : 0;
    return `<tr${s.ideal ? ' class="muted"' : ''}><td>${!s.ideal && sp === bestSats ? '🏆 ' : ''}${s.n}</td><td>${money(s.r.inv, cur)}</td><td>${fmtBtc(s.r.units)}</td><td>${money(s.r.avg, cur)}</td><td><b>${nf(sp * 1e8, 0)}</b></td><td>${money(s.r.value, cur)}</td><td class="${s.r.pnlPct >= 0 ? 'up' : 'down'}">${pct(s.r.pnlPct, 0)}</td></tr>`;
  }).join('')}</table>`;
  const o = opts({ y: { type: 'linear' }, yFmt: v => nf(v, 0), labelFmt: v => nf(v, 0) + ' сат.' });
  o.scales.x = { type: 'category', grid: { display: false } }; o.parsing = true; o.plugins.decimation.enabled = false;
  o.plugins.tooltip.callbacks.title = it => it.length ? it[0].label : '';
  const real = strats.filter(s => !s.ideal);
  mk('cStrat', { type: 'bar', data: { labels: real.map(s => s.n), datasets: [{ label: `Сатоши за 1 ${sym}`, data: real.map(s => s.r.inv ? s.r.units / s.r.inv * 1e8 : 0), backgroundColor: real.map(s => s.r.inv && s.r.units / s.r.inv === bestSats ? '#22c55e' : '#f7931a'), borderRadius: 4 }] }, options: o });
}

function calcCycles() {
  const rows = CY.cycles.map(c => `<tr>
    <td><span style="color:${CY.colors[c.year]}">●</span> ${c.year}${c.done ? '' : ' (сега)'}</td>
    <td>${fmtDate(c.h)}<br><span class="muted">${money(c.hp, 'USD')}</span></td>
    <td>${fmtDate(c.topD)}<br><span class="muted">ден ${c.topD - c.h}</span></td>
    <td>${money(c.top, 'USD', 0)}<br><span class="up">×${nf(c.top / c.hp, 1)}</span></td>
    <td>${fmtDate(c.botD)}${c.done ? '' : '*'}<br><span class="muted">ден ${c.botD - c.h}</span></td>
    <td>${money(c.bot, 'USD', 0)}<br><span class="down">${pct((c.bot / c.top - 1) * 100, 0)}</span></td>
    <td>${c.botD - c.topD}</td></tr>`).join('');
  $('#cyTable').innerHTML = `<table><tr><th>Цикъл</th><th>Халвинг</th><th>Връх (дата)</th><th>Връх</th><th>Дъно (дата)</th><th>Дъно / спад</th><th>Дни връх→дъно</th></tr>${rows}</table><p class="small muted">* текущият цикъл: най-ниската цена след върха досега.</p>`;
  const cur = CY.cur, now = Live.btcUsd ?? B.p[B.p.length - 1];
  const proj = CY.cycles.filter(c => c.done).map(c => {
    const dd = c.bot / c.top, days = c.botD - c.topD, pBot = cur.top * dd, dBot = cur.topD + days;
    return `<tr><td><span style="color:${CY.colors[c.year]}">●</span> Като ${c.year}</td><td class="down">${pct((dd - 1) * 100, 0)}</td><td>${money(pBot, 'USD', 0)}</td><td>${fmtDate(dBot)}</td><td>${dBot > today() ? 'след ' + nf(dBot - today()) + ' дни' : 'преди ' + nf(today() - dBot) + ' дни'}</td><td class="${pBot < now ? 'down' : 'up'}">${pct((pBot / now - 1) * 100, 0)}</td></tr>`;
  }).join('');
  $('#cyProj').innerHTML = `<table><tr><th>Сценарий</th><th>Спад от върха</th><th>Дъно (цена)</th><th>Дъно (дата)</th><th>Кога</th><th>Спрямо днес</th></tr>${proj}</table>`;
}

const calcs = { dca: calcDca, day: calcBestDay, months: calcMonths, strat: calcStrat, cycles: calcCycles };
let curCalc = LS.get('calc', 'dca');
function showCalc(c) {
  curCalc = c; LS.set('calc', c);
  $$('#calcNav button').forEach(b => b.classList.toggle('on', b.dataset.c === c));
  $$('.calc').forEach(el => el.hidden = el.id !== 'c-' + c);
  calcs[c]();
}

// ============================================================ portfolio
const portfolio = Object.assign({ BTC: { qty: 0, avg: 0, cur: 'EUR' }, MSTR: { qty: 0, avg: 0, cur: 'USD' }, hist: [] }, LS.get('portfolio', {}));
const savePortfolio = () => LS.set('portfolio', portfolio);
function livePrice(asset, cur) {
  const fx = Live.fx || fxAt(today());
  if (asset === 'BTC') return cur === 'EUR' ? (Live.btcEur ?? (Live.btcUsd ?? B.p[B.p.length - 1]) / fx) : (Live.btcUsd ?? B.p[B.p.length - 1]);
  const u = Live.mstr ?? M.p[M.p.length - 1]; return cur === 'EUR' ? u / fx : u;
}
function posForm(asset) {
  const p = portfolio[asset], el = $('#pos' + asset), unit = asset === 'BTC' ? 'BTC' : 'акции';
  const price = livePrice(asset, p.cur), value = p.qty * price, cost = p.qty * p.avg, pnl = value - cost, pp = cost ? (value / cost - 1) * 100 : 0;
  el.innerHTML = `
    <div class="row between"><div class="asset-head"><span class="badge" style="background:${asset === 'BTC' ? '#f7931a' : '#d9232e'}">${asset === 'BTC' ? '₿' : 'M'}</span>${asset === 'BTC' ? 'Bitcoin' : 'Strategy (MSTR)'}</div>
    <span class="chip ${pnl >= 0 ? 'up' : 'down'}">${p.qty ? pct(pp) : '—'}</span></div>
    <div class="mid">${p.qty ? money(value, p.cur) : '—'}</div>
    <div class="sub">${p.qty ? `${money(pnl, p.cur)} · ${asset === 'BTC' ? fmtBtc(p.qty) : nf(p.qty, 4)} ${unit} · средна ${money(p.avg, p.cur)}` : 'Въведи позицията си отдолу'}</div>
    ${asset === 'MSTR' && p.qty && Live.shares ? `<div class="small muted" style="margin-top:4px">≈ ${fmtBtc(p.qty * settings.holdings / Live.shares)} BTC експозиция през Strategy</div>` : ''}
    <h3>Редактирай позицията</h3>
    <div class="form" style="margin-bottom:8px">
      <div class="field"><label>Количество (${unit})</label><input data-f="qty" type="text" inputmode="decimal" autocomplete="off" placeholder="${asset === 'BTC' ? '0,01' : '10'}" value="${fmtIn(p.qty)}"></div>
      <div class="field"><label>Въвеждам</label><select data-f="mode"><option value="avg">Средна цена</option><option value="pct">% печалба (от Revolut)</option><option value="cost">Общо вложено</option></select></div>
      <div class="field"><label data-f="lbl">Средна цена</label><input data-f="val" type="text" inputmode="decimal" autocomplete="off" value="${p.avg ? fmtIn(+p.avg.toFixed(2)) : ''}"></div>
      <div class="field"><label>Валута</label><select data-f="cur"><option ${p.cur === 'EUR' ? 'selected' : ''}>EUR</option><option ${p.cur === 'USD' ? 'selected' : ''}>USD</option></select></div>
    </div>
    <div class="row"><button class="btn sm" data-f="save">Запази</button></div>
    <h3>Добави нова покупка</h3>
    <div class="form" style="margin-bottom:8px">
      <div class="field"><label>Купено количество</label><input data-f="bq" type="text" inputmode="decimal" autocomplete="off" placeholder="${asset === 'BTC' ? '0,01' : '1'}"></div>
      <div class="field"><label>Цена на покупка (${p.cur})</label><input data-f="bp" type="text" inputmode="decimal" autocomplete="off" placeholder="${nf(price, 2)}"></div>
    </div>
    <button class="btn sm ghost" data-f="buy">Добави към позицията</button>`;
  const f = n => $(`[data-f="${n}"]`, el);
  f('mode').onchange = () => {
    const m = f('mode').value, inp = f('val');
    f('lbl').textContent = m === 'avg' ? 'Средна цена' : m === 'pct' ? 'Печалба/загуба в %' : 'Общо вложено';
    inp.inputMode = m === 'pct' ? 'text' : 'decimal'; // за загуба трябва минус, а цифровата клавиатура на iPhone няма минус
    inp.placeholder = m === 'pct' ? 'напр. 12,5 или -8,3' : '';
    inp.value = '';
  };
  f('save').onclick = () => {
    const qs = f('qty').value.trim(), vs = f('val').value.trim();
    const qty = qs ? num(qs) : 0, v = num(vs), c = f('cur').value, m = f('mode').value, pr = livePrice(asset, c);
    if (!isFinite(qty) || qty < 0) return toast('Невалидно количество. Пример: 0,01');
    if (vs && !isFinite(v)) return toast('Невалидна стойност. Пример: 12,5');
    if (m === 'pct' && v <= -100) return toast('Загубата не може да е 100% или повече');
    let avg = p.avg;
    if (isFinite(v)) avg = m === 'avg' ? v : m === 'pct' ? pr / (1 + v / 100) : (qty ? v / qty : 0);
    if (c !== p.cur && !isFinite(v)) avg = c === 'EUR' ? p.avg / (Live.fx || fxAt(today())) : p.avg * (Live.fx || fxAt(today()));
    Object.assign(p, { qty, avg, cur: c }); savePortfolio(); renderPortfolio(); toast('Запазено ✓');
  };
  f('buy').onclick = () => {
    const q = num(f('bq').value), bs = f('bp').value.trim(), bp = bs ? num(bs) : price;
    if (!(q > 0)) return toast('Въведи количество. Пример: 0,01');
    if (!(bp > 0)) return toast('Невалидна цена');
    const nq = p.qty + q; p.avg = (p.qty * p.avg + q * bp) / nq; p.qty = nq; savePortfolio(); renderPortfolio(); toast('Покупката е добавена ✓');
  };
}
function portfolioTotals() {
  const fx = Live.fx || fxAt(today());
  const toUsd = (v, c) => c === 'EUR' ? v * fx : v;
  let usd = 0, cost = 0;
  for (const a of ['BTC', 'MSTR']) { const p = portfolio[a]; usd += toUsd(p.qty * livePrice(a, p.cur), p.cur); cost += toUsd(p.qty * p.avg, p.cur); }
  const btcUsd = Live.btcUsd ?? B.p[B.p.length - 1];
  return { usd, eur: usd / fx, cost, pnl: usd - cost, pp: cost ? (usd / cost - 1) * 100 : 0, inBtc: usd / btcUsd, fx };
}
function renderPortfolioTotals() {
  const t = portfolioTotals();
  $('#pTotal').textContent = money(t.eur, 'EUR', 0);
  $('#pTotal2').textContent = money(t.usd, 'USD', 0);
  const c = $('#pTotalPnl'); c.textContent = t.cost ? `${pct(t.pp)} · ${money(t.pnl / t.fx, 'EUR', 0)}` : '—'; c.className = 'chip ' + (t.pnl >= 0 ? 'up' : 'down');
  const b = portfolio.BTC, m = portfolio.MSTR, fx = t.fx;
  const bU = (b.cur === 'EUR' ? fx : 1) * b.qty * livePrice('BTC', b.cur), mU = (m.cur === 'EUR' ? fx : 1) * m.qty * livePrice('MSTR', m.cur);
  $('#pStats').innerHTML = [
    statBox('Общо в BTC', fmtBtc(t.inBtc) + ' BTC', 'Цялото портфолио, превърнато в BTC'),
    statBox('Bitcoin', fmtBtc(b.qty) + ' BTC', t.usd ? nf(bU / t.usd * 100, 0) + '% от портфолиото' : ''),
    statBox('MSTR', nf(m.qty, 2) + ' акции', t.usd ? nf(mU / t.usd * 100, 0) + '% от портфолиото' : ''),
    statBox('Общо вложено', money(t.cost / fx, 'EUR', 0), money(t.cost, 'USD', 0)),
  ].join('');
}
function snapshotPortfolio() {
  const t = portfolioTotals(); if (!t.usd) return;
  const d = today(), h = portfolio.hist, last = h[h.length - 1];
  const rec = { d, usd: Math.round(t.usd), btc: +t.inBtc.toFixed(8) };
  if (last && last.d === d) h[h.length - 1] = rec; else h.push(rec);
  if (h.length > 3000) h.splice(0, h.length - 3000);
  savePortfolio();
}
function renderPortfolio() {
  posForm('BTC'); posForm('MSTR'); renderPortfolioTotals(); snapshotPortfolio();
  const h = portfolio.hist;
  $('#pHistHint').textContent = h.length < 2 ? 'Графиката с историята на портфолиото се появява от втория ден: всеки ден, в който отвориш приложението, се записва една точка.' : '';
  $('#cPortHist').parentElement.hidden = h.length < 2;
  if (h.length < 2) return;
  const o = opts({ y: { type: 'linear' }, legend: true, yFmt: v => fmtShort(v, 'USD') });
  o.scales.y2 = { type: 'linear', position: 'left', grid: { display: false }, ticks: { callback: v => nf(v, 3) } };
  o.plugins.tooltip.callbacks.label = c => c.dataset.yAxisID === 'y2' ? ` ${fmtBtc(c.parsed.y)} BTC` : ` ${money(c.parsed.y, 'USD', 0)}`;
  mk('cPortHist', { type: 'line', data: { datasets: [
    { label: 'Стойност ($)', data: h.map(x => ({ x: x.d, y: x.usd })), borderColor: '#f7931a', borderWidth: 2, pointRadius: h.length < 30 ? 2 : 0 },
    { label: 'В BTC', data: h.map(x => ({ x: x.d, y: x.btc })), borderColor: '#22c55e', borderWidth: 1.5, pointRadius: h.length < 30 ? 2 : 0, yAxisID: 'y2' },
  ] }, options: o });
}

// ============================================================ news
async function loadNews() {
  try {
    const n = await getJSON('data/news.json');
    $('#newsUpd').textContent = 'обновено ' + new Date(n.updated).toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const safeUrl = u => /^https:\/\//.test(u || '') ? esc(u) : '';
    $('#newsList').innerHTML = n.items.map(x => `<a href="${safeUrl(x.link)}" target="_blank" rel="noopener">
      ${x.img ? `<img src="${safeUrl(x.img)}" alt="" loading="lazy">` : ''}
      <div class="body"><time>${new Date(x.date).toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><h4>${esc(x.title)}</h4><p>${esc(x.desc)}</p></div></a>`).join('');
  } catch { $('#newsList').innerHTML = '<p class="muted">Новините не могат да се заредят в момента.</p>'; }
}

// ============================================================ alerts
const alerts = LS.get('alerts', []);
const AL_NAMES = { btc_above: 'BTC над $', btc_below: 'BTC под $', mstr_above: 'MSTR над $', mstr_below: 'MSTR под $', fng_below: 'Fear & Greed под', score_below: 'Сигнал под', score_above: 'Сигнал над' };
function renderAlerts() {
  $('#alertList').innerHTML = alerts.map((a, k) => `<div class="alert-item ${a.fired ? 'fired' : ''}"><span>${a.fired ? '✅ ' : '🔔 '}${AL_NAMES[a.type]} ${nf(a.value, a.value < 1000 ? 2 : 0)}</span><span class="row">${a.fired ? `<button class="btn sm ghost" data-rearm="${k}">Активирай</button>` : ''}<button class="btn sm danger" data-del="${k}">✕</button></span></div>`).join('') || '<p class="small muted">Няма аларми.</p>';
}
function checkAlerts() {
  const v = {
    btc: Live.btcUsd, mstr: Live.mstr, fng: fngAt(today()) ?? FNGs.v[FNGs.v.length - 1], score: I.score ? I.score[I.score.length - 1] : null,
  };
  let changed = false;
  for (const a of alerts) {
    if (a.fired) continue;
    const [k, dir] = a.type.split('_'), x = v[k];
    if (x == null) continue;
    if ((dir === 'above' && x >= a.value) || (dir === 'below' && x <= a.value)) {
      a.fired = true; changed = true;
      const msg = `${AL_NAMES[a.type]} ${nf(a.value, 0)}: сега ${k === 'btc' || k === 'mstr' ? money(x, 'USD') : nf(x, 0)}`;
      toast('🔔 ' + msg, 6000); notify('More BTC', msg);
    }
  }
  if (changed) { LS.set('alerts', alerts); renderAlerts(); }
}
async function notify(title, body) {
  try {
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png' }); else new Notification(title, { body });
  } catch { }
}

// ============================================================ settings
function openSettings() {
  $('#setKey').value = settings.key; $('#setHold').value = settings.holdings; renderAlerts();
  $('#settings').showModal();
}
function wireSettings() {
  $('#openSettings').onclick = openSettings;
  document.addEventListener('click', e => { if (e.target.closest('[data-open-settings]')) { e.preventDefault(); openSettings(); } });
  $('#closeSettings').onclick = () => $('#settings').close();
  $('#saveKey').onclick = () => { settings.key = $('#setKey').value.trim(); saveSettings(); Live.mcap = Live.shares = null; Live.lastMstr = 0; $('#keyStatus').textContent = 'Проверка…'; connectFinnhub(); pollMstr(); };
  $('#saveHold').onclick = () => { settings.holdings = num($('#setHold').value) || settings.holdings; saveSettings(); dirty = true; toast('Запазено ✓'); };
  $('#addAlert').onclick = () => { const v = num($('#alVal').value); if (!isFinite(v)) return toast('Въведи стойност'); alerts.push({ type: $('#alType').value, value: v, fired: false }); LS.set('alerts', alerts); $('#alVal').value = ''; renderAlerts(); };
  $('#alertList').onclick = e => {
    const d = e.target.dataset.del, r = e.target.dataset.rearm;
    if (d != null) alerts.splice(+d, 1); else if (r != null) alerts[+r].fired = false; else return;
    LS.set('alerts', alerts); renderAlerts();
  };
  $('#notifPerm').onclick = async () => {
    if (!('Notification' in window)) return toast('На iPhone първо добави приложението към началния екран');
    const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Известията са разрешени ✓' : 'Известията не са разрешени');
  };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'more-btc', v: 1, settings: { ...settings, key: settings.key }, portfolio, alerts }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `more-btc-backup-${dayToIso(today())}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  $('#importFile').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text()); if (j.app !== 'more-btc') throw 0;
      if (j.settings) { Object.assign(settings, j.settings); saveSettings(); }
      if (j.portfolio) LS.set('portfolio', j.portfolio);
      if (j.alerts) LS.set('alerts', j.alerts);
      toast('Данните са възстановени ✓'); setTimeout(() => location.reload(), 800);
    } catch { toast('Невалиден файл'); }
  };
  $('#resetBtn').onclick = () => {
    if (!confirm('Да изтрия ли портфолиото, алармите и настройките от това устройство?')) return;
    ['settings', 'portfolio', 'alerts', 'fngCache', 'tab', 'calc'].forEach(LS.del); location.reload();
  };
}

// ============================================================ navigation & wiring
let curTab = LS.get('tab', 'market');
const rendered = {};
function showTab(t) {
  curTab = t; LS.set('tab', t);
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
  window.scrollTo(0, 0);
  if (t === 'charts') renderCharts();
  if (t === 'calc') showCalc(curCalc);
  if (t === 'portfolio') renderPortfolio();
  if (t === 'news' && !rendered.news) { rendered.news = true; loadNews(); }
}
function segWire(sel, fn) {
  $$(sel).forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); fn();
  }));
}
function wire() {
  $('#tabbar').onclick = e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };
  $$('#scaleToggle button').forEach(b => b.classList.toggle('on', b.dataset.scale === settings.scale));
  $('#scaleToggle').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    settings.scale = b.dataset.scale; saveSettings();
    $$('#scaleToggle button').forEach(x => x.classList.toggle('on', x === b));
    if (curTab === 'charts') renderCharts(); if (curTab === 'calc') showCalc(curCalc); if (curTab === 'portfolio') renderPortfolio();
  };
  segWire('.seg[data-range="price"]', chartPrice);
  segWire('.seg[data-range="mstr"]', chartMstr);
  segWire('.seg[data-range="rsi"]', chartRsi);
  segWire('#cycleMode', chartCycles);
  segWire('#mstrMode', chartMstr);
  segWire('#mAsset', calcMonths);
  $$('[data-ov]').forEach(x => x.onchange = chartPrice);
  $('#calcNav').onclick = e => { const b = e.target.closest('button'); if (b) showCalc(b.dataset.c); };

  fillDays($('#dDom')); fillDays($('#sDom'));
  const t = today(), y5 = dayToIso(t - 5 * 365), y8 = dayToIso(t - 8 * 365);
  $('#dFrom').value = y5; $('#dTo').value = dayToIso(t);
  $('#bFrom').value = y8; $('#bTo').value = dayToIso(t);
  $('#sFrom').value = y5; $('#sTo').value = dayToIso(t);
  for (const id of ['dAsset', 'dAmt', 'dCur', 'dDom', 'dFrom', 'dTo', 'dFilter', 'dThr']) $('#' + id).addEventListener('change', calcDca);
  $('#dAmt').addEventListener('input', calcDca);
  for (const id of ['bAsset', 'bFrom', 'bTo', 'bFilter']) $('#' + id).addEventListener('change', calcBestDay);
  for (const id of ['sAmt', 'sCur', 'sDom', 'sFrom', 'sTo']) $('#' + id).addEventListener('change', calcStrat);
  wireSettings();
}

// ============================================================ boot
async function boot() {
  wire();
  try { await loadData(); } catch (e) { $('#boot').textContent = 'Данните не можаха да се заредят. Провери интернет връзката и опитай пак.'; console.error(e); return; }
  computeIndicators();
  $('#boot').remove();
  connectCoinbase(); connectFinnhub(); pollBtc(); pollMstr(); pollHeight();
  renderMarket(); showTab(curTab);

  let lastFull = Date.now();
  setInterval(() => { // UI тик всяка секунда, само ако има промяна
    const live = Date.now() - Live.lastBtc < 15000;
    $('#liveDot').classList.toggle('on', live);
    $('#liveTxt').textContent = live ? 'наживо' : 'офлайн';
    if (!dirty) return; dirty = false;
    syncTodayIntoHistory();
    if (Date.now() - lastFull > 30000) { lastFull = Date.now(); computeIndicators(); }
    else { const i = B.p.length - 1; I.score[i] = scoreAt(i).score; }
    if (curTab === 'market') renderMarket();
    if (curTab === 'portfolio') { renderPortfolioTotals(); posFormLight(); }
    checkAlerts();
  }, 1000);
  setInterval(pollBtc, 5000);
  setInterval(pollMstr, 60000);
  setInterval(pollHeight, 300000);
  setInterval(snapshotPortfolio, 600000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!cbWs || cbWs.readyState > 1) connectCoinbase();
    if (settings.key && (!fhWs || fhWs.readyState > 1)) connectFinnhub();
    pollBtc(); pollMstr();
  });
}
// при живо обновяване в портфолиото обновяваме само заглавните редове, за да не губим въведеното във формите
function posFormLight() {
  for (const a of ['BTC', 'MSTR']) {
    const el = $('#pos' + a), p = portfolio[a]; if (!el || !p.qty) continue;
    const price = livePrice(a, p.cur), value = p.qty * price, cost = p.qty * p.avg, pnl = value - cost;
    $('.mid', el).textContent = money(value, p.cur);
    const chip = $('.chip', el); chip.textContent = pct(cost ? (value / cost - 1) * 100 : 0); chip.className = 'chip ' + (pnl >= 0 ? 'up' : 'down');
    $('.sub', el).textContent = `${money(pnl, p.cur)} · ${a === 'BTC' ? fmtBtc(p.qty) : nf(p.qty, 4)} ${a === 'BTC' ? 'BTC' : 'акции'} · средна ${money(p.avg, p.cur)}`;
  }
}

// Android / Chrome: собствен бутон за инсталиране (iPhone няма такова събитие, там е „Добави към началния екран“)
let installEvt = null;
const showInstall = on => { $('#installBtn').hidden = !on; $('#installBtn2').hidden = !on; };
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstall(true); });
window.addEventListener('appinstalled', () => { installEvt = null; showInstall(false); toast('Приложението е инсталирано ✓'); });
async function doInstall() {
  if (!installEvt) return toast('Меню ⋮ → „Инсталиране на приложението“', 4000);
  installEvt.prompt();
  await installEvt.userChoice.catch(() => { });
  installEvt = null; showInstall(false);
}
$('#installBtn').onclick = doInstall;
$('#installBtn2').onclick = doInstall;

$('#appVersion').textContent = `More BTC · версия ${APP_VERSION}`;
boot();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // нова версия на сайта → новият service worker поема страницата → презареждаме веднъж, за да се види веднага
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').catch(() => { });
  // iPhone връща приложението от фона без презареждане: тогава проверяваме ръчно за нова версия
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => { });
  });
}
