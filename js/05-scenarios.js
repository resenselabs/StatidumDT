'use strict';
/* =====================================================================
   What-if scenarios. Baseline and intervention start from the same snapshot of the estimated
   state and run in the same flow model; the comparison values below are computed, not entered.
   ===================================================================== */
const SCEN = [
  { id: 'gate_close', label: 'Gate Closure', ctx: 'auto', asset: { type: 'gate', opts: ['A', 'B', 'C'], def: 'B' }, desc: 'Close one gate. Arrivals and exits move to the open gates.' },
  { id: 'gate_open', label: 'Additional Gate Opening', ctx: 'auto', asset: null, desc: 'Open the auxiliary Gate D (6 lanes, 6 m opening).' },
  { id: 'stair_close', label: 'Stair Closure', ctx: 'egress', asset: { type: 'stair', opts: ['STAIR_1', 'STAIR_2'], def: 'STAIR_2' }, desc: 'Close one stair from the upper west seats. Its flow moves to the other stair.' },
  { id: 'restrict', label: 'Concourse Restriction', ctx: 'egress', asset: { type: 'zone', opts: ZONES.map(z => z.id), def: 'CONC-W-015' }, desc: 'Reduce one concourse zone to part of its width (maintenance or a temporary structure).' },
  { id: 'halftime', label: 'Halftime Rush', ctx: 'amenity', asset: null, desc: 'Concession and restroom surge at halftime. Intervention: crowd-aware guidance and four extra concession windows.' },
  { id: 'medical', label: 'Medical Response', ctx: 'medical', asset: { type: 'zone', opts: ZONES.map(z => z.id), def: 'CONC-W-014' }, desc: 'Responder dispatch to an incident. Intervention: a reserved responder lane and service-corridor access.' },
  { id: 'weather', label: 'Severe Weather Egress', ctx: 'evac', asset: null, desc: 'Lightning protocol: spectators leave the west seats. Intervention: open Gate D, crowd-aware guidance, phased release of the lower bowl.' },
  { id: 'mass_exit', label: 'Final Whistle / Mass Exit', ctx: 'egress', asset: null, desc: 'Post-game egress of the pilot catchment. Intervention: crowd-aware exit guidance and Gate D open.' },
  { id: 'redirect', label: 'Redirect Spectator Flow', ctx: 'auto', asset: null, desc: 'Raise the share of spectators following crowd-aware guidance.' }
];

function scenarioContext(def, snapClock) {
  if (def.ctx !== 'auto') return def.ctx;
  return phaseAt(snapClock) === 'pregame' ? 'ingress' : 'egress';
}
/* build baseline and intervention models from the twin's estimated state */
function buildScenario(def, P) {
  const base = TWIN.estimatedModel();
  const ctx = scenarioContext(def, base.clock);
  base.cfg.demandMul *= 1; base.cfg.weather = S.weather;
  if (ctx === 'egress' || ctx === 'evac') {
    if (!base.egress) {
      const k = P.demand;
      for (const gr of GROUPS) base.seat[gr.id] = Math.max(base.seat[gr.id], gr.cap * ATTEND) * k;
      for (const g in base.g) base.g[g].Q = 0;
      base.startEgress(ctx === 'evac' ? 'evac' : 'post');
    } else if (P.demand !== 1) for (const gr of GROUPS) base.seat[gr.id] *= P.demand;
    base.cfg.exitCapMul = P.gateCap;
    if (ctx === 'evac') base.egress.mode = 'evac';
  } else if (ctx === 'ingress') {
    base.cfg.demandMul = P.demand; base.cfg.gateCapMul = P.gateCap;
  } else if (ctx === 'amenity') {
    base.init(SCHED.half);
    base.cfg = cloneCfg(TWIN.cfg); base.cfg.amenMul = P.demand; base.cfg.weather = S.weather;
    for (const k in AMEN) base.cfg.extraServers[k] = 0;
    base.cfg.gateCapMul = P.gateCap;
  } else if (ctx === 'medical') {
    base.cfg.demandMul = P.demand; base.cfg.gateCapMul = P.gateCap;
  }
  const intv = base.clone();
  const c = intv.cfg;
  switch (def.id) {
    case 'gate_close': c.gateOpen[P.asset] = false; break;
    case 'gate_open': c.gateOpen.D = true; break;
    case 'stair_close': c.outletOpen[P.asset] = false; break;
    case 'restrict': c.restrict[zoneById(P.asset).i] = P.width; break;
    case 'halftime': if (P.opt.guide) c.awareness = 0.85; if (P.opt.windows) c.extraServers.CONC_B = 4, c.extraServers.CONC_A = 0; break;
    case 'medical': if (P.opt.lane) intv.respLane = { zone: zoneById(P.asset).i, until: intv.clock + 240 }; break;
    case 'weather': if (P.opt.gateD) c.gateOpen.D = true; if (P.opt.guide) c.awareness = 0.85; if (P.opt.phased) c.phased = true; break;
    case 'mass_exit': if (P.opt.guide) c.awareness = 0.85; if (P.opt.gateD) c.gateOpen.D = true; break;
    case 'redirect': c.awareness = P.compliance; break;
  }
  if (def.id === 'medical' && intv.respLane) applyLane(intv);
  return { base, intv, ctx };
}
/* responder dispatch time: 45 s call handling plus travel at crowd-limited speed (lane: about 1.55 m/s) */
function responderETA(model, zoneIdx, intervention) {
  const p = responderPath(zoneIdx, intervention, false, !intervention);
  if (!p) return { eta: Infinity, path: null };
  const lane = new Set(intervention ? p.zones : []);
  let t = 45;
  for (const e of p.edges) {
    let v = 1.7;
    if (e.zone >= 0) v = lane.has(e.zone) ? 1.55 : 1.7 * Math.max(0.28, 1 - model.z[e.zone].k / 5.2);
    if (e.kind === 'stair') v = 0.8;
    t += e.len / v;
  }
  return { eta: t, path: p };
}
function applyLane(model) {
  const r = model.respLane; if (!r) return;
  const route = responderPath(r.zone, true, false, false);
  r.zones = route ? route.zones : [r.zone];
  for (const j of r.zones) model.cfg.restrict[j] = Math.min(model.cfg.restrict[j], 0.82);
}
/* advance one model and record what the comparison needs */
function recorder(model, ctx) {
  return { ctx, t: 0, series: [], peak: 0, peakZone: -1, above: new Float32Array(L.nz), clearance: Infinity, initial: model.population(), throughput: 0, routeUse: {}, done: false, q0: sumQ(model), resp: null };
}
function sumQ(m) { return sum(Object.values(m.g).map(g => g.Q)); }
function sumAQ(m) { return sum(Object.keys(AMEN).map(k => Math.max(0, m.a[k].Q - AMEN[k].qcap))); }
function advance(model, rec, dt) {
  if (model.respLane && model.clock >= model.respLane.until) { for (const j of model.respLane.zones || []) model.cfg.restrict[j] = 1; model.respLane = null; }
  const ex0 = model.exited, en0 = model.entered;
  model.step(dt); rec.t += dt;
  rec.throughput += (model.exited - ex0) + (rec.ctx === 'ingress' ? model.entered - en0 : 0);
  model.forEachFlow((a, b, F) => {
    if (rec.ctx === 'egress' || rec.ctx === 'evac') { if (b.startsWith('GATE_') || b.startsWith('LINK_')) rec.routeUse[b] = (rec.routeUse[b] || 0) + F * dt / 60; }
    else if (rec.ctx === 'amenity') { if (AMEN[b] || (b.startsWith('LINK_') && !a.startsWith('LINK_'))) rec.routeUse[b] = (rec.routeUse[b] || 0) + F * dt / 60; }
  });
  if (rec.ctx === 'ingress') for (const k in GATES) rec.routeUse[GATES[k].att] = (rec.routeUse[GATES[k].att] || 0) + model.g[k].e * dt / 60;
  let mk = 0, mz = -1;
  for (let j = 0; j < L.nz; j++) { const k = model.z[j].k; if (k > mk) { mk = k; mz = j; } if (k >= BOTTLENECK_K) rec.above[j] += dt; }
  if (mk > rec.peak) { rec.peak = mk; rec.peakZone = mz; }
  if (Math.round(rec.t) % 10 === 0) rec.series.push({ t: rec.t, kmax: mk, rem: model.population(), q: sumQ(model), aq: sumAQ(model), ks: model.z.map(z => z.k) });
  if (rec.clearance === Infinity) {
    if ((rec.ctx === 'egress' || rec.ctx === 'evac') && model.population() <= 0.02 * rec.initial) rec.clearance = rec.t;
    if (rec.ctx === 'ingress' && rec.t > 20 && sumQ(model) <= 30) rec.clearance = rec.t;
    if (rec.ctx === 'amenity' && rec.t > 240 && sumAQ(model) <= 1 && amenityRate(model.clock) < 0.006) rec.clearance = rec.t;
    if (rec.ctx === 'medical' && rec.t > 0 && rec.resp && rec.t >= rec.resp.eta) rec.clearance = rec.resp.eta;
  }
}
const SCEN_MAX = 2700;
function runToEnd(model, rec) {
  const m = model.clone();
  while (rec.t < SCEN_MAX) { advance(m, rec, 2); if (rec.clearance < Infinity && rec.t > rec.clearance + 60) break; }
  rec.done = true;
  return rec;
}
/* baseline and intervention advance in lockstep over the same window, so throughput is comparable */
function pairRunner(sc, def, P) {
  const mb = sc.base.clone(), mi = sc.intv.clone();
  const rb = recorder(mb, sc.ctx), ri = recorder(mi, sc.ctx);
  if (sc.ctx === 'medical') { const z = zoneById(P.asset).i; rb.resp = responderETA(mb, z, false); ri.resp = responderETA(mi, z, true); }
  return {
    rb, ri, done: false,
    work(steps, dt) {
      for (let n = 0; n < steps && !this.done; n++) {
        advance(mb, rb, dt); advance(mi, ri, dt);
        const endB = rb.clearance < Infinity, endI = ri.clearance < Infinity;
        if ((endB && endI && rb.t > Math.max(rb.clearance, ri.clearance) + 60) || rb.t >= SCEN_MAX) { this.done = rb.done = ri.done = true; }
      }
      return this.done;
    }
  };
}

