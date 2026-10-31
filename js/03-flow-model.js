'use strict';
/* =====================================================================
   Aggregate crowd-flow model. Streams of people (per attachment pair, people/min) load the
   concourse zones; occupancy follows Little's law with density-dependent walking speed, and demand
   above a zone's capacity accumulates as a local backlog.
   ===================================================================== */
class Model {
  constructor(clock) { this.cfg = defaultCfg(); this.reset(clock === undefined ? SCHED.open : clock); }
  reset(clock) {
    this.clock = clock;
    this.z = ZONES.map(z => ({ N: 2, B: 0, H: 0, spill: 0, k: 0.03, v: 1.3, fin: 0, fout: 0, aP: 0, aN: 0, cE: 0, cW: 0, dx: 0, dz: 0, D: 0, C: 480, loiter: 2, Sst: 2, Nstar: 2, cf: 0, A: z.area }));
    this.g = {}; for (const k in GATES) this.g[k] = { Q: 0, e: 0, arr: 0, xq: 0, xarr: 0, xout: 0, transfer: 0 };
    this.a = {}; for (const k in AMEN) this.a[k] = { Q: 0, arr: 0, served: 0, comp: { G102: 0.25, G104: 0.25, G108: 0.25, GUP: 0.25 } };
    this.x = { LINK_S: { xq: 0, xarr: 0, xout: 0 }, LINK_N: { xq: 0, xarr: 0, xout: 0 } };
    this.seat = { G102: 0, G104: 0, G108: 0, GUP: 0 };
    this.off = { G102: 0, G104: 0, G108: 0, GUP: 0 };
    this.outRel = {}; for (const k in OUTLETS) this.outRel[k] = 0;
    this.egress = null;
    this.exited = 0; this.entered = 0;
    this.F = new Float64Array(NA * NA); this.fl = [];
    this.tc = new Float64Array(NA * NA); this.tcs = new Int32Array(NA * NA); this.stamp = 1;
    this.dwell = new Float32Array(L.nz);
    this.respLane = null;
  }
  clone() {
    const m = Object.create(Model.prototype);
    m.cfg = cloneCfg(this.cfg);
    m.clock = this.clock;
    m.z = this.z.map(o => Object.assign({}, o));
    m.g = JSON.parse(JSON.stringify(this.g)); m.a = JSON.parse(JSON.stringify(this.a)); m.x = JSON.parse(JSON.stringify(this.x));
    m.seat = Object.assign({}, this.seat); m.off = Object.assign({}, this.off); m.outRel = Object.assign({}, this.outRel);
    m.egress = this.egress ? Object.assign({}, this.egress) : null;
    m.exited = this.exited; m.entered = this.entered;
    m.F = new Float64Array(this.F); m.fl = this.fl.slice();
    m.tc = new Float64Array(NA * NA); m.tcs = new Int32Array(NA * NA); m.stamp = 1;
    m.dwell = new Float32Array(this.dwell);
    m.respLane = this.respLane ? JSON.parse(JSON.stringify(this.respLane)) : null;
    return m;
  }
  /* initialise a consistent state for any clock time by integrating from a known start */
  init(clock) {
    const cfg = this.cfg;
    if (clock < SCHED.kickoff + 1500) { this.reset(SCHED.open); this.cfg = cfg; this.run(clock - SCHED.open, 4); }
    else if (clock < SCHED.final) {
      this.reset(clock - 900); this.cfg = cfg;
      for (const gr of GROUPS) this.seat[gr.id] = gr.cap * ATTEND;
      this.run(900, 4);
    } else {
      this.reset(SCHED.final); this.cfg = cfg;
      for (const gr of GROUPS) this.seat[gr.id] = gr.cap * ATTEND;
      this.startEgress('post');
      this.run(clock - SCHED.final, 2);
    }
    return this;
  }
  run(sec, dt) { const n = Math.max(0, Math.round(sec / dt)); for (let i = 0; i < n; i++) this.step(dt); }
  startEgress(mode) { this.egress = { mode, t0: this.clock, initial: this.population() }; }
  population() {
    let p = sum(Object.values(this.seat));
    for (const z of this.z) p += Math.max(0, z.N - z.Sst * 0.6) + z.H;
    for (const k in this.g) p += this.g[k].xq;
    return p + this.x.LINK_S.xq + this.x.LINK_N.xq;
  }
  forEachFlow(cb) { const F = this.F; for (const i of this.fl) { const v = F[i]; if (v > 1e-4) cb(AK[(i / NA) | 0], AK[i % NA], v); } }
  flowTo(b) { let s = 0; const bi = AI[b]; for (const i of this.fl) if (i % NA === bi) s += this.F[i]; return s; }
  flowFrom(a) { let s = 0; const ai = AI[a]; for (const i of this.fl) if (((i / NA) | 0) === ai) s += this.F[i]; return s; }

  /* --- walking time helpers using the current zone speeds --- */
  tFree(a, b) { return prof(a, b).len / 1.3; }
  tCong(a, b) {
    const i = AI[a] * NA + AI[b];
    if (this.tcs[i] === this.stamp) return this.tc[i];
    const p = prof(a, b); let t = p.ext / 1.3;
    for (const j of p.zs) t += p.tot[j] / this.z[j].v;
    this.tc[i] = t; this.tcs[i] = this.stamp;
    return t;
  }
  addFlow(a, b, F) {
    if (!(F > 1e-4) || a === b) return;
    const i = AI[a] * NA + AI[b];
    if (this.F[i] === 0) this.fl.push(i);
    this.F[i] += F;
  }
  /* logit choice among destination attachments; cost in seconds */
  choose(from, cands) {
    const kap = this.cfg.awareness, th = 32;
    let best = Infinity; const cost = new Array(cands.length);
    for (let n = 0; n < cands.length; n++) {
      const c = cands[n], tf = this.tFree(from, c.att), tc = this.tCong(from, c.att), w = c.wait || 0;
      const cc = tf + kap * (tc - tf + w) + (1 - kap) * 0.3 * w + (c.pref || 0);
      cost[n] = cc; if (cc < best) best = cc;
    }
    let s = 0;
    for (let n = 0; n < cost.length; n++) { cost[n] = Math.exp(-(cost[n] - best) / th); s += cost[n]; }
    for (let n = 0; n < cost.length; n++) cost[n] /= s;
    return cost;
  }
  outletSplit(gr) {
    const key = gr; if (this._os && this._os[key]) return this._os[key];
    const o = this.cfg.outletOpen, G = GROUPS.find(g => g.id === gr);
    let res = [];
    if (gr !== 'GUP') res = o[G.outlets[0]] ? [[G.outlets[0], 1]] : [];
    else {
      const acc = 0.03;
      let elev = o.ELEV_A ? acc * 0.67 : 0, ramp = o.RAMP ? acc - elev : 0;
      if (!o.ELEV_A && o.RAMP) ramp = acc;
      const s1 = o.STAIR_1 ? 1 : 0, s2 = o.STAIR_2 ? 1 : 0, ss = s1 + s2;
      const rest = 1 - elev - ramp;
      if (ss) { if (s1) res.push(['STAIR_1', rest / ss]); if (s2) res.push(['STAIR_2', rest / ss]); }
      if (elev) res.push(['ELEV_A', elev]); if (ramp) res.push(['RAMP', ramp]);
      const t = sum(res.map(r => r[1])); res = res.map(r => [r[0], r[1] / t]);
    }
    (this._os || (this._os = {}))[key] = res;
    return res;
  }
  amenWait(k) { const a = this.a[k], c = this.cfg; if (!c.amenOpen[k]) return Infinity; const mu = (AMEN[k].servers + c.extraServers[k]) * AMEN[k].rate; return a.Q / mu * 60; }
  amenCands(type) {
    const out = [];
    for (const k in AMEN) if (AMEN[k].type === type && this.cfg.amenOpen[k]) out.push({ att: k, wait: this.amenWait(k) });
    out.push({ att: type === 'food' ? 'LINK_N' : 'LINK_S', wait: 90, pref: 150, off: true });
    return out;
  }
  exitCands() {
    const c = this.cfg, out = [];
    for (const k in GATES) if (c.gateOpen[k]) { const g = this.g[k], cap = EXIT_CAP[GATES[k].att] * c.exitCapMul; out.push({ att: GATES[k].att, gate: k, wait: g.xq / cap * 60, pref: EXIT_PREF[GATES[k].att] }); }
    for (const l of ['LINK_S', 'LINK_N']) { const x = this.x[l]; out.push({ att: l, link: l, wait: x.xq / EXIT_CAP[l] * 60, pref: EXIT_PREF[l] }); }
    return out;
  }
  /* people standing in the concourse (meeting, eating, waiting), people per square metre before zone weighting */
  standing(c) {
    const ph = phaseAt(c);
    if (this.egress) return 0.3;
    if (ph === 'pregame') return 0.15 + 0.8 * arrivalShape(c);
    if (ph === 'half') { const h = (c - SCHED.half) / 60; return 0.2 + 0.8 * Math.exp(-(((h - 6) / 5) ** 2)); }
    return 0.12;
  }
  circulation(c) {      // people/min per direction walking the concourse to other parts of the stadium
    const ph = phaseAt(c);
    if (this.egress) return 0;
    if (ph === 'pregame') return 25 + 90 * arrivalShape(c);
    if (ph === 'half') { const h = (c - SCHED.half) / 60; return 25 + 100 * Math.exp(-(((h - 6) / 5) ** 2)); }
    return 16;
  }

  step(dt) {
    const cfg = this.cfg, c = this.clock, m = dt / 60;
    for (const i of this.fl) this.F[i] = 0;
    this.fl.length = 0; this.stamp++; this._os = null;
    const egr = this.egress;
    /* 1. gates: arrivals, screening and entries */
    const arr = egr ? 0 : ARR_PEAK * arrivalShape(c) * cfg.demandMul;
    const open = []; for (const k in GATES) if (cfg.gateOpen[k]) open.push(k);
    let wsum = 0; const w = {};
    for (const k of open) {
      const gg = this.g[k], cap = GATES[k].lanes * LANE_RATE * cfg.gateCapMul;
      const wait = cap > 0 ? gg.Q / cap : 99;
      w[k] = GATES[k].share * Math.exp(-cfg.awareness * 0.6 * wait); wsum += w[k];
    }
    for (const k in GATES) {
      const gg = this.g[k];
      gg.arr = cfg.gateOpen[k] && wsum > 0 ? arr * w[k] / wsum : 0;
      if (!cfg.gateOpen[k] && gg.Q > 0) {                 // people at a closed gate walk to the open ones
        const mv = Math.min(gg.Q, gg.Q / 75 * dt + 0.5 * dt);
        gg.Q -= mv; gg.transfer = mv / dt * 60;
        if (wsum > 0) for (const j of open) this.g[j].Q += mv * w[j] / wsum;
      } else gg.transfer = 0;
      gg.Q += gg.arr * m;
      const cap = cfg.gateOpen[k] ? GATES[k].lanes * LANE_RATE * cfg.gateCapMul : 0;
      const served = Math.min(gg.Q, cap * m);
      gg.Q -= served; gg.e = served / m;
      this.entered += served;
    }
    /* 2. ingress streams from the gates */
    const food = this.amenCands('food'), rest = this.amenCands('rest');
    for (const k in GATES) {
      const e = this.g[k].e; if (e <= 0) continue;
      const ga = GATES[k].att, gx = ATT[ga].x;
      const shares = gateGroupShare(k);
      for (const gr of GROUPS) {
        const F = e * 0.675 * shares[gr.id];
        for (const [o, f] of this.outletSplit(gr.id)) this.addFlow(ga, o, F * f);
        this.seat[gr.id] += F * m;
      }
      this.addFlow(ga, gx < 0 ? 'LINK_S' : 'LINK_N', e * 0.10);
      for (const [cands, f] of [[food, 0.16], [rest, 0.065]]) {
        const p = this.choose(ga, cands);
        for (let j = 0; j < cands.length; j++) {
          const cd = cands[j], F = e * f * p[j]; if (F <= 0) continue;
          this.addFlow(ga, cd.att, F);
          if (cd.off) { for (const gr of GROUPS) this.off[gr.id] += F * shares[gr.id] * m; }
          else { const a = this.a[cd.att]; a.arr += F; for (const gr of GROUPS) a.comp[gr.id] += F * shares[gr.id] * m; }
        }
      }
    }
    /* 3. catchment spectators who entered at other gates, and concourse circulation */
    if (!egr) {
      const la = LINK_PEAK * arrivalShape(c) * cfg.demandMul;
      for (const gr of GROUPS) {
        const F = la * gr.cap / CATCH, src = gr.x < 0 ? 'LINK_S' : 'LINK_N';
        for (const [o, f] of this.outletSplit(gr.id)) this.addFlow(src, o, F * f);
        this.seat[gr.id] += F * m;
      }
      const circ = this.circulation(c) * cfg.demandMul;
      this.addFlow('LINK_S', 'LINK_N', circ); this.addFlow('LINK_N', 'LINK_S', circ * 0.92);
    }
    /* 4. amenity trips from the seats */
    const rate = egr ? 0 : amenityRate(c) * cfg.amenMul;
    if (rate > 0) for (const gr of GROUPS) {
      const trips = this.seat[gr.id] * rate; if (trips <= 0) continue;
      this.seat[gr.id] = Math.max(0, this.seat[gr.id] - trips * m);
      for (const [o, f] of this.outletSplit(gr.id)) {
        for (const [cands, tf] of [[food, 0.55], [rest, 0.45]]) {
          const p = this.choose(o, cands);
          for (let j = 0; j < cands.length; j++) {
            const cd = cands[j], F = trips * f * tf * p[j]; if (F <= 0) continue;
            this.addFlow(o, cd.att, F);
            if (cd.off) this.off[gr.id] += F * m;
            else { this.a[cd.att].arr += F; this.a[cd.att].comp[gr.id] += F * m; }
          }
        }
      }
    }
    for (const gr of GROUPS) {                // returns from facilities beyond the pilot zone (about six minutes)
      const ret = this.off[gr.id] / 360 * 60;
      if (ret > 1e-3) {
        const src = gr.x < 0 ? 'LINK_S' : 'LINK_N';
        for (const [o, f] of this.outletSplit(gr.id)) this.addFlow(src, o, ret * f);
        this.off[gr.id] -= ret * m; this.seat[gr.id] += ret * m;
      }
    }
    /* 5. amenity service and returns to the seats */
    for (const k in AMEN) {
      const a = this.a[k];
      a.Q += a.arr * m;
      const mu = cfg.amenOpen[k] ? (AMEN[k].servers + cfg.extraServers[k]) * AMEN[k].rate : 0;
      const served = Math.min(a.Q, mu * m);
      a.Q -= served; a.served = served / m;
      let cs = 0; for (const g in a.comp) cs += a.comp[g];
      cs = cs || 1;
      for (const gr of GROUPS) {
        const F = a.served * a.comp[gr.id] / cs; if (F <= 0) continue;
        for (const [o, f] of this.outletSplit(gr.id)) this.addFlow(k, o, F * f);
        this.seat[gr.id] += F * m;
      }
      const dec = Math.exp(-dt / 240); for (const g in a.comp) a.comp[g] *= dec;
      a.arr = 0;
    }
    /* 6. egress: release from the seats, exit choice and exit capacity */
    for (const k in this.outRel) this.outRel[k] = 0;
    const xarr = { GATE_A: 0, GATE_B: 0, GATE_C: 0, GATE_D: 0, LINK_S: 0, LINK_N: 0 };
    if (egr) {
      const te = (c - egr.t0) / 60;
      const lam = egr.mode === 'evac' ? 0.9 : (te < 10 ? 0.24 : 0.5);
      const xc = this.exitCands();
      let relTot = 0;
      for (const gr of GROUPS) {
        const want = this.seat[gr.id] * lam;
        const split = this.outletSplit(gr.id);
        let capSum = 0; for (const [o] of split) capSum += OUTLETS[o].cap;
        let rel = Math.min(want, capSum);
        if (cfg.phased && egr.mode !== 'post' && gr.id !== 'GUP' && te < 3) rel = Math.min(rel, capSum * 0.55);
        let done = 0;
        for (const [o, f] of split) {
          const kz = this.z[zoneIdxAt(ATT[o].x)].k, thr = clamp((4.7 - kz) / 1.6, 0.2, 1);   // portals back up when the concourse is jammed
          const F = Math.min(rel * f, OUTLETS[o].cap * thr);
          done += F;
          this.outRel[o] += F;
          const p = this.choose(o, xc);
          for (let j = 0; j < xc.length; j++) { const Fx = F * p[j]; if (Fx <= 0) continue; this.addFlow(o, xc[j].att, Fx); xarr[xc[j].att] += Fx; }
        }
        this.seat[gr.id] = Math.max(0, this.seat[gr.id] - done * m);
        relTot += done;
      }
      // spectators from neighbouring concourses who leave through the pilot gates
      const inflow = relTot * 0.12 * (egr.mode === 'evac' ? 1.2 : 1);
      for (const src of ['LINK_S', 'LINK_N']) {
        const gx = xc.filter(cd => cd.gate), p = gx.length ? this.choose(src, gx) : [];
        for (let j = 0; j < gx.length; j++) { const Fx = inflow / 2 * p[j]; this.addFlow(src, gx[j].att, Fx); xarr[gx[j].att] += Fx; }
      }
    }
    for (const k in GATES) {
      const gg = this.g[k], att = GATES[k].att, cap = cfg.gateOpen[k] ? EXIT_CAP[att] * cfg.exitCapMul : 0;
      gg.xarr = xarr[att];
      const tot = gg.xq + gg.xarr * m, out = Math.min(tot, cap * m);
      gg.xq = tot - out; gg.xout = out / m; this.exited += out;
    }
    for (const l of ['LINK_S', 'LINK_N']) {
      const xx = this.x[l]; xx.xarr = xarr[l];
      const tot = xx.xq + xx.xarr * m, out = Math.min(tot, EXIT_CAP[l] * m);
      xx.xq = tot - out; xx.xout = out / m; this.exited += out;
    }
    /* 7. zone loading */
    const Z = this.z, dwell = this.dwell, Fa = this.F;
    dwell.fill(0);
    const fl = this.fl, nfl = fl.length, zl = L.zl;
    const zfin = this.zfin || (this.zfin = new Float64Array(L.nz)), zaP = this.zaP || (this.zaP = new Float64Array(L.nz)), zaN = this.zaN || (this.zaN = new Float64Array(L.nz));
    const zcE = this.zcE || (this.zcE = new Float64Array(L.nz)), zcW = this.zcW || (this.zcW = new Float64Array(L.nz)), zdx = this.zdx || (this.zdx = new Float64Array(L.nz));
    const zdz = this.zdz || (this.zdz = new Float64Array(L.nz)), zD = this.zD || (this.zD = new Float64Array(L.nz));
    zfin.fill(0); zaP.fill(0); zaN.fill(0); zcE.fill(0); zcW.fill(0); zdx.fill(0); zdz.fill(0); zD.fill(0);
    for (let q = 0; q < nfl; q++) {
      const idx = fl[q], F = Fa[idx]; if (F <= 1e-4) continue;
      let p = PROFA[idx]; if (p === undefined) p = PROFA[idx] = makeProf(AK[(idx / NA) | 0], AK[idx % NA]);
      const zs = p.zs, tot = p.tot, al = p.along, cr = p.cross, dxa = p.dirx, dza = p.dirz;
      for (let r = 0; r < zs.length; r++) {
        const j = zs[r];
        dwell[j] += F * tot[j]; zfin[j] += F;
        const dxj = dxa[j], dzj = dza[j];
        if (dxj > 0) zaP[j] += F * al[j] / zl; else if (dxj < 0) zaN[j] += F * al[j] / zl;
        if (dzj > 0) zcE[j] += F; else if (dzj < 0) zcW[j] += F;
        zdx[j] += F * dxj; zdz[j] += F * dzj * 1.6;
        zD[j] += F * (al[j] / zl + cr[j] / 14);
      }
    }
    for (let j = 0; j < L.nz; j++) { const z = Z[j]; z.fin = zfin[j]; z.aP = zaP[j]; z.aN = zaN[j]; z.cE = zcE[j]; z.cW = zcW[j]; z.dx = zdx[j]; z.dz = zdz[j]; z.D = zD[j]; }
    /* 8. zone dynamics */
    const wf = cfg.weather === 'rain' ? 0.92 : cfg.weather === 'storm' ? 0.88 : 1;
    const spill = new Float32Array(L.nz), extraS = new Float32Array(L.nz), weight = new Float32Array(L.nz).fill(0.6);
    for (const k in AMEN) {
      const a = this.a[k], i = zoneIdxAt(ATT[k].x);
      const ex = a.Q - AMEN[k].qcap;
      if (ex > 0) { spill[i] += ex * 0.75; const j = clamp(i + (ATT[k].x > ZONES[i].xc ? 1 : -1), 0, L.nz - 1); spill[j] += ex * 0.25; }
      extraS[i] += a.served * (AMEN[k].type === 'food' ? 2.6 : 0.8);
      weight[i] = 1.25;
    }
    for (const k in GATES) {
      const i = zoneIdxAt(ATT[GATES[k].att].x), gg = this.g[k];
      if (gg.xq > 0) spill[i] += gg.xq;
      extraS[i] += gg.e * 0.6; weight[i] = Math.max(weight[i], 1.2);
    }
    for (const o of ['POR_102', 'POR_104', 'POR_108', 'STAIR_1', 'STAIR_2']) {
      const i = zoneIdxAt(ATT[o].x);
      extraS[i] += (this.flowTo(o) + this.outRel[o]) * 0.3; weight[i] = Math.max(weight[i], 1.1);
    }
    if (this.x.LINK_S.xq > 0) spill[0] += this.x.LINK_S.xq;
    if (this.x.LINK_N.xq > 0) spill[L.nz - 1] += this.x.LINK_N.xq;
    const st = this.standing(c);
    for (let j = 0; j < L.nz; j++) {
      const z = Z[j], A = ZONES[j].area * cfg.restrict[j];
      z.spill = spill[j];
      const Sst = A * st * weight[j] + extraS[j];
      z.Sst += (Sst - z.Sst) * Math.min(1, dt / 40);
      z.loiter = z.Sst;
      const r = z.aP > 8 && z.aN > 8 ? Math.min(z.aP, z.aN) / Math.max(z.aP, z.aN) : 0;
      z.cf = r;
      const weff = Math.max(1.2, (L.corrW - 0.6) * cfg.restrict[j] - Math.min(3.2, z.spill / (3 * L.zl)));
      z.C = 60 * SPEC_FLOW * weff * (1 - 0.2 * r);
      if (z.D > z.C) z.B += (z.D - z.C) * m * 0.4; else z.B = Math.max(0, z.B - (z.C - z.D) * m * 0.9);
      const moving = dwell[j] * Math.min(1, z.C / Math.max(z.D, 1)) / 60 / Math.max(z.v, 0.45);
      const room = Math.max(0, 4.4 * A - moving - z.Sst - z.spill);              // beyond this, people wait upstream in portals and aisles
      if (z.B > room) { z.H += z.B - room; z.B = room; } else if (z.H > 0) { const mv = Math.min(z.H, room - z.B); z.H -= mv; z.B += mv; }
      z.Nstar = moving + z.Sst + z.spill + z.B;
      const N0 = z.N;
      z.N += (z.Nstar - z.N) * Math.min(1, dt / 15);
      z.N = Math.min(z.N, 5.0 * A);
      z.k = z.N / A;
      z.v = vk(z.k) * wf;
      z.fout = Math.max(0, z.fin - (z.N - N0) / m);
      z.A = A;
    }
    this.clock += dt;
  }
}

/* share of a gate's entries by seating group: capacity weighted by proximity */
const GGS = {};
function gateGroupShare(k) {
  if (GGS[k]) return GGS[k];
  const gx = ATT[GATES[k].att].x; let s = 0; const o = {};
  for (const gr of GROUPS) { o[gr.id] = gr.cap / (1 + Math.abs(gx - gr.x) / 25); s += o[gr.id]; }
  for (const g in o) o[g] /= s;
  return (GGS[k] = o);
}

/* dominant direction label from the net flow vector */
function dirLabel(dx, dz) {
  if (Math.abs(dx) < 1 && Math.abs(dz) < 1) return 'STATIONARY';
  const a = Math.atan2(dz, dx) * 180 / Math.PI;             // 0 = north, 90 = east
  const names = ['NORTHBOUND', 'NORTHEAST', 'EASTBOUND', 'SOUTHEAST', 'SOUTHBOUND', 'SOUTHWEST', 'WESTBOUND', 'NORTHWEST'];
  return names[((Math.round(a / 45) % 8) + 8) % 8];
}

