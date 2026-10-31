'use strict';
/* =====================================================================
   STADIUM-DT model: illustrative layout, aggregate crowd-flow model, synthetic sensors and fusion,
   anomaly rules, short-horizon forecast, what-if scenarios and congestion-aware routing.
   Every number is produced by this synthetic model. Gate and section IDs are illustrative.
   ===================================================================== */

/* ---------------- layout of the pilot concourse (west side), metres ----------------
   x runs along the concourse (north = +x), z across it (east = +z, towards the bowl).
   This plan is a stylised concept, not derived from BIM or as-built data. */
const L = { facadeZ: -91, corrIn: -91, corrOut: -98, midZ: -94.5, alcoveZ: -101, buildZ: -105, servZ: -106.8, plazaZ: -108.6, x0: -55, zl: 11, nz: 10, corrW: 7 };
const ZONES = [];
const AREA_F = [1, 0.96, 0.94, 0.91, 0.81, 0.91, 0.88, 0.91, 0.96, 1];   // fixtures, columns and the 104/105 ramp narrow some zones
for (let i = 0; i < L.nz; i++) {
  const x0 = L.x0 + i * L.zl;
  ZONES.push({ i, id: `CONC-W-0${10 + i}`, short: `W-0${10 + i}`, x0, x1: x0 + L.zl, xc: x0 + L.zl / 2, area: Math.round(L.zl * L.corrW * AREA_F[i]) });
}
const zoneIdxAt = x => clamp(Math.floor((x - L.x0) / L.zl), 0, L.nz - 1);
const zoneById = id => ZONES.find(z => z.id === id || z.short === id);

/* attachment points on the concourse: 'out' = plaza side, 'in' = bowl side, 'end' = continues to the next concourse */
const ATT = {
  LINK_S: { x: -64, side: 'end', label: 'South concourse link' },
  LINK_N: { x: 64, side: 'end', label: 'North concourse link' },
  REST_A: { x: -49.5, side: 'out', w: 10, label: 'Restroom A' },
  RAMP: { x: -46, side: 'in', w: 2.2, label: 'Accessible ramp' },
  GATE_D: { x: -40, side: 'out', w: 6, label: 'Gate D (auxiliary)' },
  ELEV_A: { x: -38.5, side: 'in', w: 2.6, label: 'Elevator A' },
  GATE_A: { x: -27.5, side: 'out', w: 9, label: 'Gate A' },
  POR_102: { x: -27.5, side: 'in', w: 3.2, label: 'Portal 102' },
  CONC_A: { x: -15, side: 'out', w: 12, label: 'Concession A' },
  POR_104: { x: -5.5, side: 'in', w: 4, label: 'Section 104/105 access corridor' },
  GATE_B: { x: -2, side: 'out', w: 10, label: 'Gate B' },
  CONC_B: { x: 9.5, side: 'out', w: 11, label: 'Concession B' },
  STAIR_1: { x: 13, side: 'in', w: 2.6, label: 'Stair 1' },
  STAIR_2: { x: 24, side: 'in', w: 2.6, label: 'Stair 2' },
  GATE_C: { x: 27.5, side: 'out', w: 9, label: 'Gate C' },
  POR_108: { x: 38.5, side: 'in', w: 3.2, label: 'Portal 108' },
  REST_B: { x: 39, side: 'out', w: 10, label: 'Restroom B' },
  MED: { x: 50.5, side: 'out', w: 9, label: 'First-aid station' }
};
const GATES = {
  A: { att: 'GATE_A', label: 'Gate A', lanes: 8, share: 0.30, w: 9 },
  B: { att: 'GATE_B', label: 'Gate B', lanes: 10, share: 0.42, w: 10 },
  C: { att: 'GATE_C', label: 'Gate C', lanes: 8, share: 0.28, w: 9 },
  D: { att: 'GATE_D', label: 'Gate D (auxiliary)', lanes: 6, share: 0.18, w: 6, aux: true }
};
const LANE_RATE = 6.5;            // screened entries per lane per minute (demo assumption)
const SPEC_FLOW = 1.25;           // people per metre per second through openings and corridors
const AMEN = {
  CONC_A: { label: 'Concession A', type: 'food', servers: 12, rate: 1.2, qcap: 40 },
  CONC_B: { label: 'Concession B', type: 'food', servers: 12, rate: 1.2, qcap: 40 },
  REST_A: { label: 'Restroom A', type: 'rest', servers: 28, rate: 0.75, qcap: 30 },
  REST_B: { label: 'Restroom B', type: 'rest', servers: 28, rate: 0.75, qcap: 30 }
};
const OUTLETS = {
  POR_102: { cap: 270, label: 'Portal 102' }, POR_104: { cap: 330, label: 'Sections 104/105 corridor' }, POR_108: { cap: 270, label: 'Portal 108' },
  STAIR_1: { cap: 160, label: 'Stair 1', stair: true }, STAIR_2: { cap: 160, label: 'Stair 2', stair: true },
  ELEV_A: { cap: 18, label: 'Elevator A', access: true }, RAMP: { cap: 60, label: 'Accessible ramp', access: true }
};
const GROUPS = [
  { id: 'G102', label: 'Sections 101–103', short: '101–103', cap: 2200, x: -27.5, outlets: ['POR_102'] },
  { id: 'G104', label: 'Sections 104–105', short: '104–105', cap: 1800, x: -5.5, outlets: ['POR_104'] },
  { id: 'G108', label: 'Sections 106–109', short: '106–109', cap: 2400, x: 38.5, outlets: ['POR_108'] },
  { id: 'GUP', label: 'Upper West 201–209', short: '201–209', cap: 3200, x: 18.5, outlets: ['STAIR_1', 'STAIR_2', 'ELEV_A', 'RAMP'] }
];
const CATCH = sum(GROUPS.map(g => g.cap));
const ATTEND = 0.965;            // simulated attendance fraction
const EXIT_CAP = { GATE_A: 9 * SPEC_FLOW * 60, GATE_B: 10 * SPEC_FLOW * 60, GATE_C: 9 * SPEC_FLOW * 60, GATE_D: 6 * SPEC_FLOW * 60, LINK_S: 300, LINK_N: 300 };
const EXIT_PREF = { GATE_A: 0, GATE_B: -6, GATE_C: 0, GATE_D: 8, LINK_S: 70, LINK_N: 70 };

/* ---------------- game-day schedule (simulated) ---------------- */
const T = h => { const [a, b] = h.split(':').map(Number); return a * 3600 + b * 60; };
const SCHED = { open: T('18:00'), kickoff: T('19:30'), half: T('20:52'), halfEnd: T('21:12'), final: T('22:34') };
const PHASES = [
  { id: 'pregame', label: 'PRE-GAME', jump: T('19:02') },
  { id: 'first', label: '1ST HALF', jump: T('19:58') },
  { id: 'half', label: 'HALFTIME', jump: T('20:53') },
  { id: 'second', label: '2ND HALF', jump: T('21:40') },
  { id: 'post', label: 'POST-GAME', jump: T('22:35') }
];
function phaseAt(c) {
  if (c < SCHED.kickoff) return 'pregame';
  if (c < SCHED.half) return 'first';
  if (c < SCHED.halfEnd) return 'half';
  if (c < SCHED.final) return 'second';
  return 'post';
}
const phaseLabel = id => (PHASES.find(p => p.id === id) || PHASES[0]).label;
function gameClock(c) {                     // illustrative quarter clock
  const ph = phaseAt(c);
  if (ph === 'pregame') return { q: 'PRE', t: fmtMS(SCHED.kickoff - c) };
  if (ph === 'half') return { q: 'HALF', t: fmtMS(SCHED.halfEnd - c) };
  if (ph === 'post') return { q: 'FINAL', t: '00:00' };
  const h0 = ph === 'first' ? SCHED.kickoff : SCHED.halfEnd, h1 = ph === 'first' ? SCHED.half : SCHED.final;
  const f = (c - h0) / (h1 - h0) * 2, q = Math.min(1, Math.floor(f));
  return { q: `Q${(ph === 'first' ? 1 : 3) + q}`, t: fmtMS(900 * (1 - (f - q))) };
}
/* arrivals at the pilot gates (people/min): asymmetric bump peaking about 19:12 */
const ARR_PEAK = 201, LINK_PEAK = 24.7;
function arrivalShape(c) {
  const m = (c - SCHED.open) / 60;
  if (m < 0 || m > 125) return 0;
  const d = m - 72;
  return Math.exp(-0.5 * (d / (d < 0 ? 22 : 14)) ** 2);
}
/* amenity trips per seated spectator per minute */
function amenityRate(c) {
  const ph = phaseAt(c);
  if (ph === 'pregame') return 0.0025;
  if (ph === 'half') { const h = (c - SCHED.half) / 60; return 0.002 + 0.0115 * Math.exp(-(((h - 5) / 4) ** 2)); }
  if (ph === 'post') return 0;
  return 0.0022 * (1 + 0.25 * Math.sin(c / 400));
}

/* ---------------- fundamental diagram ---------------- */
const KJAM = 5.4;
const vk = k => Math.max(0.06, 1.34 * (1 - Math.pow(clamp(k, 0, KJAM) / KJAM, 1.5)));

/* ---------------- path profiles between attachments (cached by index) ---------------- */
const AK = Object.keys(ATT), AI = {}; AK.forEach((k, i) => AI[k] = i);
const NA = AK.length;
const PROFA = new Array(NA * NA);
function prof(a, b) { const i = AI[a] * NA + AI[b]; return PROFA[i] || (PROFA[i] = makeProf(a, b)); }
function makeProf(a, b) {
  let p;
  const A = ATT[a], B = ATT[b];
  const xa = A.x, xb = B.x, lo = Math.min(xa, xb), hi = Math.max(xa, xb), sg = Math.sign(xb - xa) || 1;
  const along = new Float32Array(L.nz), cross = new Float32Array(L.nz), dirx = new Float32Array(L.nz), dirz = new Float32Array(L.nz);
  for (const z of ZONES) {
    const o = Math.max(0, Math.min(z.x1, hi) - Math.max(z.x0, lo));
    along[z.i] = o; dirx[z.i] = sg * o;
  }
  if (A.side !== 'end') { const i = zoneIdxAt(xa); cross[i] += 3.5; dirz[i] += A.side === 'out' ? 3.5 : -3.5; }
  if (B.side !== 'end') { const i = zoneIdxAt(xb); cross[i] += 3.5; dirz[i] += B.side === 'in' ? 3.5 : -3.5; }
  let len = hi - lo + (A.side !== 'end' ? 3.5 : 0) + (B.side !== 'end' ? 3.5 : 0);
  const tot = new Float32Array(L.nz);
  for (let i = 0; i < L.nz; i++) tot[i] = along[i] + cross[i];
  const zs = []; for (let i = 0; i < L.nz; i++) if (tot[i] > 0) zs.push(i);
  p = { a, b, along, cross, dirx, dirz, tot, len, zs: Int8Array.from(zs), ext: Math.max(0, len - sum(tot)) };
  return p;
}

/* ---------------- configuration of the simulated venue ---------------- */
function defaultCfg() {
  return {
    gateOpen: { A: true, B: true, C: true, D: false },
    outletOpen: { POR_102: true, POR_104: true, POR_108: true, STAIR_1: true, STAIR_2: true, ELEV_A: true, RAMP: true },
    amenOpen: { CONC_A: true, CONC_B: true, REST_A: true, REST_B: true },
    restrict: new Array(L.nz).fill(1),
    demandMul: 1, gateCapMul: 1, exitCapMul: 1, amenMul: 1,
    awareness: 0.25, extraServers: { CONC_A: 0, CONC_B: 0, REST_A: 0, REST_B: 0 },
    phased: false, weather: 'clear'
  };
}
const cloneCfg = c => JSON.parse(JSON.stringify(c));

