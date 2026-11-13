'use strict';
/* Mapa de Risco RJ — app de mapa com busca, GPS, rotas e alertas. Tudo roda no aparelho. */
const APP_VERSION = '2026.11.13';

const LAT0 = -22.5, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110540;
const GDEF = {
  'CV':     {n: 'Comando Vermelho', s: 'CV', c: '#dc2626'},
  'TCP':    {n: 'Terceiro Comando Puro', s: 'TCP', c: '#2563eb'},
  'ADA':    {n: 'Amigos dos Amigos', s: 'ADA', c: '#d97706'},
  'MIL':    {n: 'Milícia', s: 'Milícia', c: '#7c3aed'},
  'MIL-CL': {n: 'Milícia – Liga da Justiça (CL220)', s: 'Milícia CL', c: '#a21caf'},
  'MIL-NI': {n: 'Milícia de Nova Iguaçu', s: 'Milícia NI', c: '#db2777'},
  'NEUTRA': {n: 'Comunidade neutra', s: 'Neutra', c: '#64748b'}
};
const ST = {
  IN: {r: 6, t: 'DENTRO DE ÁREA DE RISCO', sh: 'Dentro', ic: '⛔'},
  MP: {r: 5, t: 'MUITO PRÓXIMO', sh: 'Muito perto', ic: '⚠️'},
  NE: {r: 4, t: 'COMUNIDADE NEUTRA', sh: 'Neutra', ic: '◐'},
  PX: {r: 3, t: 'PRÓXIMO (até 600 m)', sh: 'Próximo', ic: '⚠️'},
  FO: {r: 2, t: 'FORA DAS ÁREAS MAPEADAS', sh: 'Fora', ic: '✓'},
  IM: {r: 1, t: 'LOCALIZAÇÃO IMPRECISA', sh: 'Impreciso', ic: '?'}
};
const OSM_AT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const BASES = {
  ruas:     {n: 'Ruas', dark: false, layers: [{url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', at: OSM_AT}]},
  satelite: {n: 'Satélite', dark: true, layers: [
    {url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', at: 'Imagens &copy; Esri, Maxar, Earthstar Geographics'},
    {url: ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', at: ''},
    {url: ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', at: ''}]},
  escuro:   {n: 'Escuro', dark: true, layers: [{url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', at: OSM_AT, cls: 'inv'}]}
};

const $ = id => document.getElementById(id);
/* tamanho do texto (1 normal, 2 grande, 3 extra) e altura real da tela */
function applyTextSize(n) { const h = document.documentElement; h.classList.remove('t2', 't3'); if (n > 1) h.classList.add('t' + n); }
try { applyTextSize(+(localStorage.getItem('rrj.tsize') || 1)); } catch (e) {}
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 17;
function syncViewport() {
  const vv = window.visualViewport, h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', (window.innerHeight / 100) + 'px');
  document.documentElement.style.setProperty('--vvh', h + 'px');
  try { if (map) map.invalidateSize({pan: false}); } catch (e) { /* mapa ainda não criado */ }
}
syncViewport();
window.addEventListener('resize', syncViewport);
window.addEventListener('orientationchange', () => setTimeout(syncViewport, 300));
if (window.visualViewport) window.visualViewport.addEventListener('resize', syncViewport);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmtD = d => d < 1000 ? Math.max(10, Math.round(d / 10) * 10) + ' m' : (d / 1000).toFixed(1).replace('.', ',') + ' km';
const fmtCep = c => { const s = String(c).padStart(8, '0'); return s.slice(0, 5) + '-' + s.slice(5); };
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const store = {
  get(k, d) { try { const v = localStorage.getItem('rrj.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rrj.' + k, JSON.stringify(v)); } catch (e) {} }
};
function toast(m, ms) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms || 2200); }
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const CARD = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
const bearing = (dx, dy) => (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
const cardinal = b => CARD[Math.round(b / 45) % 8];
const CARDW = ['ao norte', 'a nordeste', 'a leste', 'a sudeste', 'ao sul', 'a sudoeste', 'a oeste', 'a noroeste'];
const cardinalW = b => CARDW[Math.round(b / 45) % 8];

/* ===================== geometria ===================== */
let AR = [];
function inPoly(a, x, y) {
  let ins = false;
  for (const P of a.R) {
    const n = P.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = P[2 * i], yi = P[2 * i + 1], xj = P[2 * j], yj = P[2 * j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins;
    }
  }
  return ins;
}
function closest(a, x, y) {
  let best = Infinity, bx = 0, by = 0;
  for (const P of a.R) {
    const n = P.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = P[2 * j], y1 = P[2 * j + 1], x2 = P[2 * i], y2 = P[2 * i + 1];
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
      let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x1 + t * dx, py = y1 + t * dy, d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) { best = d; bx = px; by = py; }
    }
  }
  return {d: Math.sqrt(best), x: bx, y: by};
}
function bboxDist(a, x, y) {
  const dx = x < a.minx ? a.minx - x : x > a.maxx ? x - a.maxx : 0;
  const dy = y < a.miny ? a.miny - y : y > a.maxy ? y - a.maxy : 0;
  return Math.hypot(dx, dy);
}
/* Avalia um ponto: áreas em que está dentro, áreas próximas (até maxD) e a área de facção mais próxima. */
function assess(x, y, maxD) {
  const inArmed = [], inNeutral = [], near = [], far = []; let best = null;
  for (const a of AR) {
    const bd = bboxDist(a, x, y);
    if (bd > maxD) { if (a.armed) far.push([bd, a]); continue; }
    let e;
    if (inPoly(a, x, y)) { e = {a, d: 0, x, y}; (a.armed ? inArmed : inNeutral).push(a); }
    else { const c = closest(a, x, y); e = {a, d: c.d, x: c.x, y: c.y}; }
    if (e.d <= maxD) near.push(e);
    if (a.armed && (!best || e.d < best.d)) best = e;
  }
  if (!best || best.d > maxD) {
    far.sort((p, q) => p[0] - q[0]);
    for (const [bd, a] of far) { if (best && bd >= best.d) break; const c = closest(a, x, y); if (!best || c.d < best.d) best = {a, d: c.d, x: c.x, y: c.y}; }
  }
  near.sort((p, q) => p.d - q.d);
  return {inArmed, inNeutral, near, nearArmed: best};
}
function classify(as, reach) {
  if (as.inArmed.length) return 'IN';
  const d = as.nearArmed ? as.nearArmed.d : Infinity;
  if (d <= Math.max(150, reach || 0)) return 'MP';
  if (as.inNeutral.length) return 'NE';
  if (d <= 600) return 'PX';
  return 'FO';
}
const aname = a => `<b>${esc(a.name)}</b> <span class="gtag" style="background:${GDEF[a.gk].c}">${esc(GDEF[a.gk].s)}</span>`;
function statusLine(k, as, reach) {
  const na = as.nearArmed;
  switch (k) {
    case 'IN': return 'Dentro de ' + as.inArmed.map(aname).join(' e ') + (as.inArmed.length > 1 ? ' (áreas sobrepostas / disputa)' : '') + '.';
    case 'MP': return (reach > 150 && na.d <= reach ? 'A rua pode passar dentro ou na divisa de ' : 'A ' + fmtD(na.d) + ' de ') + aname(na.a) + '.';
    case 'NE': return 'Dentro de ' + as.inNeutral.map(aname).join(', ') + (na ? '. Facção mais próxima: ' + aname(na.a) + ' a ' + fmtD(na.d) : '') + '.';
    case 'PX': return 'Área mais próxima: ' + aname(na.a) + ' a ' + fmtD(na.d) + '.';
    case 'FO': return na ? 'Área mais próxima: ' + aname(na.a) + ' a ' + fmtD(na.d) + '.' : 'Nenhuma área mapeada por perto.';
    case 'IM': return 'O CEP não tem posição exata: o ponto é o centro aproximado da região dele. Use a lista de áreas abaixo como referência.';
  }
}
/* classificação rápida para os selos da lista de resultados */
function quickK(lat, lon, reach, imprecise) {
  if (imprecise) return 'IM';
  const x = lon * KX, y = lat * KY, lim = Math.max(600, reach || 0); let inA = false, inN = false, d = Infinity;
  for (const a of AR) {
    if (bboxDist(a, x, y) > lim) continue;
    if (inPoly(a, x, y)) { if (a.armed) inA = true; else inN = true; }
    else if (a.armed) { const c = closest(a, x, y).d; if (c < d) d = c; }
  }
  if (inA) return 'IN'; if (d <= Math.max(150, reach || 0)) return 'MP'; if (inN) return 'NE'; if (d <= 600) return 'PX'; return 'FO';
}
const chipH = k => `<span class="chip" style="background:var(--s-${k})">${ST[k].sh}</span>`;
const plain = h => h.replace(/<span class="gtag"[^>]*>([^<]*)<\/span>/g, '($1)').replace(/<[^>]+>/g, '');

/* ===================== dados ===================== */
let META = null;
async function loadAreas() {
  const r = await fetch('data/areas.json');
  const j = await r.json(); META = j;
  for (let i = 0; i < j.areas.length; i++) {
    const [name, g, city, bairro, desc, llat, llon, rings] = j.areas[i];
    const gk = j.groups[g];
    const R = [], LL = [];
    let minx = 1e18, miny = 1e18, maxx = -1e18, maxy = -1e18;
    for (const fl of rings) {
      const n = fl.length / 2, P = new Float64Array(fl.length), ll = new Array(n); let a = 0, b = 0;
      for (let k = 0; k < n; k++) {
        a += fl[2 * k]; b += fl[2 * k + 1];
        const lat = a / 1e5, lon = b / 1e5, x = lon * KX, y = lat * KY;
        P[2 * k] = x; P[2 * k + 1] = y; ll[k] = [lat, lon];
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
      R.push(P); LL.push(ll);
    }
    AR.push({i, name, gk, armed: gk !== 'NEUTRA', city, bairro, desc, R, LL, minx, miny, maxx, maxy, llat, llon, nn: ' ' + norm(name), loc: ' ' + norm(bairro + ' ' + city)});
  }
}

/* base de ruas/CEPs (carrega em segundo plano) */
let RU = null;
const TYPES = new Set('rua avenida travessa estrada praca largo alameda rodovia via beco vila ladeira caminho servidao viela condominio conjunto parque loteamento acesso escadaria praia morro passagem rampa trevo jardim quadra residencial'.split(' '));
const STOP = new Set('de da do das dos e a o'.split(' '));
const ABBR = {r: 'rua', av: 'avenida', avd: 'avenida', avn: 'avenida', tv: 'travessa', trav: 'travessa', tr: 'travessa', est: 'estrada', estr: 'estrada', etr: 'estrada',
  pc: 'praca', pca: 'praca', pq: 'parque', lg: 'largo', al: 'alameda', rod: 'rodovia', lad: 'ladeira', bc: 'beco', cond: 'condominio', conj: 'conjunto', cj: 'conjunto', sv: 'servidao', vl: 'vila',
  dr: 'doutor', dra: 'doutora', sto: 'santo', sta: 'santa', pres: 'presidente', gen: 'general', gal: 'general', cel: 'coronel', mal: 'marechal', cap: 'capitao', ten: 'tenente',
  sgt: 'sargento', prof: 'professor', profa: 'professora', eng: 'engenheiro', dep: 'deputado', ver: 'vereador', sen: 'senador', gov: 'governador', min: 'ministro', pe: 'padre',
  nsa: 'nossa', sra: 'senhora', cmte: 'comandante', alm: 'almirante', brig: 'brigadeiro', vsc: 'visconde', bar: 'barao', cde: 'conde', jd: 'jardim', jdm: 'jardim'};
const NUMW = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte'];
function alts(t) {
  const a = [t];
  if (/^\d+$/.test(t)) { const n = +t; if (n <= 20) a.push(NUMW[n]); if (n === 1) a.push('primeiro'); if (n === 2) a.push('segundo'); if (n === 3) a.push('terceiro'); }
  if (t === 'catorze') a.push('quatorze'); if (t === 'quatorze') a.push('catorze');
  return a;
}
const hasW = (h, al) => { for (const a of al) if (h.indexOf(' ' + a) !== -1) return true; return false; };
const stripType = n => { const p = n.split(' '); let i = 0; while (i < p.length - 1 && TYPES.has(p[i])) i++; return p.slice(i).join(' '); };

async function loadRuas() {
  const r = await fetch('data/ruas.json'); const D = await r.json();
  const N = D.cep.length;
  const U = {D, N, CEP: new Int32Array(N), LAT: new Float64Array(N), LON: new Float64Array(N), X: new Float64Array(N), Y: new Float64Array(N),
    RA: new Int16Array(N), Q: new Uint8Array(N), SI: new Int32Array(N), BI: new Int32Array(N), CI: new Int32Array(N), GR: [], GKEY: new Map()};
  let c = 0, la = 0, lo = 0;
  for (let i = 0; i < N; i++) {
    c += D.cep[i]; la += D.la[i]; lo += D.lo[i];
    U.CEP[i] = c; U.LAT[i] = la / 1e5; U.LON[i] = lo / 1e5; U.X[i] = U.LON[i] * KX; U.Y[i] = U.LAT[i] * KY;
    U.RA[i] = D.ra[i]; U.Q[i] = D.q[i]; U.SI[i] = D.st[i]; U.BI[i] = D.nb[i]; U.CI[i] = D.ci[i];
    const k = U.SI[i] * 1e9 + U.BI[i] * 1e4 + U.CI[i];
    let g = U.GKEY.get(k);
    if (g === undefined) { g = U.GR.length; U.GKEY.set(k, g); U.GR.push({st: U.SI[i], nb: U.BI[i], ci: U.CI[i], rows: []}); }
    U.GR[g].rows.push(i);
  }
  U.NS = D.streets.map(s => ' ' + norm(s)); U.NSC = U.NS.map(s => stripType(s.trim()));
  U.NSCK = U.NSC.map(s => s.split(' ').filter(w => !STOP.has(w)).join(' '));
  U.NB = D.bairros.map(s => ' ' + norm(s)); U.NC = D.cities.map(s => ' ' + norm(s));
  U.BIG = new Uint8Array(U.GR.length);
  for (let g = 0; g < U.GR.length; g++) U.BIG[g] = U.GR[g].rows.every(r => U.CEP[r] % 1000 >= 900) ? 1 : 0;
  RU = U;
}
function rowLoc(r) {
  const U = RU, q = U.Q[r];
  const reach = q === 0 || q === 3 ? Math.min(800, Math.max(0, 1.7 * U.RA[r] * 10)) : 0;
  return {lat: U.LAT[r], lon: U.LON[r], reach, imprecise: q === 1 || q === 2, q, ra: U.RA[r]};
}
function nearestStreet(x, y) {
  if (!RU) return null;
  let b = -1, bd = Infinity; const {X, Y, Q, N} = RU;
  for (let i = 0; i < N; i++) { if (Q[i] === 1 || Q[i] === 2) continue; const dx = X[i] - x, dy = Y[i] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; b = i; } }
  if (b < 0 || bd > 450 * 450) return null;
  const D = RU.D;
  return {r: b, d: Math.sqrt(bd), txt: `${D.streets[RU.SI[b]]} · ${D.bairros[RU.BI[b]]} · ${D.cities[RU.CI[b]]}`};
}

/* ===================== mapa ===================== */
let map, baseLayer, canvasR, polys = {}, labelLayer, selLayer, meLayer;
const hidden = new Set(store.get('hidden', []));
let baseKey = store.get('base', 'ruas');

function initMap() {
  const v = store.get('view', null);
  map = L.map('map', {zoomControl: false, attributionControl: false, preferCanvas: true, worldCopyJump: false, minZoom: 7, maxZoom: 19, tap: false})
    .setView(v ? [v[0], v[1]] : [-22.86, -43.30], v ? v[2] : 11);
  L.control.attribution({position: 'bottomleft', prefix: false}).addTo(map);
  canvasR = L.canvas({padding: 0.4, tolerance: 4});
  setBase(baseKey);
  for (const g of META.groups) polys[g] = L.layerGroup();
  for (const a of AR) {
    const c = GDEF[a.gk].c;
    a.layer = L.polygon(a.LL, {renderer: canvasR, color: c, weight: 1.6, opacity: 0.95, fillColor: c, fillOpacity: a.armed ? 0.3 : 0.2, interactive: false, dashArray: a.armed ? null : '4 4'});
    polys[a.gk].addLayer(a.layer);
  }
  for (const g of META.groups) if (!hidden.has(g)) polys[g].addTo(map);
  labelLayer = L.layerGroup().addTo(map);
  selLayer = L.layerGroup().addTo(map);
  meLayer = L.layerGroup().addTo(map);
  map.on('moveend', () => { refreshLabels(); const c = map.getCenter(); store.set('view', [+c.lat.toFixed(5), +c.lng.toFixed(5), map.getZoom()]); });
  map.on('click', e => { if (!$('results').hidden) { closeResults(); return; } selectPoint(e.latlng.lat, e.latlng.lng, {kind: 'tap'}); });
  map.on('dragstart', () => { if (gps.follow) setFollow(false); });
  refreshLabels();
}
function setBase(k) {
  if (!BASES[k]) k = 'ruas';
  baseKey = k; store.set('base', k);
  if (baseLayer) map.removeLayer(baseLayer);
  const b = BASES[k];
  baseLayer = L.layerGroup(b.layers.map(l => L.tileLayer(l.url, {maxZoom: 19, maxNativeZoom: 19, attribution: l.at, className: l.cls || '', crossOrigin: true}))).addTo(map);
  document.body.classList.toggle('dark', b.dark);
  document.querySelectorAll('#bases button').forEach(x => x.classList.toggle('on', x.dataset.k === k));
}
function refreshLabels() {
  labelLayer.clearLayers();
  const z = map.getZoom(); if (z < 13) return;
  const b = map.getBounds();
  const x0 = b.getWest() * KX, x1 = b.getEast() * KX, y0 = b.getSouth() * KY, y1 = b.getNorth() * KY;
  const mpp = 156543.03 * Math.cos(-22.9 * Math.PI / 180) / Math.pow(2, z); // metros por pixel
  const vis = AR.filter(a => !hidden.has(a.gk) && a.maxx > x0 && a.minx < x1 && a.maxy > y0 && a.miny < y1)
    .map(a => [a, Math.max(a.maxx - a.minx, a.maxy - a.miny) / mpp]).filter(([a, px]) => z >= 15 || px > 50)
    .sort((p, q) => q[1] - p[1]).slice(0, 140);
  const placed = [];
  if (sel && sel.kind !== 'gps') { const q = map.latLngToContainerPoint([sel.lat, sel.lon]); placed.push([q.x - 22, q.y - 52, 44, 56]); }
  for (const [a] of vis) {
    const p = map.latLngToContainerPoint([a.llat, a.llon]);
    const f = remPx() / 17, w = Math.min(12 * remPx(), a.name.length * 7.6 * f + 18), h = 22 * f, r = [p.x - w / 2, p.y - h / 2, w, h];
    if (placed.some(q => r[0] < q[0] + q[2] && r[0] + r[2] > q[0] && r[1] < q[1] + q[3] && r[1] + r[3] > q[1])) continue;
    placed.push(r);
    L.marker([a.llat, a.llon], {interactive: false, keyboard: false, icon: L.divIcon({className: 'alabel', iconSize: null,
      html: `<span style="border-left-color:${GDEF[a.gk].c}">${esc(a.name)}</span>`})}).addTo(labelLayer);
  }
}

/* ===================== seleção / painel inferior ===================== */
let sel = null;            // local selecionado
let radius = store.get('radius', 1000);
const PIN = c => `<svg viewBox="0 0 32 42"><path d="M16 1C8 1 2 7 2 15c0 10 14 26 14 26s14-16 14-26C30 7 24 1 16 1z" fill="${c}" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="15" r="5.5" fill="#fff"/></svg>`;

function selectPoint(lat, lon, o) {
  o = o || {};
  const x = lon * KX, y = lat * KY;
  const as = assess(x, y, Math.max(3000, radius));
  const reach = o.reach || 0;
  const k = o.imprecise ? 'IM' : classify(as, reach);
  sel = Object.assign({lat, lon, x, y, as, k, reach}, o);
  if (o.kind !== 'gps') clearRoutes();
  if (!sel.title) {
    const ns = nearestStreet(x, y);
    sel.title = o.kind === 'gps' ? 'Sua localização' : (as.inArmed[0] ? as.inArmed[0].name : (ns ? RU.D.streets[RU.SI[ns.r]] : 'Ponto no mapa'));
    sel.sub = ns ? (o.kind === 'gps' || as.inArmed[0] ? 'Perto de ' + ns.txt : `${RU.D.bairros[RU.BI[ns.r]]} · ${RU.D.cities[RU.CI[ns.r]]} · ponto tocado`) : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  drawSel();
  renderSheet();
  refreshLabels();
  if (o.fly) {
    const z = Math.max(map.getZoom(), radius > 1500 ? 14 : 15);
    flyToVisible(lat, lon, Math.min(16, z));
  }
}
function flyToVisible(lat, lon, z) {
  // centraliza o ponto na parte do mapa que fica acima do painel
  const sh = $('sheet'); const off = sh.hidden ? 0 : sh.getBoundingClientRect().height / 2;
  const p = map.project([lat, lon], z).add([0, off - 30]);
  map.flyTo(map.unproject(p, z), z, {duration: 0.6});
}
function drawSel() {
  selLayer.clearLayers();
  if (!sel) return;
  const col = cssVar('--s-' + sel.k);
  L.circle([sel.lat, sel.lon], {radius, renderer: canvasR, color: '#0ea5e9', weight: 2, dashArray: '6 6', fillOpacity: 0.04, interactive: false}).addTo(selLayer);
  if (sel.reach > 0) L.circle([sel.lat, sel.lon], {radius: sel.reach, renderer: canvasR, color: '#111', weight: 1.2, dashArray: '2 5', fill: false, interactive: false}).addTo(selLayer);
  if (sel.kind !== 'gps') L.marker([sel.lat, sel.lon], {interactive: false, keyboard: false, icon: L.divIcon({className: 'pinm', iconSize: null, html: PIN(col)})}).addTo(selLayer);
}
function highlight(a) {
  const hl = L.polygon(a.LL, {renderer: canvasR, color: '#fff', weight: 5, opacity: 1, fill: false, interactive: false}).addTo(selLayer);
  const hl2 = L.polygon(a.LL, {renderer: canvasR, color: GDEF[a.gk].c, weight: 3, opacity: 1, fillOpacity: 0.45, fillColor: GDEF[a.gk].c, interactive: false}).addTo(selLayer);
  setTimeout(() => { selLayer.removeLayer(hl); selLayer.removeLayer(hl2); }, 4000);
}
function renderSheet() {
  if (!sel) return;
  const s = sel, inR = s.as.near.filter(n => n.d <= radius);
  const armedIn = inR.filter(n => n.a.armed);
  const cnt = {}; for (const n of armedIn) cnt[n.a.gk] = (cnt[n.a.gk] || 0) + 1;
  const summ = armedIn.length ? `<b>${armedIn.length}</b> área${armedIn.length > 1 ? 's' : ''} de facção/milícia em ${fmtD(radius)}: ` +
    Object.entries(cnt).sort((p, q) => q[1] - p[1]).map(([g, c]) => `${c} ${GDEF[g].s}`).join(' · ') : `Nenhuma área de facção/milícia em ${fmtD(radius)}.`;
  const rows = inR.slice(0, 60).map(n => {
    const dir = n.d === 0 ? '' : cardinal(bearing(n.x - s.x, n.y - s.y));
    return `<button class="row" data-a="${n.a.i}"><span class="sq" style="background:${GDEF[n.a.gk].c}"></span><div class="m"><div class="t">${esc(n.a.name)}</div><div class="s">${esc(GDEF[n.a.gk].n)}${n.a.bairro ? ' · ' + esc(n.a.bairro) : ''}</div></div><div class="r">${n.d === 0 ? (s.kind === 'gps' ? '<b>você está dentro</b>' : '<b>dentro</b>') : fmtD(n.d)}${dir ? `<small>${dir}</small>` : ''}</div></button>`;
  }).join('');
  const rch = [500, 1000, 2000, 3000].map(r => `<button class="rb${r === radius ? ' on' : ''}" data-rad="${r}">${fmtD(r)}</button>`).join('');
  const dest = `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`;
  let note = '';
  if (s.kind === 'rua') note = s.imprecise ? 'Posição aproximada (centro da região do CEP, erro típico de 0,5–2 km).' :
    `Posição da rua = média dos endereços do CEP (IBGE 2022)${s.ra > 0 ? `; os endereços se espalham por ±${fmtD(s.ra * 10)} (círculo pontilhado)` : ''}. Para um número exato, busque o endereço completo (ex.: “rua x, 120”).`;
  if (s.kind === 'gps' && s.acc) note = `Precisão do GPS: ±${fmtD(s.acc)}.`;
  $('sbody').innerHTML = `<div class="sh-t">${esc(s.title)}</div><div class="sh-s">${esc(s.sub || '')}</div>
    <div class="stat" style="background:var(--s-${s.k})"><div class="k">${ST[s.k].ic} ${ST[s.k].t}</div><div class="d">${statusLine(s.k, s.as, s.reach)}</div></div>
    <div class="radius"><span class="l">Favelas próximas</span>${rch}</div>
    <div class="summ">${summ}</div>
    ${rows || '<div class="empty">Nenhuma comunidade mapeada nesse raio.</div>'}
    <div class="acts">${s.kind !== 'gps' ? '<button class="btn p wide" id="rsafe">🛡️ Ver rota segura até aqui</button>' : ''}
    <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener">Google Maps</a>
    <a class="btn" href="https://waze.com/ul?ll=${dest}&navigate=yes" target="_blank" rel="noopener">Waze</a>
    <button class="btn" id="shr">Compartilhar</button><button class="btn" id="cpy">Copiar</button></div>
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    <div class="note">Mapa colaborativo, não oficial. As divisas são aproximadas e mudam; na dúvida, confirme com quem conhece o local.</div>`;
  openSheet();
}
function openSheet() { const sh = $('sheet'); sh.hidden = false; $('fabs').style.bottom = `calc(${sh.classList.contains('full') ? 88 : 48} * var(--vh) + .8rem)`; }
function closeSheet() { $('sheet').hidden = true; $('sheet').classList.remove('full'); $('fabs').style.bottom = ''; sel = null; selLayer.clearLayers(); clearRoutes(); }
$('sclose').onclick = closeSheet;
$('handle').onclick = () => { $('sheet').classList.toggle('full'); openSheet(); };
$('sbody').addEventListener('click', async e => {
  const rb = e.target.closest('[data-rad]');
  if (rb) { radius = +rb.dataset.rad; store.set('radius', radius); if (sel) { sel.as = assess(sel.x, sel.y, Math.max(3000, radius)); drawSel(); renderSheet(); const c = L.latLng(sel.lat, sel.lon).toBounds(radius * 2.2); map.flyToBounds(c, {paddingBottomRight: [0, $('sheet').getBoundingClientRect().height], duration: 0.5}); } return; }
  const ra = e.target.closest('[data-a]');
  if (ra) { const a = AR[+ra.dataset.a]; highlight(a); map.flyToBounds(a.layer.getBounds().pad(0.6), {paddingBottomRight: [0, $('sheet').getBoundingClientRect().height], maxZoom: 17, duration: 0.6}); if (gps.follow) setFollow(false); return; }
  if (e.target.closest('#rsafe')) { planRoute(); return; }
  const rc = e.target.closest('[data-ri]');
  if (rc) { routeSel = +rc.dataset.ri; drawRoutes(true); renderRouteSheet(); return; }
  if (e.target.closest('#rback')) { clearRoutes(); renderSheet(); return; }
  if (e.target.id === 'shr' && sel) {
    const url = location.origin + location.pathname + `?ll=${sel.lat.toFixed(6)},${sel.lon.toFixed(6)}&t=${encodeURIComponent(sel.title || '')}`;
    const text = `${sel.title}: ${ST[sel.k].ic} ${ST[sel.k].t}`;
    if (navigator.share) { try { await navigator.share({title: 'Mapa de Risco RJ', text, url}); } catch (err) {} }
    else { try { await navigator.clipboard.writeText(text + '\n' + url); toast('Link copiado'); } catch (err) { toast('Não foi possível copiar'); } }
    return;
  }
  if (e.target.id === 'cpy' && sel) {
    const txt = `${sel.title}${sel.sub ? ' — ' + sel.sub : ''}\n${ST[sel.k].ic} ${ST[sel.k].t}: ${plain(statusLine(sel.k, sel.as, sel.reach))}\n` +
      `Favelas em ${fmtD(radius)}: ` + (sel.as.near.filter(n => n.d <= radius && n.a.armed).slice(0, 8).map(n => `${n.a.name} (${GDEF[n.a.gk].s}, ${n.d ? fmtD(n.d) : 'dentro'})`).join('; ') || 'nenhuma') +
      `\nhttps://www.google.com/maps?q=${sel.lat.toFixed(6)},${sel.lon.toFixed(6)}`;
    try { await navigator.clipboard.writeText(txt); toast('Copiado'); } catch (err) { toast('Não foi possível copiar'); }
  }
});

/* ===================== busca ===================== */
let lastQ = '', tmr = 0, ctrl = null, curItems = [];
function parseQuery(q) {
  const toks = norm(q).split(' ').filter(Boolean).map(t => ABBR[t] || t);
  const type = [], req = [], core = [];
  for (const t of toks) { if (TYPES.has(t)) type.push(t); else { core.push(t); if (!STOP.has(t)) req.push(t); } }
  if (!req.length && type.length) req.push(...type.splice(0));
  return {toks, type, req, core: core.join(' ')};
}
function parseCoords(q) {
  let m = q.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/) || q.match(/(-?\d{1,2},\d+)[\s;]+(-?\d{1,3},\d+)/);
  if (!m) return null;
  let la = parseFloat(m[1].replace(',', '.')), lo = parseFloat(m[2].replace(',', '.'));
  if (la > 0 && lo > 0) { la = -la; lo = -lo; }
  if (la < -24 || la > -20.5 || lo < -45.5 || lo > -40.5) return null;
  return {la, lo};
}
function searchAreas(P, lim) {
  const out = []; if (!P.req.length) return out;
  const R = P.req.map(alts);
  for (const a of AR) {
    let inName = 0, ok = true;
    for (const al of R) { if (hasW(a.nn, al)) inName++; else if (!hasW(a.loc, al)) { ok = false; break; } }
    if (!ok || !inName) continue;
    out.push([inName * 10 + (inName === R.length ? 25 : 0) - a.nn.length * 0.05, a]);
  }
  return out.sort((p, q) => q[0] - p[0]).slice(0, lim).map(x => x[1]);
}
function searchStreets(P, lim) {
  const U = RU, out = []; if (!U || !P.req.length) return out;
  const R = P.req.map(alts), T = P.type;
  for (let g = 0; g < U.GR.length; g++) {
    const G = U.GR[g], hs = U.NS[G.st];
    let sh = 0, lh = 0, ok = true; const mt = [];
    for (let k = 0; k < R.length; k++) {
      const al = R[k];
      if (hasW(hs, al)) { sh++; mt.push(P.req[k]); }
      else if (hasW(U.NB[G.nb], al) || hasW(U.NC[G.ci], al)) lh++;
      else { ok = false; break; }
    }
    if (!ok || !sh) continue;
    const core = U.NSC[G.st];
    let sc = sh * 10 + lh * 6;
    if (sh === R.length) sc += 20;
    if (R[0].some(a => U.NSCK[G.st].startsWith(a))) sc += 15;
    if (core === P.core) sc += 40; else if (U.NSCK[G.st] === mt.join(' ')) sc += 30;
    if (T.length) sc += T.some(t => hs.startsWith(' ' + t)) ? 15 : -14;
    if (U.BIG[g]) sc -= 25;
    sc -= hs.length * 0.04;
    out.push([sc, g]);
  }
  return out.sort((p, q) => q[0] - p[0]).slice(0, lim).map(x => x[1]);
}
function searchCep(digits) {
  const U = RU; if (!U) return [];
  const len = digits.length, mul = 10 ** (8 - len), lo = (+digits) * mul, hi = lo + mul - 1;
  let a = 0, b = U.N;
  while (a < b) { const m = (a + b) >> 1; if (U.CEP[m] < lo) a = m + 1; else b = m; }
  const rows = []; for (let i = a; i < U.N && U.CEP[i] <= hi && rows.length < 25; i++) rows.push(i);
  return rows;
}
async function photon(q, signal) {
  const c = map.getCenter();
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&bbox=-44.95,-23.40,-40.90,-20.70`;
  const r = await fetch(url, {signal}); if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const seen = new Set();
  return j.features.filter(f => !f.properties.state || /rio de janeiro/i.test(f.properties.state)).map(f => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    const street = p.street ? p.street + (p.housenumber ? ', ' + p.housenumber : '') : '';
    let title = p.name && p.name !== p.street ? p.name : (street || p.name || '');
    if (!title) title = [p.district, p.city].filter(Boolean).join(', ');
    const sub = [p.name && p.name !== p.street ? street : '', p.district || p.locality, p.city || p.county].filter(Boolean).join(' · ');
    return {type: 'osm', lat, lon, title, sub, exact: !!p.housenumber};
  }).filter(o => { const k = o.title + '|' + o.sub; if (seen.has(k)) return false; seen.add(k); return true; });
}
function bestRow(G, r) { const U = RU; if (r != null) return r; return G.rows.find(x => U.Q[x] === 0) ?? G.rows.find(x => U.Q[x] === 3) ?? G.rows[0]; }
function ritem(o, i) {
  let k, t, s;
  if (o.type === 'area') { k = `<span class="k" style="background:${GDEF[o.a.gk].c};color:#fff;font-size:10px;font-weight:800">${esc(GDEF[o.a.gk].s.slice(0, 3))}</span>`; t = o.a.name; s = `Comunidade · ${GDEF[o.a.gk].n}${o.a.bairro ? ' · ' + o.a.bairro : ''}${o.a.city ? ' · ' + o.a.city : ''}`; }
  else if (o.type === 'rua') { const U = RU, G = U.GR[o.g]; k = '<span class="k">🛣️</span>'; t = U.D.streets[G.st]; s = `${U.D.bairros[G.nb]} · ${U.D.cities[G.ci]} · ` + (o.r != null ? 'CEP ' + fmtCep(U.CEP[o.r]) : (G.rows.length > 1 ? G.rows.length + ' CEPs' : 'CEP ' + fmtCep(U.CEP[G.rows[0]]))); }
  else if (o.type === 'osm') { k = `<span class="k">${o.exact ? '🏠' : '📍'}</span>`; t = o.title; s = o.sub; }
  else if (o.type === 'pt') { k = '<span class="k">🎯</span>'; t = `Coordenada ${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}`; s = 'Ponto informado'; }
  let kk = null;
  try {
    if (o.type === 'area') kk = o.a.armed ? 'IN' : 'NE';
    else if (o.type === 'rua') { const r = bestRow(RU.GR[o.g], o.r), rl = rowLoc(r); kk = quickK(rl.lat, rl.lon, rl.reach, rl.imprecise); }
    else if (o.type === 'osm' || o.type === 'pt') kk = quickK(o.lat, o.lon, 0, false);
  } catch (e) {}
  return `<button class="ritem" data-i="${i}">${k}<div class="m"><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div>${kk ? chipH(kk) : ''}</button>`;
}
function renderResults(local, osm, osmState) {
  const box = $('results'); curItems = [];
  let h = '';
  const add = (title, arr) => { if (!arr.length) return; h += `<div class="rsec">${title}</div>`; for (const o of arr) { h += ritem(o, curItems.length); curItems.push(o); } };
  add('Comunidades', local.areas);
  add('Endereços', osm);
  add('Ruas e CEPs (base offline)', local.ruas);
  if (local.pts) add('Coordenada', local.pts);
  if (osmState === 'loading') h += '<div class="rmsg">Buscando endereços…</div>';
  if (osmState === 'error' && !curItems.length) h += '<div class="rmsg">Sem internet para buscar endereços. A busca de ruas, CEPs e comunidades funciona offline.</div>';
  if (!RU) h += '<div class="rmsg">Carregando base de ruas e CEPs…</div>';
  if (!h) h = '<div class="rmsg">Nada encontrado. Tente o nome principal da rua, o CEP ou o bairro.</div>';
  box.innerHTML = h; box.hidden = false;
}
function localSearch(q) {
  const res = {areas: [], ruas: [], pts: null};
  const pc = parseCoords(q);
  if (pc) { res.pts = [{type: 'pt', lat: pc.la, lon: pc.lo}]; return res; }
  const digits = q.replace(/\D/g, '');
  if (/^[\d\s.\-]+$/.test(q) && digits.length >= 5 && digits.length <= 8) {
    res.ruas = searchCep(digits).map(r => ({type: 'rua', g: RU.GKEY.get(RU.SI[r] * 1e9 + RU.BI[r] * 1e4 + RU.CI[r]), r}));
    res.cep = true; return res;
  }
  const P = parseQuery(q);
  res.areas = searchAreas(P, 6).map(a => ({type: 'area', a}));
  res.ruas = searchStreets(P, 15).map(g => ({type: 'rua', g}));
  if (!res.ruas.length && P.req.some(t => /^\d+$/.test(t) && +t > 20)) {
    // endereço com número: procura só a rua
    const P2 = Object.assign({}, P, {req: P.req.filter(t => !(/^\d+$/.test(t) && +t > 20))});
    P2.core = P2.req.join(' ');
    if (P2.req.length) res.ruas = searchStreets(P2, 10).map(g => ({type: 'rua', g}));
  }
  return res;
}
function doSearch(force) {
  const q = $('q').value.trim();
  $('clr').hidden = !q;
  if (!force && q === lastQ) return; lastQ = q;
  if (ctrl) { ctrl.abort(); ctrl = null; }
  if (q.length < 2) { showRecents(); return; }
  const local = localSearch(q);
  const wantOsm = !local.pts && !local.cep && q.length >= 3 && navigator.onLine !== false;
  renderResults(local, [], wantOsm ? 'loading' : null);
  if (!wantOsm) return;
  const c = new AbortController(); ctrl = c;
  photon(q, c.signal).then(osm => { if (ctrl === c) renderResults(local, osm, null); })
    .catch(err => { if (ctrl === c && err.name !== 'AbortError') renderResults(local, [], 'error'); });
}
function showRecents() {
  const rec = store.get('recentes', []);
  if (!rec.length) { $('results').hidden = true; curItems = []; return; }
  curItems = []; let h = '<div class="rsec">Recentes</div>';
  for (const o of rec) { let kk = null; try { kk = o.kind === 'area' ? (AR[o.ai] && AR[o.ai].armed ? 'IN' : 'NE') : quickK(o.lat, o.lon, o.reach, o.imprecise); } catch (e) {}
    h += `<button class="ritem" data-i="${curItems.length}"><span class="k">🕘</span><div class="m"><div class="t">${esc(o.title)}</div><div class="s">${esc(o.sub || '')}</div></div>${kk ? chipH(kk) : ''}</button>`; curItems.push({type: 'recent', o}); }
  $('results').innerHTML = h; $('results').hidden = false;
}
function closeResults() { $('results').hidden = true; $('q').blur(); }
function pickItem(o) {
  closeResults();
  if (gps.follow) setFollow(false);
  let loc;
  if (o.type === 'recent') { loc = o.o; }
  else if (o.type === 'area') {
    const a = o.a;
    loc = {lat: a.llat, lon: a.llon, title: a.name, sub: `Comunidade · ${GDEF[a.gk].n}${a.bairro ? ' · ' + a.bairro : ''}${a.city ? ' · ' + a.city : ''}`, kind: 'area', ai: a.i};
  } else if (o.type === 'rua') {
    const U = RU, G = U.GR[o.g];
    // escolhe o trecho (CEP) informado ou o mais preciso
    const r = bestRow(G, o.r);
    const rl = rowLoc(r);
    loc = {lat: rl.lat, lon: rl.lon, reach: rl.reach, imprecise: rl.imprecise, ra: rl.ra, kind: 'rua', title: U.D.streets[G.st],
      sub: `${U.D.bairros[G.nb]} · ${U.D.cities[G.ci]} · CEP ${fmtCep(U.CEP[r])}`};
  } else if (o.type === 'osm') loc = {lat: o.lat, lon: o.lon, title: o.title, sub: o.sub, kind: 'osm'};
  else if (o.type === 'pt') loc = {lat: o.lat, lon: o.lon, title: `Coordenada ${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}`, kind: 'pt'};
  const rec = store.get('recentes', []).filter(x => !(x.title === loc.title && x.sub === loc.sub));
  rec.unshift(loc); store.set('recentes', rec.slice(0, 10));
  selectPoint(loc.lat, loc.lon, Object.assign({}, loc, {fly: true}));
  if (loc.kind === 'area') setTimeout(() => highlight(AR[loc.ai]), 700);
}
$('q').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(doSearch, 300); });
$('q').addEventListener('focus', () => { if (!$('q').value.trim()) showRecents(); else doSearch(true); });
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(tmr); doSearch(); if (curItems.length) pickItem(curItems[0]); } if (e.key === 'Escape') closeResults(); });
$('clr').onclick = () => { $('q').value = ''; lastQ = ''; $('clr').hidden = true; showRecents(); $('q').focus(); };
$('results').addEventListener('click', e => { const b = e.target.closest('.ritem'); if (b) pickItem(curItems[+b.dataset.i]); });

/* ===================== GPS / navegação ===================== */
const gps = {on: false, follow: false, watch: null, pos: null, heading: null, level: 0, lastAlert: 0, wake: null, firstFix: false, marker: null, acc: null};
const opts = {sound: store.get('sound', true), vib: store.get('vib', true), wake: store.get('wake', true)};
let actx = null;
function beep(n) {
  if (!opts.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.28;
      o.frequency.value = n > 1 ? 880 : 660; o.type = 'square';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.22);
    }
  } catch (e) {}
}
async function keepAwake() {
  if (!opts.wake || !gps.on || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { gps.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
function setFollow(f) {
  gps.follow = f; const b = $('gps');
  b.classList.toggle('follow', f); b.classList.toggle('on', gps.on && !f);
  if (f && gps.pos) map.setView([gps.pos.lat, gps.pos.lon], Math.max(map.getZoom(), 15), {animate: true});
}
function startGps() {
  if (!('geolocation' in navigator)) { toast('Este aparelho não tem GPS disponível no navegador.'); return; }
  gps.on = true; gps.firstFix = true; setFollow(true);
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) {}
  keepAwake();
  toast('Buscando sua localização…', 1800);
  gps.watch = navigator.geolocation.watchPosition(onPos, onPosErr, {enableHighAccuracy: true, maximumAge: 2000, timeout: 20000});
}
function stopGps() {
  if (gps.watch != null) navigator.geolocation.clearWatch(gps.watch);
  gps.on = false; gps.watch = null; gps.pos = null; gps.level = 0; setFollow(false); $('gps').classList.remove('on');
  meLayer.clearLayers(); gps.marker = null; gps.acc = null; gps.line = null; $('gbanner').hidden = true;
  if (gps.wake) { try { gps.wake.release(); } catch (e) {} gps.wake = null; }
}
$('gps').onclick = () => { if (!gps.on) startGps(); else if (!gps.follow) setFollow(true); else stopGps(); };
function onPosErr(err) {
  if (err.code === 1) { toast('Permissão de localização negada. No iPhone: Ajustes › Privacidade › Serviços de Localização › Safari.', 5000); stopGps(); }
  else toast('Sem sinal de GPS no momento…');
}
const ARROW = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 5 20l7-4 7 4z"/></svg>';
function onPos(p) {
  const lat = p.coords.latitude, lon = p.coords.longitude, acc = p.coords.accuracy;
  const sp = p.coords.speed, hd = p.coords.heading;
  if (hd != null && !isNaN(hd) && (sp == null || sp > 1)) gps.heading = hd;
  gps.pos = {lat, lon, acc};
  const x = lon * KX, y = lat * KY;
  // marcador
  const hdHtml = gps.heading != null ? `<svg class="hd" viewBox="0 0 44 44" style="transform:rotate(${gps.heading}deg)"><path d="M22 2 30 16H14z" fill="#1d9bf0" opacity=".9"/></svg>` : '';
  const icon = L.divIcon({className: 'me', iconSize: null, html: hdHtml + '<div class="dot"></div>'});
  if (!gps.marker) { gps.acc = L.circle([lat, lon], {radius: acc, renderer: canvasR, color: '#1d9bf0', weight: 1, fillOpacity: 0.08, interactive: false}).addTo(meLayer); gps.marker = L.marker([lat, lon], {icon, interactive: false, keyboard: false}).addTo(meLayer); }
  else { gps.acc.setLatLng([lat, lon]).setRadius(acc); gps.marker.setLatLng([lat, lon]).setIcon(icon); }
  if (gps.follow) { if (gps.firstFix) map.setView([lat, lon], Math.max(map.getZoom(), 15)); else map.panTo([lat, lon], {animate: true, duration: 0.5}); }
  gps.firstFix = false;
  // situação
  const as = assess(x, y, 3000), k = classify(as, 0), na = as.nearArmed;
  const d = as.inArmed.length ? 0 : (na ? na.d : Infinity);
  // níveis com histerese: 3 dentro, 2 ≤150 m, 1 ≤400 m
  let lvl = as.inArmed.length ? 3 : d <= 150 ? 2 : d <= 400 ? 1 : 0;
  if (lvl < gps.level) { const thr = [Infinity, 440, 190, 0][gps.level]; if (gps.level === 3 ? false : d <= thr) lvl = gps.level; if (gps.level === 3 && d < 25) lvl = 3; }
  if (lvl > gps.level && lvl >= 1) alertUser(lvl);
  gps.level = lvl;
  renderBanner(k, as, x, y, acc);
  if (!as.inArmed.length && na && na.d <= 2000) {
    const ll = [[lat, lon], [na.y / KY, na.x / KX]], col = cssVar('--s-' + k);
    if (!gps.line) gps.line = L.polyline(ll, {renderer: canvasR, color: col, weight: 3, dashArray: '6 6', opacity: 0.9, interactive: false}).addTo(meLayer);
    else gps.line.setLatLngs(ll).setStyle({color: col});
  } else if (gps.line) { meLayer.removeLayer(gps.line); gps.line = null; }
  if (sel && sel.kind === 'gps' && !$('sheet').hidden) { const st = $('sbody').scrollTop; selectPoint(lat, lon, {kind: 'gps', acc}); $('sbody').scrollTop = st; }
}
function alertUser(lvl) {
  const now = Date.now(); if (now - gps.lastAlert < 8000 && lvl < 3) return; gps.lastAlert = now;
  beep(lvl >= 3 ? 3 : lvl === 2 ? 2 : 1);
  if (opts.vib && navigator.vibrate) navigator.vibrate(lvl >= 3 ? [300, 120, 300, 120, 300] : lvl === 2 ? [250, 120, 250] : [200]);
  const b = $('gbanner'); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
}
function renderBanner(k, as, x, y, acc) {
  const b = $('gbanner'), na = as.nearArmed;
  let t, s, rot = null;
  if (k === 'IN') { const a = as.inArmed[0]; t = `Você está DENTRO de ${a.name}`; s = `${GDEF[a.gk].n}${as.inArmed.length > 1 ? ' + ' + (as.inArmed.length - 1) + ' área(s)' : ''}`; }
  else if (na) {
    const brg = bearing(na.x - x, na.y - y);
    rot = gps.heading != null ? (brg - gps.heading + 360) % 360 : brg;
    const rel = gps.heading != null ? ['à frente', 'à frente-direita', 'à direita', 'atrás-direita', 'atrás', 'atrás-esquerda', 'à esquerda', 'à frente-esquerda'][Math.round(rot / 45) % 8] : cardinalW(brg);
    t = `${na.a.name} a ${fmtD(na.d)}`;
    s = `${GDEF[na.a.gk].s} · ${rel}` + (k === 'NE' ? ' · você está em comunidade neutra' : k === 'FO' ? ' · nenhuma área a menos de 600 m' : '');
  } else { t = 'Nenhuma área mapeada por perto'; s = ''; }
  if (acc > 150) s += ` · GPS impreciso (±${fmtD(acc)})`;
  b.style.background = `var(--s-${k})`;
  b.innerHTML = `<span class="ar">${k === 'IN' ? '<b style="font-size:20px">⛔</b>' : `<span style="display:flex;transform:rotate(${rot || 0}deg)">${ARROW}</span>`}</span><div class="m"><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div>`;
  b.hidden = !$('results').hidden;
}
$('gbanner').onclick = () => { if (gps.pos) { selectPoint(gps.pos.lat, gps.pos.lon, {kind: 'gps', acc: gps.pos.acc}); } };
$('q').addEventListener('focus', () => { $('gbanner').hidden = true; });
$('q').addEventListener('blur', () => setTimeout(() => { window.scrollTo(0, 0); document.body.scrollTop = 0; syncViewport(); if (gps.on && $('results').hidden) $('gbanner').hidden = false; }, 120));

/* ===================== painel de opções ===================== */
function buildPanel() {
  $('bases').innerHTML = Object.entries(BASES).map(([k, b]) => `<button data-k="${k}" class="${k === baseKey ? 'on' : ''}">${b.n}</button>`).join('');
  $('bases').onclick = e => { const b = e.target.closest('button'); if (b) setBase(b.dataset.k); };
  const ts = store.get('tsize', 1);
  $('tsize').innerHTML = ['Normal', 'Grande', 'Extra'].map((n, i) => `<button data-t="${i + 1}" class="${ts === i + 1 ? 'on' : ''}">${n}</button>`).join('');
  $('tsize').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; const n = +b.dataset.t;
    store.set('tsize', n); applyTextSize(n);
    $('tsize').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    refreshLabels(); if (!$('sheet').hidden) openSheet();
  };
  const cnt = {}; for (const a of AR) cnt[a.gk] = (cnt[a.gk] || 0) + 1;
  $('legend').innerHTML = META.groups.map(g => `<button class="lg${hidden.has(g) ? ' off' : ''}" data-g="${g}"><i style="background:${GDEF[g].c}"></i>${esc(GDEF[g].n)} <span style="color:var(--mu)">${cnt[g] || 0}</span></button>`).join('');
  $('legend').onclick = e => {
    const b = e.target.closest('.lg'); if (!b) return; const g = b.dataset.g;
    if (hidden.has(g)) { hidden.delete(g); polys[g].addTo(map); } else { hidden.add(g); map.removeLayer(polys[g]); }
    b.classList.toggle('off'); store.set('hidden', [...hidden]); refreshLabels();
  };
  for (const k of ['sound', 'vib', 'wake']) { const el = $('o-' + k); el.checked = opts[k]; el.onchange = () => { opts[k] = el.checked; store.set(k, el.checked); if (k === 'wake') keepAwake(); if (k === 'sound' && el.checked) beep(1); }; }
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  $('about').innerHTML = `
  <p><b>Como usar:</b> busque um endereço, rua, CEP ou comunidade, ou toque em qualquer ponto do mapa. O painel mostra se o local está dentro/perto de uma área e lista as favelas no raio escolhido. Com o botão de GPS (◎) o mapa acompanha você e avisa ao chegar perto de uma área (toque de novo para soltar/desligar).</p>
  <p><b>Instalar como app:</b> ${isIOS ? 'no Safari, toque em Compartilhar › “Adicionar à Tela de Início”.' : 'no menu do navegador, toque em “Instalar app” ou “Adicionar à tela inicial”.'} Os alertas só funcionam com o app aberto na tela.</p>
  <p><b>Fontes:</b> áreas do mapa colaborativo “[UTILIDADE PÚBLICA] Mapa Das Facções RJ” (Google My Maps), copiado em 11/11/2026 — não oficial, divisas aproximadas. Ruas e CEPs: <a href="https://www.cepaberto.com/" target="_blank" rel="noopener">CEP Aberto</a> (ODbL) com coordenadas do CNEFE/IBGE (Censo 2022). Busca de endereços: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>/OpenStreetMap. Mapa base: © OpenStreetMap; satélite © Esri.</p>
  <p><b>Níveis:</b> Dentro = ponto dentro de área marcada · Muito perto = até 150 m · Próximo = até 600 m · Fora = nada a menos de 600 m (não é garantia de segurança).</p>
  <p><b>Rota segura:</b> calculada pelo OSRM (OpenStreetMap). O app testa caminhos alternativos e mostra quais áreas cada um atravessa. Ao abrir no Google Maps, vão pontos intermediários para manter o trajeto escolhido.</p>`;
  $('ver').textContent = 'Versão ' + APP_VERSION;
  $('upd').onclick = () => checkUpdate(true);
  $('fix').onclick = hardRefresh;
}
$('menu').onclick = () => { $('panel').hidden = false; };
$('pclose').onclick = () => { $('panel').hidden = true; };
$('panel').onclick = e => { if (e.target.id === 'panel') $('panel').hidden = true; };

/* ===================== início ===================== */
(async function boot() {
  try {
    await loadAreas();
    initMap(); buildPanel();
    $('boot').classList.add('off');
    loadRuas().then(() => { if (!$('results').hidden && $('q').value.trim()) doSearch(true); }).catch(e => console.warn('ruas', e));
    // links do tipo ?q=... ou ?ll=lat,lon
    const u = new URLSearchParams(location.search);
    if (u.get('ll')) { const c = parseCoords(u.get('ll')); if (c) selectPoint(c.la, c.lo, Object.assign({fly: true, kind: 'pt'}, u.get('t') ? {title: u.get('t'), sub: 'Local compartilhado'} : {})); }
    if (u.has('r')) history.replaceState(null, '', location.pathname);
  } catch (e) {
    $('boot').innerHTML = '<div style="padding:20px;text-align:center">Não foi possível carregar os dados.<br>' + esc(e.message) + '</div>';
  }
  initUpdates();
})();

/* ===================== rota segura ===================== */
const ROUTERS = ['https://routing.openstreetmap.de/routed-car/route/v1/driving/', 'https://router.project-osrm.org/route/v1/driving/'];
let routeLayer = null, routes = [], routeSel = 0, routeDest = null, GRID = null;
const GC = 1000;
function buildGrid() {
  GRID = new Map();
  for (const a of AR) {
    if (!a.armed) continue;
    const x0 = Math.floor((a.minx - 120) / GC), x1 = Math.floor((a.maxx + 120) / GC), y0 = Math.floor((a.miny - 120) / GC), y1 = Math.floor((a.maxy + 120) / GC);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i + ',' + j; let l = GRID.get(k); if (!l) GRID.set(k, l = []); l.push(a); }
  }
}
const gridAt = (x, y) => GRID.get(Math.floor(x / GC) + ',' + Math.floor(y / GC)) || [];
async function osrm(pts, alts) {
  const path = pts.map(c => c[1].toFixed(6) + ',' + c[0].toFixed(6)).join(';');
  const q = '?overview=full&geometries=geojson' + (alts ? '&alternatives=3' : '');
  let err = null;
  for (const base of ROUTERS) {
    try { const r = await fetch(base + path + q); const j = await r.json(); if (j.code === 'Ok' && j.routes && j.routes.length) return j.routes; err = new Error(j.code || 'erro'); }
    catch (e) { err = e; }
  }
  throw err;
}
/* percorre a rota a cada ~20 m e anota as áreas atravessadas e as que ficam a menos de 100 m */
function evalRoute(rt) {
  const C = rt.geometry.coordinates, P = C.map(([lo, la]) => [lo * KX, la * KY]);
  const hits = new Map(), segs = []; let cur = null;
  for (let i = 0; i < P.length - 1; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[i + 1], L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / 20)), step = L / n;
    for (let k = 0; k < n; k++) {
      const t = k / n, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      let inside = false;
      for (const a of gridAt(x, y)) {
        if (x < a.minx - 100 || x > a.maxx + 100 || y < a.miny - 100 || y > a.maxy + 100) continue;
        let h = hits.get(a);
        if (x >= a.minx && x <= a.maxx && y >= a.miny && y <= a.maxy && inPoly(a, x, y)) {
          if (!h) hits.set(a, h = {a, inM: 0, minD: 0, pos: i}); h.inM += step; h.minD = 0; inside = true;
        } else {
          const d = closest(a, x, y).d;
          if (d <= 100) { if (!h) hits.set(a, h = {a, inM: 0, minD: d, pos: i}); else if (d < h.minD) h.minD = d; }
        }
      }
      const ll = [y / KY, x / KX];
      if (inside) { if (!cur) { cur = [ll]; segs.push(cur); } else cur.push(ll); }
      else if (cur) { cur.push(ll); cur = null; }
    }
  }
  const list = [...hits.values()].sort((p, q) => p.pos - q.pos);
  const crossed = list.filter(h => h.inM > 0), near = list.filter(h => h.inM === 0);
  return {P, crossed, near, inM: crossed.reduce((s, h) => s + h.inM, 0), segs, dist: rt.distance, dur: rt.duration, ll: C.map(([lo, la]) => [la, lo])};
}
const routeScore = r => (r.inM > 0 ? 1e9 : 0) + r.inM * 1e4 + r.near.length * 120 + r.dur;
/* pontos de desvio dos dois lados das áreas atravessadas */
function detourVias(ev) {
  const vias = [];
  for (const h of ev.crossed.slice(0, 2)) {
    const a = h.a, cx = (a.minx + a.maxx) / 2, cy = (a.miny + a.maxy) / 2, R = Math.max(a.maxx - a.minx, a.maxy - a.miny) / 2;
    const i = Math.min(h.pos, ev.P.length - 1), p1 = ev.P[Math.max(0, i - 4)], p2 = ev.P[Math.min(ev.P.length - 1, i + 4)];
    let dx = p2[0] - p1[0], dy = p2[1] - p1[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const off = R + 500;
    for (const sg of [1, -1]) vias.push([(cy + dx * off * sg) / KY, (cx - dy * off * sg) / KX]);
  }
  return vias.slice(0, 4);
}
function getOrigin() {
  if (gps.pos) return Promise.resolve([gps.pos.lat, gps.pos.lon]);
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('GPS indisponível neste aparelho.'));
    navigator.geolocation.getCurrentPosition(p => res([p.coords.latitude, p.coords.longitude]),
      e => rej(new Error(e.code === 1 ? 'Permita o acesso à localização para calcular a rota.' : 'Não consegui pegar sua localização.')),
      {enableHighAccuracy: true, timeout: 15000, maximumAge: 30000});
  });
}
async function planRoute() {
  if (!sel) return;
  routeDest = {lat: sel.lat, lon: sel.lon, title: sel.title};
  $('sbody').innerHTML = '<div class="sh-t">Rota segura</div><div class="sh-s">Pegando sua localização e calculando caminhos…</div><div style="display:flex;justify-content:center;padding:1.5rem"><div class="spin"></div></div>';
  let origin;
  try { origin = await getOrigin(); } catch (e) { toast(e.message, 4000); renderSheet(); return; }
  if (!GRID) buildGrid();
  let evs = [];
  try {
    evs = (await osrm([origin, [routeDest.lat, routeDest.lon]], true)).map(evalRoute);
    evs.sort((p, q) => routeScore(p) - routeScore(q));
    if (evs[0].inM > 0) {
      const extra = await Promise.allSettled(detourVias(evs[0]).map(v => osrm([origin, v, [routeDest.lat, routeDest.lon]], false)));
      for (const r of extra) if (r.status === 'fulfilled') evs.push(evalRoute(r.value[0]));
    }
  } catch (e) { toast('Não foi possível calcular a rota agora (sem internet ou serviço de rotas fora do ar).', 4500); renderSheet(); return; }
  const seen = new Set();
  evs = evs.filter(r => { const k = Math.round(r.dist / 150) + ':' + Math.round(r.dur / 45); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((p, q) => routeScore(p) - routeScore(q)).slice(0, 4);
  // descarta desvios absurdos (mais que 2,5x o tempo da rota mais rápida)
  const fastest = Math.min(...evs.map(r => r.dur));
  routes = evs.filter(r => r.dur <= fastest * 2.5);
  routes.origin = origin; routeSel = 0;
  if (gps.follow) setFollow(false);
  drawRoutes(true); renderRouteSheet();
}
function clearRoutes() { if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; } routes = []; }
function drawRoutes(fit) {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.layerGroup().addTo(map);
  routes.forEach((r, i) => { if (i !== routeSel) L.polyline(r.ll, {renderer: canvasR, color: '#475569', weight: 5, opacity: 0.75, interactive: false}).addTo(routeLayer); });
  const r = routes[routeSel]; if (!r) return;
  L.polyline(r.ll, {renderer: canvasR, color: '#fff', weight: 10, opacity: 0.95, interactive: false}).addTo(routeLayer);
  L.polyline(r.ll, {renderer: canvasR, color: '#0284c7', weight: 6, opacity: 1, interactive: false}).addTo(routeLayer);
  for (const sgm of r.segs) L.polyline(sgm, {renderer: canvasR, color: '#ef4444', weight: 7, opacity: 1, interactive: false}).addTo(routeLayer);
  L.circleMarker(routes.origin, {renderer: canvasR, radius: 7, color: '#fff', weight: 3, fillColor: '#0284c7', fillOpacity: 1, interactive: false}).addTo(routeLayer);
  if (fit) map.flyToBounds(L.latLngBounds(r.ll).pad(0.08), {paddingTopLeft: [20, 90], paddingBottomRight: [20, $('sheet').getBoundingClientRect().height + 20], duration: 0.6, maxZoom: 16});
}
const fmtT = s => s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : Math.floor(s / 3600) + ' h ' + String(Math.round(s % 3600 / 60)).padStart(2, '0');
function routeVerdict(r) {
  if (r.crossed.length) return `<span style="color:var(--s-IN)">⛔ Passa por ${r.crossed.length} área${r.crossed.length > 1 ? 's' : ''}</span>`;
  if (r.near.length) return `<span style="color:var(--s-MP)">⚠️ Não entra em áreas, mas passa a menos de 100 m de ${r.near.length}</span>`;
  return '<span style="color:var(--s-FO)">✓ Não passa por áreas mapeadas</span>';
}
function gmapsRouteUrl(r) {
  const o = routes.origin, d = r.ll[r.ll.length - 1], wp = [];
  let acc = 0; const total = r.P.reduce((s, p, i) => i ? s + Math.hypot(p[0] - r.P[i - 1][0], p[1] - r.P[i - 1][1]) : 0, 0);
  const marks = [0.25, 0.5, 0.75]; let mi = 0;
  for (let i = 1; i < r.P.length && mi < marks.length; i++) {
    acc += Math.hypot(r.P[i][0] - r.P[i - 1][0], r.P[i][1] - r.P[i - 1][1]);
    if (acc >= total * marks[mi]) { wp.push(r.ll[i][0].toFixed(6) + ',' + r.ll[i][1].toFixed(6)); mi++; }
  }
  return `https://www.google.com/maps/dir/?api=1&origin=${o[0].toFixed(6)},${o[1].toFixed(6)}&destination=${routeDest.lat.toFixed(6)},${routeDest.lon.toFixed(6)}&travelmode=driving&waypoints=${encodeURIComponent(wp.join('|'))}`;
}
function renderRouteSheet() {
  const r = routes[routeSel];
  const cards = routes.map((x, i) => `<button class="rcard${i === routeSel ? ' on' : ''}" data-ri="${i}"><div class="rt"><b>${fmtT(x.dur)}</b> · ${fmtD(x.dist)}${i === 0 ? ' <span class="best">mais segura</span>' : ''}</div><div class="rv">${routeVerdict(x)}</div></button>`).join('');
  const crossedH = r.crossed.length ? '<div class="sec2">Áreas atravessadas por esta rota</div>' + r.crossed.map(h => `<button class="row" data-a="${h.a.i}"><span class="sq" style="background:${GDEF[h.a.gk].c}"></span><div class="m"><div class="t">${esc(h.a.name)}</div><div class="s">${esc(GDEF[h.a.gk].n)}${h.a.bairro ? ' · ' + esc(h.a.bairro) : ''}</div></div><div class="r">${fmtD(h.inM)}<small>dentro</small></div></button>`).join('') : '';
  const nearH = r.near.length ? '<div class="sec2">Passa perto (menos de 100 m)</div>' + r.near.map(h => `<button class="row" data-a="${h.a.i}"><span class="sq" style="background:${GDEF[h.a.gk].c}"></span><div class="m"><div class="t">${esc(h.a.name)}</div><div class="s">${esc(GDEF[h.a.gk].n)}</div></div><div class="r">${fmtD(h.minD)}</div></button>`).join('') : '';
  const allBad = routes.every(x => x.crossed.length);
  $('sbody').innerHTML = `<div class="sh-t">Rotas até ${esc(routeDest.title || 'o destino')}</div><div class="sh-s">Saindo da sua localização · de carro</div>
    ${allBad ? '<div class="note" style="color:#fca5a5">Não achei caminho que evite todas as áreas. A primeira opção é a que passa menos tempo dentro delas.</div>' : ''}
    <div class="rcards">${cards}</div>${crossedH}${nearH}
    <div class="acts"><a class="btn p wide" href="${gmapsRouteUrl(r)}" target="_blank" rel="noopener">Abrir esta rota no Google Maps</a>
    <button class="btn" id="rback">‹ Voltar</button></div>
    <div class="note">Trechos em vermelho no mapa = dentro de área. O Waze não aceita pontos intermediários, por isso a rota escolhida abre no Google Maps. Rotas: OSRM/OpenStreetMap.</div>`;
  openSheet(); $('sbody').scrollTop = 0;
}

/* ===================== atualização automática ===================== */
let swReg = null, lastCheck = 0, reloading = false;
function safeReload(msg) {
  if (reloading) return;
  if (gps.on) { toast('Nova versão do app baixada. Ela entra quando você reabrir o app.', 4000); return; }
  reloading = true; toast(msg || 'Atualizando o app…', 1500);
  setTimeout(() => location.reload(), 700);
}
async function checkUpdate(manual) {
  lastCheck = Date.now();
  try {
    if (swReg) swReg.update().catch(() => {});
    const j = await (await fetch('version.json?ts=' + Date.now(), {cache: 'no-store'})).json();
    if (j.v && j.v !== APP_VERSION) {
      const last = +(sessionStorage.getItem('rrj.upd') || 0);
      if (Date.now() - last > 60000) { sessionStorage.setItem('rrj.upd', Date.now()); safeReload('Nova versão encontrada. Atualizando…'); }
      else if (manual) hardRefresh();
    } else if (manual) toast('Você já está na versão mais nova (' + APP_VERSION + ').');
  } catch (e) { if (manual) toast('Sem internet para verificar atualização.'); }
}
async function hardRefresh() {
  toast('Limpando e recarregando…', 1500);
  try {
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if (window.caches) for (const k of await caches.keys()) if (k !== 'tiles') await caches.delete(k);
  } catch (e) {}
  setTimeout(() => location.replace(location.pathname + '?r=' + Date.now()), 500);
}
async function initUpdates() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) safeReload(); });
    try { swReg = await navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}); } catch (e) {}
  }
  checkUpdate(false);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60000) checkUpdate(false); });
}
