'use strict';
/* =====================================================================
   Walkable graph for agents and routing (geometric nodes and edges)
   ===================================================================== */
const G = { nodes: new Map(), edges: [], adj: new Map() };
function gNode(id, x, z, o) { const n = Object.assign({ id, x, z, y: 0, zone: x >= L.x0 && x <= L.x0 + L.nz * L.zl && z <= L.corrIn && z >= L.corrOut ? zoneIdxAt(x) : -1 }, o || {}); G.nodes.set(id, n); G.adj.set(id, []); return n; }
function gEdge(a, b, o) {
  const A = G.nodes.get(a), B = G.nodes.get(b);
  const len = (o && o.len) || Math.hypot(A.x - B.x, A.z - B.z, (A.y || 0) - (B.y || 0));
  const e = Object.assign({ a, b, len, kind: 'walk', zone: -1, access: true, restricted: false }, o || {});
  if (e.zone === -1 && A.zone >= 0 && B.zone >= 0) e.zone = zoneIdxAt((A.x + B.x) / 2);
  e.len = len;
  G.edges.push(e); G.adj.get(a).push([b, e]); G.adj.get(b).push([a, e]);
  return e;
}
const QR = [
  { id: 'QR-01', node: 'SP:-38.5', label: 'QR-01 · Concourse W-011' },
  { id: 'QR-02', node: 'SP:-15', label: 'QR-02 · Concourse W-013' },
  { id: 'QR-03', node: 'SP:-5.5', label: 'QR-03 · Concourse W-014' },
  { id: 'QR-04', node: 'SP:13', label: 'QR-04 · Concourse W-016' },
  { id: 'QR-05', node: 'SP:39', label: 'QR-05 · Concourse W-018' },
  { id: 'QR-06', node: 'PL:MAIN', label: 'QR-06 · Main entrance plaza' }
];
function buildGraph() {
  const xs = new Set([-64, -60, -50, -44, -33, -22, -11, -8.5, 0, 11, 22, 33, 44, 55, 60, 64, -55]);
  for (const k in ATT) if (ATT[k].side !== 'end') xs.add(ATT[k].x);
  const sx = [...xs].sort((a, b) => a - b);
  for (const x of sx) gNode('SP:' + x, x, L.midZ, { kind: 'spine' });
  for (let i = 1; i < sx.length; i++) gEdge('SP:' + sx[i - 1], 'SP:' + sx[i], { kind: 'walk', zone: (sx[i - 1] + sx[i]) / 2 >= L.x0 && (sx[i - 1] + sx[i]) / 2 <= -L.x0 ? zoneIdxAt((sx[i - 1] + sx[i]) / 2) : -1 });
  G.nodes.get('SP:-64').link = 'LINK_S'; G.nodes.get('SP:64').link = 'LINK_N';
  for (const k in ATT) {
    const a = ATT[k]; if (a.side === 'end') continue;
    const mz = a.side === 'out' ? L.corrOut + 0.4 : L.corrIn - 0.4;
    gNode('M:' + k, a.x, mz, { kind: 'mouth', att: k });
    gEdge('SP:' + a.x, 'M:' + k, { zone: zoneIdxAt(a.x) });
  }
  // gates: turnstile line, outside, plaza
  for (const k in GATES) {
    const x = ATT[GATES[k].att].x;
    gNode('TS:' + k, x, -103, { kind: 'turnstile', gate: k });
    gNode('GO:' + k, x, -109.5, { kind: 'gateout', gate: k });
    gNode('PL:' + k, x, -118, { kind: 'plaza' });
    gEdge('M:' + GATES[k].att, 'TS:' + k, { kind: 'gate', gate: k });
    gEdge('TS:' + k, 'GO:' + k, { kind: 'gate', gate: k });
    gEdge('GO:' + k, 'PL:' + k, { kind: 'plaza' });
  }
  gNode('PL:MAIN', -2, -131, { kind: 'plaza', label: 'Main entrance' });
  gNode('PL:W', -62, -124, { kind: 'plaza' }); gNode('PL:E', 58, -124, { kind: 'plaza' });
  gNode('OPS', -52, -121, { kind: 'ops' });
  gNode('DX:W', -104, -146, { kind: 'exit', label: 'West lots' }); gNode('DX:S', -2, -170, { kind: 'exit', label: 'Main walkway' }); gNode('DX:E', 100, -146, { kind: 'exit', label: 'North lots' });
  gEdge('PL:B', 'PL:MAIN', { kind: 'plaza' }); gEdge('PL:A', 'PL:MAIN', { kind: 'plaza' }); gEdge('PL:C', 'PL:MAIN', { kind: 'plaza' });
  gEdge('PL:A', 'PL:D', { kind: 'plaza' }); gEdge('PL:D', 'PL:W', { kind: 'plaza' }); gEdge('PL:C', 'PL:E', { kind: 'plaza' });
  gEdge('PL:W', 'OPS', { kind: 'plaza' }); gEdge('PL:W', 'DX:W', { kind: 'plaza' }); gEdge('PL:MAIN', 'DX:S', { kind: 'plaza' }); gEdge('PL:E', 'DX:E', { kind: 'plaza' });
  // amenities: counter or interior node
  for (const k of ['CONC_A', 'CONC_B', 'REST_A', 'REST_B']) { gNode('CT:' + k, ATT[k].x, L.alcoveZ + 0.2, { kind: 'counter', amen: k }); gEdge('M:' + k, 'CT:' + k, { kind: 'walk' }); }
  gNode('MD:MED', ATT.MED.x, -101.5, { kind: 'medical' }); gEdge('M:MED', 'MD:MED', { kind: 'walk' });
  // portals into the lower bowl and seats
  for (const [p, g] of [['POR_102', 'G102'], ['POR_104', 'G104'], ['POR_108', 'G108']]) {
    gNode('PT:' + p, ATT[p].x, -83.5, { kind: 'portal', y: 2.4 });
    gEdge('M:' + p, 'PT:' + p, { kind: 'portal' });
    gNode('SEAT:' + g, ATT[p].x, -66, { kind: 'seat', y: 9, group: g });
    gEdge('PT:' + p, 'SEAT:' + g, { kind: 'portal', len: 18 });
  }
  // stairs, elevator and ramp to the upper level
  gNode('UP:W', 18, -80, { kind: 'upper', y: 17 });
  gNode('SEAT:GUP', 18, -76, { kind: 'seat', y: 24, group: 'GUP' });
  gEdge('UP:W', 'SEAT:GUP', { kind: 'walk', len: 22 });
  for (const s of ['STAIR_1', 'STAIR_2']) {
    gNode('ST:' + s, ATT[s].x, -81.6, { kind: 'stairtop', y: 8.8 });
    gEdge('M:' + s, 'ST:' + s, { kind: 'stair', access: false, asset: s, len: 16 });
    gEdge('ST:' + s, 'UP:W', { kind: 'stair', access: false, asset: s, len: 14 });
  }
  gNode('EL:ELEV_A', ATT.ELEV_A.x, -89.8, { kind: 'elevator' });
  gEdge('M:ELEV_A', 'EL:ELEV_A', { kind: 'walk' });
  gEdge('EL:ELEV_A', 'UP:W', { kind: 'elev', asset: 'ELEV_A', len: 30 });
  gNode('RP:1', -49.5, -88.5, { kind: 'ramp', y: 2.2 }); gNode('RP:2', -42.5, -86, { kind: 'ramp', y: 4.4 }); gNode('RP:3', -49.5, -83.5, { kind: 'ramp', y: 6.6 }); gNode('RP:TOP', -42.5, -81, { kind: 'ramp', y: 8.8 });
  gEdge('M:RAMP', 'RP:1', { kind: 'ramp', asset: 'RAMP' }); gEdge('RP:1', 'RP:2', { kind: 'ramp', asset: 'RAMP' }); gEdge('RP:2', 'RP:3', { kind: 'ramp', asset: 'RAMP' }); gEdge('RP:3', 'RP:TOP', { kind: 'ramp', asset: 'RAMP' });
  gEdge('RP:TOP', 'UP:W', { kind: 'walk', len: 30 });
  // links to the rest of the stadium
  gNode('LK:S', -78, -86, { kind: 'link', label: 'South concourse' }); gNode('LK:N', 78, -86, { kind: 'link', label: 'North concourse' });
  gEdge('SP:-64', 'LK:S', { kind: 'walk' }); gEdge('SP:64', 'LK:N', { kind: 'walk' });
  // staff service corridor behind the amenity band (restricted to staff and responders)
  const sv = [-56, -49.5, -40, -27.5, -15, -8.5, -2, 9.5, 19, 27.5, 39, 50.5, 56];
  for (const x of sv) gNode('SV:' + x, x, L.servZ, { kind: 'service' });
  for (let i = 1; i < sv.length; i++) gEdge('SV:' + sv[i - 1], 'SV:' + sv[i], { kind: 'service', restricted: true });
  gEdge('SV:50.5', 'MD:MED', { kind: 'service', restricted: true });
  gNode('SD:W014', -8.5, L.corrOut - 0.3, { kind: 'servicedoor' });
  gEdge('SV:-8.5', 'SD:W014', { kind: 'service', restricted: true }); gEdge('SD:W014', 'SP:-8.5', { kind: 'walk', zone: zoneIdxAt(-8.5) });
  for (const k of ['A', 'B', 'C', 'D']) gEdge('SV:' + ATT[GATES[k].att].x, 'TS:' + k, { kind: 'service', restricted: true, gate: k });
  gEdge('SV:-56', 'PL:W', { kind: 'service', restricted: true });
}
buildGraph();

/* ---------------- routing: Dijkstra with a congestion-aware generalised cost ---------------- */
const W8 = { alpha: 1, beta: 1.5, gamma: 1, delta: 45, eps: Infinity, zeta: 1 };
const recLoad = new Float32Array(L.nz);         // expected people from recent recommendations, per zone
const recDest = {};                               // recent recommendations per destination
function edgeCost(e, o) {
  const tw = TWIN, cfg = tw.cfg;
  if (e.restricted && !o.responder) return Infinity;
  if (o.inVenue && e.kind === 'gate') return Infinity;            // no exit and re-entry through turnstiles for in-venue trips
  if (e.gate && !cfg.gateOpen[e.gate]) return Infinity;
  if (e.asset && cfg.outletOpen[e.asset] === false) return Infinity;
  if (e.kind === 'elev' && !cfg.outletOpen.ELEV_A) return Infinity;
  if ((o.access || o.stairFree) && e.kind === 'stair') return W8.eps;
  let v = 1.3, k = 0, kp = 0;
  if (e.zone >= 0) {
    const est = tw.est[e.zone];
    k = est.k + recLoad[e.zone] / ZONES[e.zone].area * (o.crowdAware ? 1 : 0);
    kp = tw.predicted(e.zone, 2);
    v = o.crowdAware ? vk(k) : 1.3;
  }
  if (o.responder || o.responderSpeed) v = 1.7 * Math.max(0.28, 1 - (k / 5.2));
  if (e.kind === 'stair') v = (o.responder || o.responderSpeed) ? 0.8 : 0.7 * (o.crowdAware ? Math.min(1, vk(k) / 1.3 + 0.2) : 1);
  if (e.kind === 'ramp') v = 0.9;
  let c = W8.alpha * e.len / v;
  if (e.kind === 'elev') c += 45;
  if (e.gate && o.crowdAware) { const g = tw.gest[e.gate]; c += (g.Q || 0) * 0.08; }
  if (o.crowdAware && e.zone >= 0) {
    c += W8.beta * e.len * Math.max(0, k - 1.2);
    c += W8.zeta * e.len * Math.max(0, kp - 1.5);
    if (e.asset) for (const a of tw.alerts.values()) if (a.asset && OUTLETS[e.asset] && a.asset === OUTLETS[e.asset].label) c += W8.delta;
  }
  return c;
}
function dijkstra(start, o) {
  const dist = new Map(), prev = new Map(), done = new Set();
  dist.set(start, 0);
  const pq = [[0, start]];
  while (pq.length) {
    let bi = 0; for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
    const [d, u] = pq.splice(bi, 1)[0];
    if (done.has(u)) continue; done.add(u);
    for (const [w, e] of G.adj.get(u)) {
      if (done.has(w)) continue;
      const c = o.distance ? (edgeCost(e, o) === Infinity ? Infinity : e.len) : edgeCost(e, o);
      if (!isFinite(c)) continue;
      const nd = d + c;
      if (nd < (dist.has(w) ? dist.get(w) : Infinity)) { dist.set(w, nd); prev.set(w, [u, e]); pq.push([nd, w]); }
    }
  }
  return { dist, prev };
}
function pathTo(res, target) {
  if (!res.dist.has(target)) return null;
  const nodes = [target], edges = []; let u = target;
  while (res.prev.has(u)) { const [p, e] = res.prev.get(u); nodes.push(p); edges.push(e); u = p; }
  nodes.reverse(); edges.reverse();
  let len = 0, walk = 0; const zones = [];
  const o = res.o;
  for (const e of edges) {
    len += e.len;
    let v = 1.3;
    if (e.zone >= 0) { v = o && (o.responder || o.responderSpeed) ? 1.7 * Math.max(0.28, 1 - TWIN.est[e.zone].k / 5.2) : (o && !o.crowdAware ? vk(TWIN.est[e.zone].k) : vk(TWIN.est[e.zone].k)); if (!zones.includes(e.zone)) zones.push(e.zone); }
    if (o && (o.responder || o.responderSpeed) && e.zone < 0) v = 1.7;
    if (e.kind === 'stair') v = o && (o.responder || o.responderSpeed) ? 0.8 : 0.7;
    if (e.kind === 'ramp') v = 0.9;
    walk += e.len / v + (e.kind === 'elev' ? 45 : 0);
  }
  return { nodes, edges, len, walk, zones, cost: res.dist.get(target) };
}
/* destination catalogue for the route planner */
const DEST_TYPES = {
  restroom: { label: 'Restroom', cands: () => [{ id: 'REST_A', node: 'CT:REST_A', label: 'Restroom A' }, { id: 'REST_B', node: 'CT:REST_B', label: 'Restroom B' }, { id: 'REST_S', node: 'LK:S', label: 'Restroom S (south concourse)', extraLen: 85, wait: 150 }] },
  food: { label: 'Food', cands: () => [{ id: 'CONC_A', node: 'CT:CONC_A', label: 'Concession A' }, { id: 'CONC_B', node: 'CT:CONC_B', label: 'Concession B' }, { id: 'CONC_N', node: 'LK:N', label: 'Concession N (north concourse)', extraLen: 90, wait: 180 }] },
  seat: { label: 'Seat', cands: () => [{ id: 'SEAT', node: 'SEAT:' + (S.nav.seat || 'G104'), label: GROUPS.find(g => g.id === (S.nav.seat || 'G104')).label }] },
  exit: { label: 'Exit', cands: () => [{ id: 'DX:W', node: 'DX:W', label: 'West lots exit' }, { id: 'DX:S', node: 'DX:S', label: 'Main walkway exit' }, { id: 'DX:E', node: 'DX:E', label: 'North lots exit' }, { id: 'LK:S', node: 'LK:S', label: 'South concourse exits', extraLen: 110 }, { id: 'LK:N', node: 'LK:N', label: 'North concourse exits', extraLen: 110 }] },
  medical: { label: 'Medical', cands: () => [{ id: 'MED', node: 'MD:MED', label: 'First-aid station' }] },
  accessible: { label: 'Accessible route', cands: () => [{ id: 'ELEV', node: 'EL:ELEV_A', label: 'Elevator A', down: !TWIN.cfg.outletOpen.ELEV_A }, { id: 'RAMP', node: 'RP:TOP', label: 'Accessible ramp' }] }
};
function destWait(c) {
  if (c.wait !== undefined) return c.wait;
  if (AMEN[c.id]) { const mu = (AMEN[c.id].servers + TWIN.cfg.extraServers[c.id]) * AMEN[c.id].rate; return (TWIN.aest[c.id].Q + (recDest[c.id] || 0) * 0.35) / mu * 60; }
  if (c.id === 'ELEV') return 40;
  return 0;
}
function planRoute(startNode, destType, opts) {
  const o = Object.assign({ crowdAware: true }, opts);
  if (destType !== 'exit' && !/^(PL|DX|GO|OPS)/.test(startNode)) o.inVenue = true;
  const cands = DEST_TYPES[destType].cands().filter(c => !c.down);
  const resAware = dijkstra(startNode, Object.assign({}, o, { crowdAware: true })); resAware.o = Object.assign({}, o, { crowdAware: true });
  const resShort = dijkstra(startNode, Object.assign({}, o, { distance: true, crowdAware: false })); resShort.o = Object.assign({}, o, { crowdAware: false });
  const rows = [];
  for (const c of cands) {
    const pa = pathTo(resAware, c.node), ps = pathTo(resShort, c.node);
    if (!pa || !ps) { rows.push({ c, ok: false }); continue; }
    const extra = c.extraLen || 0;
    const wait = destWait(c);
    const walkAware = pa.walk + extra / 1.2;
    rows.push({ c, ok: true, pa, ps, dist: pa.len + extra, distShort: ps.len + extra, walk: walkAware, wait, total: walkAware + wait, freeWalk: (ps.len + extra) / 1.3 });
  }
  const ok = rows.filter(r => r.ok);
  if (!ok.length) return { rows, none: true };
  const shortest = ok.reduce((a, b) => a.distShort <= b.distShort ? a : b);
  const aware = ok.reduce((a, b) => a.total <= b.total ? a : b);
  const shortTotal = (() => { const p = shortest.ps; let w = 0; for (const e of p.edges) { let v = e.zone >= 0 ? vk(TWIN.est[e.zone].k) : 1.3; if (e.kind === 'stair') v = 0.7; if (e.kind === 'ramp') v = 0.9; w += e.len / v + (e.kind === 'elev' ? 45 : 0); } return w + (shortest.c.extraLen || 0) / 1.2 + shortest.wait; })();
  return { rows, shortest, aware, shortTotal, start: startNode, type: destType };
}
function congestionOf(path) { let mk = 0; for (const z of path.zones) mk = Math.max(mk, TWIN.est[z].k); return densLevel(mk); }
function noteRecommendation(r) {
  if (!r || !r.aware) return;
  const id = r.aware.c.id;
  recDest[id] = (recDest[id] || 0) + AGENT_SCALE;
  for (const z of r.aware.pa.zones) recLoad[z] += AGENT_SCALE * 0.4;
}
function decayRecommendations(dt) {
  const f = Math.exp(-dt / 180);
  for (let j = 0; j < L.nz; j++) recLoad[j] *= f;
  for (const k in recDest) recDest[k] *= f;
}
/* responder route from the first-aid station to an incident zone */
function responderPath(zoneIdx, laneAware, stairFree, noService) {
  const target = 'SP:' + nearestSpineX(ZONES[zoneIdx].xc);
  const o = { responder: !noService, responderSpeed: true, crowdAware: !!laneAware, stairFree: !!stairFree };
  const res = dijkstra('MD:MED', o); res.o = o;
  return pathTo(res, target);
}
function nearestSpineX(x) { let best = null, bd = Infinity; for (const n of G.nodes.values()) if (n.kind === 'spine') { const d = Math.abs(n.x - x); if (d < bd) { bd = d; best = n.x; } } return best; }
