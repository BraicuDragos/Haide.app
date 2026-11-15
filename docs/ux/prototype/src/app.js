/* ================= Haide prototype: core, data, components ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (k, p) => {
  const s = STR[k];
  if (s === undefined) { console.warn('missing string', k); return k; }
  return p ? s.replace(/\{(\w+)\}/g, (m, n) => (p[n] !== undefined ? esc(p[n]) : m)) : s;
};
const tp = (k, n, p = {}) => t(k + (n === 1 ? '.one' : '.other'), { ...p, n });
const money = n => n.toFixed(2) + ' RON';

/* ---- pricing: mirrors docs/product/pricing.md. The real app computes this server-side only. ---- */
const CONFIG = { // config v1, effective 2026-11-15
  petrol: { cons: 7.0, price: 9.81 }, diesel: { cons: 6.0, price: 10.85 }, lpg: { cons: 9.0, price: 4.76 },
  hybrid: { cons: 5.0, price: 9.81 }, electric: { cons: 17, price: 1.40 }
};
const rate = f => CONFIG[f].cons / 100 * CONFIG[f].price;
const floor10 = x => Math.floor(x * 10 + 1e-9) / 10;
const priceFor = (km, fuel, n) => floor10(km * rate(fuel) / (n + 1)); // n = passengers on the ride, this one included
const tripCost = (km, fuel) => km * rate(fuel);

/* ---- time ---- */
const NOW = 6 * 60 + 42; // Monday 16 Nov 2026, 06:42
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const hhmm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const parseT = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const dayStr = i => { const d = new Date(Date.UTC(2026, 10, 16 + i)); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const dayName = i => (i === 0 ? t('common.today') : i === 1 ? t('common.tomorrow') : dayStr(i));
const dayOption = i => (i === 0 ? `${t('common.today')}, ${dayStr(0)}` : i === 1 ? `${t('common.tomorrow')}, ${dayStr(1)}` : dayStr(i));

/* ---- data ---- */
const PLACES = [
  { id: 'p1', name: 'Str. Măgurii', area: 'Cisnădie', g: 'cis' },
  { id: 'p2', name: 'Cisnădie centru', area: 'Cisnădie', g: 'cis' },
  { id: 'p3', name: 'Shopping City', area: 'Șelimbăr', g: 'sel' },
  { id: 'p9', name: 'Calea Dumbrăvii', area: 'Sibiu', g: 'sel' },
  { id: 'p4', name: 'Piața Mare', area: 'Sibiu', g: 'centre' },
  { id: 'p5', name: 'ULBS Rectorat, Str. Cetății', area: 'Sibiu', g: 'centre' },
  { id: 'p6', name: 'Hipodrom', area: 'Sibiu', g: 'hip' },
  { id: 'p11', name: 'Ștrand', area: 'Sibiu', g: 'hip' },
  { id: 'p12', name: 'Mihai Viteazu', area: 'Sibiu', g: 'hip' },
  { id: 'p7', name: 'Zona Industrială Vest, Str. Salzburg', area: 'Sibiu', g: 'zi' },
  { id: 'p8', name: 'Aeroportul Sibiu', area: 'Sibiu', g: 'zi' },
  { id: 'p10', name: 'Turnișor', area: 'Sibiu', g: 'west' },
  { id: 'p13', name: 'Vasile Aaron', area: 'Sibiu', g: 'west' }
];
const place = id => PLACES.find(p => p.id === id);
const plabel = p => (p ? `${p.name}, ${p.area}` : '');
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const USERS = {
  radu: { name: 'Radu', rating: 4.8, n: 23, rides: 34, since: 'March 2026', late: 0, noshow: 0, bio: 'Drives Cisnădie to the centre every weekday. Quiet mornings.', ci: 0 },
  teodora: { name: 'Teodora', rating: null, n: 1, rides: 2, since: 'November 2026', late: 0, noshow: 0, bio: '', ci: 1 },
  mihai: { name: 'Mihai', rating: 4.6, n: 31, rides: 44, since: 'January 2026', late: 1, noshow: 0, bio: 'Hybrid car, music low. Happy to wait two minutes.', ci: 2 },
  andrei: { name: 'Andrei', rating: 4.9, n: 41, rides: 58, since: 'February 2026', late: 0, noshow: 0, bio: 'Engineer in Zona Industrială Vest. Same commute every day.', ci: 0 },
  ana: { name: 'Ana', rating: 4.7, n: 9, rides: 12, since: 'August 2026', late: 0, noshow: 0, bio: 'Lecturer at ULBS.', ci: 1 },
  alexandra: { name: 'Alexandra', rating: 4.9, n: 12, rides: 15, since: 'May 2026', late: 0, noshow: 0, bio: 'Works shifts at the industrial zone.', ci: 2 },
  bogdan: { name: 'Bogdan', rating: null, n: 2, rides: 2, since: 'October 2026', late: 0, noshow: 0, bio: '', ci: 0 }
};
const RIDES = {
  r1: { id: 'r1', driver: 'radu', dep: '07:25', fuel: 'petrol', total: 3, booked: 1, car: { make: 'Škoda', model: 'Octavia', colour: 'grey', plate: 'SB 24 RDU' }, phone: '0723 100 221', note: 'I wait by the pharmacy on the corner. A small bag fits in the boot.' },
  r2: { id: 'r2', driver: 'teodora', dep: '07:45', fuel: 'diesel', total: 3, booked: 0, car: { make: 'Dacia', model: 'Duster', colour: 'blue', plate: 'SB 91 TEO' }, phone: '0723 100 222', note: '' },
  r3: { id: 'r3', driver: 'mihai', dep: '07:10', fuel: 'hybrid', total: 2, booked: 1, car: { make: 'Toyota', model: 'Yaris', colour: 'white', plate: 'SB 17 MHI' }, phone: '0723 100 223', note: 'Leaving on time, I have a 08:00 start.' },
  r4: { id: 'r4', driver: 'andrei', dep: '07:30', fuel: 'diesel', total: 3, booked: 0, car: { make: 'Volkswagen', model: 'Golf', colour: 'grey', plate: 'SB 38 AND' }, phone: '0723 100 224', note: 'Meet at the bus shelter by the Shopping City entrance.' },
  r5: { id: 'r5', driver: 'ana', dep: '08:40', fuel: 'petrol', total: 3, booked: 0, car: { make: 'Opel', model: 'Corsa', colour: 'red', plate: 'SB 55 ANA' }, phone: '0723 100 225', note: '' }
};
const RES = { // search results by corridor pair: approximate labels (public) and exact points (after acceptance)
  'cis>centre': [
    { r: 'r1', pu: 'Cisnădie, Măgurii area', do: 'Piața Mare', xpu: 'Str. Măgurii 14, Cisnădie (pharmacy corner)', xdo: 'Piața Mare, by the Council House', w1: 150, w2: 100, km: 11.3 },
    { r: 'r2', pu: 'Cisnădie, centre', do: 'Piața Mare', xpu: 'Piața Mihai Viteazu 3, Cisnădie', xdo: 'Piața Mare, by the Council House', w1: 650, w2: 250, km: 10.1 },
    { r: 'r3', pu: 'Cisnădie, north side', do: 'Str. Cetății', xpu: 'Str. Cisnădioarei 2, Cisnădie', xdo: 'Str. Cetății 9, Sibiu', w1: 400, w2: 500, km: 10.6 }
  ],
  'sel>centre': [{ r: 'r1', pu: 'Șelimbăr, Shopping City area', do: 'Piața Mare', xpu: 'Șelimbăr, Shopping City, bus stop', xdo: 'Piața Mare, by the Council House', w1: 200, w2: 100, km: 5.4 }],
  'sel>zi': [{ r: 'r4', pu: 'Șelimbăr, Shopping City area', do: 'Zona Industrială Vest', xpu: 'Șelimbăr, Shopping City, main entrance', xdo: 'Str. Salzburg 8, Sibiu', w1: 100, w2: 150, km: 9.588 }],
  'hip>centre': [{ r: 'r5', pu: 'Hipodrom', do: 'Old town, Str. Cetății', xpu: 'Str. Hipodromului 4, Sibiu', xdo: 'Str. Cetății 9, Sibiu', w1: 100, w2: 200, km: 4.234 }]
};
const ROUTE_KM = { 'sel>zi': [9.588, 17], 'cis>centre': [11.514, 17], 'hip>centre': [4.234, 7], 'sel>centre': [5.39, 12] };
const CI = ['', 'c2', 'c3'];

/* ---- state ---- */
let S, SHEET = null, LASTFOCUS = null, TOASTT = null;
function freshState(persona = 'visitor') {
  const s = {
    persona, user: null, consent: false, profile: { firstName: '', phone: '', photoUrl: '', bio: '' }, vehicle: null,
    search: { from: null, to: null, day: 0, time: '07:30', win: 30 }, loading: false, notified: false,
    booking: null, driving: [], blocked: [], intent: null, f: {}, errs: {}, ridesRole: 'riding', ridesWhen: 'up',
    phase: 'before', offline: false, dayLimit: false, offer: { from: null, to: null, seats: 3, route: null, routeState: 'idle' },
    unread: 0, rated: {}, extraJoined: 0, picker: null, emailSent: '', authEmail: '', publishedId: null, dropPulse: false, nextId: 10
  };
  if (persona === 'ioana') {
    s.user = { email: 'ioana@example.com' }; s.consent = true;
    s.profile = { firstName: 'Ioana', phone: '0721 234 567', photoUrl: '', photo: true, bio: 'ULBS student. I commute from Cisnădie.' };
  }
  if (persona === 'andrei') {
    s.user = { email: 'andrei@example.com' }; s.consent = true;
    s.profile = { firstName: 'Andrei', phone: '0723 100 224', photoUrl: '', photo: true, bio: USERS.andrei.bio };
    s.vehicle = { make: 'Volkswagen', model: 'Golf', colour: 'grey', plate: 'SB 38 AND', fuel: 'diesel', seats: 3 };
    s.driving = [{
      id: 'd1', ref: 'r4', day: 0, time: '07:30', from: 'p3', to: 'p7', km: 9.588, min: 17, fuel: 'diesel', seats: 3, note: RIDES.r4.note, free: false, status: 'published',
      requests: [
        { id: 'q1', u: 'alexandra', pu: 'Șelimbăr, Shopping City area', do: 'Zona Industrială Vest', phone: '0724 300 111' },
        { id: 'q2', u: 'bogdan', pu: 'Șelimbăr, Shopping City area', do: 'Zona Industrială Vest', phone: '0724 300 112' }
      ],
      pax: []
    }];
  }
  return s;
}
const profileOk = () => !!(S.profile.firstName && S.profile.phone && (S.profile.photoUrl || S.profile.photo));
const myName = () => S.profile.firstName || 'You';

/* ---- icons: Lucide (ISC), path data vendored per icon, 24 px grid, stroke from token sizing.iconStroke (ADR 0018) ---- */
const IC = {
  back: '<path d="m15 18-6-6 6-6"/>', close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  chev: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>', search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  offer: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  rides: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  swap: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  locate: '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  camera: '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  gear: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  route: '<path d="M9 5h8.5a1 1 0 0 1 0 7h-11a1 1 0 0 0 0 7H15"/><circle cx="18" cy="19" r="3"/><circle cx="6" cy="5" r="3"/>',
  seat: '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M5 18v2"/><path d="M19 18v2"/>'
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${IC[n]}</svg>`;
const starIc = ic('star');

/* ---- small components ---- */
const avatar = (key, cls = '') => {
  const u = USERS[key] || { name: key, ci: 0 };
  const photo = key === 'me' && S.profile.photoUrl;
  const nm = key === 'me' ? myName() : u.name;
  return `<span class="avatar ${cls} ${CI[(key === 'me' ? 0 : u.ci)]}" role="img" aria-label="${t('a11y.avatar', { name: nm })}">${photo ? `<img src="${esc(S.profile.photoUrl)}" alt="">` : esc(nm[0])}</span>`;
};
const ratingHtml = u => (u.n >= 3 && u.rating
  ? `<span class="stars" aria-label="${t('card.rating', { r: u.rating.toFixed(1), n: u.n })}">${starIc}<span aria-hidden="true">${u.rating.toFixed(1)}</span></span>`
  : `<span class="stars muted">${t('common.new')}</span>`);
const stopRail = (a, b, attr = '') => `<div class="rail" ${attr}><div class="stop a"><div class="nm">${a.nm}</div>${a.sub ? `<div class="sub">${a.sub}</div>` : ''}</div><div class="stop b"><div class="nm">${b.nm}</div>${b.sub ? `<div class="sub">${b.sub}</div>` : ''}</div></div>`;
const banner = (kind, icon, html, role = '') => `<div class="banner ${kind}" ${role ? `role="${role}"` : ''}>${ic(icon)}<div>${html}</div></div>`;
const errMsg = (id) => (S.errs[id] ? `<p class="err" id="${id}-err">${ic('alert')}<span>${S.errs[id]}</span></p>` : '');
const fv = (k, d = '') => (S.f[k] !== undefined ? S.f[k] : d);
function field({ id, label, hint, type = 'text', value = '', attrs = '', tag = 'input', opt = false }) {
  const e = S.errs[id];
  const desc = [hint ? id + '-hint' : '', e ? id + '-err' : ''].filter(Boolean).join(' ');
  const lab = `<label for="${id}">${label}${opt ? ` <span class="muted" style="font-weight:400">(${t('common.optional')})</span>` : ''}</label>`;
  const ctl = tag === 'textarea'
    ? `<textarea class="input" id="${id}" name="${id}" ${attrs} ${e ? 'aria-invalid="true"' : ''} ${desc ? `aria-describedby="${desc}"` : ''}>${esc(value)}</textarea>`
    : `<input class="input" id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${attrs} ${e ? 'aria-invalid="true"' : ''} ${desc ? `aria-describedby="${desc}"` : ''}>`;
  return `<div class="field">${lab}${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}${ctl}${errMsg(id)}</div>`;
}
const appbar = (title, { back = true, right = '', fallback = '#/find' } = {}) =>
  `<header class="appbar">${back ? `<button class="icon-btn" data-act="back" data-arg="${fallback}" aria-label="${t('common.back')}">${ic('back')}</button>` : '<span class="spacer"></span>'}<h1 id="h1" tabindex="-1">${title}</h1>${right}</header>`;

/* ---- map: the night map is a stylised drawing (no tiles, works offline). The route is an overlay: SVG strokes (aura, halo, core, spark)
        plus HTML elements for the travelling light, exactly the contract in docs/brand/design-direction.md section 6. ---- */
const GEO = { // route per corridor in a 360 x 240 box: path, pickup a, drop-off b, where you start, where you go, label spots
  'cis>centre': { d: 'M44 196C96 192 120 150 160 124S244 84 310 48', a: [44, 196], b: [310, 48], you: [20, 218], dest: [338, 26], la: [58, 220, 'start'], lb: [296, 28, 'end'], ly: [10, 236, 'start'], chip: 'top' },
  'sel>centre': { d: 'M52 150C100 156 150 120 196 104S270 70 308 60', a: [52, 150], b: [308, 60], you: [24, 172], dest: [338, 40], la: [64, 178, 'start'], lb: [296, 40, 'end'], ly: [10, 196, 'start'], chip: 'top' },
  'sel>zi': { d: 'M40 70C90 70 120 110 180 120S272 150 316 188', a: [40, 70], b: [316, 188], you: [22, 48], dest: [340, 210], la: [54, 54, 'start'], lb: [300, 214, 'end'], ly: [8, 36, 'start'], chip: 'bottom' },
  'hip>centre': { d: 'M300 190C260 180 236 140 200 118S120 80 60 60', a: [300, 190], b: [60, 60], you: [328, 212], dest: [30, 42], la: [290, 216, 'end'], lb: [74, 44, 'start'], ly: [350, 232, 'end'], chip: 'bottom' }
};
const geoFor = key => GEO[key] || GEO['sel>centre'];
function mapBlock({ key, exact, match = false, walk = true, chip = '', fit = '' }) {
  const g = geoFor(key), aria = exact ? t('a11y.map.exact') : t('a11y.map.approx');
  const [ax, ay] = g.a, [bx, by] = g.b, [yx, yy] = g.you, [dx, dy] = g.dest;
  const zone = (x, y) => (exact ? '' : `<circle class="zone" cx="${x}" cy="${y}" r="22"/>`);
  return `<div class="mapframe" ${match ? 'data-match' : ''}><div class="mapwrap" data-w="360" role="img" aria-label="${aria}" style="aspect-ratio:360/240">
    <svg class="map" viewBox="0 0 360 240" aria-hidden="true" focusable="false"><use href="#basemap"/></svg>
    <svg class="layer aura" viewBox="0 0 360 240" aria-hidden="true" focusable="false"><path class="rt aura" pathLength="1" d="${g.d}"/><path class="rt halo" pathLength="1" d="${g.d}"/></svg>
    <svg class="layer" viewBox="0 0 360 240" aria-hidden="true" focusable="false">
      <path class="rt core" pathLength="1" d="${g.d}"/><path class="rt spark" pathLength="1" d="${g.d}"/>
      ${walk ? `<g class="pass"><path class="walk" d="M${yx} ${yy}L${ax} ${ay}"/><path class="walk" d="M${bx} ${by}L${dx} ${dy}"/><circle class="you" cx="${yx}" cy="${yy}" r="6"/><circle class="you" cx="${dx}" cy="${dy}" r="6"/></g>` : ''}
      <g class="mk dp">${zone(bx, by)}<circle class="t" cx="${bx}" cy="${by}" r="7"/></g>
      <g class="mk pk">${zone(ax, ay)}<circle class="ping" cx="${ax}" cy="${ay}" r="9"/><circle class="ring" cx="${ax}" cy="${ay}" r="14"/><circle class="dot" cx="${ax}" cy="${ay}" r="7"/></g>
      <circle class="snap a" cx="${ax}" cy="${ay}" r="10"/><circle class="snap b" cx="${bx}" cy="${by}" r="10"/>
      <text class="m-lbl" x="106" y="118" transform="rotate(80 106 118)">Cibin</text>
      <text class="m-lbl" x="${g.la[0]}" y="${g.la[1]}" text-anchor="${g.la[2]}">${t('detail.pickup')}</text>
      <text class="m-lbl" x="${g.lb[0]}" y="${g.lb[1]}" text-anchor="${g.lb[2]}">${t('detail.dropoff')}</text>
      ${walk ? `<text class="m-lbl" x="${g.ly[0]}" y="${g.ly[1]}" text-anchor="${g.ly[2]}">${t('common.you')}</text>` : ''}
    </svg>
    <div class="fx" aria-hidden="true"><i class="pl hd"></i><i class="pl t t1"></i><i class="pl t t2"></i><i class="pl t t3"></i><i class="pl amb"></i><i class="pl still"></i></div>
  </div>${chip}${fit ? fitChip(fit, g.chip) : ''}</div>`;
}
const fitChip = (text, pos = 'bottom') => `<div class="fit glass ${pos}"><span class="ok">${ic('check', 'sm')}</span><span>${text}</span></div>`;
/** Live trip strip: a street, the pickup point waiting at its end, one ambient light travelling toward it. Schedule-driven, not GPS (ADR 0005). */
function liveMap() {
  const d = 'M20 92C74 90 110 62 170 66S280 96 322 54';
  return `<div class="mapframe" data-live><div class="mapwrap" data-w="360" aria-hidden="true" style="aspect-ratio:360/120">
    <svg class="map" viewBox="0 60 360 120" aria-hidden="true" focusable="false"><use href="#basemap"/></svg>
    <svg class="layer aura" viewBox="0 0 360 120" aria-hidden="true" focusable="false"><path class="rt aura" pathLength="1" d="${d}"/><path class="rt halo" pathLength="1" d="${d}"/></svg>
    <svg class="layer" viewBox="0 0 360 120" aria-hidden="true" focusable="false"><path class="rt core" pathLength="1" d="${d}"/><path class="rt spark" pathLength="1" d="${d}"/>
      <g class="mk pk"><circle class="ring-wait" cx="322" cy="54" r="9"/><circle class="ring" cx="322" cy="54" r="14"/><circle class="dot" cx="322" cy="54" r="7"/></g></svg>
    <div class="fx" aria-hidden="true"><i class="pl t t1"></i><i class="pl t t2"></i><i class="pl t t3"></i><i class="pl amb"></i><i class="pl still"></i></div>
  </div></div>`;
}
/** Scatter low-contrast buildings on the base map, away from every route and the river. Deterministic. */
function buildBasemap() {
  const NS = 'http://www.w3.org/2000/svg', tmp = document.createElementNS(NS, 'svg');
  tmp.setAttribute('width', 0); tmp.setAttribute('height', 0); tmp.style.position = 'absolute'; document.body.append(tmp);
  const avoid = [];
  [...Object.values(GEO).map(g => g.d), 'M-20 30C60 50 104 104 114 150S116 214 146 262', 'M-20 200C90 184 200 214 380 186'].forEach(d => {
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); tmp.append(p); avoid.push(...M.sample(p, 36));
  });
  tmp.remove();
  const g = $('#bld'); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 330 + 12, y = rnd() * 216 + 10, w = 9 + rnd() * 16, h = 7 + rnd() * 12;
    if (avoid.some(p => Math.hypot(p.x - x, p.y - y) < 30)) continue;
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('class', 'm-bld'); r.setAttribute('x', x.toFixed(0)); r.setAttribute('y', y.toFixed(0)); r.setAttribute('width', w.toFixed(0)); r.setAttribute('height', h.toFixed(0)); r.setAttribute('rx', 2);
    g.append(r);
  }
}

/* ---- price numerals (rolled in on screens that reveal a price), loaders, empty art, launch button ---- */
const priceNum = (amount, { from = null, unit = true } = {}) => {
  const s = amount.toFixed(2);
  return `<span class="pline"><span class="roll" data-roll="${s}" ${from != null ? `data-from="${from.toFixed(2)}"` : ''} aria-hidden="true">${s}</span>${unit ? '<span class="cur" aria-hidden="true">RON</span>' : ''}<span class="sr-only">${s} RON</span></span>`;
};
const ldPath = 'M14 54C46 54 52 20 86 26S128 18 146 14';
const loaderCard = label => `<div class="card loader ambient" role="status"><svg class="ld" viewBox="0 0 160 70" aria-hidden="true" focusable="false"><path class="tr" d="${ldPath}"/><circle class="pt-a" cx="14" cy="54" r="6"/><circle class="pt-b" cx="146" cy="14" r="6"/><circle class="tl" r="2.5"/><circle class="tl" r="3.5"/><circle class="tl" r="4.5"/><circle class="hd" r="5.5"/><circle class="still" r="5.5"/></svg><h2 class="h3">${label}</h2></div>`;
const emptyArt = () => `<svg class="empty-art ambient" viewBox="0 0 160 70" aria-hidden="true" focusable="false"><path class="tr" d="${ldPath}"/><circle class="pt-a breath" cx="14" cy="54" r="6"/><circle class="pt-b" cx="146" cy="14" r="6"/></svg>`;
const miniLoader = () => `<svg class="ld mini-ld ambient" viewBox="0 0 160 70" aria-hidden="true" focusable="false"><path class="tr" d="${ldPath}"/><circle class="tl" r="2.5"/><circle class="tl" r="3.5"/><circle class="tl" r="4.5"/><circle class="hd" r="5.5"/><circle class="still" r="5.5"/></svg>`;
/** The primary action as a launch button. Label, then (after the Haide moment) the confirmed text. One per screen. */
const ctaButton = ({ id, label, done, type = 'submit', attrs = '' }) => `<div class="cta-wrap"><button class="btn primary cta" type="${type}" id="${id}" ${attrs}><span class="wipe" aria-hidden="true"></span><span class="dotl" aria-hidden="true"></span><span class="l l1">${label}</span><span class="l l2" aria-hidden="true">${ic('check')}${done}</span><span class="l l3" aria-hidden="true">${t('launch.haide')}</span></button><span class="cta-ring" aria-hidden="true"></span></div>`;
/** Time, day and price as one block. Carries across list, details and booking as shared elements. */
const rideHead = (time, dayLabel, priceHtml) => `<div class="rhead"><div><div class="num" data-vt="ride-time">${time}</div><div class="muted">${dayLabel}</div></div>${priceHtml ? `<div class="pr" data-vt="ride-price">${priceHtml}</div>` : ''}</div>`;
/** Read-only seat strip: taken seats filled, free seats dashed. The words carry the meaning, the tokens are decoration. */
const seatStrip = (taken, total) => `<div class="seatrow" aria-hidden="true">${Array.from({ length: total }, (_, k) => `<span class="face ${k < taken ? 'taken' : 'free'}">${ic('seat')}</span>`).join('')}</div>`;

/* ---- ride card ---- */
function priceUpTo(v, r) { return priceFor(v.km, r.fuel, 1); }
function rideCard(v, i) {
  const r = RIDES[v.r], u = USERS[r.driver];
  const left = r.total - r.booked, up = priceUpTo(v, r);
  const diff = Math.abs(parseT(r.dep) - parseT(S.search.time));
  const out = diff > S.search.win;
  return `<li><a class="card ride" href="#/ride/${r.id}/${i}" data-enter>
    <div><div class="tm" data-vt-src="ride-time">${r.dep}</div><div class="dy">${dayName(S.search.day)}</div></div>
    <div class="pr" data-vt-src="ride-price"><div class="price sm"><small>${t('card.upTo')}</small><br>${money(up)}</div><div class="small muted">${t('card.drops')}</div></div>
    ${stopRail({ nm: esc(v.pu), sub: t('card.walkTo', { m: v.w1 }) }, { nm: esc(v.do), sub: t('card.walkFrom', { m: v.w2 }) }, 'data-vt-src="ride-route"')}
    <div class="foot">${avatar(r.driver)}<span class="who">${esc(u.name)}</span>${ratingHtml(u)}<span class="seats-left">${out ? t('card.outsideWindow', { n: diff }) : tp('card.seatsLeft', left)}</span></div>
  </a></li>`;
}

/* ================= router, sheets, toast, passenger screens ================= */
const LOGO = () => $('#tpl-logo').innerHTML;
/** Find hero: the night map with one lit route. Draws in once per session, then only the ambient light moves. */
const HERO_D = 'M40 214C110 222 176 206 236 190S320 150 346 100';
const heroMap = () => `<div class="mapframe" data-once="hero"><div class="mapwrap" data-w="360" aria-hidden="true" style="aspect-ratio:360/240">
  <svg class="map" viewBox="0 0 360 240" aria-hidden="true" focusable="false"><use href="#basemap"/></svg>
  <svg class="layer aura" viewBox="0 0 360 240" aria-hidden="true" focusable="false"><path class="rt aura" pathLength="1" d="${HERO_D}"/><path class="rt halo" pathLength="1" d="${HERO_D}"/></svg>
  <svg class="layer" viewBox="0 0 360 240" aria-hidden="true" focusable="false"><path class="rt core" pathLength="1" d="${HERO_D}"/><path class="rt spark" pathLength="1" d="${HERO_D}"/>
    <g class="mk dp"><circle class="t" cx="346" cy="100" r="7"/></g><g class="mk pk"><circle class="ping" cx="40" cy="214" r="9"/><circle class="ring" cx="40" cy="214" r="14"/><circle class="dot" cx="40" cy="214" r="7"/></g></svg>
  <div class="fx" aria-hidden="true"><i class="pl hd"></i><i class="pl t t1"></i><i class="pl t t2"></i><i class="pl t t3"></i><i class="pl amb"></i><i class="pl still"></i></div>
</div></div>`;
const nowMin = () => ({ before: NOW, day: 7 * 60 + 15 + (S.tick || 0), after: 9 * 60 + 40 }[S.phase]);
const clockLabel = () => hhmm(nowMin());

/* ---- derived status (phase driven, nothing is mutated by the clock) ---- */
function bst(b) {
  if (!b) return null;
  if (b.status === 'requested' && S.phase !== 'before') return 'expired';
  if (b.status === 'confirmed' && S.phase === 'after') return 'completed';
  return b.status;
}
const variantFor = (id, i) => {
  const key = S.key && RES[S.key] && RES[S.key][i] && RES[S.key][i].r === id ? S.key : Object.keys(RES).find(k => RES[k].some(v => v.r === id));
  return RES[key][RES[key][i] && RES[key][i].r === id ? i : RES[key].findIndex(v => v.r === id)];
};
const curN = b => RIDES[b.r].booked + 1 + S.extraJoined;
const curPrice = b => Math.min(b.lock ?? 99, priceFor(b.v.km, RIDES[b.r].fuel, curN(b)));
const deadlineOf = r => hhmm(Math.min(NOW + 30, parseT(r.dep) - 10));
const pendingCount = () => S.driving.filter(d => d.status === 'published' && S.phase !== 'after').reduce((n, d) => n + d.requests.length, 0);

/* ---- routing ---- */
let IDX = 0;
const parseRoute = () => {
  const h = (location.hash || '#/find').replace(/^#\//, '');
  const [name, a, b, c] = h.split('/');
  return { name: name || 'find', a, b, c };
};
function nav(h, { replace = false } = {}) {
  if (SHEET) closeSheet(true);
  S.errs = {}; S.drvMsg = '';
  if (replace) history.replaceState({ i: history.state ? history.state.i : 0 }, '', h);
  else history.pushState({ i: ++IDX }, '', h);
  return M.transition(() => render());
}
function keyOf(el) {
  if (!el || !el.closest) return null;
  if (el.id) return '#' + el.id;
  if (el.dataset && el.dataset.act) return `[data-act="${el.dataset.act}"][data-arg="${el.dataset.arg || ''}"]`;
  if (el.getAttribute && el.getAttribute('href')) return `[href="${el.getAttribute('href')}"]`;
  return null;
}
function tabbar(cur) {
  const n = pendingCount() + S.unread;
  const items = [['find', 'search', 'nav.find'], ['offer', 'offer', 'nav.offer'], ['rides', 'rides', 'nav.rides'], ['profile', 'user', 'nav.profile']];
  return `<nav class="tabbar" aria-label="${t('nav.label')}">${items.map(([k, i, l]) =>
    `<a class="tab" href="#/${k}" ${cur === k ? 'aria-current="page"' : ''}><span class="pillic">${ic(i)}</span><span>${t(l)}</span>${k === 'rides' && n ? `<span class="badge" aria-hidden="true">${n}</span><span class="sr-only">, ${tp('nav.updates', n)}</span>` : ''}</a>`).join('')}</nav>`;
}
const ROUTES = {};
/** View-transition names must be unique per state. Details and booking carry them in the markup (data-vt), a list card gets them
 *  when it is the card in play (clicked, or the one we are coming back to). */
function markShared() {
  $$('[data-vt]').forEach(el => { el.style.viewTransitionName = el.dataset.vt; });
  if (S.vtHref) { const c = $(`a.card.ride[href="${S.vtHref}"]`); if (c) $$('[data-vt-src]', c).forEach(el => { el.style.viewTransitionName = el.dataset.vtSrc; }); }
}
function render({ keep = false, focusErr = false } = {}) {
  const rt = parseRoute();
  const fn = ROUTES[rt.name] || screenNotFound;
  const prev = $('#main');
  const scroll = keep && prev ? prev.scrollTop : 0;
  const ae = document.activeElement;
  const fkey = keep && ae && $('#app').contains(ae) ? keyOf(ae) : null;
  const sc = fn(rt.a, rt.b, rt.c);
  M.unwatch();
  $('#app').innerHTML =
    (S.offline ? `<div class="offline">${ic('alert', 'sm')}<span>${t('error.offline.banner')}</span></div>` : '') +
    `<main id="main" tabindex="-1" class="${sc.cta ? 'has-cta' : sc.tab ? 'has-tab' : ''}">${sc.html}</main>` +
    (sc.cta ? `<div class="cta-bar">${sc.cta}</div>` : '') + (sc.tab ? tabbar(sc.tab) : '');
  const main = $('#main');
  main.scrollTop = scroll;
  document.title = (sc.title || t('app.name')) + ' · ' + t('app.name');
  if (focusErr && $('[aria-invalid="true"]')) $('[aria-invalid="true"]').focus();
  else if (fkey && $(fkey)) $(fkey).focus({ preventScroll: true });
  else if (!keep) { const h = $('#h1'); (h || main).focus({ preventScroll: true }); $('#live').textContent = sc.title || ''; }
  $('#clock').textContent = 'Time ' + clockLabel();
  markShared();
  // motion: arrival moments play on navigation, a re-render in place (keep) only restores the still and ambient state
  const app = $('#app');
  M.fit(app); M.rolls(app, { animate: !keep }); M.maps(app, { draw: !keep }); M.live(app); M.ambient(app);
  if (!keep) { M.match(app); M.seatsIn(app); M.enter(app, 120); }
  if (sc.after) sc.after();
}
function screenNotFound() {
  return { title: t('error.notFound.title'), tab: 'find', html: appbar(t('error.notFound.title'), { back: false }) + `<div class="page"><p>${t('error.notFound.body')}</p><a class="btn primary" href="#/find">${t('error.notFound.cta')}</a></div>` };
}

/* ---- sheets, toast ---- */
function sheetHead(title) { return `<header><h2 id="sheet-title">${title}</h2><button class="icon-btn" data-act="closeSheet" aria-label="${t('common.close')}">${ic('close')}</button></header>`; }
function openSheet(html, { full = false } = {}) {
  if (SHEET) closeSheet(true);
  LASTFOCUS = keyOf(document.activeElement);
  const root = $('#sheets');
  root.classList.add('open');
  root.innerHTML = `<div class="scrim" data-act="closeSheet"></div><div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><div class="handle" aria-hidden="true"></div>${html}</div>`;
  $('#app').inert = true; SHEET = true;
  const sh = $('.sheet', root);
  const auto = $('[data-autofocus]', sh);
  (auto || sh).focus();
}
function closeSheet(silent = false) {
  const root = $('#sheets');
  root.innerHTML = ''; root.classList.remove('open');
  $('#app').inert = false; SHEET = false;
  if (!silent) { const el = LASTFOCUS && $(LASTFOCUS); (el || $('#h1') || $('#main')).focus({ preventScroll: true }); }
}
function toast(msg) {
  const el = $('#toast');
  el.innerHTML = `<div>${msg}</div>`;
  $('#live').textContent = msg.replace(/<[^>]+>/g, '');
  clearTimeout(TOASTT);
  TOASTT = setTimeout(() => { el.innerHTML = ''; }, 5000);
}

/* ---- gating (progressive onboarding) ---- */
function nextStep() {
  const i = S.intent;
  if (!S.user) return '#/auth';
  if (!S.consent) return '#/auth/consent';
  if (!profileOk()) return '#/setup/profile';
  if (i && i.kind === 'offer' && !S.vehicle) return '#/setup/vehicle';
  return null;
}
function stepsFor() { return ['account', 'agreement', 'profile'].concat(S.intent && S.intent.kind === 'offer' ? ['car'] : []); }
function stepHeader(cur) {
  const steps = stepsFor(), n = steps.indexOf(cur) + 1;
  return `<div class="stack-sm"><div class="progress" aria-hidden="true">${steps.map((s, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div><p class="small muted"><span class="sr-only">${t('a11y.progress', { n, total: steps.length })}. </span><span aria-hidden="true">${t('setup.step', { n, total: steps.length })}</span>: ${t('setup.step.' + cur)}</p></div>`;
}
function startGate(kind, back, extra = {}) { S.intent = { kind, back, ...extra }; const n = nextStep(); if (n) nav(n); return !n; }
function finishOnboarding() {
  const i = S.intent; S.intent = null;
  const p = nav(i ? i.back : '#/profile', { replace: true });
  if (i && i.kind === 'request') p.then(() => setTimeout(() => openRequest(i.id, i.vi), 60));
}
function advance() { const n = nextStep(); if (n) nav(n, { replace: true }); else finishOnboarding(); }

/* ================= FIND ================= */
function placeBtn(which, id) {
  const p = place(id), bad = S.errs.search && !p;
  return `<button type="button" class="field-btn" id="pick-${which}" data-act="pickPlace" data-arg="${which}" ${bad ? 'aria-invalid="true"' : ''}>
    <span class="${which === 'from' ? 'dot-from' : 'dot-to'}" aria-hidden="true"></span>
    <span class="grow"><span class="lbl">${t('find.' + which)}</span><span class="val ${p ? '' : 'ph'}">${p ? esc(plabel(p)) : t('find.' + which + 'Placeholder')}</span></span></button>`;
}
ROUTES.find = function () {
  const s = S.search;
  const days = Array.from({ length: 14 }, (_, i) => `<option value="${i}" ${s.day === i ? 'selected' : ''}>${dayOption(i)}</option>`).join('');
  const wins = [15, 30, 60].map(w => `<label class="chip"><input type="radio" name="s_win" value="${w}" ${s.win === w ? 'checked' : ''}><span>${t('find.window.' + w)}</span></label>`).join('');
  const corr = [['south', 'p1', 'p4'], ['west', 'p3', 'p7'], ['campus', 'p6', 'p5']].map(([k, a, b]) =>
    `<li><button type="button" class="card flat row" style="width:100%;text-align:left;cursor:pointer;min-height:56px;padding:12px 16px" data-act="corridor" data-arg="${a}|${b}"><span class="dot-from" aria-hidden="true"></span><span class="grow label" style="font-weight:600">${t('find.corridor.' + k)}</span>${ic('chev')}</button></li>`).join('');
  return {
    title: t('find.title'), tab: 'find',
    html: `<div class="hero">${LOGO()}<h1 id="h1" tabindex="-1">${t('find.title')}</h1><p>${t('find.subtitle')}</p>${heroMap()}</div>
    <div class="page lift">
      <form class="card stack" data-form="search" novalidate>
        <div class="pair swap-wrap">${placeBtn('from', s.from)}${placeBtn('to', s.to)}<button type="button" class="swap" data-act="swap" aria-label="${t('find.swap')}">${ic('swap')}</button></div>
        ${S.errs.search ? `<p class="err" role="alert">${ic('alert')}<span>${S.errs.search}</span></p>` : ''}
        <div class="row dt">
          <div class="field grow day"><label for="s_day">${t('find.day')}</label><div class="sel"><select class="select" id="s_day" name="s_day">${days}</select>${ic('down')}</div></div>
          <div class="field time"><label for="s_time">${t('find.time')}</label><input class="input" id="s_time" name="s_time" type="time" value="${s.time}" required></div>
        </div>
        <fieldset><legend>${t('find.window')}</legend><div class="chips" style="margin-top:8px">${wins}</div></fieldset>
        <button class="btn primary block" type="submit">${ic('search')}${t('find.cta')}</button>
      </form>
      <section class="stack" aria-labelledby="corr-h"><h2 class="h3" id="corr-h">${t('find.corridors')}</h2><ul class="list">${corr}</ul></section>
      ${S.user ? '' : `<p class="small muted center">${t('find.visitorHint')}</p>`}
    </div>`
  };
};

/* place picker */
function openPicker(target) {
  S.picker = { target };
  const isFrom = target === 'from' || target === 'ofrom';
  openSheet(`${sheetHead(t(isFrom ? 'place.title.from' : 'place.title.to'))}<div class="body">
    <div class="field"><label for="pq" class="sr-only">${t('place.search')}</label><input class="input" id="pq" type="search" autocomplete="off" placeholder="${t('place.search')}" data-autofocus></div>
    <ul class="group" aria-label="${t('place.suggestions')}"><li><button class="list-row" data-act="useLocation">${ic('locate')}<span class="grow"><span id="loc-label">${t('place.myLocation')}</span><span class="sub" id="loc-sub">${t('place.myLocation.hint')}</span></span></button></li>
    <li><button class="list-row" data-act="onMap">${ic('pin')}<span class="grow">${t('place.onMap')}</span></button></li></ul>
    <p class="sr-only" id="pcount" role="status"></p>
    <ul class="group" id="plist"></ul>
  </div>`, { full: true });
  refreshPlaces('');
}
function refreshPlaces(q) {
  const items = PLACES.filter(p => !q || norm(plabel(p)).includes(norm(q)));
  $('#plist').innerHTML = items.length
    ? items.map(p => `<li><button class="list-row" data-act="choosePlace" data-arg="${p.id}">${ic('pin')}<span class="grow">${esc(p.name)}<span class="sub">${esc(p.area)}</span></span></button></li>`).join('')
    : `<li class="list-row" style="cursor:default">${t('place.noMatch', { q })}</li>`;
  $('#pcount').textContent = q ? tp('place.count', items.length) : '';
}
function setPlace(id) {
  const tg = S.picker.target;
  if (tg === 'from' || tg === 'to') S.search[tg] = id;
  else { S.offer[tg === 'ofrom' ? 'from' : 'to'] = id; computeRoute(); }
  closeSheet(true); render({ keep: true });
  const el = $('#pick-' + tg) || $('#pick-' + tg.replace('o', ''));
  if (el) el.focus({ preventScroll: true });
}

/* results */
function runSearch() {
  const s = S.search, f = place(s.from), to = place(s.to);
  S.key = f.g + '>' + to.g;
  S.loading = true; S.searchError = S.offline;
  nav('#/results');
  setTimeout(() => { S.loading = false; if (parseRoute().name === 'results') render(); }, 650);
}
function computeResults() {
  const f = place(S.search.from), to = place(S.search.to);
  const all = RES[f.g + '>' + to.g] || [];
  const vis = all.filter(v => !S.blocked.includes(RIDES[v.r].driver));
  const des = parseT(S.search.time);
  const df = v => Math.abs(parseT(RIDES[v.r].dep) - des);
  const sort = (a, b) => (a.w1 + a.w2) - (b.w1 + b.w2) || df(a) - df(b);
  const inWin = vis.filter(v => df(v) <= S.search.win).sort(sort);
  const alt = inWin.length ? [] : vis.sort((a, b) => df(a) - df(b)).slice(0, 3);
  return { inWin, alt, all, hidden: all.length - vis.length };
}
ROUTES.results = function () {
  const s = S.search;
  if (!s.from || !s.to) { return { title: t('find.title'), tab: 'find', html: appbar(t('find.title'), { back: false }) + `<div class="page"><a class="btn primary" href="#/find">${t('results.editSearch')}</a></div>` }; }
  const f = place(s.from), to = place(s.to);
  const summary = `<div class="card flat row between"><div class="grow"><div style="font-weight:600">${t('results.route', { from: esc(f.name), to: esc(to.name) })}</div><div class="small muted">${t('results.when', { day: dayName(s.day), time: s.time, win: t('find.window.' + s.win) })}</div></div><a class="btn ghost" href="#/find">${t('results.editSearch')}</a></div>`;
  if (S.loading) {
    return { title: t('results.title.loading'), html: appbar(t('results.title.loading'), { fallback: '#/find' }) + `<div class="page" aria-busy="true">${summary}${loaderCard(t('results.loading'))}<div class="ghost-card" aria-hidden="true"></div><div class="ghost-card" aria-hidden="true"></div></div>` };
  }
  if (S.searchError) {
    return { title: t('results.error.title'), html: appbar(t('results.error.title'), { fallback: '#/find' }) + `<div class="page">${summary}${banner('bad', 'alert', `<b>${t('results.error.title')}</b><br>${t('results.error')}`, 'alert')}<button class="btn primary" data-act="retry">${t('results.retry')}</button></div>` };
  }
  const R = computeResults();
  const list = R.inWin.map(v => rideCard(v, R.all.indexOf(v)));
  let body;
  if (list.length) body = `<p class="small muted">${t('results.sortNote')}</p><ul class="list">${list.join('')}</ul>${R.hidden ? `<p class="small muted">${t('results.blockedNote')}</p>` : ''}`;
  else {
    body = `<div class="empty">
      ${emptyArt()}
      <h2 class="big-title">${t('results.empty.title')}</h2><p class="muted" style="max-width:32ch">${t('results.empty.body')}</p>
      ${S.notified ? banner('ok', 'check', t('results.notified.state'), 'status') : `<button class="btn primary" data-act="notify">${ic('mail')}${t('results.empty.notify')}</button>`}
      <a class="btn secondary" href="#/find">${t('results.empty.edit')}</a></div>
      ${R.alt.length ? `<section class="stack"><h2 class="h3">${t('results.empty.alt')}</h2><ul class="list">${R.alt.map(v => rideCard(v, R.all.indexOf(v))).join('')}</ul></section>` : ''}`;
  }
  return { title: list.length ? tp('results.count', list.length) : t('results.empty.title'), html: appbar(list.length ? tp('results.count', list.length) : t('results.title.empty'), { fallback: '#/find' }) + `<div class="page">${summary}${body}</div>` };
};

/* ride detail: the map is the hero. The route draws in, the request snaps onto it (match), the price rolls in, the seats pop in. */
const keyOfVariant = v => Object.keys(RES).find(k => RES[k].includes(v));
ROUTES.ride = function (id, i) {
  const r = RIDES[id], v = r && variantFor(id, +i);
  if (!r || !v) return screenNotFound();
  const u = USERS[r.driver], left = r.total - r.booked, up = priceUpTo(v, r);
  const own = S.driving.some(d => d.ref === id);
  const mine = S.booking && S.booking.r === id && ['requested', 'confirmed'].includes(bst(S.booking));
  const late = parseT(r.dep) - nowMin() < 10;
  const blocked = S.blocked.includes(r.driver);
  let cta, why = '';
  if (blocked) { why = t('detail.blocked'); } else if (own) { why = t('detail.ownRide'); } else if (mine) { why = t('detail.alreadyRequested'); } else if (left <= 0) { why = t('detail.full'); } else if (late) { why = t('detail.tooLate'); }
  if (why) cta = `<div class="grow"><p class="small" style="font-weight:600">${why}</p></div>${mine ? '<a class="btn secondary" href="#/booking">' + t('rides.title') + '</a>' : ''}`;
  else cta = `<div class="price-mini"><span>${t('card.upTo')}</span><b>${money(up)}</b></div><button class="btn primary grow" data-act="requestSeat" data-arg="${id}|${i}">${t('detail.cta')}</button>`;
  const rows = Array.from({ length: Math.min(r.total, 4) }, (_, k) => k + 1).map(n => `<tr class="${n === 1 ? 'me' : ''}"><th scope="row">${tp('detail.priceTable.n', n)}</th><td>${money(priceFor(v.km, r.fuel, n))}</td></tr>`).join('');
  return {
    title: t('detail.title'), cta,
    html: `${appbar(t('detail.title'), { fallback: '#/results' })}<div class="page">
      ${mapBlock({ key: keyOfVariant(v), exact: false, match: true, fit: t('match.fit', { m: v.w1 }) })}
      <p class="pill-lock">${ic('lock', 'sm')}<span>${t('detail.approx', { driver: u.name })}</span></p>
      ${rideHead(r.dep, `${dayName(S.search.day)}, ${dayStr(S.search.day)}`, `<div class="small muted">${t('card.upTo')}</div><div class="price">${priceNum(up)}</div>`)}
      <div class="row between" data-enter>${seatStrip(r.booked, r.total)}<span class="status ${left > 0 ? 'ok' : 'mute'}">${tp('detail.seatsLeft', left, { total: r.total })}</span></div>
      <div class="card stack" data-enter>${stopRail({ nm: `<span class="sr-only">${t('detail.pickup')}: </span>${esc(v.pu)}`, sub: t('detail.walk.to', { m: v.w1 }) }, { nm: `<span class="sr-only">${t('detail.dropoff')}: </span>${esc(v.do)}`, sub: t('detail.walk.from', { m: v.w2 }) }, 'data-vt="ride-route"')}</div>
      <a class="card row" data-enter href="#/user/${r.driver}" aria-label="${t('detail.driver')}: ${esc(u.name)}. ${t('common.viewProfile')}">${avatar(r.driver)}<div class="grow"><div style="font-weight:600">${esc(u.name)}</div><div class="row" style="gap:8px">${ratingHtml(u)}<span class="small muted">${tp('pub.rides', u.rides)}</span></div></div>${ic('chev')}</a>
      <div class="card stack-sm" data-enter><div class="row">${ic('car')}<span><span class="sr-only">${t('detail.car')}: </span>${esc(r.car.make)} ${esc(r.car.model)}, ${esc(r.car.colour)}</span></div><p class="pill-lock">${ic('lock', 'sm')}<span>${t('detail.plateLocked')}</span></p></div>
      ${r.note ? `<div class="card stack-sm"><h2 class="label">${t('detail.note', { driver: u.name })}</h2><p>${esc(r.note)}</p></div>` : ''}
      <section class="card stack" aria-labelledby="pr-h"><h2 class="h3" id="pr-h">${t('detail.priceTitle')}</h2>
        <p class="small muted">${t('detail.priceNote')}</p>
        <table class="table"><caption>${t('detail.priceTable.caption')}</caption><thead class="sr-only"><tr><th>${t('detail.priceTable.col1')}</th><th>${t('detail.priceTable.col2')}</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="small">${t('detail.payDirect', { driver: u.name })}</p><p class="small muted">${t('detail.fuelNote', { driver: u.name })}</p></section>
    </div>`
  };
};

/* request sheet */
function openRequest(id, i) {
  const r = RIDES[id], v = variantFor(id, +i), u = USERS[r.driver];
  openSheet(`${sheetHead(t('request.title'))}<form class="body" data-form="request" data-arg="${id}|${i}">
    <div class="card flat stack-sm"><div style="font-weight:600">${t('request.summary', { time: r.dep, from: esc(v.pu), to: esc(v.do) })}</div><div class="price sm"><small>${t('card.upTo')}</small> ${money(priceUpTo(v, r))}</div></div>
    <ul class="stack small"><li>${t('request.line.decides', { driver: u.name })}</li><li>${t('request.line.expires', { driver: u.name, deadline: deadlineOf(r) })}</li><li>${t('request.line.approx', { driver: u.name })}</li></ul>
    ${S.offline ? banner('warn', 'alert', t('request.offline'), 'status') : ''}
    <div class="actions">${ctaButton({ id: 'send-btn', label: t('request.send'), done: S.offline ? t('request.saved') : t('request.sent.toast'), attrs: 'data-autofocus' })}<button type="button" class="btn ghost" data-act="closeSheet">${t('common.close')}</button></div></form>`);
}

/* ================= BOOKING (passenger) ================= */
/** Live trip card (ride day). Calm and honest: the light travels the route toward the pickup on a 6 s loop, driven by the schedule,
 *  not by GPS (ADR 0005: no live tracking in the MVP). The text carries the facts, the animation is ambient. */
function liveCard(b, r, u) {
  const eta = Math.max(0, parseT(r.dep) - nowMin());
  const from = S.etaFrom != null && S.etaFrom !== eta ? pad(S.etaFrom) : null;
  const head = eta > 0
    ? `<div class="eta" aria-hidden="true"><span class="num roll" data-roll="${pad(eta)}" ${from ? `data-from="${from}"` : ''}>${pad(eta)}</span><span class="cur">${t('common.min', { n: '' }).trim()}</span></div><p class="sr-only">${t('live.leavesIn', { n: eta })}</p>`
    : `<p class="big-title">${t('live.now')}</p>`;
  return `<section class="card live" aria-labelledby="live-h">${liveMap()}<div class="body"><h2 class="label" id="live-h">${t('live.caption', { driver: esc(u.name), time: r.dep })}</h2>${head}<p>${t('booking.confirmed.body')}</p><p class="small muted">${t('live.note')}</p></div></section>`;
}
ROUTES.booking = function () {
  const b = S.booking;
  if (!b) return screenNotFound();
  const r = RIDES[b.r], u = USERS[r.driver], v = b.v, st = bst(b);
  if (b.unread) { b.unread = false; S.unread = Math.max(0, S.unread - 1); }
  const exact = st === 'confirmed' || st === 'completed' || st === 'no_show';
  const live = st === 'requested' || st === 'confirmed' || st === 'completed';
  const done = st === 'completed';
  const tl = live ? (() => {
    const steps = ['requested', 'accepted', 'ride', 'rate'];
    const idx = st === 'requested' ? 0 : st === 'confirmed' ? 2 : (b.rated ? 4 : 3);
    return `<ol class="timeline" aria-label="${t('booking.title')}">${steps.map((s, k) => `<li class="${k < idx ? 'done' : k === idx ? 'now' : ''}" ${k === idx ? 'aria-current="step"' : ''}><span class="n" aria-hidden="true">${k < idx ? '✓' : k + 1}</span>${t('booking.step.' + s)}</li>`).join('')}</ol>`;
  })() : '';
  const head = {
    requested: ['plain', 'hourglass', t('booking.requested.title', { driver: u.name }), t('booking.requested.body', { driver: u.name, deadline: deadlineOf(r) })],
    confirmed: ['ok', 'check', t('booking.confirmed.title', { driver: u.name }), t('booking.confirmed.body')],
    rejected: ['bad', 'close', t('booking.rejected.title', { driver: u.name }), t('booking.rejected.body')],
    expired: ['warn', 'clock', t('booking.expired.title'), t('booking.expired.body', { driver: u.name })],
    cancelled: ['plain', 'close', t('booking.cancelled.title'), ''],
    rideCancelled: ['bad', 'alert', t('booking.rideCancelled.title', { driver: u.name }), t('booking.rideCancelled.body')],
    completed: ['ok', 'check', t('booking.completed.title'), b.rated ? t('booking.rating.sent', { driver: u.name }) : t('booking.completed.body', { driver: u.name })],
    no_show: ['bad', 'flag', t('booking.noShow.title'), '']
  }[st];
  const price = b.lock ?? priceUpTo(v, r);
  const cur = st === 'confirmed' || st === 'completed' ? curPrice(b) : price;
  const showLive = S.phase === 'day' && st === 'confirmed';
  let html = appbar(t('booking.title'), { fallback: '#/rides' }) + '<div class="page">';
  html += banner(head[0], head[1], `<b>${head[2]}</b>${head[3] && !showLive ? `<br>${head[3]}` : ''}`, 'status');
  if (b.queued && st === 'requested') html += banner('warn', 'alert', t('booking.queued'));
  html += tl;
  if (b.dropped && st === 'confirmed') html += banner('ok', 'check', `${t('booking.priceDropped', { price: money(cur) })}`, 'status');
  if (showLive) html += liveCard(b, r, u);
  html += mapBlock({ key: keyOfVariant(v), exact });
  html += rideHead(r.dep, dayStr(0), '');
  html += `<div class="card stack">${stopRail(
    { nm: `<span class="sr-only">${t('booking.pickup')}: </span>${esc(exact ? v.xpu : v.pu)}`, sub: exact ? `${ic('lock', 'sm')} ${t('common.exact')}` : t('booking.pickup.approx') },
    { nm: `<span class="sr-only">${t('booking.dropoff')}: </span>${esc(exact ? v.xdo : v.do)}`, sub: exact ? `${ic('lock', 'sm')} ${t('common.exact')}` : t('booking.pickup.approx') }, 'data-vt="ride-route"')}
    <div class="row between"><span class="muted">${t('booking.leaves', { time: r.dep })}</span><span class="muted">${dayStr(0)}</span></div></div>`;
  if (st === 'confirmed' || st === 'completed') {
    const from = S.dropPulse && b.dropped && S.prevPrice != null ? S.prevPrice : null;
    html += `<section class="card stack" aria-labelledby="pay-h"><h2 class="label" id="pay-h">${t('booking.pay', { driver: u.name })}</h2>
      <div class="row" style="gap:12px"><div class="price" data-vt="ride-price">${priceNum(cur, { from })}</div>${b.dropped ? `<span class="dotw" role="img" aria-label="${t('a11y.priceDropped')}"><span class="d"></span><span class="r"></span></span>` : ''}</div>
      <p class="small">${t('booking.pay.how')}</p><p class="small muted">${done ? t('booking.pay.final', { driver: u.name }) : t('booking.priceNever')}</p></section>`;
    html += `<section class="card stack" aria-labelledby="ct-h"><h2 class="label" id="ct-h">${t('booking.contact', { driver: u.name })}</h2>
      <div class="row">${avatar(r.driver)}<a class="grow" href="#/user/${r.driver}" style="font-weight:600">${esc(u.name)}</a></div>
      <div class="row"><a class="btn tonal grow" href="tel:${r.phone.replace(/\s/g, '')}">${ic('phone')}${t('booking.call')}</a><a class="btn tonal grow" href="#" data-act="whatsapp">${ic('chat')}${t('booking.whatsapp')}</a></div>
      <p class="small">${r.phone}</p>
      <dl><div class="kv"><dt>${t('booking.car')}</dt><dd>${esc(r.car.make)} ${esc(r.car.model)}, ${esc(r.car.colour)}</dd></div><div class="kv"><dt>${t('booking.plate')}</dt><dd>${esc(r.car.plate)}</dd></div></dl>
      <p class="small muted">${t('booking.hiddenAfter')}</p></section>`;
  } else if (st === 'requested') {
    html += `<div class="card stack-sm"><div class="price sm" data-vt="ride-price"><small>${t('card.upTo')}</small> ${priceNum(price)}</div><p class="small muted">${t('detail.priceNote')}</p></div>`;
  }
  if (st === 'confirmed') {
    html += `<div class="stack"><button class="btn secondary block" data-act="share">${ic('share')}${t('rideday.share')}</button>`;
    if (S.phase === 'day') html += `<a class="btn danger-outline block" href="tel:112">${ic('phone')}${t('rideday.call112')}</a>`;
    html += '</div>';
  }
  if (st === 'completed') {
    if (!b.rated) html += `<a class="btn primary block" href="#/rate/driver">${ic('star')}${t('rides.rateCta')}</a>`;
    html += `<div class="stack"><button class="btn secondary block" data-act="driverMissing">${ic('flag')}${t('rideday.driverMissing')}</button><button class="btn ghost block" data-act="openReport" data-arg="${r.driver}">${t('rideday.problem')}</button></div>`;
  }
  if (['rejected', 'expired', 'cancelled', 'rideCancelled', 'no_show'].includes(st)) html += `<a class="btn primary block" href="#/results">${t('booking.findAnother')}</a>`;
  if (st === 'requested' || (st === 'confirmed')) html += `<button class="btn danger-outline block" data-act="cancelBooking">${t('booking.cancel')}</button>`;
  html += '</div>';
  return { title: t('booking.title'), html, after() { if (S.dropPulse) { M.ringPulse($('.dotw .r')); S.dropPulse = false; S.prevPrice = null; } S.etaFrom = null; } };
};
function openCancelBooking() {
  const b = S.booking, r = RIDES[b.r], u = USERS[r.driver];
  const late = bst(b) === 'confirmed' && parseT(r.dep) - nowMin() <= 30;
  openSheet(`${sheetHead(t('booking.cancel.title'))}<div class="body"><p>${t('booking.cancel.body', { driver: u.name })}</p>${late ? banner('warn', 'alert', t('booking.cancel.late')) : ''}
    <div class="actions"><button class="btn danger block" data-act="confirmCancelBooking">${t('booking.cancel.confirm')}</button><button class="btn secondary block" data-act="closeSheet" data-autofocus>${t('booking.cancel.keep')}</button></div></div>`);
}

/* ================= AUTH / SETUP ================= */
function authSubtitle() { const k = S.intent && S.intent.kind; return t(k === 'request' ? 'auth.subtitle.request' : k === 'offer' ? 'auth.subtitle.offer' : 'auth.subtitle.default'); }
ROUTES.auth = function (a) {
  if (a === 'consent') {
    return {
      title: t('consent.title'),
      html: `<header class="appbar"><span class="spacer"></span><h1 id="h1" tabindex="-1">${t('consent.title')}</h1></header><div class="page">
      ${stepHeader('agreement')}<p>${t('consent.body')}</p>
      <form class="stack" data-form="consent" data-persist novalidate>
        <div class="field"><div class="check"><input type="checkbox" id="c_age" name="c_age" ${fv('c_age') ? 'checked' : ''} ${S.errs.c_age ? 'aria-invalid="true" aria-describedby="c_age-err"' : ''}><label for="c_age">${t('consent.age')}</label></div>${errMsg('c_age')}</div>
        <div class="field"><div class="check"><input type="checkbox" id="c_terms" name="c_terms" ${fv('c_terms') ? 'checked' : ''} ${S.errs.c_terms ? 'aria-invalid="true" aria-describedby="c_terms-err"' : ''}><label for="c_terms">${t('consent.terms.pre')}<a href="#/policy/terms">${t('consent.terms.tos')}</a>${t('consent.terms.and')}<a href="#/policy/privacy">${t('consent.terms.pp')}</a></label></div>${errMsg('c_terms')}</div>
        <button class="btn primary block" type="submit">${t('consent.cta')}</button>
        <button class="btn ghost block" type="button" data-act="declineConsent">${t('consent.decline')}</button>
      </form></div>`
    };
  }
  if (a === 'check') {
    return {
      title: t('auth.check.title'),
      html: `<header class="appbar"><button class="icon-btn" data-act="back" data-arg="#/auth" aria-label="${t('common.back')}">${ic('back')}</button><h1 id="h1" tabindex="-1">${t('auth.check.title')}</h1></header><div class="page">
      <div class="empty" style="padding-top:16px"><span class="avatar lg" aria-hidden="true">${ic('mail')}</span><p style="max-width:32ch">${t('auth.check.body', { email: S.authEmail })}</p></div>
      <button class="btn tonal block" data-act="openLink">Prototype: open the link in the email</button>
      <button class="btn ghost block" data-act="resend">${t('auth.check.resend')}</button>
      <button class="btn ghost block" data-act="back" data-arg="#/auth">${t('auth.check.wrong')}</button></div>`
    };
  }
  return {
    title: t('auth.title'),
    html: `<header class="appbar"><button class="icon-btn" data-act="closeAuth" aria-label="${t('common.close')}">${ic('close')}</button><h1 id="h1" tabindex="-1">${t('auth.title')}</h1></header><div class="page">
    <p>${authSubtitle()}</p>
    <button class="btn secondary block" data-act="google"><span class="avatar" style="width:28px;height:28px;font-size:15px" aria-hidden="true">G</span>${t('auth.google')}</button>
    <p class="center muted" aria-hidden="true">${t('auth.or')}</p>
    <form class="stack" data-form="email" novalidate>${field({ id: 'email', label: t('auth.email'), hint: t('auth.email.hint'), type: 'email', value: fv('email', S.authEmail), attrs: 'autocomplete="email" inputmode="email" required' })}
    <button class="btn primary block" type="submit">${ic('mail')}${t('auth.email.send')}</button></form></div>`
  };
};
function photoBlock() {
  const url = S.profile.photoUrl;
  return `<div class="field"><span class="lbl" id="ph-l">${t('profile.photo')}</span><div class="row"><span class="avatar lg" role="img" aria-label="${t('a11y.avatar', { name: myName() })}">${url ? `<img src="${esc(url)}" alt="">` : (S.profile.photo ? esc(myName()[0]) : ic('camera'))}</span>
    <div class="stack-sm grow"><label class="btn tonal sm" for="photo" style="cursor:pointer">${ic('camera')}${t(url || S.profile.photo ? 'profile.photo.change' : 'profile.photo.add')}</label><input type="file" id="photo" class="sr-only" accept="image/jpeg,image/png" aria-describedby="photo-hint ${S.errs.photo ? 'photo-err' : ''}"><p class="hint" id="photo-hint">${t('profile.photo.hint')}</p></div></div>${errMsg('photo')}</div>`;
}
function profileForm(setup) {
  const p = S.profile;
  return `<form class="stack" data-form="profile" data-persist data-setup="${setup ? 1 : 0}" novalidate>${photoBlock()}
    ${field({ id: 'firstName', label: t('profile.firstName'), value: fv('firstName', p.firstName), attrs: 'autocomplete="given-name" maxlength="40" required' })}
    ${field({ id: 'phone', label: t('profile.phone'), hint: t('profile.phone.hint'), type: 'tel', value: fv('phone', p.phone), attrs: 'autocomplete="tel" inputmode="tel" required' })}
    ${field({ id: 'bio', label: t('profile.bio'), opt: true, tag: 'textarea', value: fv('bio', p.bio), attrs: 'maxlength="200" data-count-key="profile.bio.hint" placeholder="' + t('profile.bio.placeholder') + '"' })}
    <p class="hint" id="bio-count" aria-live="off">${t('profile.bio.hint', { n: (fv('bio', p.bio) || '').length })}</p>
    <button class="btn primary block" type="submit">${setup ? t('setup.profile.cta') : t('common.save')}</button></form>`;
}
function vehicleForm(setup) {
  const v = S.vehicle || { seats: 3, fuel: 'petrol' };
  const fuels = ['petrol', 'diesel', 'lpg', 'hybrid', 'electric'].map(f => `<option value="${f}" ${fv('v_fuel', v.fuel) === f ? 'selected' : ''}>${t('vehicle.fuel.' + f)}</option>`).join('');
  const seats = [1, 2, 3, 4].map(n => `<option value="${n}" ${+fv('v_seats', v.seats) === n ? 'selected' : ''}>${n}</option>`).join('');
  return `<form class="stack" data-form="vehicle" data-persist data-setup="${setup ? 1 : 0}" novalidate>
    ${field({ id: 'v_make', label: t('vehicle.make'), value: fv('v_make', v.make || ''), attrs: 'maxlength="30" autocomplete="off" required' })}
    ${field({ id: 'v_model', label: t('vehicle.model'), value: fv('v_model', v.model || ''), attrs: 'maxlength="30" autocomplete="off" required' })}
    ${field({ id: 'v_colour', label: t('vehicle.colour'), value: fv('v_colour', v.colour || ''), attrs: 'maxlength="30" autocomplete="off" required' })}
    ${field({ id: 'v_plate', label: t('vehicle.plate'), hint: t('vehicle.plate.hint'), value: fv('v_plate', v.plate || ''), attrs: 'maxlength="12" autocapitalize="characters" autocomplete="off" required' })}
    <div class="field"><label for="v_fuel">${t('vehicle.fuel')}</label><div class="sel"><select class="select" id="v_fuel" name="v_fuel">${fuels}</select>${ic('down')}</div></div>
    <div class="field"><label for="v_seats">${t('vehicle.seats')}</label><p class="hint" id="v_seats-hint">${t('vehicle.seats.hint')}</p><div class="sel"><select class="select" id="v_seats" name="v_seats" aria-describedby="v_seats-hint">${seats}</select>${ic('down')}</div></div>
    ${setup ? '' : `<p class="small muted">${t('vehicle.note')}</p>`}
    <button class="btn primary block" type="submit">${t('vehicle.save')}</button></form>`;
}
ROUTES.setup = function (a) {
  if (a === 'vehicle') return { title: t('vehicle.title'), html: `<header class="appbar"><span class="spacer"></span><h1 id="h1" tabindex="-1">${t('vehicle.title')}</h1></header><div class="page">${stepHeader('car')}<p>${t('vehicle.body')}</p>${vehicleForm(true)}</div>` };
  return { title: t('setup.profile.title'), html: `<header class="appbar"><span class="spacer"></span><h1 id="h1" tabindex="-1">${t('setup.profile.title')}</h1></header><div class="page">${stepHeader('profile')}<p>${t('setup.profile.body')}</p>${profileForm(true)}</div>` };
};

/* ================= OFFER (driver) ================= */
function computeRoute() {
  const o = S.offer, f = place(o.from), to = place(o.to);
  if (!f || !to) { o.routeState = 'idle'; return; }
  if (f.id === to.id) { o.routeState = 'same'; return; }
  o.routeState = 'loading';
  const key = f.g + '>' + to.g;
  setTimeout(() => {
    if (S.offline) o.routeState = 'error';
    else { const [km, min] = ROUTE_KM[key] || [7.2, 14]; o.route = { km, min }; o.routeState = 'ok'; }
    if (parseRoute().name === 'offer') render({ keep: true });
  }, 600);
}
function offerGate() {
  const bad = !S.user ? 'account' : (!S.consent || !profileOk()) ? 'profile' : 'car';
  if (bad === 'car') return `<div class="page"><div class="empty"><span class="avatar lg" aria-hidden="true">${ic('car')}</span><h2 class="big-title">${t('offer.needCar.title')}</h2><p class="muted" style="max-width:32ch">${t('offer.needCar.body')}</p><button class="btn primary" data-act="startOffer">${t('offer.needCar.cta')}</button></div></div>`;
  return `<div class="page"><p>${t('offer.subtitle')}</p><button class="btn primary block" data-act="startOffer">${t('auth.title')}</button></div>`;
}
const placeKey = (from, to) => { const f = place(from), g = place(to); return f && g ? f.g + '>' + g.g : 'sel>centre'; };
/** Price table and the "you recover" line. Re-rendered in place when the seat count changes, so the seat springs are never interrupted. */
function offerPrice() {
  const o = S.offer, v = S.vehicle;
  if (o.routeState !== 'ok') return `<p class="small muted">${t('offer.price.waiting')}</p>`;
  const km = o.route.km, cost = tripCost(km, v.fuel), free = !!fv('o_free', false), nmax = o.seats;
  const rows = Array.from({ length: nmax }, (_, k) => k + 1).map(n => `<tr class="${n === nmax ? 'me' : ''}"><th scope="row">${tp('detail.priceTable.n', n)}</th><td>${free ? t('common.free') : money(priceFor(km, v.fuel, n))}</td></tr>`).join('');
  return `<table class="table"><caption>${t('offer.price.fuel', { fuel: t('vehicle.fuel.' + v.fuel), km: km.toFixed(1) })}</caption><thead class="sr-only"><tr><th>${t('detail.priceTable.col1')}</th><th>${t('detail.priceTable.col2')}</th></tr></thead><tbody>${rows}</tbody></table>
    ${free ? '' : `<p class="save">${t('offer.price.recover', { n: nmax, amount: money(nmax * priceFor(km, v.fuel, nmax)), fuel: money(cost) })}</p>`}<p class="small muted">${t('offer.price.lock')}</p>`;
}
/** The readout under the seats: how many seats, and what each passenger pays when the car is full. Digits roll. */
function offerReadout() {
  const o = S.offer, v = S.vehicle, free = !!fv('o_free', false);
  const each = o.routeState === 'ok' ? (free ? `<span class="num pc">${t('common.free')}</span>` : `<span class="num pc"><span class="roll" id="roll-each" data-roll="${priceFor(o.route.km, v.fuel, o.seats).toFixed(2)}" aria-hidden="true"></span> <span class="cur" aria-hidden="true">RON</span></span>`) : '';
  return `<div class="readout"><div class="pline" aria-hidden="true"><span class="num cnt roll" id="roll-cnt" data-roll="${o.seats}">${o.seats}</span><span class="cur" id="cnt-unit">${seatWord(o.seats)}</span></div>${each ? `<div style="text-align:right"><p class="small muted">${t('detail.priceTable.col2')}</p>${each}</div>` : ''}</div>`;
}
const seatWord = n => tp('offer.seats.value', n).replace(/^\d+\s*/, '');
function changeSeats(k) {
  const was = S.offer.seats; if (k === was) return;
  S.offer.seats = k;
  M.seats($$('#seats-row .face'), k, was);
  M.rollSet($('#roll-cnt'), String(k), { animate: true });
  const o = S.offer, v = S.vehicle;
  if (o.routeState === 'ok' && $('#roll-each') && !fv('o_free', false)) M.rollSet($('#roll-each'), priceFor(o.route.km, v.fuel, k).toFixed(2), { animate: true, delay: 60 });
  $('#offer-price').innerHTML = offerPrice();
  $('#seats-sr').textContent = tp('offer.seats.value', k);
  $('#cnt-unit').textContent = seatWord(k);
}
ROUTES.offer = function (a) {
  const ready = S.user && S.consent && profileOk() && S.vehicle;
  if (!ready) return { title: t('offer.title'), tab: 'offer', html: appbar(t('offer.title'), { back: false }) + offerGate() };
  if (a === 'done') {
    const d = S.driving.find(x => x.id === S.publishedId) || S.driving[0];
    return {
      title: t('offer.done.title'), tab: 'offer',
      html: appbar(t('offer.done.title'), { back: false }) + `<div class="page">${mapBlock({ key: placeKey(d.from, d.to), exact: true, walk: false })}
      <div class="stack-sm" role="status"><h2 class="big-title">${t('offer.done.title')}</h2><p class="muted">${t('offer.done.body')}</p></div>
      <div class="card stack-sm"><div class="num" style="font-size:40px;line-height:44px">${d.time}</div><div class="muted">${dayName(d.day)}</div><div class="small muted">${esc(plabel(place(d.from)))} to ${esc(plabel(place(d.to)))}</div></div>
      <a class="btn primary block" href="#/driving/${d.id}">${t('offer.done.view')}</a><a class="btn secondary block" href="#/offer" data-act="another">${t('offer.done.another')}</a></div>`
    };
  }
  const o = S.offer, v = S.vehicle;
  const days = Array.from({ length: 15 }, (_, i) => `<option value="${i}" ${+fv('o_day', 0) === i ? 'selected' : ''}>${dayOption(i)}</option>`).join('');
  const maxSeats = +v.seats;
  if (o.seats > maxSeats) o.seats = maxSeats;
  let route = '';
  if (o.routeState === 'loading') route = `<p class="row small muted" role="status">${miniLoader()}<span>${t('offer.route.loading')}</span></p>`;
  else if (o.routeState === 'ok') route = `<p class="row" role="status">${ic('car')}<span style="font-weight:600">${t('offer.route.result', { km: o.route.km.toFixed(1), min: o.route.min })}</span></p>`;
  else if (o.routeState === 'error') route = `<div role="alert">${banner('bad', 'alert', t('offer.route.err'))}<button type="button" class="btn secondary sm" style="margin-top:8px" data-act="retryRoute">${t('offer.route.retry')}</button></div>`;
  else if (o.routeState === 'same') route = `<p class="err" role="alert">${ic('alert')}<span>${t('offer.err.same')}</span></p>`;
  const pick = (w, id, which) => { const p = place(id); const bad = S.errs.places && !p; return `<button type="button" class="field-btn" id="pick-${w}" data-act="pickPlace" data-arg="${w}" ${bad ? 'aria-invalid="true"' : ''}><span class="${which === 'from' ? 'dot-from' : 'dot-to'}" aria-hidden="true"></span><span class="grow"><span class="lbl">${t('offer.' + which)}</span><span class="val ${p ? '' : 'ph'}">${p ? esc(plabel(p)) : t('find.' + which + 'Placeholder')}</span></span></button>`; };
  const seatTokens = Array.from({ length: maxSeats }, (_, k) => k + 1).map(n => `<label class="seat"><input type="radio" name="o_seats" value="${n}" ${o.seats === n ? 'checked' : ''}><span class="mag"><span class="face ${n <= o.seats ? 'on' : ''}">${ic('seat')}</span></span><span class="sr-only">${tp('offer.seats.value', n)}</span></label>`).join('');
  return {
    title: t('offer.title'), tab: 'offer',
    after() { const row = $('#seats-row'); if (row) M.lean(row); },
    html: `${appbar(t('offer.title'), { back: false })}<div class="page">
    <p class="muted">${t('offer.subtitle')}</p>
    <form class="stack" data-form="offer" data-persist novalidate>
      <div class="pair">${pick('ofrom', o.from, 'from')}${pick('oto', o.to, 'to')}</div>
      ${S.errs.places ? `<p class="err" role="alert">${ic('alert')}<span>${S.errs.places}</span></p>` : ''}${route}
      <div class="row dt">
        <div class="field grow day"><label for="o_day">${t('offer.day')}</label><div class="sel"><div class="sel"><select class="select" id="o_day" name="o_day" ${S.errs.o_day ? 'aria-invalid="true"' : ''}>${days}</select>${ic('down')}</div>${ic('down')}</div></div>
        <div class="field time"><label for="o_time">${t('offer.time')}</label><input class="input" id="o_time" name="o_time" type="time" value="${fv('o_time', '07:30')}" required ${S.errs.o_time ? 'aria-invalid="true" aria-describedby="o_time-err"' : ''}></div>
      </div>
      ${errMsg('o_time')}${S.errs.o_day ? `<p class="err" role="alert">${ic('alert')}<span>${S.errs.o_day}</span></p>` : ''}
      <fieldset class="stack"><legend>${t('offer.seats')}</legend><div class="seats" id="seats-row">${seatTokens}</div>${offerReadout()}<p class="sr-only" id="seats-sr" role="status"></p></fieldset>
      ${field({ id: 'o_note', label: t('offer.note'), opt: true, tag: 'textarea', value: fv('o_note', ''), attrs: 'maxlength="140" rows="2" placeholder="' + t('offer.note.placeholder') + '"' })}
      <section class="card stack" aria-labelledby="op-h"><h2 class="h3" id="op-h">${t('offer.price.title')}</h2><p class="small muted">${t('offer.price.body')}</p><div id="offer-price" class="stack">${offerPrice()}</div>
        <div class="switch"><label for="o_free"><span style="font-weight:600">${t('offer.free')}</span><span class="small muted">${t('offer.free.hint')}</span></label><input type="checkbox" role="switch" id="o_free" name="o_free" ${fv('o_free', false) ? 'checked' : ''}></div></section>
      <div class="switch"><label for="o_rep"><span style="font-weight:600">${t('offer.repeat')}</span> <span class="status mute">${t('offer.repeat.soon')}</span></label><input type="checkbox" role="switch" id="o_rep" disabled></div>
      ${S.errs.limit ? `<div role="alert">${banner('bad', 'alert', S.errs.limit)}</div>` : ''}
      <p class="pill-lock">${ic('lock', 'sm')}<span>${t('offer.private')}</span></p>
      ${ctaButton({ id: 'publish', label: t('offer.cta'), done: t('offer.done.title') })}
    </form></div>`
  };
};

/* ================= MY RIDES ================= */
ROUTES.rides = function () {
  if (!S.user) {
    return { title: t('rides.title'), tab: 'rides', html: appbar(t('rides.title'), { back: false }) + `<div class="page"><div class="empty">${emptyArt()}<h2 class="big-title">${t('rides.visitor.title')}</h2><p class="muted" style="max-width:32ch">${t('rides.visitor.body')}</p><button class="btn primary" data-act="signInTab" data-arg="#/rides">${t('rides.visitor.cta')}</button></div></div>` };
  }
  const role = S.ridesRole, when = S.ridesWhen;
  const tabs = (name, cur, items) => `<div class="seg" role="tablist" aria-label="${name}">${items.map(([k, l]) => `<button role="tab" id="tab-${k}" aria-selected="${cur === k}" tabindex="${cur === k ? 0 : -1}" data-act="${k === 'riding' || k === 'driving' ? 'setRole' : 'setWhen'}" data-arg="${k}">${l}</button>`).join('')}</div>`;
  let items = [];
  if (role === 'riding') {
    const b = S.booking;
    if (b) {
      const st = bst(b), isPast = ['rejected', 'expired', 'cancelled', 'rideCancelled', 'completed', 'no_show'].includes(st);
      if ((when === 'past') === isPast) {
        const r = RIDES[b.r], v = b.v, cls = { requested: 'wait', confirmed: 'ok', rejected: 'bad', expired: 'mute', cancelled: 'mute', rideCancelled: 'bad', completed: 'ok', no_show: 'bad' }[st];
        items.push(`<li><a class="card ride" href="#/booking" data-enter><div><div class="tm" data-vt-src="ride-time">${r.dep}</div><div class="dy">${dayName(0)}</div></div><div class="pr">${b.unread ? `<span class="badge" aria-hidden="true">1</span><span class="sr-only">${t('a11y.statusUpdated')}</span>` : ''}</div>${stopRail({ nm: esc(v.pu) }, { nm: esc(v.do) }, 'data-vt-src="ride-route"')}<div class="foot">${avatar(r.driver)}<span class="who">${esc(USERS[r.driver].name)}</span><span class="status ${cls}">${t('status.' + st)}</span>${st === 'confirmed' || st === 'completed' ? `<span class="seats price sm" style="font-size:18px">${money(curPrice(b))}</span>` : ''}</div></a></li>`);
      }
    }
  } else {
    S.driving.forEach(d => {
      const past = d.status === 'cancelled' || S.phase === 'after';
      if ((when === 'past') !== past) return;
      const st = d.status === 'cancelled' ? 'cancelled' : S.phase === 'after' ? (d.pax.length ? 'completed' : 'expired') : 'published';
      const cls = { published: 'ok', cancelled: 'mute', completed: 'ok', expired: 'mute' }[st];
      const rq = d.status === 'published' && S.phase !== 'after' ? d.requests.length : 0;
      items.push(`<li><a class="card ride" href="#/driving/${d.id}"><div><div class="tm">${d.time}</div><div class="dy">${dayName(d.day)}</div></div><div class="pr">${rq ? `<span class="badge" aria-hidden="true">${rq}</span>` : ''}</div>${stopRail({ nm: esc(plabel(place(d.from))) }, { nm: esc(plabel(place(d.to))) })}<div class="foot"><span class="status ${cls}">${st === 'cancelled' ? t('status.rideCancelled') : t('status.' + st)}</span>${rq ? `<span class="who">${tp('rides.requests', rq)}</span>` : ''}<span class="seats">${t('rides.seatsTaken', { booked: d.pax.length, total: d.seats })}</span></div></a></li>`);
    });
  }
  let body;
  if (items.length) body = `<ul class="list" role="tabpanel" aria-labelledby="tab-${role}">${items.join('')}</ul>`;
  else if (when === 'past') body = `<p class="muted center" style="padding:32px 0" role="tabpanel">${t('rides.empty.past')}</p>`;
  else body = `<div class="empty" role="tabpanel">${emptyArt()}<h2 class="big-title">${t('rides.empty.' + role + '.title')}</h2><p class="muted" style="max-width:32ch">${t('rides.empty.' + role + '.body')}</p><a class="btn primary" href="#/${role === 'riding' ? 'find' : 'offer'}">${t('rides.empty.' + role + '.cta')}</a></div>`;
  return { title: t('rides.title'), tab: 'rides', html: appbar(t('rides.title'), { back: false }) + `<div class="page">${tabs(t('rides.title'), role, [['riding', t('rides.riding')], ['driving', t('rides.driving')]])}${tabs(t('rides.title'), when === 'up' ? 'up' : 'past', [['up', t('rides.upcoming')], ['past', t('rides.past')]])}${body}</div>` };
};

/* ================= DRIVER RIDE ================= */
const dstat = d => (d.status === 'cancelled' ? 'cancelled' : S.phase === 'after' ? (d.pax.length ? 'completed' : 'expired') : 'published');
ROUTES.driving = function (id) {
  const d = S.driving.find(x => x.id === id);
  if (!d) return screenNotFound();
  const st = dstat(d), v = S.vehicle || { fuel: d.fuel }, n = d.pax.length, cost = tripCost(d.km, d.fuel);
  const open = st === 'published';
  const pn = priceFor(d.km, d.fuel, Math.max(n, 1));
  let h = appbar(t('driverRide.title'), { fallback: '#/rides' }) + '<div class="page">';
  if (S.drvMsg) h += `<div role="status">${banner('ok', 'check', S.drvMsg)}</div>`;
  if (S.errs.drv) h += `<div role="alert">${banner('bad', 'alert', S.errs.drv)}</div>`;
  h += `<div class="row between"><div><div class="big-title" style="font-variant-numeric:tabular-nums">${d.time}</div><div class="muted">${dayName(d.day)}, ${dayStr(d.day)}</div></div><span class="status ${st === 'published' || st === 'completed' ? 'ok' : 'mute'}">${st === 'cancelled' ? t('status.rideCancelled') : t('status.' + st)}</span></div>`;
  h += mapBlock({ key: placeKey(d.from, d.to), exact: true, walk: false });
  h += `<div class="card stack">${stopRail({ nm: esc(plabel(place(d.from))) }, { nm: esc(plabel(place(d.to))) })}<p class="small muted">${t('rides.seatsTaken', { booked: n, total: d.seats })} · ${t('common.km', { n: d.km.toFixed(1) })}</p>${d.note ? `<p class="small">${esc(d.note)}</p>` : ''}</div>`;
  h += `<section class="card stack" aria-labelledby="dp-h"><h2 class="h3" id="dp-h">${t('offer.price.title')}</h2>`;
  if (d.free) h += `<div class="price">${t('common.free')}</div>`;
  else if (n === 0) h += `<div class="price"><small>${t('card.upTo')}</small> ${money(priceFor(d.km, d.fuel, 1))}</div><p class="small muted">${t('driverRide.recover.none', { fuel: money(cost) })}</p>`;
  else h += `<div class="price">${money(pn)}</div><p class="small">${t('driverRide.priceNow', { price: money(pn) })}</p><p class="save">${t('driverRide.recover', { amount: money(n * pn), fuel: money(cost) })}</p>`;
  h += `<table class="table"><caption>${t('detail.priceTable.caption')}</caption><thead class="sr-only"><tr><th>${t('detail.priceTable.col1')}</th><th>${t('detail.priceTable.col2')}</th></tr></thead><tbody>${Array.from({ length: d.seats }, (_, k) => k + 1).map(k => `<tr><th scope="row">${tp('detail.priceTable.n', k)}</th><td>${d.free ? t('common.free') : money(priceFor(d.km, d.fuel, k))}</td></tr>`).join('')}</tbody></table><p class="small muted">${t('driverRide.fuelRule')}</p></section>`;
  if (open && S.phase !== 'after') {
    h += `<section class="stack" aria-labelledby="rq-h"><h2 class="h3" id="rq-h">${t('driverRide.requests')}${d.requests.length ? ` <span class="badge">${d.requests.length}</span>` : ''}</h2>`;
    h += d.requests.length ? `<ul class="list">${d.requests.map((q, qi) => {
      const u = USERS[q.u], full = n >= d.seats, first = qi === 0; // one primary: the next request to answer
      return `<li class="card stack"><div class="row"><a href="#/user/${q.u}" class="row grow" style="text-decoration:none;color:inherit">${avatar(q.u)}<span class="grow"><span style="font-weight:600;display:block">${esc(u.name)}</span>${ratingHtml(u)}</span></a></div>
        <p class="small">${t('driverRide.request.route', { pickup: esc(q.pu), dropoff: esc(q.do) })}</p><p class="small muted">${d.free ? t('common.free') : (n === 0 ? t('driverRide.request.pays.one', { price: money(priceFor(d.km, d.fuel, 1)) }) : t('driverRide.request.pays', { price: money(priceFor(d.km, d.fuel, n + 1)), n: n + 1 }))}</p>
        <div class="row"><button class="btn ${first ? 'primary' : 'secondary'} grow" data-act="accept" data-arg="${q.id}" ${full ? 'aria-disabled="true"' : ''}>${t('driverRide.accept')}</button><button class="btn ghost grow" data-act="decline" data-arg="${q.id}">${t('driverRide.decline')}</button></div></li>`;
    }).join('')}</ul>` : `<p class="muted">${t('driverRide.noRequests')}</p>`;
    h += '</section>';
  }
  h += `<section class="stack" aria-labelledby="px-h"><h2 class="h3" id="px-h">${t('driverRide.passengers')}</h2>`;
  const firstUnrated = d.pax.find(p => !p.noShow && !S.rated['p:' + p.id]);
  h += n ? `<ul class="list">${d.pax.map(p => {
    const u = USERS[p.u], key = 'p:' + p.id, firstRate = firstUnrated && firstUnrated.id === p.id; // one primary at a time
    return `<li class="card stack"><div class="row">${avatar(p.u)}<a class="grow" href="#/user/${p.u}" style="font-weight:600">${esc(u.name)}</a>${p.noShow ? `<span class="status bad">${t('status.no_show')}</span>` : ''}</div>
      ${!p.noShow ? `<div class="row"><a class="btn tonal grow" href="tel:${p.phone.replace(/\s/g, '')}">${ic('phone')}${t('booking.call')}</a><a class="btn tonal grow" href="#" data-act="whatsapp">${ic('chat')}${t('booking.whatsapp')}</a></div><p class="small">${p.phone}</p>` : ''}
      ${S.phase === 'after' && !p.noShow ? `<div class="row">${S.rated[key] ? `<span class="small muted grow">${t('rate.done.title')}</span>` : `<a class="btn ${firstRate ? 'primary' : 'secondary'} sm grow" href="#/rate/p/${p.id}">${ic('star')}${t('driverRide.rate', { name: u.name })}</a>`}<button class="btn secondary sm grow" data-act="noShow" data-arg="${p.id}">${t('rideday.noShow')}</button></div>` : ''}</li>`;
  }).join('')}</ul>` : `<p class="muted">${t('driverRide.noPassengers')}</p>`;
  h += '</section>';
  if (S.phase === 'day' && open && n) h += `<a class="btn danger-outline block" href="tel:112">${ic('phone')}${t('rideday.call112')}</a>`;
  if (open && S.phase !== 'after') h += `<button class="btn danger-outline block" data-act="cancelRide" data-arg="${d.id}">${t('driverRide.cancel')}</button>`;
  if (st === 'cancelled') h += banner('plain', 'info', t('driverRide.cancelled'));
  h += '</div>';
  return { title: t('driverRide.title'), html: h };
};

/* ================= RATING ================= */
ROUTES.rate = function (a, b) {
  const isDriver = a === 'driver';
  let who, key, tags;
  if (isDriver) { who = RIDES[S.booking.r].driver; key = who; tags = ['punctual', 'friendly', 'safe', 'clean']; }
  else { const d = S.driving.find(x => x.pax.some(p => p.id === b)); const p = d.pax.find(x => x.id === b); who = p.u; key = 'p:' + b; tags = ['punctual', 'friendly', 'respectful', 'onTime']; }
  const name = USERS[who].name;
  if (S.rated[key]) {
    return { title: t('rate.done.title'), html: `${appbar(t('rate.done.title'), { fallback: '#/rides' })}<div class="page"><div class="empty"><span class="avatar lg c2" aria-hidden="true">${ic('check')}</span><h2 class="big-title">${t('rate.done.title')}</h2><p class="muted" style="max-width:32ch">${t('rate.done.body', { name })}</p></div><a class="btn primary block" href="#/rides">${t('rate.done.cta')}</a></div>` };
  }
  const cur = +fv('r_stars', 0);
  const stars = [1, 2, 3, 4, 5].map(n => `<label class="${n <= cur ? 'on' : ''}"><input type="radio" name="r_stars" value="${n}" ${cur === n ? 'checked' : ''} aria-label="${tp('rate.star', n)}">${starIc}</label>`).join('');
  const tg = tags.map(k => `<label class="chip"><input type="checkbox" name="r_tag_${k}" ${fv('r_tag_' + k) ? 'checked' : ''}><span>${t('rate.tag.' + k)}</span></label>`).join('');
  return {
    title: t('rate.title', { name }),
    html: `${appbar(t('rate.title', { name }), { fallback: '#/rides' })}<div class="page"><div class="row">${avatar(who, 'lg')}<div><div class="big-title">${esc(name)}</div></div></div>
    <form class="stack" data-form="rate" data-persist data-key="${key}" novalidate>
      <fieldset class="stack"><legend>${t('rate.stars')}</legend><div class="starpick">${stars}</div>${errMsg('r_stars')}</fieldset>
      <fieldset class="stack"><legend>${t('rate.tags')} <span class="muted" style="font-weight:400">(${t('common.optional')})</span></legend><div class="chips">${tg}</div></fieldset>
      <p class="small muted">${t('rate.window')}</p>
      <button class="btn primary block" type="submit">${t('rate.submit')}</button></form></div>`
  };
};

/* ================= PROFILE / USER / SETTINGS ================= */
ROUTES.profile = function (a) {
  if (!S.user) {
    return { title: t('me.title'), tab: 'profile', html: appbar(t('me.title'), { back: false }) + `<div class="page"><div class="empty">${emptyArt()}<h2 class="big-title">${t('me.visitor.title')}</h2><p class="muted" style="max-width:32ch">${t('me.visitor.body')}</p><button class="btn primary" data-act="signInTab" data-arg="#/profile">${t('me.visitor.cta')}</button></div><p class="small muted center">${t('app.pronounce')}</p></div>` };
  }
  if (a === 'edit') return { title: t('profile.edit.title'), html: appbar(t('profile.edit.title'), { fallback: '#/profile' }) + `<div class="page">${profileForm(false)}</div>` };
  if (a === 'car') return { title: t('vehicle.title'), html: appbar(t('vehicle.title'), { fallback: '#/profile' }) + `<div class="page"><p>${t('vehicle.body')}</p>${vehicleForm(false)}</div>` };
  const p = S.profile, v = S.vehicle;
  return {
    title: t('me.title'), tab: 'profile',
    html: `${appbar(t('me.title'), { back: false })}<div class="page"><div class="row">${avatar('me', 'lg')}<div><div class="big-title">${esc(p.firstName)}</div><div class="small muted">${t('pub.new')}</div></div></div>
    <div class="group"><a class="list-row" href="#/user/me">${ic('user')}<span class="grow">${t('me.viewPublic')}</span>${ic('chev')}</a><a class="list-row" href="#/profile/edit">${ic('gear')}<span class="grow">${t('me.edit')}</span>${ic('chev')}</a>
    <a class="list-row" href="#/profile/car">${ic('car')}<span class="grow">${t('me.car')}<span class="sub">${v ? `${esc(v.make)} ${esc(v.model)}, ${esc(v.colour)}` : t('me.car.none')}</span></span>${ic('chev')}</a><a class="list-row" href="#/settings">${ic('gear')}<span class="grow">${t('me.settings')}</span>${ic('chev')}</a></div>
    <button class="btn secondary block" data-act="signOut">${t('me.signOut')}</button></div>`
  };
};
ROUTES.user = function (id) {
  const me = id === 'me';
  const u = me ? { name: myName(), rating: null, n: 0, rides: 0, since: 'November 2026', late: 0, noshow: 0, bio: S.profile.bio } : USERS[id];
  if (!u) return screenNotFound();
  const menu = me ? '' : `<button class="icon-btn" data-act="userMenu" data-arg="${id}" aria-label="${t('common.moreOptions')}" aria-haspopup="dialog">${ic('more')}</button>`;
  return {
    title: u.name,
    html: `${appbar(esc(u.name), { fallback: '#/profile', right: menu })}<div class="page"><div class="row">${avatar(me ? 'me' : id, 'lg')}<div class="stack-sm"><div class="big-title">${esc(u.name)}</div>${ratingHtml(u)}<div class="small muted">${t('pub.since', { month: u.since })}</div></div></div>
    ${u.n < 3 ? `<p class="small muted">${t('pub.new.hint')}</p>` : ''}
    <dl class="card"><div class="kv"><dt>${tp('pub.rides', u.rides).replace(/^\d+ /, '')}</dt><dd>${u.rides}</dd></div><div class="kv"><dt>${t('pub.late')}</dt><dd>${u.late}</dd></div><div class="kv"><dt>${t('pub.noShows')}</dt><dd>${u.noshow}</dd></div></dl>
    ${u.bio ? `<div class="card stack-sm"><h2 class="label" style="font-size:16px;line-height:20px">${t('pub.about', { name: u.name })}</h2><p>${esc(u.bio)}</p></div>` : ''}
    <p class="pill-lock">${ic('lock', 'sm')}<span>${t('pub.private')}</span></p></div>`
  };
};
ROUTES.settings = function (a) {
  if (a === 'blocked') {
    return { title: t('block.title.list'), html: appbar(t('block.title.list'), { fallback: '#/settings' }) + `<div class="page">${S.blocked.length ? `<ul class="group">${S.blocked.map(k => `<li class="list-row">${avatar(k)}<span class="grow">${esc(USERS[k].name)}</span><button class="btn secondary sm" data-act="unblock" data-arg="${k}">${t('block.unblock')}</button></li>`).join('')}</ul>` : `<p class="muted">${t('block.empty')}</p>`}</div>` };
  }
  return {
    title: t('settings.title'),
    html: `${appbar(t('settings.title'), { fallback: '#/profile' })}<div class="page">
    <section class="stack-sm"><h2 class="label">${t('settings.notifications')}</h2><div class="group"><div class="list-row"><span class="grow">${t('settings.email')}<span class="sub">${t('settings.email.value')}</span></span></div><div class="list-row"><span class="grow">${t('settings.push')}<span class="sub">${t('settings.push.value')}</span></span></div></div></section>
    <section class="stack-sm"><h2 class="label">${t('settings.language')}</h2><div class="group"><div class="list-row"><span class="grow">${t('settings.language.value')}</span></div></div></section>
    <section class="stack-sm"><h2 class="label">${t('settings.safety')}</h2><div class="group"><a class="list-row" href="#/settings/blocked">${ic('ban')}<span class="grow">${t('settings.blocked')}</span>${ic('chev')}</a></div></section>
    <section class="stack-sm"><h2 class="label">${t('settings.privacy')}</h2><div class="group"><a class="list-row" href="#/policy/privacy">${ic('shield')}<span class="grow">${t('settings.policy')}</span>${ic('chev')}</a><a class="list-row" href="#/policy/terms">${ic('info')}<span class="grow">${t('settings.terms')}</span>${ic('chev')}</a><button class="list-row" data-act="requestData">${ic('mail')}<span class="grow">${t('settings.data')}</span></button><a class="list-row danger" href="#/delete">${ic('trash')}<span class="grow">${t('settings.delete')}</span>${ic('chev')}</a></div></section>
    <p class="small muted center">${t('settings.version', { v: '0.1 prototype' })}</p></div>`
  };
};
ROUTES.policy = function (a) {
  const k = a === 'terms' ? 'terms' : 'privacy';
  return { title: t('policy.' + k + '.title'), html: `${appbar(t('policy.' + k + '.title'), { fallback: '#/settings' })}<div class="page"><p class="small muted">${t('policy.version', { v: '1.0', date: '15 Nov 2026' })}</p>${[1, 2, 3, 4].map(n => `<p>${t('policy.' + k + '.p' + n)}</p>`).join('')}${k === 'privacy' ? `<p class="small muted">${t('policy.controller')}</p>` : ''}</div>` };
};
ROUTES.delete = function () {
  return { title: t('delete.title'), html: `${appbar(t('delete.title'), { fallback: '#/settings' })}<div class="page"><p style="font-weight:600">${t('delete.body')}</p><ul class="stack">${['l1', 'l2', 'l3'].map(k => `<li class="row" style="align-items:flex-start">${ic('alert')}<span>${t('delete.' + k)}</span></li>`).join('')}</ul>
  <button class="btn danger block" data-act="confirmDelete">${t('delete.confirm')}</button><a class="btn secondary block" href="#/settings" data-autofocus>${t('delete.keep')}</a></div>` };
};

/* ================= FORMS ================= */
const FORMS = {
  search() { syncSearch(); const s = S.search; if (!s.from || !s.to) { S.errs.search = t('find.err.missing'); return render({ keep: true, focusErr: true }); } if (s.from === s.to) { S.errs.search = t('find.err.same'); return render({ keep: true }); } if (!s.time) { S.errs.search = t('find.err.timeMissing'); return render({ keep: true }); } runSearch(); },
  request(fd, form) {
    const [id, i] = form.dataset.arg.split('|'), v = variantFor(id, +i);
    const btn = $('#send-btn'); if (btn.classList.contains('is-done')) return;
    const queued = S.offline, ok = queued ? t('request.saved') : t('request.sent.toast');
    $('#live').textContent = t('request.sending');
    // the Haide moment only when the request really leaves (never when it is only queued offline)
    M.launch(btn, { haide: !queued, ok }).then(() => {
      closeSheet(true);
      S.booking = { r: id, v, status: 'requested', lock: null, queued, rated: false, dropped: false, unread: false };
      S.extraJoined = 0;
      toast(ok);
      nav('#/booking');
    });
  },
  email(fd) {
    const e = (fd.get('email') || '').trim(); S.f.email = e;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { S.errs.email = t('auth.email.err'); return render({ keep: true, focusErr: true }); }
    S.authEmail = e; nav('#/auth/check');
  },
  consent(fd) {
    const age = fd.get('c_age'), tm = fd.get('c_terms');
    if (!age) S.errs.c_age = t('consent.err.age'); if (!tm) S.errs.c_terms = t('consent.err.terms');
    if (!age || !tm) return render({ keep: true, focusErr: true });
    S.consent = true; S.f = {}; advance();
  },
  profile(fd, form) {
    const nm = (fd.get('firstName') || '').trim(), ph = (fd.get('phone') || '').replace(/[\s.-]/g, ''), bio = (fd.get('bio') || '').trim();
    if (!/^[\p{L}][\p{L} '’-]{0,29}$/u.test(nm)) S.errs.firstName = t('profile.err.name');
    if (!/^(\+40|0040|0)7\d{8}$/.test(ph)) S.errs.phone = t('profile.err.phone');
    if (!S.profile.photoUrl && !S.profile.photo) S.errs.photo = t('profile.err.photo');
    if (Object.keys(S.errs).length) { S.f.firstName = nm; S.f.phone = fd.get('phone'); S.f.bio = bio; return render({ keep: true, focusErr: true }); }
    S.profile = { ...S.profile, firstName: nm, phone: fd.get('phone').trim(), bio, photo: true };
    ['firstName', 'phone', 'bio'].forEach(k => delete S.f[k]);
    if (form.dataset.setup === '1') advance(); else { nav('#/profile', { replace: true }); toast(t('common.save')); }
  },
  vehicle(fd, form) {
    ['v_make', 'v_model', 'v_colour'].forEach(k => { if (!(fd.get(k) || '').trim()) S.errs[k] = t('vehicle.err.required'); });
    const plate = (fd.get('v_plate') || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (!/^[A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{3}$/.test(plate)) S.errs.v_plate = t('vehicle.err.plate');
    if (Object.keys(S.errs).length) { ['v_make', 'v_model', 'v_colour'].forEach(k => (S.f[k] = fd.get(k))); S.f.v_plate = fd.get('v_plate'); return render({ keep: true, focusErr: true }); }
    S.vehicle = { make: fd.get('v_make').trim(), model: fd.get('v_model').trim(), colour: fd.get('v_colour').trim(), plate, fuel: fd.get('v_fuel'), seats: +fd.get('v_seats') };
    ['v_make', 'v_model', 'v_colour', 'v_plate', 'v_fuel', 'v_seats'].forEach(k => delete S.f[k]);
    if (form.dataset.setup === '1') advance(); else { nav('#/profile', { replace: true }); toast(t('common.save')); }
  },
  offer(fd) {
    const o = S.offer, day = +fd.get('o_day'), tm = fd.get('o_time');
    if (!o.from || !o.to) S.errs.places = t('offer.err.places');
    else if (o.routeState === 'same') S.errs.places = t('offer.err.same');
    if (!tm || (day === 0 && parseT(tm) < NOW + 15)) S.errs.o_time = t('offer.err.time');
    if (S.dayLimit) S.errs.limit = t('offer.err.limit', { day: dayName(day) });
    if (o.routeState === 'loading' || o.routeState === 'error') S.errs.places = S.errs.places || t('offer.route.err');
    if (Object.keys(S.errs).length) return render({ keep: true, focusErr: true });
    const btn = $('#publish'); if (btn.classList.contains('is-done')) return;
    $('#live').textContent = t('offer.publishing');
    M.launch(btn, { ok: t('offer.done.title') }).then(() => {
      const id = 'd' + (S.nextId++);
      S.driving.unshift({ id, day, time: tm, from: o.from, to: o.to, km: o.route.km, min: o.route.min, fuel: S.vehicle.fuel, seats: o.seats, note: fd.get('o_note') || '', free: !!fd.get('o_free'), status: 'published', requests: [], pax: [] });
      S.publishedId = id; ['o_note', 'o_free'].forEach(k => delete S.f[k]);
      S.offer = { from: null, to: null, seats: Math.min(3, +S.vehicle.seats), route: null, routeState: 'idle' };
      nav('#/offer/done'); // the page itself confirms, no toast on top of its buttons
    });
  },
  rate(fd, form) {
    const n = +fd.get('r_stars');
    if (!n) { S.errs.r_stars = t('rate.err'); return render({ keep: true, focusErr: true }); }
    const key = form.dataset.key; S.rated[key] = true;
    if (S.booking && key === RIDES[S.booking.r].driver) S.booking.rated = true;
    $$('[name^="r_"]').forEach(el => delete S.f[el.name]); delete S.f.r_stars;
    toast(t('rate.toast')); render();
  },
  report(fd, form) {
    const reason = fd.get('reason');
    if (!reason) { $('#rep-err').innerHTML = `${ic('alert')}<span>${t('report.err')}</span>`; $('#rep-err').hidden = false; $('input[name=reason]').focus(); return; }
    const u = form.dataset.arg;
    if (fd.get('also')) { if (!S.blocked.includes(u)) S.blocked.push(u); }
    openSheet(`${sheetHead(t('report.sent.title'))}<div class="body"><div role="status">${banner('ok', 'check', t('report.sent.body'))}</div><button class="btn primary block" data-act="closeSheet" data-autofocus>${t('common.done')}</button></div>`);
    $('#live').textContent = t('report.toast');
  }
};
function syncSearch() { const d = $('#s_day'), tm = $('#s_time'), w = $('input[name=s_win]:checked'); if (d) S.search.day = +d.value; if (tm) S.search.time = tm.value; if (w) S.search.win = +w.value; }

/* ================= ACTIONS ================= */
function openReport(uid) {
  const name = USERS[uid].name;
  const reasons = ['noShow', 'unsafe', 'harassment', 'extraMoney', 'fake', 'other'].map(k => `<label class="check"><input type="radio" name="reason" value="${k}"><span>${t('report.reason.' + k)}</span></label>`).join('');
  openSheet(`${sheetHead(t('report.title', { name }))}<form class="body" data-form="report" data-arg="${uid}" novalidate><p>${t('report.body', { name })}</p>
    <fieldset><legend>${t('report.reason')}</legend>${reasons}<p class="err" id="rep-err" hidden role="alert"></p></fieldset>
    <div class="field"><label for="rep-d">${t('report.details')} <span class="muted" style="font-weight:400">(${t('common.optional')})</span></label><textarea class="input" id="rep-d" name="details" maxlength="500" data-count-key="report.details.hint" aria-describedby="rep-d-count"></textarea><p class="hint" id="rep-d-count">${t('report.details.hint', { n: 0 })}</p></div>
    <label class="check"><input type="checkbox" name="also"><span>${t('report.alsoBlock', { name })}</span></label>
    <div class="actions"><button class="btn primary block" type="submit">${t('report.send')}</button></div></form>`);
}
function openBlock(uid) {
  const name = USERS[uid].name;
  openSheet(`${sheetHead(t('block.title', { name }))}<div class="body"><p>${t('block.body')}</p><div class="actions"><button class="btn danger block" data-act="confirmBlock" data-arg="${uid}">${t('block.confirm', { name })}</button><button class="btn secondary block" data-act="closeSheet" data-autofocus>${t('block.keep')}</button></div></div>`);
}
const ACT = {
  back(fb) { if (history.state && history.state.i > 0) history.back(); else nav(fb || '#/find', { replace: true }); },
  closeSheet() { closeSheet(); },
  skip() { $('#main').focus(); },
  pickPlace(w) { openPicker(w); },
  choosePlace(id) { setPlace(id); },
  useLocation() {
    $('#loc-label').textContent = t('place.locating'); $('#loc-sub').textContent = '';
    setTimeout(() => { if (SHEET && S.picker) setPlace(/to/.test(S.picker.target) ? 'p4' : 'p1'); }, 700);
  },
  onMap() { toast(t('place.mapSoon')); },
  swap() { syncSearch(); const s = S.search;[s.from, s.to] = [s.to, s.from]; render({ keep: true }); },
  corridor(arg) { syncSearch(); const [a, b] = arg.split('|'); S.search.from = a; S.search.to = b; S.errs = {}; runSearch(); },
  retry() { S.searchError = S.offline; S.loading = true; render({ keep: true }); setTimeout(() => { S.loading = false; if (parseRoute().name === 'results') render(); }, 650); },
  notify() { S.notified = true; toast(t('results.notified')); render({ keep: true }); },
  requestSeat(arg) {
    const [id, i] = arg.split('|');
    if (!S.user || !S.consent || !profileOk()) { startGate('request', location.hash, { id, vi: i }); return; }
    openRequest(id, i);
  },
  signInTab(back) { startGate(back === '#/rides' ? 'rides' : 'profile', back); },
  startOffer() { startGate('offer', '#/offer'); },
  closeAuth() { const i = S.intent; S.intent = null; nav(i ? i.back : '#/find', { replace: true }); },
  google() { S.authEmail = 'ioana@example.com'; S.user = { email: S.authEmail }; advance(); },
  openLink() { S.user = { email: S.authEmail }; advance(); },
  resend() { toast(t('auth.check.resent')); },
  declineConsent() { S.user = null; S.f = {}; S.intent = null; toast(t('me.signOut.toast')); nav('#/find', { replace: true }); },
  cancelBooking() { openCancelBooking(); },
  confirmCancelBooking() { const b = S.booking; b.status = 'cancelled'; closeSheet(true); toast(t('booking.cancel.toast')); render({ keep: true }); },
  share() {
    openSheet(`${sheetHead(t('rideday.share'))}<div class="body"><p>${t('rideday.share.body')}</p><div class="card flat small" style="word-break:break-all">haide.ro/t/k7Qx2mRb</div><div class="actions"><button class="btn primary block" data-act="copyLink" data-autofocus>${ic('copy')}${t('rideday.share.copy')}</button></div></div>`);
  },
  copyLink() { closeSheet(); toast(t('rideday.share.copied')); },
  whatsapp(a, el, e) { e.preventDefault(); toast('Prototype: this opens WhatsApp'); },
  driverMissing() {
    const u = USERS[RIDES[S.booking.r].driver].name;
    openSheet(`${sheetHead(t('rideday.driverMissing.title', { driver: u }))}<div class="body"><p>${t('rideday.driverMissing.body')}</p><div class="actions"><button class="btn danger block" data-act="confirmDriverMissing">${t('rideday.driverMissing.confirm')}</button><button class="btn secondary block" data-act="closeSheet" data-autofocus>${t('common.close')}</button></div></div>`);
  },
  confirmDriverMissing() { S.booking.status = 'no_show'; closeSheet(true); toast(t('rideday.driverMissing.toast')); render({ keep: true }); },
  openReport(uid) { openReport(uid); },
  userMenu(uid) {
    const name = USERS[uid].name;
    openSheet(`${sheetHead(t('common.moreOptions'))}<div class="body"><div class="group"><button class="list-row" data-act="openReport" data-arg="${uid}" data-autofocus>${ic('flag')}<span class="grow">${t('pub.menu.report', { name })}</span></button><button class="list-row danger" data-act="openBlock" data-arg="${uid}">${ic('ban')}<span class="grow">${t('pub.menu.block', { name })}</span></button></div></div>`);
  },
  openBlock(uid) { openBlock(uid); },
  confirmBlock(uid) { if (!S.blocked.includes(uid)) S.blocked.push(uid); closeSheet(true); toast(t('block.toast', { name: USERS[uid].name })); nav('#/find', { replace: true }); },
  unblock(uid) { S.blocked = S.blocked.filter(x => x !== uid); toast(t('block.unblocked', { name: USERS[uid].name })); render({ keep: true }); },
  seats(d) { S.offer.seats = Math.max(1, Math.min(+S.vehicle.seats, S.offer.seats + +d)); render({ keep: true }); },
  retryRoute() { computeRoute(); render({ keep: true }); },
  another() { S.offer = { from: null, to: null, seats: Math.min(3, +S.vehicle.seats), route: null, routeState: 'idle' }; },
  setRole(k) { S.ridesRole = k; render({ keep: true }); },
  setWhen(k) { S.ridesWhen = k; render({ keep: true }); },
  accept(qid) {
    const d = S.driving.find(x => x.requests.some(q => q.id === qid)), q = d.requests.find(x => x.id === qid);
    if (d.pax.length >= d.seats) { S.errs.drv = t('driverRide.err.full'); return render({ keep: true }); }
    d.requests = d.requests.filter(x => x.id !== qid); d.pax.push({ id: qid, u: q.u, phone: q.phone, noShow: false });
    const price = priceFor(d.km, d.fuel, d.pax.length);
    S.drvMsg = d.free ? '' : t('driverRide.priceNow', { price: money(price) });
    toast(t('driverRide.accept.toast', { name: USERS[q.u].name })); render({ keep: true });
  },
  decline(qid) { const d = S.driving.find(x => x.requests.some(q => q.id === qid)); d.requests = d.requests.filter(x => x.id !== qid); toast(t('driverRide.decline.toast')); render({ keep: true }); },
  cancelRide(id) {
    const d = S.driving.find(x => x.id === id), n = d.pax.length, late = parseT(d.time) - nowMin() <= 30;
    openSheet(`${sheetHead(t('driverRide.cancel.title'))}<div class="body"><p>${n ? tp('driverRide.cancel.body', n) : t('driverRide.cancel.body.none')}</p>${late ? banner('warn', 'alert', t('driverRide.cancel.late')) : ''}<div class="actions"><button class="btn danger block" data-act="confirmCancelRide" data-arg="${id}">${t('driverRide.cancel.confirm')}</button><button class="btn secondary block" data-act="closeSheet" data-autofocus>${t('driverRide.cancel.keep')}</button></div></div>`);
  },
  confirmCancelRide(id) { S.driving.find(x => x.id === id).status = 'cancelled'; closeSheet(true); toast(t('driverRide.cancel.toast')); render({ keep: true }); },
  noShow(pid) {
    const d = S.driving.find(x => x.pax.some(p => p.id === pid)), p = d.pax.find(x => x.id === pid), name = USERS[p.u].name;
    openSheet(`${sheetHead(t('rideday.noShow.title', { name }))}<div class="body"><p>${t('rideday.noShow.body')}</p><div class="actions"><button class="btn danger block" data-act="confirmNoShow" data-arg="${pid}">${t('rideday.noShow.confirm')}</button><button class="btn secondary block" data-act="closeSheet" data-autofocus>${t('rideday.noShow.keep')}</button></div></div>`);
  },
  confirmNoShow(pid) { const d = S.driving.find(x => x.pax.some(p => p.id === pid)), p = d.pax.find(x => x.id === pid); p.noShow = true; closeSheet(true); toast(t('rideday.noShow.toast', { name: USERS[p.u].name })); render({ keep: true }); },
  signOut() { S = freshState('visitor'); toast(t('me.signOut.toast')); nav('#/find', { replace: true }); syncDemo(); },
  requestData() { toast(t('settings.data.toast')); },
  confirmDelete() { S = freshState('visitor'); toast(t('delete.toast')); nav('#/find', { replace: true }); syncDemo(); }
};

/* ================= DEMO CONTROLS (prototype only) ================= */
function syncDemo() { const th = $(`input[name=theme][value=${document.documentElement.dataset.theme}]`); if (th) th.checked = true; $('#d-rm').setAttribute('aria-pressed', M.reduced()); const r = $(`input[name=persona][value=${S.persona}]`); if (r) r.checked = true; const p = $(`input[name=phase][value=${S.phase}]`); if (p) p.checked = true; $('#d-off').setAttribute('aria-pressed', S.offline); $('#d-lim').setAttribute('aria-pressed', S.dayLimit); }
const DEMO = {
  reset() { S = freshState('visitor'); S.f = {}; nav('#/find', { replace: true }); },
  accept() { const b = S.booking; if (!b || b.status !== 'requested') return toast('Prototype: send a seat request first'); b.status = 'confirmed'; b.lock = priceFor(b.v.km, RIDES[b.r].fuel, curN(b)); b.unread = true; S.unread++; toast(USERS[RIDES[b.r].driver].name + ' accepted. Check My rides.'); render({ keep: true }); },
  decline() { const b = S.booking; if (!b || b.status !== 'requested') return toast('Prototype: send a seat request first'); b.status = 'rejected'; b.unread = true; S.unread++; toast('Request declined. Check My rides.'); render({ keep: true }); },
  join() { const b = S.booking; if (!b || b.status !== 'confirmed') return toast('Prototype: get a seat accepted first'); S.prevPrice = curPrice(b); S.extraJoined++; const np = priceFor(b.v.km, RIDES[b.r].fuel, curN(b)); b.dropped = np < b.lock; b.lock = Math.min(b.lock, np); S.dropPulse = true; b.unread = true; S.unread++; toast(t('booking.priceDropped', { price: money(b.lock) })); render({ keep: true }); },
  rideCancelled() { const b = S.booking; if (!b || !['requested', 'confirmed'].includes(b.status)) return toast('Prototype: needs an active booking'); b.status = 'rideCancelled'; b.unread = true; S.unread++; toast(t('booking.rideCancelled.title', { driver: USERS[RIDES[b.r].driver].name })); render({ keep: true }); },
  tick() { if (S.phase !== 'day') return toast('Prototype: switch to 07:15 ride day first'); S.etaFrom = Math.max(0, parseT(RIDES.r1.dep) - nowMin()); S.tick = Math.min((S.tick || 0) + 1, 10); render({ keep: true }); },
  motion() { M.setReduced(!M.reduced()); syncDemo(); render({ keep: true }); },
  offline() { S.offline = !S.offline; if (!S.offline && S.booking && S.booking.queued) { S.booking.queued = false; toast('Back online. Your request was sent.'); } syncDemo(); render({ keep: true }); },
  limit() { S.dayLimit = !S.dayLimit; syncDemo(); toast(S.dayLimit ? 'Prototype: you now have 4 rides today' : 'Prototype: ride limit cleared'); }
};

/* ================= events + init ================= */
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (a) {
    e.preventDefault();
    if (a.matches('a.card.ride')) { // names are unique per state: clear the list, then tag the card that is leaving
      $$('[data-vt-src]').forEach(el => { el.style.viewTransitionName = ''; }); S.vtHref = a.getAttribute('href');
      $$('[data-vt-src]', a).forEach(el => { el.style.viewTransitionName = el.dataset.vtSrc; });
    }
    if (a.dataset.act && ACT[a.dataset.act]) ACT[a.dataset.act](a.dataset.arg, a, e); nav(a.getAttribute('href')); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') {
    if (el && el.getAttribute('aria-disabled') === 'true' && el.dataset.act === 'accept') ACT.accept(el.dataset.arg);
    return;
  }
  const fn = ACT[el.dataset.act];
  if (fn) { if (el.tagName === 'A') e.preventDefault(); fn(el.dataset.arg, el, e); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault(); S.errs = {};
  const h = FORMS[f.dataset.form]; if (h) h(new FormData(f), f);
});
function persist(e) {
  const el = e.target;
  if (el.id === 'pq') return refreshPlaces(el.value);
  if (el.id === 'photo' && e.type === 'change') {
    const file = el.files && el.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { S.errs.photo = t('profile.err.photoSize'); return render({ keep: true, focusErr: true }); }
    S.profile.photoUrl = URL.createObjectURL(file); S.profile.photo = true; S.errs = {}; return render({ keep: true });
  }
  if (el.dataset && el.dataset.countKey) { const c = $('#' + el.id + '-count'); if (c) c.textContent = t(el.dataset.countKey, { n: el.value.length }); }
  if (el.name === 'o_seats' && e.type === 'change') { S.f.o_seats = el.value; return changeSeats(+el.value); }
  if (el.name && /^s_/.test(el.name)) return syncSearch();
  const form = el.form;
  if (!form || form.dataset.persist === undefined || !el.name) return;
  if (el.type === 'radio' && !el.checked) return;
  S.f[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  if (e.type === 'change' && (el.name === 'r_stars' || el.name === 'o_free')) render({ keep: true });
}
document.addEventListener('input', persist);
document.addEventListener('pointerdown', e => { const f = e.target.closest && e.target.closest('.seat'); if (f) M.seatPress($('.face', f)); });
document.addEventListener('change', persist);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (SHEET) { e.preventDefault(); closeSheet(); } else if (!$('#demo-panel').hidden) { toggleDemo(false); }
    return;
  }
  if (e.key === 'Tab' && SHEET) {
    const sh = $('.sheet'); const f = $$('button,a[href],input,select,textarea,[tabindex="0"]', sh).filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sh)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  const tab = e.target.closest && e.target.closest('[role=tab]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const tabs = $$('[role=tab]', tab.parentElement); let i = tabs.indexOf(tab);
    i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault(); tabs[i].click(); const k = '#' + tabs[i].id; setTimeout(() => $(k) && $(k).focus(), 0);
  }
});
window.addEventListener('popstate', () => { IDX = (history.state && history.state.i) || 0; if (SHEET) closeSheet(true); S.errs = {}; M.transition(() => render()); });

/* demo panel */
function toggleDemo(open) {
  const p = $('#demo-panel'), b = $('#demo-btn');
  const show = open === undefined ? p.hidden : open;
  p.hidden = !show; b.setAttribute('aria-expanded', show);
}
$('#demo-btn').addEventListener('click', () => toggleDemo());
$$('input[name=persona]').forEach(r => r.addEventListener('change', () => {
  if (SHEET) closeSheet(true);
  const ph = S.phase; S = freshState(r.value); S.phase = ph;
  nav('#/find', { replace: true }); syncDemo(); toggleDemo(false);
}));
$$('input[name=theme]').forEach(r => r.addEventListener('change', () => { document.documentElement.dataset.theme = r.value; $('meta[name=theme-color]').content = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim(); toast('Theme: ' + r.value); }));
$$('input[name=phase]').forEach(r => r.addEventListener('change', () => { S.phase = r.value; S.tick = 0; render({ keep: true }); toast('Time ' + clockLabel()); toggleDemo(false); }));
$$('[data-demo]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.demo; DEMO[k](); if (!['offline', 'limit', 'motion', 'tick'].includes(k)) toggleDemo(false); }));

/* init */
$('.skip').textContent = t('common.skipToMain');
buildBasemap();
S = freshState('visitor');
history.replaceState({ i: 0 }, '', location.hash || '#/find');
render();
syncDemo();

