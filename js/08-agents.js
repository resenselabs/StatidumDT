'use strict';
/* =====================================================================
   STADIUM-DT visible agents. A manageable number of anonymous, short-lived agents samples the
   aggregate flows (about one agent per AGENT_SCALE simulated people). Agents carry no identity:
   an ID is random per session and is discarded when the agent leaves the scene.
   ===================================================================== */
const AG = { list: [], max: 900, acc: new Map(), pathCache: new Map(), grid: new Map(), src: null, closureKey: '', queueSlots: [] };

/* walkable rectangles: corridor, gate passages, alcoves, portals, stairs, ramp, plaza; service corridor for responders */
const WALK = [
  [-66, 66, -97.7, -91.3], [-110, 110, -175, -109.2],
  [-50.2, -41.8, -91.3, -80.5], [-40.2, -36.8, -91.3, -88.4]
];
for (const k in GATES) { const x = ATT[GATES[k].att].x, w = GATES[k].w; WALK.push([x - w / 2 + 0.3, x + w / 2 - 0.3, -109.6, -97.6]); }
for (const k of ['CONC_A', 'CONC_B', 'REST_A', 'REST_B']) { const x = ATT[k].x, w = ATT[k].w; WALK.push([x - w / 2 + 0.6, x + w / 2 - 0.6, -100.6, -97.6]); }
WALK.push([ATT.MED.x - 3.5, ATT.MED.x + 4, -102, -97.6]);
for (const p of ['POR_102', 'POR_104', 'POR_108']) WALK.push([ATT[p].x - ATT[p].w / 2 + 0.2, ATT[p].x + ATT[p].w / 2 - 0.2, -91.3, -82]);
for (const s of ['STAIR_1', 'STAIR_2']) WALK.push([ATT[s].x - 2.1, ATT[s].x + 2.1, -91.3, -80.8]);
WALK.push([-80, -64, -92, -84], [64, 80, -92, -84]);
const WALK_SVC = [[-58, 58, -108.4, -105.4], [-9.3, -7.7, -105.6, -97.6], [ATT.MED.x - 1.5, ATT.MED.x + 1.5, -105.6, -101]];
function clampWalk(a) {
  const rects = a.kind === 'resp' ? WALK.concat(WALK_SVC) : WALK;
  let best = null, bd = Infinity;
  for (const r of rects) {
    if (a.x >= r[0] && a.x <= r[1] && a.z >= r[2] && a.z <= r[3]) return;
    const cx = clamp(a.x, r[0], r[1]), cz = clamp(a.z, r[2], r[3]), d = (cx - a.x) ** 2 + (cz - a.z) ** 2;
    if (d < bd) { bd = d; best = [cx, cz]; }
  }
  if (best && bd < 9) { a.x = best[0]; a.z = best[1]; }
}

/* endpoints in the walk graph for each model attachment */
function nodeFor(att, role) {
  if (att.startsWith('GATE_')) { const k = att.slice(5); return role === 'from' ? 'TS:' + k : 'GO:' + k; }
  if (att === 'LINK_S') return 'LK:S'; if (att === 'LINK_N') return 'LK:N';
  if (att.startsWith('POR_')) return 'PT:' + att;
  if (att.startsWith('STAIR_')) return 'ST:' + att;
  if (att === 'ELEV_A') return 'EL:ELEV_A';
  if (att === 'RAMP') return 'RP:TOP';
  if (AMEN[att]) return role === 'from' ? 'CT:' + att : 'M:' + att;
  if (att === 'MED') return 'MD:MED';
  return 'SP:0';
}
function closureKey(cfg) { return JSON.stringify([cfg.gateOpen, cfg.outletOpen]); }
function walkPath(a, b, opt) {
  const cfg = (AG.src || TWIN.m).cfg;
  const ck = closureKey(cfg) + (opt && opt.access ? 'A' : '') + (opt && opt.resp ? 'R' : '');
  if (ck !== AG.closureKey) { AG.pathCache.clear(); AG.closureKey = ck; }
  const key = a + '|' + b + '|' + ck;
  let p = AG.pathCache.get(key);
  if (p === undefined) {
    const res = dijkstraCfg(a, cfg, opt || {});
    p = pathNodes(res, b);
    AG.pathCache.set(key, p);
  }
  return p;
}
/* plain distance Dijkstra that respects the closures of the model being displayed */
function dijkstraCfg(start, cfg, o) {
  const dist = new Map([[start, 0]]), prev = new Map(), done = new Set(), pq = [[0, start]];
  while (pq.length) {
    let bi = 0; for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
    const [d, u] = pq.splice(bi, 1)[0];
    if (done.has(u)) continue; done.add(u);
    for (const [w, e] of G.adj.get(u)) {
      if (done.has(w)) continue;
      if (e.restricted && !o.resp) continue;
      if (e.gate && !cfg.gateOpen[e.gate]) continue;
      if (e.asset && cfg.outletOpen[e.asset] === false) continue;
      if (o.access && e.kind === 'stair') continue;
      const nd = d + e.len;
      if (nd < (dist.has(w) ? dist.get(w) : Infinity)) { dist.set(w, nd); prev.set(w, u); pq.push([nd, w]); }
    }
  }
  return { dist, prev };
}
function pathNodes(res, target) {
  if (!res.dist.has(target)) return null;
  const out = [target]; let u = target;
  while (res.prev.has(u)) { u = res.prev.get(u); out.push(u); }
  return out.reverse().map(id => { const n = G.nodes.get(id); return { x: n.x, z: n.z, y: n.y || 0, id, zone: n.zone }; });
}

let agentSeq = 0;
function newAgent(path, kind, opt) {
  if (!path || path.length < 2 || AG.list.length >= AG.max) return null;
  const p0 = path[0];
  const a = {
    id: 'A-' + Math.floor(rnd() * 0xFFFFF).toString(16).toUpperCase().padStart(5, '0'), n: ++agentSeq,
    x: p0.x + rndN() * 0.6, z: p0.z + rndN() * 0.6, y: p0.y, path, seg: 1, kind,
    spd: (kind === 'resp' ? 1.75 : 1.28) * (1 + 0.13 * rndN()), lane: 0.4 + rnd() * 1.6, col: Math.floor(rnd() * W3.agentColors.length),
    stop: 0, stopChance: rnd() < 0.35 ? 0.012 : 0.002, born: TWIN.m.clock, fade: 0, out: false, hd: 0, access: !!(opt && opt.access),
    src: opt && opt.src, dst: opt && opt.dst, scale: 1, vx: 0, vz: 0
  };
  if (a.access) a.spd *= 0.75;
  AG.list.push(a);
  return a;
}
/* spawn agents in proportion to the flows of the model on display */
function spawnFromModel(model, dtSim) {
  const k = dtSim / 60 / AGENT_SCALE;
  if (AG.list.length > AG.max - 20) return;
  const spawn = (key, rate, fn) => {
    let acc = (AG.acc.get(key) || 0) + rate * k;
    while (acc >= 1) { acc -= 1; fn(); }
    if (rnd() < acc * 0.02) { acc = 0; fn(); }
    AG.acc.set(key, acc);
  };
  model.forEachFlow((a, b, F) => {
    spawn(a + '>' + b, F, () => {
      const from = nodeFor(a, 'from'), to = nodeFor(b, 'to');
      const access = (a === 'ELEV_A' || a === 'RAMP' || b === 'ELEV_A' || b === 'RAMP');
      let p = walkPath(from, to, { access });
      if (!p) return;
      if (b.startsWith('GATE_')) { const tail = walkPath('GO:' + b.slice(5), pick(['DX:W', 'DX:S', 'DX:E', 'DX:S'])); if (tail) p = p.concat(tail.slice(1)); }
      newAgent(p, 'walk', { access, src: a, dst: b });
    });
  });
  // arrivals walking across the plaza to the gate queues
  for (const g in GATES) {
    const r = model.g[g].arr;
    if (r > 0) spawn('arr>' + g, r, () => { const p = walkPath(pick(['DX:W', 'DX:S', 'DX:S', 'DX:E']), 'GO:' + g); if (p) { p[p.length - 1] = Object.assign({}, p[p.length - 1], { z: p[p.length - 1].z - 3 - Math.min(14, model.g[g].Q / 60) }); newAgent(p, 'walk', { src: 'plaza', dst: 'Q:' + g }); } });
  }
}
/* responders for the medical scenario and navigate role */
function spawnResponder(path) { if (!path) return null; const a = newAgent(path, 'resp'); if (a) { a.spd = 1.75; a.lane = 0; a.stopChance = 0; } return a; }

/* queue figures: drawn from aggregate queue lengths so queues match the model exactly */
function queueSlots(model) {
  const out = AG.queueSlots; out.length = 0;
  for (const g in GATES) {
    const n = Math.min(70, Math.round(model.g[g].Q / AGENT_SCALE)), L0 = W3.lanes[g];
    for (let i = 0; i < n; i++) { const lane = i % L0.nl, row = Math.floor(i / L0.nl); out.push([L0.x - L0.w / 2 + (lane + 0.5) * L0.lw + Math.sin(i * 7.1) * 0.15, -109.8 - row * 0.85, 'q', i * 1.7]); }
    const xq = Math.min(40, Math.round(model.g[g].xq / AGENT_SCALE));
    for (let i = 0; i < xq; i++) out.push([L0.x + Math.sin(i * 2.3) * L0.w * 0.4, -97.2 + Math.cos(i * 1.7) * 2.6, 'x', i]);
  }
  for (const k in AMEN) {
    const q = model.a[k].Q, n = Math.min(60, Math.round(q / AGENT_SCALE)), x0 = ATT[k].x, w = ATT[k].w;
    const per = Math.max(3, Math.floor((w - 2) / 0.9));
    for (let i = 0; i < n; i++) {
      const lineIn = Math.floor(AMEN[k].qcap / AGENT_SCALE);
      if (i < lineIn) { const col = i % per, row = Math.floor(i / per); out.push([x0 - (w - 2) / 2 + (col + 0.5) * (w - 2) / per, -100.0 + row * 0.75, 'a', i]); }
      else { const j = i - lineIn, dir = x0 > -3 ? 1 : -1; out.push([x0 + dir * (w / 2 + 0.6 + j * 0.62), -97.3 + (j % 2) * 0.55, 'a', i]); }
    }
  }
  return out;
}

/* per-frame movement with separation, lane keeping, short stops and responder yielding */
const _hash = (x, z) => ((Math.floor(x / 1.2) * 73856093) ^ (Math.floor(z / 1.2) * 19349663));
function stepAgents(dt, model) {
  if (dt <= 0) return;
  const grid = AG.grid; grid.clear();
  for (const a of AG.list) { const h = _hash(a.x, a.z); let c = grid.get(h); if (!c) grid.set(h, c = []); c.push(a); }
  const resp = AG.list.filter(a => a.kind === 'resp');
  for (let idx = AG.list.length - 1; idx >= 0; idx--) {
    const a = AG.list[idx];
    if (a.out) { a.fade += dt * 2.2; if (a.fade >= 1) { AG.list.splice(idx, 1); } continue; }
    const tgt = a.path[a.seg];
    if (!tgt) { a.out = true; continue; }
    // speed from the zone the agent is in (crowd-limited walking speed of the model)
    let zi = -1;
    if (a.z <= -91.2 && a.z >= -98 && a.x >= L.x0 && a.x <= -L.x0) zi = zoneIdxAt(a.x);
    let v = a.spd;
    if (zi >= 0) v *= Math.max(0.25, model.z[zi].v / 1.34);
    if (a.kind !== 'resp' && S.weather !== 'clear') v *= 0.94;
    if (a.stop > 0) { a.stop -= dt; v = 0; }
    else if (a.kind === 'walk' && zi >= 0 && rnd() < a.stopChance * dt) a.stop = 1.5 + rnd() * 4;
    // steer towards the waypoint, offset to the right of the walking direction (keep right)
    let dx = tgt.x - a.x, dz = tgt.z - a.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const last = a.seg === a.path.length - 1;
    const offs = last || a.kind === 'resp' ? 0 : Math.min(a.lane, d * 0.5);
    const ux = dx / d, uz = dz / d;
    const tx = tgt.x + (-uz) * offs, tz = tgt.z + ux * offs;          // right-hand side of the walking direction
    dx = tx - a.x; dz = tz - a.z;
    const dd = Math.hypot(dx, dz) || 1e-6;
    let fx = dx / dd * v, fz = dz / dd * v;
    // separation from neighbours (stronger around responders)
    let sx = 0, sz = 0;
    const cx = Math.floor(a.x / 1.2), cz = Math.floor(a.z / 1.2);
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const c = grid.get(((cx + ix) * 73856093) ^ ((cz + iz) * 19349663)); if (!c) continue;
      for (const b of c) {
        if (b === a) continue;
        const ex = a.x - b.x, ez = a.z - b.z, e2 = ex * ex + ez * ez;
        if (e2 < 0.62 && e2 > 1e-6) { const e = Math.sqrt(e2), push = (0.79 - e) * 2.2; sx += ex / e * push; sz += ez / e * push; }
      }
    }
    if (a.kind !== 'resp') for (const r of resp) {
      const ex = a.x - r.x, ez = a.z - r.z, e2 = ex * ex + ez * ez;
      if (e2 < 7) { const e = Math.sqrt(e2) || 0.1, side = Math.sign(ex * (-r.vz) + ez * r.vx) || 1; sx += -r.vz * side * 0.9 / e; sz += r.vx * side * 0.9 / e; }
    }
    a.vx = fx + sx * 0.6; a.vz = fz + sz * 0.6;
    const sp = Math.hypot(a.vx, a.vz), cap = Math.max(v * 1.15, 0.35);
    if (sp > cap) { a.vx *= cap / sp; a.vz *= cap / sp; }
    a.x += a.vx * dt; a.z += a.vz * dt;
    if (Math.abs(a.vx) + Math.abs(a.vz) > 0.05) a.hd = Math.atan2(a.vx, a.vz);
    clampWalk(a);
    // height along stairs and ramps
    const p0 = a.path[a.seg - 1];
    const segLen = Math.hypot(tgt.x - p0.x, tgt.z - p0.z) || 1;
    const prog = clamp(1 - Math.hypot(tgt.x - a.x, tgt.z - a.z) / segLen, 0, 1);
    a.y = lerp(p0.y, tgt.y, prog);
    if (Math.hypot(tgt.x - a.x, tgt.z - a.z) < (last ? 0.9 : 1.6)) {
      a.seg++;
      if (a.seg >= a.path.length) a.out = true;
    }
    if (TWIN.m.clock - a.born > 900) a.out = true;
  }
}
function clearAgents() { AG.list.length = 0; AG.acc.clear(); }
