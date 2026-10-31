'use strict';
/* =====================================================================
   STADIUM-DT core: palette, helpers, random numbers, clock, shared state, event log
   Concept demonstration with synthetic data. Nothing here reads real venue systems.
   ===================================================================== */
const VERSION = '1.0';
const CAPACITY = 106572;              // stadium capacity cited by the proposal
const AGENT_SCALE = 6;                // one rendered agent stands for about six simulated people

const COL = {
  bg: 0x1C1428, deep: 0x120D1C, amber: 0xFFB547, text: 0xF8F1E7, text2: 0xA99DB4, violet: 0x9678C8,
  low: 0x698AB0, mod: 0xFFB547, high: 0xF27868, crit: 0xD84E68, ok: 0x91B49A
};
const HEX = {
  bg: '#1C1428', deep: '#120D1C', amber: '#FFB547', text: '#F8F1E7', text2: '#A99DB4', violet: '#9678C8',
  low: '#698AB0', mod: '#FFB547', high: '#F27868', crit: '#D84E68', ok: '#91B49A'
};

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const sum = a => { let s = 0; for (const v of a) s += v; return s; };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const RNG = mulberry32(20261026);               // visual randomness (agents, sensors)
const rnd = () => RNG();
const rndN = () => gauss(RNG);
const pick = arr => arr[Math.floor(rnd() * arr.length) % arr.length];

/* clock: seconds since midnight on the simulated game day */
const pad2 = n => String(Math.floor(n)).padStart(2, '0');
function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)) % 86400; return `${pad2(sec / 3600)}:${pad2((sec % 3600) / 60)}:${pad2(sec % 60)}`; }
function fmtHM(sec) { sec = Math.max(0, Math.floor(sec)) % 86400; return `${pad2(sec / 3600)}:${pad2((sec % 3600) / 60)}`; }
function fmtMS(sec) { if (!isFinite(sec)) return '--:--'; sec = Math.max(0, Math.round(sec)); return `${pad2(sec / 60)}:${pad2(sec % 60)}`; }
function fmtDur(sec) { if (!isFinite(sec)) return 'n/a'; sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m >= 60 ? `${Math.floor(m / 60)}h ${pad2(m % 60)}m` : `${pad2(m)}m ${pad2(s)}s`; }
const fmtInt = n => Math.round(n).toLocaleString('en-US');
const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1);
const fmt2 = n => (Math.round(n * 100) / 100).toFixed(2);
const pctDiff = (a, b) => a > 0 ? (b - a) / a * 100 : 0;

/* crowd density classes (people per square metre); thresholds are design choices of the demo */
const DENS = [
  { id: 'low', label: 'LOW', max: 1.5, col: COL.low, hex: HEX.low },
  { id: 'moderate', label: 'MODERATE', max: 2.5, col: COL.mod, hex: HEX.mod },
  { id: 'elevated', label: 'ELEVATED', max: 3.5, col: COL.high, hex: HEX.high },
  { id: 'high', label: 'HIGH', max: Infinity, col: COL.crit, hex: HEX.crit }
];
const BOTTLENECK_K = 3.5;
function densLevel(k) { for (const d of DENS) if (k < d.max) return d; return DENS[3]; }

/* heat colour ramp: blue-grey, gold, coral, deep red */
const RAMP = [[0, 0x2C2F4A], [0.18, COL.low], [0.42, COL.mod], [0.66, COL.high], [0.85, COL.crit], [1, 0x9E2346]];
function rampColor(t, out) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
      const a = (t - t0) / (t1 - t0);
      const r = lerp((c0 >> 16) & 255, (c1 >> 16) & 255, a), g = lerp((c0 >> 8) & 255, (c1 >> 8) & 255, a), b = lerp(c0 & 255, c1 & 255, a);
      out.r = r / 255; out.g = g / 255; out.b = b / 255; return out.convertSRGBToLinear ? out.convertSRGBToLinear() : out;
    }
  }
  out.r = 0.62; out.g = 0.14; out.b = 0.27; return out.convertSRGBToLinear ? out.convertSRGBToLinear() : out;
}

/* ---------------- shared application state ---------------- */
const S = {
  mode: 'mirror',            // mirror | predict | simulate | navigate | replay
  area: 'overview',
  horizon: 0,                // 0, 2, 5 minutes (predict mode)
  speed: 1,                  // live clock speed
  paused: false,
  night: true,
  weather: 'clear',          // clear | rain | storm
  sources: { cctv: true, wifi: true, turnstile: true },
  overlay: { density: true, metric: 'density', flow: true, sensors: true, labels: true },
  sel: null,                 // {type, id}
  hover: null,
  follow: null,              // agent id when the operator asked to follow
  focusZone: 'CONC-W-014',
  role: 'spectator',         // spectator | responder | access
  nav: { start: 'QR-03', dest: 'restroom', access: false, crowdAware: true, result: null, show: 'aware' },
  responder: { incidentZone: 'CONC-W-014', stairFree: false },
  scenario: null,            // active scenario lab state
  replay: { t: 0, playing: false, rate: 2 },
  evFilter: 'all',
  tab: 'zones',
  alertsOpen: 0
};

/* ---------------- event log and audit trail ---------------- */
const EVCAT = {
  alert: { label: 'Alert', hex: HEX.high },
  predict: { label: 'Prediction', hex: HEX.violet },
  sim: { label: 'Simulation', hex: HEX.amber },
  operator: { label: 'Operator action', hex: HEX.text },
  route: { label: 'Routing', hex: HEX.ok },
  system: { label: 'System', hex: HEX.text2 }
};
const EVENTS = [];
let evSeq = 0;
const evListeners = [];
function logEvent(cat, text, extra) {
  const ev = Object.assign({ id: ++evSeq, cat, text, clock: TWIN ? TWIN.m.clock : 0 }, extra || {});
  EVENTS.push(ev);
  if (EVENTS.length > 600) EVENTS.splice(0, EVENTS.length - 600);
  for (const f of evListeners) f(ev);
  return ev;
}
let TWIN = null;   // set by the model once the twin exists
