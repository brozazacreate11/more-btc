'use strict';
/* More BTC: всичко работи в браузъра. Личните данни са само в localStorage на устройството. */
const APP_VERSION = '8'; // същият номер като CACHE в sw.js

// ============================================================ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const DAY = 86400000;
const today = () => Math.floor(Date.now() / DAY);
const pad = n => String(n).padStart(2, '0');
const dDate = d => new Date(d * DAY);
const dSep = () => LANG === 'en' ? '/' : '.';
const fmtDate = d => { const x = dDate(d); return `${pad(x.getUTCDate())}${dSep()}${pad(x.getUTCMonth() + 1)}${dSep()}${x.getUTCFullYear()}`; };
const fmtMonY = d => { const x = dDate(d); return `${pad(x.getUTCMonth() + 1)}${dSep()}${x.getUTCFullYear()}`; };
const isoToDay = s => Math.floor(Date.parse(s + 'T00:00:00Z') / DAY);
const dayToIso = d => dDate(d).toISOString().slice(0, 10);
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

const nf = (n, dec = 0) => Number(n).toLocaleString(loc(), { minimumFractionDigits: dec, maximumFractionDigits: dec });
function money(n, cur = 'USD', dec) {
  if (n == null || !isFinite(n)) return '—';
  if (dec == null) dec = Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 1 ? 2 : 4;
  const s = nf(Math.abs(n), dec), neg = n < 0 ? '−' : '';
  if (cur === 'EUR') return LANG === 'en' ? `${neg}€${s}` : `${neg}${s} €`;
  return `${neg}$${s}`;
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
  else if (lc > -1) {
    // на английски „70,000“ е хиляди; иначе една запетая е десетичен знак (0,01)
    const thousands = s.indexOf(',') !== lc || (LANG === 'en' && /^-?[1-9]\d{0,2},\d{3}$/.test(s));
    s = thousands ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  return Number(s);
}
// стойност за показване в поле: с десетичния знак на езика и без излишни нули
const fmtIn = n => n ? (+n).toFixed(8).replace(/\.?0+$/, '').replace('.', LANG === 'en' ? '.' : ',') : '';
const fmtShort = (v, cur = 'USD') => {
  const a = Math.abs(v); let s;
  if (a >= 1e12) s = nf(v / 1e12, 2) + tr('u.T'); else if (a >= 1e9) s = nf(v / 1e9, 1) + tr('u.B');
  else if (a >= 1e6) s = nf(v / 1e6, 1) + tr('u.M'); else if (a >= 1e4) s = nf(v / 1e3, 0) + 'k';
  else if (a >= 1) s = nf(v, a >= 100 ? 0 : 2); else s = nf(v, 3);
  return cur === 'EUR' ? (LANG === 'en' ? '€' + s : s + ' €') : cur === 'USD' ? '$' + s : s;
};
const cls = (el, n) => { el.classList.remove('up', 'down'); if (n != null && isFinite(n)) el.classList.add(n >= 0 ? 'up' : 'down'); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); // за текст, въведен от потребителя

const LS = {
  get(k, d) { try { const v = localStorage.getItem('morebtc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('morebtc.' + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem('morebtc.' + k); } catch { } },
};
const settings = Object.assign({ key: '', holdMSTR: null, holdASST: null, scale: 'log', lang: LANG }, LS.get('settings', {}));
// старо поле „holdings“ (MSTR, по подразбиране 848000): различно число значи, че е въведено ръчно
if ('holdings' in settings) { if (settings.holdings && settings.holdings !== 848000) settings.holdMSTR = settings.holdings; delete settings.holdings; }
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
const A = { d: [], p: [] };          // ASST (Strive) USD, търговски дни — само за портфолиото
const G = { d: [], p: [] };          // злато, USD за тройунция, търговски дни
const OZ = 31.1034768;               // грама в една тройунция
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
  try { const a = await getJSON('data/asst.json'); A.d = a.d.map(x => x[0]); A.p = a.d.map(x => x[1]); } catch { }
  try { const g = await getJSON('data/gold.json'); G.d = g.d.map(x => x[0]); G.p = g.d.map(x => x[1]); } catch { }
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
const rbNames = () => tr('rb.names');
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
  const ph = (k, n) => [tr('ph.' + k), tr('ph.' + k + '.d', { n })];
  if (t < 180) return ph('early');
  if (t < topT - 75) return ph('bull', topT);
  if (t < topT + 75) return ph('top');
  if (t < botT - 120) return ph('bear', botT);
  if (t < botT + 120) return ph('bot');
  return ph('pre');
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
  I.score = B.p.map((_, i) => scoreAt(i, false).score);
}
const lerpLog = (m, a, b) => (Math.log(m) - Math.log(a)) / (Math.log(b) - Math.log(a)) * 100;
// txt = false: само числото (за цялата история, по-бързо), без текстовете за екрана
function scoreAt(i, txt = true) {
  const p = B.p[i], d = B.d[i], c = [];
  const r = Math.log10(p) - RB.fit(d);
  c.push({ n: 'Rainbow', v: clamp((r - RB.mn) / (RB.mx - RB.mn) * 100), t: txt ? rbNames()[rbBand(d, p)] : '' });
  if (I.sma200[i]) { const m = p / I.sma200[i]; c.push({ n: 'Mayer Multiple', v: clamp(lerpLog(m, 0.6, 2.4)), t: txt ? nf(m, 2) : '' }); }
  if (I.wma200[i]) { const m = p / I.wma200[i]; c.push({ n: txt ? tr('c.w200') : '', v: clamp(lerpLog(m, 1, 4.5)), t: txt ? '×' + nf(m, 2) : '' }); }
  if (I.rsiW[i] != null) c.push({ n: txt ? tr('c.rsiw') : '', v: clamp((I.rsiW[i] - 30) / 60 * 100), t: txt ? nf(I.rsiW[i], 0) : '' });
  const f = fngAt(d); if (f != null) c.push({ n: 'Fear & Greed', v: f, t: String(f) });
  const h = halvingBefore(d); if (h != null) c.push({ n: txt ? tr('c.cycle') : '', v: clamp(cycleScore(d - h)), t: txt ? tr('nDays', { n: d - h }) : '' });
  if (I.pi[i]) c.push({ n: 'Pi Cycle Top', v: clamp((I.pi[i] - 0.35) / 0.65 * 100), t: txt ? nf(I.pi[i] * 100, 0) + '%' : '' });
  return { score: c.reduce((s, x) => s + x.v, 0) / c.length, comps: c };
}
const scoreOnDay = d => I.score[clamp(d - B.d0, 0, I.score.length - 1)];
const scoreLabel = s => tr('sc.' + (s < 20 ? 0 : s < 40 ? 1 : s < 60 ? 2 : s < 80 ? 3 : 4));
const scoreColor = s => `hsl(${Math.round(220 - clamp(s) * 2.2)}, 85%, 55%)`;

// ============================================================ live prices
const Live = { btcUsd: null, btcEur: null, openUsd: null, openEur: null, fx: null, mstr: null, mstrPc: null, asst: null, asstPc: null, gold: null, goldOpen: null, mcap: null, shares: null, sharesASST: null, lastBtc: 0, lastMstr: 0, lastAsst: 0, lastGold: 0, height: null };
// злато в USD за тройунция: наживо от Coinbase (PAXG, токен = 1 унция злато), иначе последното дневно затваряне
const goldNow = () => Live.gold ?? G.p[G.p.length - 1] ?? null;

// Биткойн резерви на компаниите: ръчно число от настройките, иначе CoinGecko (кеш 6 ч.), иначе последното известно
const TREASURY_DEFAULT = { MSTR: 848517, ASST: 43000 };
let treasury = LS.get('treasury', { t: 0 });
const holdingsOf = s => settings['hold' + s] || treasury[s] || TREASURY_DEFAULT[s];
async function loadTreasury() {
  if (Date.now() - treasury.t < 6 * 3600e3) return;
  try {
    const j = await getJSON('https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin');
    const find = sym => (j.companies.find(c => c.symbol === sym + '.US') || {}).total_holdings || null;
    treasury = { t: Date.now(), MSTR: find('MSTR') || treasury.MSTR, ASST: find('ASST') || treasury.ASST };
    LS.set('treasury', treasury); dirty = true;
  } catch { }
}
let dirty = true, cbWs = null, fhWs = null;

function connectCoinbase() {
  try { cbWs && cbWs.close(); } catch { }
  const ws = cbWs = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD', 'BTC-EUR', 'PAXG-USD'], channels: ['ticker'] }));
  ws.onmessage = e => {
    const m = JSON.parse(e.data); if (m.type !== 'ticker') return;
    if (m.product_id === 'PAXG-USD') { Live.gold = +m.price; Live.goldOpen = +m.open_24h; Live.lastGold = Date.now(); dirty = true; return; }
    if (m.product_id === 'BTC-USD') { Live.btcUsd = +m.price; Live.openUsd = +m.open_24h; } else { Live.btcEur = +m.price; Live.openEur = +m.open_24h; }
    if (Live.btcUsd && Live.btcEur) Live.fx = Live.btcUsd / Live.btcEur;
    Live.lastBtc = Date.now(); dirty = true;
  };
  ws.onclose = () => { if (cbWs === ws) setTimeout(() => document.visibilityState === 'visible' && connectCoinbase(), 3000); };
  ws.onerror = () => ws.close();
}
async function pollBtc() { // резервен вариант, ако WebSocket мълчи
  if (Date.now() - Live.lastGold > 120000) { // златото се търгува рядко: проверка на всеки 2 мин. без сделка
    try { const g = await getJSON('https://api.coinbase.com/v2/prices/PAXG-USD/spot'); Live.gold = +g.data.amount; Live.lastGold = Date.now(); dirty = true; } catch { }
  }
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
  ws.onopen = () => { for (const symbol of ['MSTR', 'ASST']) ws.send(JSON.stringify({ type: 'subscribe', symbol })); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type !== 'trade' || !m.data) return;
    for (const x of m.data) { // сделките идват по ред; последната за всеки символ е текущата цена
      if (x.s === 'MSTR') { Live.mstr = x.p; Live.lastMstr = Date.now(); dirty = true; }
      else if (x.s === 'ASST') { Live.asst = x.p; Live.lastAsst = Date.now(); dirty = true; }
    }
  };
  ws.onclose = () => { if (fhWs === ws) setTimeout(() => document.visibilityState === 'visible' && connectFinnhub(), 5000); };
  ws.onerror = () => ws.close();
}
async function pollMstr() { // MSTR и ASST
  if (!settings.key) { // без ключ: последна дневна цена от файла
    Live.mstr = M.p[M.p.length - 1]; Live.mstrPc = M.p[M.p.length - 2];
    if (A.p.length) { Live.asst = A.p[A.p.length - 1]; Live.asstPc = A.p[A.p.length - 2]; }
    dirty = true; return;
  }
  try {
    const q = await getJSON(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${encodeURIComponent(settings.key)}`);
    if (q.c) { if (Date.now() - Live.lastMstr > 30000) Live.mstr = q.c; Live.mstrPc = q.pc; dirty = true; }
    const qa = await getJSON(`https://finnhub.io/api/v1/quote?symbol=ASST&token=${encodeURIComponent(settings.key)}`);
    if (qa.c) { if (Date.now() - Live.lastAsst > 30000) Live.asst = qa.c; Live.asstPc = qa.pc; dirty = true; }
    if (!Live.mcap) {
      const pr = await getJSON(`https://finnhub.io/api/v1/stock/profile2?symbol=MSTR&token=${encodeURIComponent(settings.key)}`);
      Live.shares = pr.shareOutstanding ? pr.shareOutstanding * 1e6 : null; Live.mcap = pr.marketCapitalization ? pr.marketCapitalization * 1e6 : null;
    }
    if (!Live.sharesASST) { // брой акции на Strive за mNAV и BTC на акция
      const pa = await getJSON(`https://finnhub.io/api/v1/stock/profile2?symbol=ASST&token=${encodeURIComponent(settings.key)}`);
      Live.sharesASST = pa.shareOutstanding ? pa.shareOutstanding * 1e6 : null;
    }
    $('#keyStatus').textContent = tr('key.ok');
  } catch { $('#keyStatus').textContent = tr('key.bad'); }
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
  const c = $('#btcChg'); c.textContent = pct(ch) + ' ' + tr('h24'); c.className = 'chip ' + (ch >= 0 ? 'up' : 'down');
  let ath = 0, athD = 0; for (let k = 0; k < B.p.length; k++) if (B.p[k] > ath) { ath = B.p[k]; athD = B.d[k]; }
  $('#athTxt').textContent = `${money(ath, 'USD', 0)} (${fmtDate(athD)})`;
  const dd = $('#ddTxt'); dd.textContent = pct((usd / ath - 1) * 100, 1); cls(dd, usd / ath - 1);

  // MSTR
  const mp = Live.mstr ?? M.p[M.p.length - 1], mpc = Live.mstrPc ?? M.p[M.p.length - 2];
  $('#mstrUsd').textContent = money(mp, 'USD', 2);
  $('#mstrEur').textContent = money(mp / (Live.fx || fxAt(t)), 'EUR', 2);
  const mch = (mp / mpc - 1) * 100, mc = $('#mstrChg'); mc.textContent = pct(mch) + ' ' + tr('today'); mc.className = 'chip ' + (mch >= 0 ? 'up' : 'down');
  // mNAV = пазарна капитализация / стойност на биткойните; BTC на акция в сатоши
  const treasuryStats = (price, shares, hold, ids) => {
    $(ids[0]).textContent = shares ? nf(shares * price / (hold * usd), 2) : '—';
    $(ids[1]).textContent = shares ? tr('satsN', { n: nf(hold / shares * 1e8, 0) }) : '—';
    $(ids[2]).textContent = tr('treasury', { n: nf(hold) });
  };
  treasuryStats(mp, Live.shares, holdingsOf('MSTR'), ['#mnavTxt', '#bpsTxt', '#holdM']);
  $('#mstrNote').innerHTML = settings.key ? tr(Date.now() - Live.lastMstr < 120000 ? 'mstr.live' : 'mstr.closed') : tr('mstr.nokey');

  // ASST (Strive)
  const ap = Live.asst ?? A.p[A.p.length - 1], apc = Live.asstPc ?? A.p[A.p.length - 2];
  if (ap) {
    $('#asstUsd').textContent = money(ap, 'USD', 2);
    $('#asstEur').textContent = money(ap / (Live.fx || fxAt(t)), 'EUR', 2);
    const ach = (ap / apc - 1) * 100, ac = $('#asstChg'); ac.textContent = pct(ach) + ' ' + tr('today'); ac.className = 'chip ' + (ach >= 0 ? 'up' : 'down');
    treasuryStats(ap, Live.sharesASST, holdingsOf('ASST'), ['#mnavA', '#bpsA', '#holdA']);
  }

  // Злато
  const g = goldNow();
  if (g) {
    const gPrev = Live.goldOpen || (G.d[G.d.length - 1] >= t ? G.p[G.p.length - 2] : G.p[G.p.length - 1]);
    $('#goldUsd').textContent = money(g, 'USD', 0);
    $('#goldEurG').textContent = tr('gold.perG', { p: money(g / OZ / (Live.fx || fxAt(t)), 'EUR', 2) });
    const gch = (g / gPrev - 1) * 100, gc = $('#goldChg'); gc.textContent = pct(gch) + ' ' + tr('h24'); gc.className = 'chip ' + (gch >= 0 ? 'up' : 'down');
    $('#goldBtc').textContent = tr('gold.btcIn', { n: nf(usd / g, 1) });
  }

  // Сигнал
  const sc = scoreAt(i);
  $('#scoreNum').textContent = Math.round(sc.score);
  $('#scoreNum').style.color = scoreColor(sc.score);
  $('#scoreLabel').textContent = scoreLabel(sc.score);
  $('#scoreMarker').style.left = clamp(sc.score) + '%';
  $('#scoreComp').innerHTML = sc.comps.map(x => `<span>${x.n}</span><span class="muted mono">${x.t}</span><div class="bar"><i style="width:${Math.max(4, x.v)}%;background:${scoreColor(x.v)}"></i></div>`).join('');

  // Цикъл
  const cur = CY.cur, tH = t - cur.h, [ph, phTxt] = phaseOf(tH);
  $('#phaseTxt').textContent = ph;
  $('#cycleHint').textContent = phTxt;
  $('#daysSinceH').textContent = nf(tH);
  $('#lastHTxt').textContent = tr('halvingOn', { d: fmtDate(cur.h) });
  const nextH = 1050000, left = Live.height ? nextH - Live.height : null;
  const estNext = left != null ? t + Math.round(left * 10 / 1440) : cur.h + CY.len;
  $('#nextHTxt').textContent = fmtMonY(estNext);
  $('#blocksLeft').textContent = left != null ? tr('daysBlocks', { d: nf(estNext - t), b: nf(left) }) : tr('daysApprox', { d: nf(estNext - t) });
  $('#cTop').textContent = money(cur.top, 'USD', 0);
  $('#cTopS').textContent = `${fmtDate(cur.topD)} · ${tr('dayN', { n: cur.topD - cur.h })}`;
  $('#cBot').textContent = money(cur.bot, 'USD', 0);
  $('#cBotS').textContent = `${pct((cur.bot / cur.top - 1) * 100, 0)} · ${fmtDate(cur.botD)} (${tr('soFar')})`;
  const len = estNext - cur.h, P = x => clamp(x / len * 100, 0, 100);
  $('#cycleBar').innerHTML = `<div class="fill" style="width:100%"></div>
    <div class="tick" style="left:${P(CY.topT)}%">${tr('tick.top', { n: CY.topT })}</div>
    <div class="tick" style="left:${P(CY.botT)}%">${tr('tick.bot', { n: CY.botT })}</div>
    <div class="now" style="left:${P(tH)}%"><span>${tr('today')}</span></div>`;

  // Индикатори
  const f = fngAt(t) ?? FNGs.v[FNGs.v.length - 1];
  const fTxt = f == null ? '—' : tr('fg.' + (f < 25 ? 0 : f < 45 ? 1 : f < 56 ? 2 : f < 76 ? 3 : 4));
  const box = (k, v, s, col) => `<div class="stat"><div class="k">${k}</div><div class="v" ${col ? `style="color:${col}"` : ''}>${v}</div><div class="s">${s}</div></div>`;
  const rd = I.rsiD[i], rw = I.rsiW[i], may = usd / I.sma200[i], w2 = I.wma200[i], pi = I.pi[i];
  const rsiS = r => r == null ? '' : tr(r >= 70 ? 'rsi.ob' : r <= 30 ? 'rsi.os' : 'rsi.n');
  const band = rbBand(t, usd);
  $('#indStats').innerHTML = [
    box('Fear & Greed', f ?? '—', fTxt, f != null ? scoreColor(f) : null),
    box(tr('i.rsiD'), rd != null ? nf(rd, 0) : '—', rsiS(rd), rd != null ? scoreColor(clamp((rd - 30) / 40 * 100)) : null),
    box(tr('i.rsiW'), rw != null ? nf(rw, 0) : '—', rsiS(rw), rw != null ? scoreColor(clamp((rw - 30) / 60 * 100)) : null),
    box('Mayer Multiple', nf(may, 2), tr(may < 0.8 ? 'may.low' : may > 2.4 ? 'may.high' : 'may.mid'), scoreColor(clamp(lerpLog(may, 0.6, 2.4)))),
    box('200W MA', money(w2, 'USD', 0), tr('w200.s', { p: pct((usd / w2 - 1) * 100, 0) })),
    box('200D MA', money(I.sma200[i], 'USD', 0), tr(usd > I.sma200[i] ? 'd200.above' : 'd200.below')),
    box('Pi Cycle Top', nf(pi * 100, 0) + '%', tr('pi.s'), scoreColor(clamp((pi - 0.35) / 0.65 * 100))),
    box(tr('rb.zone'), rbNames()[band], tr('rb.s'), RB_COLORS[band]),
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
  $('#lgPrice').innerHTML = (ov.signal ? `<span><i style="background:linear-gradient(90deg,${scoreColor(0)},${scoreColor(50)},${scoreColor(100)})"></i>${tr('lg.signal')}</span>` : `<span><i style="background:#f7931a"></i>${tr('lg.price')}</span>`)
    + (ov.wma200 ? `<span><i style="background:#e5e7eb"></i>${tr('lg.w200')}</span>` : '')
    + (ov.sma200 ? `<span><i style="background:#a855f7"></i>${tr('lg.d200')}</span>` : '')
    + (ov.halvings ? `<span><i style="background:rgba(247,147,26,.7)"></i>${tr('lg.halving')}</span>` : '');
}

function chartCycles() {
  const mode = $('#cycleMode button.on').dataset.m;
  $('#cycleModeHint').textContent = tr(`cm.${mode}.h`);
  const ds = [], lg = [];
  const names = { 2012: '2012–2016', 2016: '2016–2020', 2020: '2020–2024', 2024: `2024–${tr('nowParen')}` };
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
  o.scales.x.ticks.callback = v => v + tr('dShort');
  o.scales.x.title = { display: true, text: tr('ax.' + mode) };
  o.plugins.tooltip.callbacks.title = it => it.length ? tr('dayCap', { n: it[0].parsed.x }) : '';
  o.interaction = { mode: 'index', intersect: false, axis: 'x' };
  o.plugins.decimation.enabled = false;
  const cur = CY.cur, tNow = mode === 'halving' ? today() - cur.h : mode === 'bottom' ? today() - cur.pb : today() - cur.topD;
  o.plugins.lines = { v: [{ x: tNow, t: tr('today'), c: '#22c55e' }] };
  mk('cCycles', { type: 'line', data: { datasets: ds }, options: o });
  $('#lgCycles').innerHTML = lg.reverse().join('');
}

function chartRainbow() {
  const from = isoToDay('2010-09-01'), to = today() + 365 * 3, ds = [];
  for (let k = 0; k <= 9; k++) {
    const data = [];
    for (let d = from; d <= to; d += 7) data.push({ x: d, y: 10 ** (RB.fit(d) + RB.edges[k]) });
    ds.push({ label: k ? rbNames()[k - 1] : tr('rb.floor'), data, borderWidth: 0, pointRadius: 0, fill: k ? '-1' : false, backgroundColor: k ? RB_COLORS[k - 1] + 'b0' : 'transparent' });
  }
  ds.push({ label: 'BTC', data: xy(B.d, B.p, from), borderColor: '#fff', borderWidth: 1.5, pointRadius: 0 });
  const o = opts();
  o.plugins.tooltip.filter = c => c.dataset.label === 'BTC';
  o.plugins.lines = { v: [{ x: today(), t: tr('today'), c: '#fff' }] };
  mk('cRainbow', { type: 'line', data: { datasets: ds }, options: o });
  const b = rbBand(today(), B.p[B.p.length - 1]);
  $('#rbNow').textContent = rbNames()[b]; $('#rbNow').style.color = RB_COLORS[b];
  $('#lgRainbow').innerHTML = rbNames().map((n, k) => `<span><i class="sq" style="background:${RB_COLORS[k]}"></i>${n}</span>`).reverse().join('');
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
    hint = tr('mh.norm', { d: fmtDate(dd[0]), a: pct(r1, 0), b: pct(r2, 0) });
    o = opts({ legend: true, yFmt: v => nf(v, 0), labelFmt: v => nf(v, 1) });
  } else if (mode === 'mstrbtc') {
    ds = [{ label: tr('ml.mstrsats'), data: dd.map((d, k) => ({ x: d, y: mp[k] / bp[k] * 1e8 })), borderColor: '#ef4444', borderWidth: 1.6, pointRadius: 0, fill: true, backgroundColor: 'rgba(239,68,68,.08)' }];
    hint = tr('mh.mstrbtc');
    o = opts({ yFmt: v => fmtShort(v, '') + ' sat' });
  } else {
    ds = [{ label: tr('ml.btcmstr'), data: dd.map((d, k) => ({ x: d, y: bp[k] / mp[k] })), borderColor: '#f7931a', borderWidth: 1.6, pointRadius: 0, fill: true, backgroundColor: 'rgba(247,147,26,.08)' }];
    hint = tr('mh.btcmstr');
    o = opts({ yFmt: v => nf(v, v < 10 ? 2 : 0) });
  }
  $('#mstrHint').textContent = hint;
  mk('cMstr', { type: 'line', data: { datasets: ds }, options: o });
}

function chartGold() {
  const mode = $('#goldMode button.on').dataset.m, from = rangeFrom(getRange('gold'));
  const dd = G.d.slice(), gp = G.p.slice();
  if (Live.gold && dd.length && dd[dd.length - 1] < today()) { dd.push(today()); gp.push(Live.gold); } // днешната цена наживо
  else if (Live.gold && dd.length) gp[gp.length - 1] = Live.gold;
  const start = Math.max(from === -Infinity ? 0 : from, mode === 'btc' ? B.d0 : 0);
  const i0 = lowerBound(dd, start), xs = dd.slice(i0), ys = gp.slice(i0);
  let data, label, yFmt, labelFmt;
  if (mode === 'eurg') {
    data = xs.map((d, k) => ({ x: d, y: ys[k] / OZ / fxAt(d) })); label = tr('gl.eurg');
    yFmt = v => fmtShort(v, 'EUR'); labelFmt = v => money(v, 'EUR', 2);
  } else if (mode === 'btc') {
    data = xs.map((d, k) => ({ x: d, y: btcAt(d) / ys[k] })); label = tr('gl.btcoz');
    yFmt = v => nf(v, v < 10 ? 2 : 0); labelFmt = v => tr('ozN', { n: nf(v, 2) });
  } else {
    data = xs.map((d, k) => ({ x: d, y: ys[k] })); label = tr('gl.usdoz');
    yFmt = v => fmtShort(v, 'USD'); labelFmt = v => money(v, 'USD', 0);
  }
  $('#goldHint').textContent = tr('gold.h.' + mode);
  const o = opts({ yFmt, labelFmt });
  if (mode === 'btc') o.plugins.lines = { v: halvingLines() };
  mk('cGold', { type: 'line', data: { datasets: [{ label, data, borderColor: '#d4af37', borderWidth: 1.6, pointRadius: 0, fill: true, backgroundColor: 'rgba(212,175,55,.08)' }] }, options: o });
}

function chartRsi() {
  const from = rangeFrom(getRange('rsi'));
  const o = opts({ y: { type: 'linear', min: 0, max: 100 }, yFmt: v => nf(v, 0), legend: true });
  o.plugins.lines = { h: [{ y: 70, t: tr('rsi.70'), c: '#ef4444' }, { y: 30, t: tr('rsi.30'), c: '#3b82f6' }] };
  mk('cRsi', { type: 'line', data: { datasets: [
    { label: tr('rsi.daily'), data: xy(B.d, I.rsiD, from), borderColor: 'rgba(247,147,26,.55)', borderWidth: 1, pointRadius: 0 },
    { label: tr('c.rsiw'), data: xy(B.d, I.rsiW, from), borderColor: '#a855f7', borderWidth: 2, pointRadius: 0 },
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
  o2.plugins.lines = { h: [{ y: 80, t: tr('l.sell'), c: '#ef4444' }, { y: 20, t: tr('l.acc'), c: '#3b82f6' }] };
  mk('cScore', { type: 'line', data: { datasets: [{ label: tr('signal'), data: xy(B.d, I.score, from, 3), borderWidth: 1.5, pointRadius: 0, segment: { borderColor: c => scoreColor(c.p1.parsed.y) } }] }, options: o2 });
}
function renderCharts() { chartPrice(); chartCycles(); chartRainbow(); chartMstr(); chartGold(); chartRsi(); chartFng(); chartScore(); }

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
function fillDays(sel) { // пази избрания ден при смяна на езика
  const v = sel.value || '20';
  sel.innerHTML = Array.from({ length: 28 }, (_, k) => `<option value="${k + 1}">${tr('dom.opt', { d: ordDay(k + 1) })}</option>`).join('') + `<option value="last">${tr('lastDay')}</option>`;
  sel.value = v;
}
const statBox = (k, v, s = '', c = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${c}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

function calcDca() {
  const asset = $('#dAsset').value, cur = $('#dCur').value, filter = $('#dFilter').value, thr = isFinite(num($('#dThr').value)) ? num($('#dThr').value) : 30;
  $('#dThrWrap').hidden = !(filter === 'fear' || filter === 'score');
  const mult = filter === 'bear' ? d => regime(d, 'bear') ? 1 : 0
    : filter === 'fear' ? d => { const f = fngAt(d); return f != null && f <= thr ? 1 : 0; }
    : filter === 'score' ? d => scoreOnDay(d) <= thr ? 1 : 0 : () => 1;
  const r = dca({ asset, cur, amount: num($('#dAmt').value) || 0, dom: $('#dDom').value, from: isoToDay($('#dFrom').value), to: isoToDay($('#dTo').value), mult });
  const unit = asset === 'BTC' ? 'BTC' : tr('unit.shares');
  const sats = asset === 'BTC' && r.inv ? nf(r.units * 1e8 / r.inv, 0) : null;
  $('#dRes').innerHTML = [
    statBox(tr('st.invested'), money(r.inv, cur), tr('nBuys', { n: r.buys.length })),
    statBox(tr('st.accum'), asset === 'BTC' ? fmtBtc(r.units) + ' BTC' : nf(r.units, 3) + ' ' + unit, sats ? tr('satsPer', { n: sats, c: cur === 'EUR' ? '€' : '$' }) : ''),
    statBox(tr('st.avg'), money(r.avg, cur), tr('priceAtEnd', { p: money(r.endP, cur) })),
    statBox(tr('st.valueNow'), money(r.value, cur), fmtDate(r.endDay)),
    statBox(tr('st.pnl'), money(r.pnl, cur), '', r.pnl >= 0 ? 'up' : 'down'),
    statBox(tr('st.ret'), pct(r.pnlPct), '', r.pnl >= 0 ? 'up' : 'down'),
  ].join('');
  if (!r.buys.length) { mk('cDca', { type: 'line', data: { datasets: [] }, options: opts() }); mk('cDcaAvg', { type: 'line', data: { datasets: [] }, options: opts() }); $('#dTable').innerHTML = `<p class="muted">${tr('noBuys')}</p>`; return; }
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
    { label: tr('l.value'), data: val, borderColor: '#f7931a', backgroundColor: 'rgba(247,147,26,.12)', fill: true, borderWidth: 2, pointRadius: 0 },
    { label: tr('l.invested'), data: inv, borderColor: '#9ca3af', borderWidth: 1.5, pointRadius: 0, stepped: true },
  ] }, options: o });
  const o2 = opts({ legend: true, yFmt: v => fmtShort(v, cur), labelFmt: v => money(v, cur) });
  mk('cDcaAvg', { type: 'line', data: { datasets: [
    { label: tr('l.price'), data: pr, borderColor: 'rgba(255,255,255,.6)', borderWidth: 1.2, pointRadius: 0 },
    { label: tr('l.yourAvg'), data: av, borderColor: '#22c55e', borderWidth: 2, pointRadius: 0 },
  ] }, options: o2 });
  $('#dTable').innerHTML = `<table><tr><th>${tr('th.date')}</th><th>${tr('l.price')}</th><th>${tr('th.amount')}</th><th>${unit}</th></tr>${r.buys.map(b => `<tr><td>${fmtDate(b.day)}</td><td>${money(b.price, cur)}</td><td>${money(b.amt, cur)}</td><td>${asset === 'BTC' ? fmtBtc(b.units) : nf(b.units, 4)}</td></tr>`).join('')}</table>`;
}

function calcBestDay() {
  const asset = $('#bAsset').value, from = isoToDay($('#bFrom').value), to = isoToDay($('#bTo').value), f = $('#bFilter').value;
  const mult = f === 'all' ? () => 1 : d => regime(d, f) ? 1 : 0;
  const res = Array.from({ length: 28 }, (_, k) => dca({ asset, cur: 'USD', dom: k + 1, from, to, mult }).avg).map((v, k) => ({ dom: k + 1, avg: v })).filter(x => x.avg > 0);
  if (!res.length) { $('#bBest').textContent = tr('noData'); return; }
  const mean = res.reduce((s, x) => s + x.avg, 0) / res.length;
  const sorted = [...res].sort((a, b) => a.avg - b.avg), best = sorted.slice(0, 3).map(x => x.dom), worst = sorted.slice(-3).map(x => x.dom);
  const b0 = sorted[0], w0 = sorted[sorted.length - 1];
  $('#bBest').innerHTML = tr('bd.result', {
    best: tr('dom.opt', { d: ordDay(b0.dom) }), avg: money(b0.avg), pb: pct((b0.avg / mean - 1) * 100),
    worst: tr('dom.opt', { d: ordDay(w0.dom) }), pw: pct((w0.avg / mean - 1) * 100), diff: nf((w0.avg / b0.avg - 1) * 100, 1),
  });
  const o = opts({ y: { type: 'linear' }, yFmt: v => pct(v, 1), labelFmt: (v, c) => `${pct(v, 2)} (${tr('avgShort', { p: money(res[c.dataIndex].avg) })})` });
  o.scales.x = { type: 'category', grid: { display: false } };
  o.plugins.tooltip.callbacks.title = it => it.length ? tr('dom.opt', { d: ordDay(it[0].label) }) : '';
  o.plugins.decimation.enabled = false; o.parsing = true;
  mk('cBestDay', { type: 'bar', data: { labels: res.map(x => x.dom), datasets: [{ label: tr('vsMean'), data: res.map(x => (x.avg / mean - 1) * 100),
    backgroundColor: res.map(x => best.includes(x.dom) ? '#22c55e' : worst.includes(x.dom) ? '#ef4444' : '#4b5563'), borderRadius: 4 }] }, options: o });
  const WEEKDAYS = tr('weekdays');
  const wd = WEEKDAYS.map((_, k) => dcaWeekly(asset, k, from, to)).map(v => v ?? NaN);
  const wmean = wd.filter(isFinite).reduce((s, v, _, a) => s + v / a.length, 0), wmin = Math.min(...wd.filter(isFinite));
  const o2 = opts({ y: { type: 'linear' }, yFmt: v => pct(v, 1), labelFmt: v => pct(v, 2) });
  o2.scales.x = { type: 'category', grid: { display: false } }; o2.plugins.decimation.enabled = false; o2.parsing = true;
  o2.plugins.tooltip.callbacks.title = it => it.length ? it[0].label : '';
  mk('cBestWd', { type: 'bar', data: { labels: WEEKDAYS, datasets: [{ label: tr('vsMean'), data: wd.map(v => (v / wmean - 1) * 100), backgroundColor: wd.map(v => v === wmin ? '#22c55e' : '#4b5563'), borderRadius: 4 }] }, options: o2 });
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
  const MONTHS = tr('months');
  let h = `<table class="heat"><tr><th>${tr('th.year')}</th>${MONTHS.map(m => `<th>${m}</th>`).join('')}<th>${tr('th.year')}</th></tr>`;
  for (const y of years) {
    h += `<tr><td>${y}</td>${rows.get(y).map(v => `<td style="background:${heatBg(v)}">${v == null ? '' : nf(v, 0) + '%'}</td>`).join('')}<td style="background:${heatBg(yearly.get(y) != null ? yearly.get(y) / 4 : null)};font-weight:700">${yearly.has(y) ? nf(yearly.get(y), 0) + '%' : ''}</td></tr>`;
  }
  const col = m => years.map(y => rows.get(y)[m]).filter(v => v != null);
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length, med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  h += `<tr><td><b>${tr('mo.avg')}</b></td>${MONTHS.map((_, m) => { const a = col(m); const v = a.length ? avg(a) : null; return `<td style="background:${heatBg(v)}"><b>${v == null ? '' : nf(v, 1) + '%'}</b></td>`; }).join('')}<td></td></tr>`;
  h += `<tr><td><b>${tr('mo.med')}</b></td>${MONTHS.map((_, m) => { const v = med(col(m)); return `<td style="background:${heatBg(v)}">${v == null ? '' : nf(v, 1) + '%'}</td>`; }).join('')}<td></td></tr>`;
  h += `<tr><td><b>${tr('mo.pos')}</b></td>${MONTHS.map((_, m) => { const a = col(m); const v = a.length ? a.filter(x => x > 0).length / a.length * 100 : null; return `<td style="background:${v == null ? '' : heatBg((v - 50) / 2)}">${v == null ? '' : nf(v, 0) + '%'}</td>`; }).join('')}<td></td></tr></table>`;
  $('#mHeat').innerHTML = h;
  // по година в цикъла
  const hy = HALVINGS.map(x => dDate(x).getUTCFullYear());
  const types = tr('cy.types');
  let t = `<table><tr><th>${tr('th.phase')}</th>${hy.map(y => `<th>${tr('th.cycleY', { y })}</th>`).join('')}<th>${tr('mo.avg')}</th></tr>`;
  types.forEach((name, k) => {
    const vals = hy.map(y => yearly.get(y + k));
    const v2 = vals.filter(v => v != null);
    t += `<tr><td>${name}</td>${vals.map((v, j) => `<td class="${v == null ? '' : v >= 0 ? 'up' : 'down'}">${v == null ? '—' : pct(v, 0)}${hy[j] + k === new Date().getUTCFullYear() ? ` <span class="muted">(${tr('soFar')})</span>` : ''}</td>`).join('')}<td><b>${v2.length ? pct(avg(v2), 0) : '—'}</b></td></tr>`;
  });
  $('#mCycleYears').innerHTML = t + '</table>';
}

function calcStrat() {
  const cur = $('#sCur').value, amount = num($('#sAmt').value) || 0, dom = $('#sDom').value, from = isoToDay($('#sFrom').value), to = isoToDay($('#sTo').value);
  const fngMult = d => { const f = fngAt(d); if (f == null) return 1; return f < 25 ? 2 : f < 45 ? 1.5 : f < 55 ? 1 : f < 75 ? 0.5 : 0.25; };
  const scMult = d => { const s = scoreOnDay(d); return s < 20 ? 3 : s < 40 ? 2 : s < 60 ? 1 : s < 80 ? 0.5 : 0; };
  const strats = [
    [tr('s.plain'), () => 1], ['Fear & Greed', fngMult], [tr('s.sig'), scMult], [tr('s.bear'), d => regime(d, 'bear') ? 2 : 0],
  ].map(([n, f]) => ({ n, r: dca({ asset: 'BTC', cur, amount, dom, from, to, mult: f }) }));
  // идеал: всичко на дъното
  const base = strats[0].r; let minP = Infinity, minD = from;
  for (let d = from; d <= Math.min(to, today()); d++) { const p = btcAt(d) / (cur === 'EUR' ? fxAt(d) : 1); if (p < minP) { minP = p; minD = d; } }
  const ideal = { inv: base.inv, units: base.inv / minP, avg: minP }; ideal.value = ideal.units * base.endP; ideal.pnlPct = (ideal.value / ideal.inv - 1) * 100;
  strats.push({ n: tr('s.ideal', { d: fmtDate(minD) }), r: ideal, ideal: true });
  const sym = cur === 'EUR' ? '€' : '$';
  const bestSats = Math.max(...strats.filter(s => !s.ideal && s.r.inv).map(s => s.r.units / s.r.inv));
  $('#sTable').innerHTML = `<table><tr><th>${tr('th.strategy')}</th><th>${tr('l.invested')}</th><th>BTC</th><th>${tr('st.avg')}</th><th>${tr('th.satsPer', { c: sym })}</th><th>${tr('l.value')}</th><th>${tr('st.ret')}</th></tr>${strats.map(s => {
    const sp = s.r.inv ? s.r.units / s.r.inv : 0;
    return `<tr${s.ideal ? ' class="muted"' : ''}><td>${!s.ideal && sp === bestSats ? '🏆 ' : ''}${s.n}</td><td>${money(s.r.inv, cur)}</td><td>${fmtBtc(s.r.units)}</td><td>${money(s.r.avg, cur)}</td><td><b>${nf(sp * 1e8, 0)}</b></td><td>${money(s.r.value, cur)}</td><td class="${s.r.pnlPct >= 0 ? 'up' : 'down'}">${pct(s.r.pnlPct, 0)}</td></tr>`;
  }).join('')}</table>`;
  const o = opts({ y: { type: 'linear' }, yFmt: v => nf(v, 0), labelFmt: v => tr('satsN', { n: nf(v, 0) }) });
  o.scales.x = { type: 'category', grid: { display: false } }; o.parsing = true; o.plugins.decimation.enabled = false;
  o.plugins.tooltip.callbacks.title = it => it.length ? it[0].label : '';
  const real = strats.filter(s => !s.ideal);
  mk('cStrat', { type: 'bar', data: { labels: real.map(s => s.n), datasets: [{ label: tr('satsPerLbl', { c: sym }), data: real.map(s => s.r.inv ? s.r.units / s.r.inv * 1e8 : 0), backgroundColor: real.map(s => s.r.inv && s.r.units / s.r.inv === bestSats ? '#22c55e' : '#f7931a'), borderRadius: 4 }] }, options: o });
}

function calcCycles() {
  const rows = CY.cycles.map(c => `<tr>
    <td><span style="color:${CY.colors[c.year]}">●</span> ${c.year}${c.done ? '' : tr('nowParen')}</td>
    <td>${fmtDate(c.h)}<br><span class="muted">${money(c.hp, 'USD')}</span></td>
    <td>${fmtDate(c.topD)}<br><span class="muted">${tr('dayN', { n: c.topD - c.h })}</span></td>
    <td>${money(c.top, 'USD', 0)}<br><span class="up">×${nf(c.top / c.hp, 1)}</span></td>
    <td>${fmtDate(c.botD)}${c.done ? '' : '*'}<br><span class="muted">${tr('dayN', { n: c.botD - c.h })}</span></td>
    <td>${money(c.bot, 'USD', 0)}<br><span class="down">${pct((c.bot / c.top - 1) * 100, 0)}</span></td>
    <td>${c.botD - c.topD}</td></tr>`).join('');
  $('#cyTable').innerHTML = `<table><tr><th>${tr('th.cycle')}</th><th>${tr('th.halving')}</th><th>${tr('th.topDate')}</th><th>${tr('th.top')}</th><th>${tr('th.botDate')}</th><th>${tr('th.botDrop')}</th><th>${tr('th.topToBot')}</th></tr>${rows}</table><p class="small muted">${tr('cy.foot')}</p>`;
  const cur = CY.cur, now = Live.btcUsd ?? B.p[B.p.length - 1];
  const proj = CY.cycles.filter(c => c.done).map(c => {
    const dd = c.bot / c.top, days = c.botD - c.topD, pBot = cur.top * dd, dBot = cur.topD + days;
    const when = dBot > today() ? tr('inDays', { n: nf(dBot - today()) }) : tr('daysAgo', { n: nf(today() - dBot) });
    return `<tr><td><span style="color:${CY.colors[c.year]}">●</span> ${tr('likeY', { y: c.year })}</td><td class="down">${pct((dd - 1) * 100, 0)}</td><td>${money(pBot, 'USD', 0)}</td><td>${fmtDate(dBot)}</td><td>${when}</td><td class="${pBot < now ? 'down' : 'up'}">${pct((pBot / now - 1) * 100, 0)}</td></tr>`;
  }).join('');
  $('#cyProj').innerHTML = `<table><tr><th>${tr('th.scenario')}</th><th>${tr('th.dropFromTop')}</th><th>${tr('th.botPrice')}</th><th>${tr('th.botDate')}</th><th>${tr('th.when')}</th><th>${tr('th.vsToday')}</th></tr>${proj}</table>`;
}

// ============================================================ BTC прогноза: сценарии за бъдещето
const PJ_COLORS = ['#ef4444', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
const pj = Object.assign({ initial: 1000, monthly: 100, cur: 'EUR', years: 20, scen: [{ n: '', r: 10, d: 0 }, { n: '', r: 15, d: 1 }, { n: '', r: 30, d: 2 }] }, LS.get('proj', {}));
const savePj = () => LS.set('proj', pj);
// d = пореден номер на сценария; дава името по подразбиране и цвета, които не се местят при изтриване
const pjName = s => s.n || (s.d < 3 ? tr('pj.s' + s.d) : tr('pj.sN', { n: s.d + 1 }));
const pjColor = s => PJ_COLORS[s.d % PJ_COLORS.length];
// месец по месец: цената на BTC расте равномерно с r% на година; в края на всеки месец купуваш за вноската
function projectScenario(r, years, initial, monthly, p0) {
  const m = Math.pow(1 + r / 100, 1 / 12) - 1;
  let value = initial, invested = initial, btc = initial / p0, price = p0;
  const pts = [{ y: 0, value, invested, btc, price }];
  for (let k = 1; k <= years * 12; k++) {
    price *= 1 + m; value = value * (1 + m) + monthly; invested += monthly; btc += monthly / price;
    if (k % 12 === 0) pts.push({ y: k / 12, value, invested, btc, price });
  }
  return pts;
}
function renderPjEditor() {
  $('#pjScen').innerHTML = pj.scen.map((s, k) => `<div class="pj-row"><i style="background:${pjColor(s)}"></i>
    <input data-k="${k}" data-f="n" value="${esc(s.n)}" placeholder="${esc(pjName({ d: s.d }))}" autocomplete="off">
    <div class="pct"><input data-k="${k}" data-f="r" type="text" inputmode="decimal" autocomplete="off" value="${fmtIn(s.r) || '0'}"><span>%</span></div>
    <button class="iconbtn" data-del="${k}" ${pj.scen.length <= 1 ? 'disabled' : ''} aria-label="✕">✕</button></div>`).join('');
  $('#pjAdd').hidden = pj.scen.length >= 5;
}
function calcProj(full = true) {
  pj.initial = Math.max(0, num($('#pjInit').value) || 0);
  pj.monthly = Math.max(0, num($('#pjMon').value) || 0);
  pj.cur = $('#pjCur').value;
  pj.years = clamp(Math.round(num($('#pjYears').value) || 20), 1, 50);
  savePj();
  if (full) renderPjEditor();
  const cur = pj.cur, Y = pj.years, p0 = livePrice('BTC', cur);
  const big = v => Math.abs(v) >= 1e7 ? fmtShort(v, cur) : money(v, cur, 0);
  const res = pj.scen.map(s => ({ s, pts: projectScenario(clamp(s.r, -99, 1000), Y, pj.initial, pj.monthly, p0) }));
  const inv = pj.initial + pj.monthly * 12 * Y;
  $('#pjRes').innerHTML = res.map(({ s, pts }) => { const f = pts[Y];
    return `<div class="stat"><div class="k"><span style="color:${pjColor(s)}">●</span> ${esc(pjName(s))} · ${pct(s.r, 0)}</div><div class="v">${big(f.value)}</div><div class="s">${tr('pj.mult', { m: nf(f.invested ? f.value / f.invested : 0, 1) })} · ${fmtBtc(f.btc)} BTC</div></div>`;
  }).join('') + statBox(tr('l.invested'), big(inv), tr('pj.after', { y: Y }));
  // за сравнение: средногодишен ръст на BTC за последните 4, 8, 12 години (цели цикли)
  const nowP = B.p[B.p.length - 1], cagr = n => { const i = B.p.length - 1 - Math.round(n * 365.25); return i > 0 ? (Math.pow(nowP / B.p[i], 1 / n) - 1) * 100 : null; };
  $('#pjRef').textContent = tr('pj.ref', { a: [4, 8, 12].map(n => tr('pj.refY', { y: n, p: pct(cagr(n), 0) })).join(' · ') });
  // таблица по години
  const ys = [1, 5, 10, 15, 20, 25, 30, 40, 50].filter(y => y < Y).concat(Y);
  $('#pjTable').innerHTML = `<table><tr><th>${tr('th.year')}</th><th>${tr('l.invested')}</th>${res.map(({ s }) => `<th><span style="color:${pjColor(s)}">●</span> ${esc(pjName(s))}</th>`).join('')}</tr>${ys.map(y => `<tr><td>${tr('pj.after', { y })}</td><td>${big(pj.initial + pj.monthly * 12 * y)}</td>${res.map(({ pts }) => `<td><b>${big(pts[y].value)}</b><br><span class="muted small">${fmtBtc(pts[y].btc)} BTC · ${tr('pj.btcAt', { p: fmtShort(pts[y].price, cur) })}</span></td>`).join('')}</tr>`).join('')}</table>`;
  // графика
  const o = opts({ yFmt: v => fmtShort(v, cur), labelFmt: v => money(v, cur, 0), legend: true });
  o.scales.x = { type: 'linear', bounds: 'data', grid: { display: false }, ticks: { callback: v => tr('yShort', { n: v }), maxTicksLimit: 8 } };
  o.plugins.tooltip.callbacks.title = it => it.length ? tr('pj.after', { y: it[0].parsed.x }) : '';
  o.plugins.decimation.enabled = false;
  mk('cProj', { type: 'line', data: { datasets: [
    ...res.map(({ s, pts }) => ({ label: pjName(s), data: pts.map(p => ({ x: p.y, y: p.value })), borderColor: pjColor(s), borderWidth: 2, pointRadius: 0 })),
    { label: tr('l.invested'), data: res[0] ? res[0].pts.map(p => ({ x: p.y, y: p.invested })) : [], borderColor: '#9ca3af', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0 },
  ] }, options: o });
}

// ============================================================ сложна лихва (общ калкулатор, не само за BTC)
const ci = Object.assign({ initial: 1000, contrib: 100, freq: 'month', rate: 10, per: 'year', dur: 20, unit: 'years', cur: 'EUR' }, LS.get('ci', {}));
const CI_DAYS = { day: 1, week: 7, month: 30.4375, year: 365.25, days: 1, months: 30.4375, years: 365.25 };
// ден по ден: салдото расте с доходността, превърната в дневен множител; вноските се добавят в края на всеки период
function simCompound(c) {
  const unitDays = CI_DAYS[c.unit], totalDays = Math.max(1, Math.round(c.dur * unitDays));
  const f = Math.pow(1 + c.rate / 100, 1 / CI_DAYS[c.per]);
  const step = c.freq === 'none' ? Infinity : CI_DAYS[c.freq];
  const rowStep = Math.max(1, Math.ceil(c.dur / 60)); // най-много ~60 реда в таблицата
  const sampleEvery = totalDays <= 120 ? 1 : totalDays <= 1100 ? 7 : 30.4375;
  let bal = c.initial, inv = c.initial, nextC = step, nextS = sampleEvery, nextR = 1;
  const pts = [{ x: 0, v: bal, i: inv }], rows = [];
  for (let d = 1; d <= totalDays; d++) {
    bal *= f;
    while (d >= Math.round(nextC)) { bal += c.contrib; inv += c.contrib; nextC += step; } // закръглено като редовете: 12-ата вноска влиза в „Година 1“
    if (d >= nextS - 1e-9 || d === totalDays) { pts.push({ x: d / unitDays, v: bal, i: inv }); while (nextS <= d + 1e-9) nextS += sampleEvery; }
    while (nextR <= c.dur && d >= Math.round(nextR * unitDays)) { rows.push({ n: nextR, v: bal, i: inv }); nextR += rowStep; }
  }
  if (!rows.length || rows[rows.length - 1].n !== c.dur) rows.push({ n: +c.dur.toFixed(2), v: bal, i: inv });
  return { bal, inv, pts, rows, eff: (Math.pow(f, 365.25) - 1) * 100 };
}
function calcCi() {
  ci.initial = Math.max(0, num($('#ciInit').value) || 0);
  ci.contrib = Math.max(0, num($('#ciContrib').value) || 0);
  ci.freq = $('#ciFreq').value; ci.per = $('#ciPer').value; ci.unit = $('#ciUnit').value; ci.cur = $('#ciCur').value;
  const r = num($('#ciRate').value); ci.rate = isFinite(r) ? clamp(r, -99, 1000) : 0;
  ci.dur = clamp(num($('#ciDur').value) || 1, 1, ci.unit === 'days' ? 20000 : ci.unit === 'months' ? 600 : 50);
  LS.set('ci', ci);
  const s = simCompound(ci), cur = ci.cur;
  const big = v => Math.abs(v) >= 1e9 ? fmtShort(v, cur) : money(v, cur, Math.abs(v) >= 1000 ? 0 : 2);
  const gain = s.bal - s.inv;
  $('#ciRes').innerHTML = [
    statBox(tr('ci.final'), big(s.bal), tr('ci.mult', { m: nf(s.inv ? s.bal / s.inv : 0, 2) })),
    statBox(tr('l.invested'), big(s.inv), ''),
    statBox(tr('ci.interest'), big(gain), '', gain >= 0 ? 'up' : 'down'),
    statBox(tr('ci.eff'), pct(s.eff, 2), ''),
  ].join('');
  const rowName = n => tr({ days: 'dayCap', months: 'ci.monthN', years: 'ci.yearN' }[ci.unit], { n: nf(n, n % 1 ? 2 : 0) });
  $('#ciTable').innerHTML = `<table><tr><th>${tr('ci.period')}</th><th>${tr('l.invested')}</th><th>${tr('ci.interest')}</th><th>${tr('ci.final')}</th></tr>${s.rows.map(x => `<tr><td>${rowName(x.n)}</td><td>${big(x.i)}</td><td class="${x.v - x.i >= 0 ? 'up' : 'down'}">${big(x.v - x.i)}</td><td><b>${big(x.v)}</b></td></tr>`).join('')}</table>`;
  const unitShort = { days: 'dShort', months: 'mShort', years: 'yShortU' }[ci.unit];
  const o = opts({ y: { type: 'linear' }, yFmt: v => fmtShort(v, cur), labelFmt: v => money(v, cur, 0), legend: true });
  o.scales.x = { type: 'linear', bounds: 'data', grid: { display: false }, ticks: { callback: v => nf(v, v % 1 ? 1 : 0) + tr(unitShort), maxTicksLimit: 8 } };
  o.plugins.tooltip.callbacks.title = it => it.length ? rowName(it[0].parsed.x) : '';
  o.plugins.decimation.enabled = false;
  mk('cCi', { type: 'line', data: { datasets: [
    { label: tr('ci.final'), data: s.pts.map(p => ({ x: p.x, y: p.v })), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.12)', fill: true, borderWidth: 2, pointRadius: 0 },
    { label: tr('l.invested'), data: s.pts.map(p => ({ x: p.x, y: p.i })), borderColor: '#9ca3af', borderWidth: 1.5, pointRadius: 0 },
  ] }, options: o });
}

const calcs = { dca: calcDca, proj: calcProj, ci: calcCi, day: calcBestDay, months: calcMonths, strat: calcStrat, cycles: calcCycles };
let curCalc = LS.get('calc', 'dca');
function showCalc(c) {
  curCalc = c; LS.set('calc', c);
  $$('#calcNav button').forEach(b => b.classList.toggle('on', b.dataset.c === c));
  $$('.calc').forEach(el => el.hidden = el.id !== 'c-' + c);
  calcs[c]();
}

// ============================================================ portfolio
// Активите в портфолиото. Нов актив: ред тук + цена в livePrice() + <div class="card" id="pos…"> в index.html
const ASSETS = {
  BTC: { name: 'Bitcoin', short: 'Bitcoin', badge: '₿', color: '#f7931a', cur: 'EUR', ex: 0.01 },
  MSTR: { name: 'Strategy (MSTR)', short: 'MSTR', badge: 'M', color: '#d9232e', cur: 'USD', ex: 10 },
  ASST: { name: 'Strive (ASST)', short: 'ASST', badge: 'S', color: '#2b59c3', cur: 'USD', ex: 10 },
  GOLD: { nameKey: 'gold.name', shortKey: 'gold.short', badge: 'Au', color: '#d4af37', cur: 'EUR', ex: 1 }, // инвестиционно злато (Тавекс), в грамове
};
const aName = a => ASSETS[a].nameKey ? tr(ASSETS[a].nameKey) : ASSETS[a].name;
const aShort = a => ASSETS[a].shortKey ? tr(ASSETS[a].shortKey) : ASSETS[a].short;
const portfolio = Object.assign({ hist: [] }, ...Object.entries(ASSETS).map(([a, m]) => ({ [a]: { qty: 0, avg: 0, cur: m.cur } })), LS.get('portfolio', {}));
const savePortfolio = () => LS.set('portfolio', portfolio);
// цена за 1 единица (BTC, акция или грам злато) в избраната валута
function livePrice(asset, cur) {
  const fx = Live.fx || fxAt(today());
  if (asset === 'BTC') return cur === 'EUR' ? (Live.btcEur ?? (Live.btcUsd ?? B.p[B.p.length - 1]) / fx) : (Live.btcUsd ?? B.p[B.p.length - 1]);
  const u = asset === 'GOLD' ? (goldNow() ?? 0) / OZ : asset === 'ASST' ? (Live.asst ?? A.p[A.p.length - 1] ?? 0) : (Live.mstr ?? M.p[M.p.length - 1]);
  return cur === 'EUR' ? u / fx : u;
}
const unitOf = a => a === 'BTC' ? 'BTC' : a === 'GOLD' ? tr('unit.g') : tr('unit.shares');
const sharesOf = a => a === 'MSTR' ? Live.shares : a === 'ASST' ? Live.sharesASST : null; // брой акции (от Finnhub)
// количество без излишни нули, като в Revolut: „14,41 ASST“
const fmtQty = (a, q) => Number(q).toLocaleString(loc(), { minimumFractionDigits: 0, maximumFractionDigits: a === 'BTC' ? 8 : a === 'GOLD' ? 2 : 4 });
const qtyLabel = a => a === 'GOLD' ? tr('unit.g') : a; // BTC, MSTR, ASST, гр.
const priceDec = a => a === 'BTC' ? 0 : 2;
// ред 1: количество и текуща цена (като в Revolut); ред 2: средна покупна цена и печалба/загуба
function posSub(a) {
  const p = portfolio[a];
  return `${fmtQty(a, p.qty)} ${qtyLabel(a)} · ${money(livePrice(a, p.cur), p.cur, priceDec(a))}`;
}
function posPl(a) {
  const p = portfolio[a], pnl = p.qty * (livePrice(a, p.cur) - p.avg);
  return `${tr('pf.avg', { p: money(p.avg, p.cur, priceDec(a)) })} · ${tr('pf.pnl', { p: money(pnl, p.cur, 2) })}`;
}
function posForm(asset) {
  const meta = ASSETS[asset], p = portfolio[asset], el = $('#pos' + asset), unit = unitOf(asset);
  const price = livePrice(asset, p.cur), value = p.qty * price, cost = p.qty * p.avg, pnl = value - cost, pp = cost ? (value / cost - 1) * 100 : 0;
  const ex = fmtIn(meta.ex);
  el.innerHTML = `
    <div class="row between"><div class="asset-head"><span class="badge" style="background:${meta.color}">${meta.badge}</span>${aName(asset)}</div>
    <span class="chip ${pnl >= 0 ? 'up' : 'down'}">${p.qty ? pct(pp) : '—'}</span></div>
    <div class="mid">${p.qty ? money(value, p.cur) : '—'}</div>
    <div class="sub">${p.qty ? posSub(asset) : tr('pf.enter')}</div>
    <div class="small muted pl" style="margin-top:2px">${p.qty ? posPl(asset) : ''}</div>
    ${p.qty && sharesOf(asset) ? `<div class="small muted" style="margin-top:4px">${tr('pf.exposure', { b: fmtBtc(p.qty * holdingsOf(asset) / sharesOf(asset)), c: aName(asset) })}</div>` : ''}
    ${asset === 'GOLD' ? `<div class="small muted" style="margin-top:4px">${tr('gold.note', { p: money(price, p.cur, 2) })}</div>` : ''}
    <h3>${tr('pf.edit')}</h3>
    <div class="form" style="margin-bottom:8px">
      <div class="field"><label>${tr('pf.qty', { u: unit })}</label><input data-f="qty" type="text" inputmode="decimal" autocomplete="off" placeholder="${ex}" value="${fmtIn(p.qty)}"></div>
      <div class="field"><label>${tr('pf.mode')}</label><select data-f="mode"><option value="avg">${tr('st.avg')}</option><option value="pct">${tr('pf.m.pct')}</option><option value="cost">${tr('st.invested')}</option></select></div>
      <div class="field"><label data-f="lbl">${tr('st.avg')}</label><input data-f="val" type="text" inputmode="decimal" autocomplete="off" value="${p.avg ? fmtIn(+p.avg.toFixed(2)) : ''}"></div>
      <div class="field"><label>${tr('f.cur')}</label><select data-f="cur"><option ${p.cur === 'EUR' ? 'selected' : ''}>EUR</option><option ${p.cur === 'USD' ? 'selected' : ''}>USD</option></select></div>
    </div>
    <div class="row"><button class="btn sm" data-f="save">${tr('save')}</button></div>
    <h3>${tr('pf.addBuy')}</h3>
    <div class="form" style="margin-bottom:8px">
      <div class="field"><label>${tr('pf.boughtQty')}</label><input data-f="bq" type="text" inputmode="decimal" autocomplete="off" placeholder="${asset === 'BTC' ? ex : '1'}"></div>
      <div class="field"><label>${tr('pf.buyPrice', { c: p.cur })}</label><input data-f="bp" type="text" inputmode="decimal" autocomplete="off" placeholder="${nf(price, 2)}"></div>
    </div>
    <button class="btn sm ghost" data-f="buy">${tr('pf.addToPos')}</button>`;
  const f = n => $(`[data-f="${n}"]`, el);
  f('mode').onchange = () => {
    const m = f('mode').value, inp = f('val');
    f('lbl').textContent = tr(m === 'avg' ? 'st.avg' : m === 'pct' ? 'pf.lbl.pct' : 'st.invested');
    inp.inputMode = m === 'pct' ? 'text' : 'decimal'; // за загуба трябва минус, а цифровата клавиатура на iPhone няма минус
    inp.placeholder = m === 'pct' ? tr('pf.ph.pct') : '';
    inp.value = '';
  };
  f('save').onclick = () => {
    const qs = f('qty').value.trim(), vs = f('val').value.trim();
    const qty = qs ? num(qs) : 0, v = num(vs), c = f('cur').value, m = f('mode').value, pr = livePrice(asset, c);
    if (!isFinite(qty) || qty < 0) return toast(tr('e.qty', { ex }));
    if (vs && !isFinite(v)) return toast(tr('e.val', { ex: fmtIn(12.5) }));
    if (m === 'pct' && v <= -100) return toast(tr('e.loss'));
    let avg = p.avg;
    if (isFinite(v)) avg = m === 'avg' ? v : m === 'pct' ? pr / (1 + v / 100) : (qty ? v / qty : 0);
    if (c !== p.cur && !isFinite(v)) avg = c === 'EUR' ? p.avg / (Live.fx || fxAt(today())) : p.avg * (Live.fx || fxAt(today()));
    Object.assign(p, { qty, avg, cur: c }); savePortfolio(); renderPortfolio(); toast(tr('saved'));
  };
  f('buy').onclick = () => {
    const q = num(f('bq').value), bs = f('bp').value.trim(), bp = bs ? num(bs) : price;
    if (!(q > 0)) return toast(tr('e.enterQty', { ex }));
    if (!(bp > 0)) return toast(tr('e.price'));
    const nq = p.qty + q; p.avg = (p.qty * p.avg + q * bp) / nq; p.qty = nq; savePortfolio(); renderPortfolio(); toast(tr('buyAdded'));
  };
}
function portfolioTotals() {
  const fx = Live.fx || fxAt(today());
  const toUsd = (v, c) => c === 'EUR' ? v * fx : v;
  let usd = 0, cost = 0; const byAsset = {};
  for (const a of Object.keys(ASSETS)) {
    const p = portfolio[a]; byAsset[a] = toUsd(p.qty * livePrice(a, p.cur), p.cur);
    usd += byAsset[a]; cost += toUsd(p.qty * p.avg, p.cur);
  }
  const btcUsd = Live.btcUsd ?? B.p[B.p.length - 1];
  return { usd, eur: usd / fx, cost, pnl: usd - cost, pp: cost ? (usd / cost - 1) * 100 : 0, inBtc: usd / btcUsd, fx, byAsset };
}
function renderPortfolioTotals() {
  const t = portfolioTotals();
  $('#pTotal').textContent = money(t.eur, 'EUR', 0);
  $('#pTotal2').textContent = money(t.usd, 'USD', 0);
  const c = $('#pTotalPnl'); c.textContent = t.cost ? `${pct(t.pp)} · ${money(t.pnl / t.fx, 'EUR', 0)}` : '—'; c.className = 'chip ' + (t.pnl >= 0 ? 'up' : 'down');
  const share = a => t.usd ? tr('pf.share', { n: nf(t.byAsset[a] / t.usd * 100, 0) }) : '';
  const qtyTxt = a => { const q = portfolio[a].qty; return a === 'BTC' ? fmtBtc(q) + ' BTC' : a === 'GOLD' ? tr('pf.nGrams', { n: nf(q, 2) }) : tr('pf.nShares', { n: nf(q, 2) }); };
  $('#pStats').innerHTML = [
    statBox(tr('pf.inBtc'), fmtBtc(t.inBtc) + ' BTC', tr('pf.inBtc.s')),
    ...Object.keys(ASSETS).map(a => statBox(aShort(a), qtyTxt(a), share(a))),
    statBox(tr('st.invested'), money(t.cost / t.fx, 'EUR', 0), money(t.cost, 'USD', 0)),
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
  Object.keys(ASSETS).forEach(posForm); renderPortfolioTotals(); snapshotPortfolio();
  const h = portfolio.hist;
  $('#pHistHint').textContent = h.length < 2 ? tr('pf.hist') : '';
  $('#cPortHist').parentElement.hidden = h.length < 2;
  if (h.length < 2) return;
  const o = opts({ y: { type: 'linear' }, legend: true, yFmt: v => fmtShort(v, 'USD') });
  o.scales.y2 = { type: 'linear', position: 'left', grid: { display: false }, ticks: { callback: v => nf(v, 3) } };
  o.plugins.tooltip.callbacks.label = c => c.dataset.yAxisID === 'y2' ? ` ${fmtBtc(c.parsed.y)} BTC` : ` ${money(c.parsed.y, 'USD', 0)}`;
  mk('cPortHist', { type: 'line', data: { datasets: [
    { label: tr('l.valueUsd'), data: h.map(x => ({ x: x.d, y: x.usd })), borderColor: '#f7931a', borderWidth: 2, pointRadius: h.length < 30 ? 2 : 0 },
    { label: tr('l.inBtc'), data: h.map(x => ({ x: x.d, y: x.btc })), borderColor: '#22c55e', borderWidth: 1.5, pointRadius: h.length < 30 ? 2 : 0, yAxisID: 'y2' },
  ] }, options: o });
}

// ============================================================ news
async function loadNews() {
  try {
    const n = await getJSON('data/news.json');
    $('#newsUpd').textContent = tr('news.upd', { t: new Date(n.updated).toLocaleString(loc(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) });
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const safeUrl = u => /^https:\/\//.test(u || '') ? esc(u) : '';
    $('#newsList').innerHTML = n.items.map(x => `<a href="${safeUrl(x.link)}" target="_blank" rel="noopener">
      ${x.img ? `<img src="${safeUrl(x.img)}" alt="" loading="lazy">` : ''}
      <div class="body"><time>${new Date(x.date).toLocaleString(loc(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><h4>${esc(x.title)}</h4><p>${esc(x.desc)}</p></div></a>`).join('');
  } catch { $('#newsList').innerHTML = `<p class="muted">${tr('news.err')}</p>`; }
}

// ============================================================ alerts
const alerts = LS.get('alerts', []);
const alName = type => tr('al.' + type);
function renderAlerts() {
  $('#alertList').innerHTML = alerts.map((a, k) => `<div class="alert-item ${a.fired ? 'fired' : ''}"><span>${a.fired ? '✅ ' : '🔔 '}${alName(a.type)} ${nf(a.value, a.value < 1000 ? 2 : 0)}</span><span class="row">${a.fired ? `<button class="btn sm ghost" data-rearm="${k}">${tr('al.rearm')}</button>` : ''}<button class="btn sm danger" data-del="${k}">✕</button></span></div>`).join('') || `<p class="small muted">${tr('al.none')}</p>`;
}
function checkAlerts() {
  const v = {
    btc: Live.btcUsd, mstr: Live.mstr, asst: Live.asst, fng: fngAt(today()) ?? FNGs.v[FNGs.v.length - 1], score: I.score ? I.score[I.score.length - 1] : null,
  };
  let changed = false;
  for (const a of alerts) {
    if (a.fired) continue;
    const [k, dir] = a.type.split('_'), x = v[k];
    if (x == null) continue;
    if ((dir === 'above' && x >= a.value) || (dir === 'below' && x <= a.value)) {
      a.fired = true; changed = true;
      const msg = `${alName(a.type)} ${nf(a.value, 0)}: ${tr('now')} ${['btc', 'mstr', 'asst'].includes(k) ? money(x, 'USD') : nf(x, 0)}`;
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
  $('#setKey').value = settings.key;
  for (const s of ['MSTR', 'ASST']) { // празно = автоматично (CoinGecko); в placeholder е текущото автоматично число
    const inp = $('#setHold' + s[0]); inp.value = settings['hold' + s] ? fmtIn(settings['hold' + s]) : ''; inp.placeholder = nf(treasury[s] || TREASURY_DEFAULT[s]);
  }
  renderAlerts();
  $('#settings').showModal();
}
function wireSettings() {
  $('#openSettings').onclick = openSettings;
  document.addEventListener('click', e => { if (e.target.closest('[data-open-settings]')) { e.preventDefault(); openSettings(); } });
  $('#closeSettings').onclick = () => $('#settings').close();
  $('#saveKey').onclick = () => { settings.key = $('#setKey').value.trim(); saveSettings(); Live.mcap = Live.shares = Live.sharesASST = null; Live.lastMstr = 0; $('#keyStatus').textContent = tr('key.checking'); connectFinnhub(); pollMstr(); };
  $('#saveHold').onclick = () => {
    for (const s of ['MSTR', 'ASST']) { const v = num($('#setHold' + s[0]).value); settings['hold' + s] = v > 0 ? v : null; }
    saveSettings(); dirty = true; toast(tr('saved'));
  };
  $('#addAlert').onclick = () => { const v = num($('#alVal').value); if (!isFinite(v)) return toast(tr('e.enterVal')); alerts.push({ type: $('#alType').value, value: v, fired: false }); LS.set('alerts', alerts); $('#alVal').value = ''; renderAlerts(); };
  $('#alertList').onclick = e => {
    const d = e.target.dataset.del, r = e.target.dataset.rearm;
    if (d != null) alerts.splice(+d, 1); else if (r != null) alerts[+r].fired = false; else return;
    LS.set('alerts', alerts); renderAlerts();
  };
  $('#notifPerm').onclick = async () => {
    if (!('Notification' in window)) return toast(tr('notif.ios'));
    const p = await Notification.requestPermission(); toast(tr(p === 'granted' ? 'notif.ok' : 'notif.no'));
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
      toast(tr('restored')); setTimeout(() => location.reload(), 800);
    } catch { toast(tr('badFile')); }
  };
  $('#resetBtn').onclick = () => {
    if (!confirm(tr('resetQ'))) return;
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
  segWire('.seg[data-range="gold"]', chartGold);
  segWire('#goldMode', chartGold);
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

  // BTC прогноза: полетата се пресмятат при всяко натискане; редовете със сценарии се рисуват наново само при добавяне/изтриване
  $('#pjInit').value = fmtIn(pj.initial) || '0'; $('#pjMon').value = fmtIn(pj.monthly) || '0'; $('#pjCur').value = pj.cur; $('#pjYears').value = pj.years;
  for (const id of ['pjInit', 'pjMon', 'pjYears']) $('#' + id).addEventListener('input', () => calcProj(false));
  $('#pjCur').addEventListener('change', () => calcProj(false));
  $('#pjScen').addEventListener('input', e => {
    const k = +e.target.dataset.k, s = pj.scen[k]; if (!s) return;
    if (e.target.dataset.f === 'n') s.n = e.target.value.trim();
    else { const v = num(e.target.value); if (!isFinite(v)) return; s.r = v; }
    calcProj(false);
  });
  $('#pjScen').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b || pj.scen.length <= 1) return;
    pj.scen.splice(+b.dataset.del, 1); calcProj();
  });
  $('#pjAdd').onclick = () => {
    if (pj.scen.length >= 5) return;
    const last = pj.scen[pj.scen.length - 1];
    pj.scen.push({ n: '', r: last ? last.r + 10 : 20, d: Math.max(-1, ...pj.scen.map(s => s.d)) + 1 }); calcProj();
  };

  // сложна лихва
  $('#ciInit').value = fmtIn(ci.initial) || '0'; $('#ciContrib').value = fmtIn(ci.contrib) || '0'; $('#ciRate').value = fmtIn(ci.rate) || '0';
  $('#ciDur').value = fmtIn(ci.dur) || '1'; $('#ciFreq').value = ci.freq; $('#ciPer').value = ci.per; $('#ciUnit').value = ci.unit; $('#ciCur').value = ci.cur;
  for (const id of ['ciInit', 'ciContrib', 'ciRate', 'ciDur']) $('#' + id).addEventListener('input', calcCi);
  for (const id of ['ciFreq', 'ciPer', 'ciUnit', 'ciCur']) $('#' + id).addEventListener('change', calcCi);
  wireSettings();
}

// ============================================================ boot
async function boot() {
  wire();
  try { await loadData(); } catch (e) { $('#boot').textContent = tr('boot.err'); console.error(e); return; }
  computeIndicators();
  $('#boot').remove();
  connectCoinbase(); connectFinnhub(); pollBtc(); pollMstr(); pollHeight(); loadTreasury();
  renderMarket(); showTab(curTab);

  let lastFull = Date.now();
  setInterval(() => { // UI тик всяка секунда, само ако има промяна
    const live = Date.now() - Live.lastBtc < 15000;
    $('#liveDot').classList.toggle('on', live);
    $('#liveTxt').textContent = tr(live ? 'live.on' : 'live.off');
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
  setInterval(() => { pollHeight(); loadTreasury(); }, 300000);
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
  for (const a of Object.keys(ASSETS)) {
    const el = $('#pos' + a), p = portfolio[a]; if (!el || !p.qty) continue;
    const price = livePrice(a, p.cur), value = p.qty * price, cost = p.qty * p.avg, pnl = value - cost;
    $('.mid', el).textContent = money(value, p.cur);
    const chip = $('.chip', el); chip.textContent = pct(cost ? (value / cost - 1) * 100 : 0); chip.className = 'chip ' + (pnl >= 0 ? 'up' : 'down');
    $('.sub', el).textContent = posSub(a);
    $('.pl', el).textContent = posPl(a);
  }
}

// Android / Chrome: собствен бутон за инсталиране (iPhone няма такова събитие, там е „Добави към началния екран“)
let installEvt = null;
const showInstall = on => { $('#installBtn').hidden = !on; $('#installBtn2').hidden = !on; };
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstall(true); });
window.addEventListener('appinstalled', () => { installEvt = null; showInstall(false); toast(tr('installed')); });
async function doInstall() {
  if (!installEvt) return toast(tr('installHint'), 4000);
  installEvt.prompt();
  await installEvt.userChoice.catch(() => { });
  installEvt = null; showInstall(false);
}
$('#installBtn').onclick = doInstall;
$('#installBtn2').onclick = doInstall;

// ============================================================ languages
function renderLangUi() {
  $('#langBtn').textContent = LANG.toUpperCase();
  $$('#langSeg button').forEach(b => b.classList.toggle('on', b.dataset.l === LANG));
  $('#appVersion').textContent = tr('version', { v: APP_VERSION });
}
function setLang(l) {
  if (!LANGS[l] || l === LANG) return;
  LANG = l; settings.lang = l; saveSettings();
  applyI18n(); renderLangUi();
  fillDays($('#dDom')); fillDays($('#sDom'));
  if (!B.p.length) return; // данните още се зареждат: boot() ще нарисува всичко на новия език
  rendered.news = false;
  renderMarket(); showTab(curTab);
  if ($('#settings').open) renderAlerts();
}
$('#langBtn').onclick = () => { const ls = Object.keys(LANGS); setLang(ls[(ls.indexOf(LANG) + 1) % ls.length]); };
$('#langSeg').onclick = e => { const b = e.target.closest('button'); if (b) setLang(b.dataset.l); };
applyI18n(); renderLangUi();

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
