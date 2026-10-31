'use strict';
/* =====================================================================
   Synthetic sensors, fusion, anomaly rules and forecast (the digital twin)
   ===================================================================== */
const CAMERAS = [
  { id: 'CAM-W-01', x: -52, z: -91.6, zones: [0, 1], yaw: 0.35 },
  { id: 'CAM-W-02', x: -33, z: -97.8, zones: [1, 2], yaw: -2.6 },
  { id: 'CAM-W-03', x: -19, z: -91.6, zones: [3, 4], yaw: 0.2 },
  { id: 'CAM-W-04', x: 1.5, z: -91.6, zones: [4, 5], yaw: -0.25 },
  { id: 'CAM-W-05', x: 17, z: -97.8, zones: [5, 6], yaw: 2.75 },
  { id: 'CAM-W-06', x: 27, z: -91.6, zones: [6, 7], yaw: 0.25 },
  { id: 'CAM-W-07', x: 44.5, z: -97.8, zones: [8, 9], yaw: -2.9 },
  { id: 'CAM-G-B', x: 6, z: -108.8, zones: [], gate: 'B', yaw: 1.97 }
];
const WIFI = [
  { id: 'AP-W-01', x: -44, z: -94.5, zones: [0, 1] },
  { id: 'AP-W-02', x: -22, z: -94.5, zones: [2, 3] },
  { id: 'AP-W-03', x: 0, z: -94.5, zones: [4, 5] },
  { id: 'AP-W-04', x: 22, z: -94.5, zones: [6, 7] },
  { id: 'AP-W-05', x: 44, z: -94.5, zones: [8, 9] }
];
const SRC_INFO = {
  cctv: { label: 'CCTV-derived analytics', short: 'CCTV', latency: 2, note: 'Counts, direction, speed and queue estimates computed at the edge; no footage leaves the camera node; no facial recognition.' },
  wifi: { label: 'WiFi aggregate telemetry', short: 'WiFi', latency: 30, note: 'Device activity summed per access point over 30 s windows. Not a person count: the device-to-person ratio drifts.' },
  turnstile: { label: 'Turnstile counts', short: 'Turnstiles', latency: 1, note: 'Entries per gate per minute and gate status. No ticket-holder identities.' }
};

class Twin {
  constructor() {
    this.m = new Model();
    this.cfg = this.m.cfg;
    this.est = ZONES.map(() => ({ N: 0, k: 0, v: 1.3, fin: 0, fout: 0, conf: 0.9, sig: 2, dir: 'STATIONARY', cE: 0, cW: 0, aP: 0, aN: 0, q: 0, cf: 0, err: 0, src: {} }));
    this.gest = {}; for (const k in GATES) this.gest[k] = { Q: 0, thr: 0, conf: 0.95 };
    this.aest = {}; for (const k in AMEN) this.aest[k] = { Q: 0, conf: 0.9 };
    this.cc = ZONES.map(() => 0); this.wc = ZONES.map(() => 0); this.mc = ZONES.map(() => 0);
    this.delay = [];                  // truth history for delayed WiFi windows
    this.ratio = 0.55;                // true device-to-person ratio (drifts)
    this.acc = 0; this.facc = 0; this.dacc = 0;
    this.alerts = new Map(); this.alertSeq = 0; this.cond = new Map();
    this.fc = null;
    this.hist = ZONES.map(() => []);
    this.sens = { cctv: 'ONLINE', wifi: 'ONLINE', turnstile: 'ONLINE' };
    TWIN = this;
  }
  init(clock) {
    this.m.init(clock); this.cfg = this.m.cfg;
    this.delay = [];
    for (let j = 0; j < L.nz; j++) { const z = this.m.z[j], e = this.est[j]; e.N = z.N; e.k = z.k; e.v = z.v; e.sig = 0.08 * z.N + 2; this.hist[j] = []; }
    this.alerts.clear(); this.cond.clear();
    this.sense(1); this.forecast();
  }
  step(dt) {
    this.m.step(dt);
    this.acc += dt; this.facc += dt; this.dacc += dt;
    if (this.acc >= 1) { this.sense(this.acc); this.acc = 0; }
    if (this.dacc >= 2) { this.detect(); this.dacc = 0; }
    if (this.facc >= 5 && !this.job) { this.forecastStart(); this.facc = 0; }
  }
  /* --- synthetic sensing and inverse-variance fusion --- */
  sense(dt) {
    const m = this.m, src = S.sources, ph = phaseAt(m.clock);
    this.sens.cctv = src.cctv ? 'ONLINE' : 'DISABLED'; this.sens.wifi = src.wifi ? 'ONLINE' : 'DISABLED'; this.sens.turnstile = src.turnstile ? 'ONLINE' : 'DISABLED';
    this.delay.push(m.z.map(z => z.N)); if (this.delay.length > 31) this.delay.shift();
    const lag = this.delay[0];
    const target = ph === 'half' ? 0.61 : ph === 'pregame' ? 0.5 : 0.56;
    this.ratio += (target - this.ratio) * dt / 400 + 0.002 * rndN() * Math.sqrt(dt);
    for (let j = 0; j < L.nz; j++) {
      const z = m.z[j], e = this.est[j], N = z.N;
      this.cc[j] = 0.9 * this.cc[j] + 0.44 * 0.05 * rndN();
      this.wc[j] = 0.95 * this.wc[j] + 0.31 * 0.1 * rndN();
      this.mc[j] = 0.97 * this.mc[j] + 0.24 * 0.04 * rndN();
      const ms = [];
      // model propagation from the previous estimate using measured (or estimated) gate flows
      const prevTrue = e._prevTrue === undefined ? N : e._prevTrue;
      const q = src.turnstile ? 0.1 : 0.3;
      const pred = Math.max(0, e.N + (N - prevTrue) * (1 + q * this.mc[j] * 10) + (src.turnstile ? 0 : 0.01 * N * this.mc[j] * 5));
      const sp = Math.sqrt(e.sig * e.sig + (q * Math.abs(N - prevTrue)) ** 2 + (0.015 * N + 0.6) ** 2 * dt);
      ms.push([pred, sp, 'model']);
      e._prevTrue = N;
      if (src.cctv) {
        const occl = 0.02 + 0.035 * Math.max(0, z.k - 2);
        const zc = N * (1 - occl) * (1 + this.cc[j]);
        ms.push([zc, 0.06 * N + 2, 'cctv']);
      }
      if (src.wifi) {
        const zw = lag[j] * (this.ratio / 0.55) * (1 + this.wc[j]);
        ms.push([zw, 0.2 * N + 5, 'wifi']);
      }
      let wsum = 0, xs = 0; e.src = {};
      for (const [x, s, k] of ms) { const w = 1 / (s * s); wsum += w; xs += w * x; e.src[k] = w; }
      for (const k in e.src) e.src[k] /= wsum;
      e.N = xs / wsum; e.sig = Math.min(1 / Math.sqrt(wsum), 0.6 * e.N + 10);
      e.k = e.N / z.A; e.err = N > 3 ? (e.N - N) / N : 0;
      e.conf = clamp(1 - 2.8 * e.sig / Math.max(e.N, 25), 0.25, 0.97);
      e.v = src.cctv ? z.v * (1 + 0.04 * this.cc[j]) : vk(e.k);
      const fq = src.turnstile ? 0.04 : 0.12;
      e.fin = Math.max(0, z.fin * (1 + fq * this.mc[j] * 6)); e.fout = Math.max(0, z.fout * (1 + fq * this.mc[j] * 6));
      e.aP = z.aP; e.aN = z.aN; e.cE = z.cE; e.cW = z.cW; e.cf = z.cf;
      e.dx = z.dx; e.dz = z.dz; e.dir = dirLabel(z.dx, z.dz);
      e.q = 0; for (const k in AMEN) if (zoneIdxAt(ATT[k].x) === j) e.q += m.a[k].Q;
      e.B = z.B; e.C = z.C; e.D = z.D; e.A = z.A; e.loiter = z.loiter;
      const h = this.hist[j]; h.push([m.clock, e.k, e.N]); if (h.length > 400) h.shift();
    }
    for (const k in GATES) {
      const g = m.g[k], ge = this.gest[k];
      ge.thr = src.turnstile ? g.e : g.e * (1 + 0.15 * this.mc[0] * 5);
      ge.Q = src.cctv ? g.Q * (1 + 0.5 * this.cc[1]) : g.Q * (1 + 0.25 * this.wc[2] * 3);
      ge.conf = src.cctv && src.turnstile ? 0.93 : src.cctv || src.turnstile ? 0.78 : 0.55;
      ge.xout = g.xout; ge.xq = g.xq;
    }
    for (const k in AMEN) { const a = m.a[k], ae = this.aest[k]; ae.Q = src.cctv ? a.Q * (1 + 0.6 * this.cc[3]) : a.Q * (1 + 0.3 * this.wc[4] * 3); ae.conf = src.cctv ? 0.88 : 0.6; ae.served = a.served; }
  }
  meanConf() { return sum(this.est.map(e => e.conf)) / L.nz; }
  /* --- anomaly rules on the estimated state, with onset and clearing hysteresis --- */
  detect() {
    const m = this.m, now = m.clock, found = [];
    for (let j = 0; j < L.nz; j++) {
      const e = this.est[j], h = this.hist[j];
      let slope = 0;
      for (let i = h.length - 1; i >= 0; i--) if (now - h[i][0] >= 30) { slope = (e.k - h[i][1]) / ((now - h[i][0]) / 60); break; }
      e.slope = slope;
      if (e.k >= BOTTLENECK_K) found.push(['HIGH_DENSITY', j, 'HIGH DENSITY', 3]);
      else if (e.k >= 2.5 && slope > 0.05) found.push(['CONGESTION', j, 'CONGESTION DEVELOPING', 2]);
      if (e.v < 0.55 && e.k > 2) found.push(['SLOWDOWN', j, 'MOVEMENT SLOWDOWN', 2]);
      if (e.cf >= 0.55 && e.aP + e.aN > 250 && e.k > 2.7) found.push(['COUNTERFLOW', j, 'COUNTER-FLOW DETECTED', 1]);
      if (e.D > e.C * 0.95) found.push(['CAPACITY', j, 'CAPACITY CONSTRAINT', 2]);
    }
    for (const k in AMEN) { const q = this.aest[k].Q; if (q > AMEN[k].qcap + 8) found.push(['SPILL_' + k, zoneIdxAt(ATT[k].x), 'QUEUE SPILLOVER', 2, AMEN[k].label]); }
    for (const s of ['STAIR_1', 'STAIR_2']) {
      if (!this.cfg.outletOpen[s]) continue;
      const j = zoneIdxAt(ATT[s].x), e = this.est[j];
      const dem = m.flowTo(s) + m.flowFrom(s);
      if (dem > OUTLETS[s].cap * 0.85 || (e.k > 2.8 && dem > 40)) found.push(['STAIR_' + s, j, 'STAIR BOTTLENECK', 2, OUTLETS[s].label]);
    }
    for (const k in GATES) { const q = this.gest[k].Q; if (q > 260) found.push(['GATEQ_' + k, zoneIdxAt(ATT[GATES[k].att].x), 'GATE QUEUE BUILD-UP', 1, GATES[k].label]); }
    const seen = new Set();
    for (const [type, j, label, sev, asset] of found) {
      const key = type + '@' + j; seen.add(key);
      const c = this.cond.get(key) || { since: now, last: now };
      c.last = now; this.cond.set(key, c);
      if (!this.alerts.has(key) && now - c.since >= 6) {
        const a = { key, id: `AL-${String(++this.alertSeq).padStart(3, '0')}`, type, zone: j, label, sev, asset, t0: now, open: true };
        this.alerts.set(key, a);
        logEvent('alert', `${label}${asset ? ' at ' + asset : ''} in ${ZONES[j].id}`, { alert: a.id, zone: j });
      }
    }
    for (const [key, c] of this.cond) if (!seen.has(key) && now - c.last > 20) this.cond.delete(key);
    for (const [key, a] of this.alerts) if (!seen.has(key)) {
      const c = this.cond.get(key);
      if (!c) { this.alerts.delete(key); logEvent('alert', `Cleared: ${a.label.toLowerCase()} in ${ZONES[a.zone].id}`, { zone: a.zone, cleared: true }); }
    }
  }
  /* --- short-horizon forecast: the flow model run forward from the estimated state --- */
  estimatedModel() {
    const f = this.m.clone();
    for (let j = 0; j < L.nz; j++) { const e = this.est[j]; f.z[j].N = e.N; f.z[j].k = e.k; f.z[j].v = vk(e.k); }
    for (const k in GATES) f.g[k].Q = this.gest[k].Q;
    for (const k in AMEN) f.a[k].Q = this.aest[k].Q;
    return f;
  }
  /* forecast runs incrementally (a few model steps per frame) so the interface never stalls */
  forecastStart() {
    const f = this.estimatedModel();
    this.job = { f, t: 0, t0: this.m.clock, series: ZONES.map(() => []), tt: ZONES.map(() => Infinity), h2: null, dtF: 4 };
    this.forecastWork(0);
  }
  forecastWork(n) {
    const J = this.job; if (!J) return;
    const f = J.f;
    for (let i = 0; i <= n; i++) {
      if (J.t > 0 || i > 0) { f.step(J.dtF); J.t += J.dtF; }
      if (J.t % 20 === 0) for (let j = 0; j < L.nz; j++) J.series[j].push(f.z[j].k);
      for (let j = 0; j < L.nz; j++) if (J.tt[j] === Infinity && f.z[j].k >= BOTTLENECK_K) J.tt[j] = J.t;
      if (J.t === 120) J.h2 = f.z.map(z => ({ k: z.k, N: z.N, dx: z.dx, dz: z.dz, aP: z.aP, aN: z.aN, cE: z.cE, cW: z.cW, v: z.v }));
      if (J.t >= 300) { this.forecastFinish(); return; }
    }
  }
  forecastFinish() {
    const J = this.job; this.job = null;
    const f5 = J.f.z.map(z => ({ k: z.k, N: z.N, dx: z.dx, dz: z.dz, aP: z.aP, aN: z.aN, cE: z.cE, cW: z.cW, v: z.v }));
    const out = { t0: J.t0, series: J.series, tt: J.tt, h2: J.h2, h5: f5, gates5: Object.fromEntries(Object.keys(GATES).map(k => [k, J.f.g[k].Q])) };
    out.unc = h => ZONES.map((z, j) => { const e = this.est[j], k = h === 0 ? e.k : (h === 2 ? out.h2[j].k : out.h5[j].k); return Math.sqrt((e.sig / e.A) ** 2 + (k * 0.05 * h) ** 2) * (1.6 - e.conf); });
    let best = -1;
    for (let j = 0; j < L.nz; j++) if (J.tt[j] < Infinity && (best < 0 || J.tt[j] < J.tt[best])) best = j;
    out.next = best >= 0 ? { zone: best, eta: J.tt[best] } : null;
    const prev = this.fc && this.fc.next;
    this.fc = out;
    if (out.next && (!prev || prev.zone !== out.next.zone) && out.next.eta > 0) logEvent('predict', `Bottleneck forecast: ${ZONES[out.next.zone].id} reaches ${BOTTLENECK_K} p/m² in ${fmtMS(out.next.eta)}`, { zone: out.next.zone });
    return out;
  }
  forecast() { this.forecastStart(); while (this.job) this.forecastWork(10); return this.fc; }
  /* time to threshold from the latest forecast, counted down since it was made */
  nextETA() { if (!this.fc || !this.fc.next) return null; return { zone: this.fc.next.zone, eta: Math.max(0, this.fc.next.eta - (this.m.clock - this.fc.t0)) }; }
  predicted(j, h) { if (!this.fc || h === 0) return this.est[j].k; return (h === 2 ? this.fc.h2 : this.fc.h5)[j].k; }
  trend(j) { const k0 = this.est[j].k, k2 = this.predicted(j, 2); return k2 - k0 > 0.12 ? 'Rising' : k2 - k0 < -0.12 ? 'Falling' : 'Stable'; }
  risk(j, h) { const k = h ? this.predicted(j, h) : this.est[j].k; return densLevel(k); }
}

