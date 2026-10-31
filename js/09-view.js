'use strict';
/* =====================================================================
   STADIUM-DT view: per-frame drawing of the twin state in 3D (heat tiles, flow chevrons, agents,
   queues, turnstiles, sensors, data particles, labels, routes, camera glides, day/night, weather)
   ===================================================================== */
const LANDMARKS = [
  { id: 'MAIN', n: 1, name: 'Main stadium entrance', pos: [-2, 17.5, -131], sel: { type: 'landmark', id: 'MAIN' }, icon: 'arch' },
  { id: 'GATE_A', n: 2, name: 'Gate A turnstiles', pos: [-27.5, 9.4, -98.6], sel: { type: 'gate', id: 'A' }, icon: 'gate' },
  { id: 'GATE_B', n: 3, name: 'Gate B turnstiles', pos: [-2, 9.4, -98.6], sel: { type: 'gate', id: 'B' }, icon: 'gate' },
  { id: 'GATE_C', n: 4, name: 'Gate C turnstiles', pos: [27.5, 9.4, -98.6], sel: { type: 'gate', id: 'C' }, icon: 'gate' },
  { id: 'CENTRAL', n: 5, name: 'Central concourse', pos: [2, 9.6, -94.5], sel: { type: 'landmark', id: 'CENTRAL' }, icon: 'zone' },
  { id: 'ACCESS104', n: 6, name: 'Section 104/105 access corridor', pos: [-5.5, 7.6, -90.6], sel: { type: 'asset', id: 'POR_104' }, icon: 'portal' },
  { id: 'REST', n: 7, name: 'Restroom complex', pos: [39, 6.6, -101], sel: { type: 'amen', id: 'REST_B' }, icon: 'rest' },
  { id: 'FOOD', n: 8, name: 'Food and concessions', pos: [-15, 6.6, -101], sel: { type: 'amen', id: 'CONC_A' }, icon: 'food' },
  { id: 'STAIRS', n: 9, name: 'Main stair cluster', pos: [18.5, 10.6, -88], sel: { type: 'landmark', id: 'STAIRS' }, icon: 'stairs' },
  { id: 'ACCESS', n: 10, name: 'Accessible ramp / elevator', pos: [-42, 21.6, -89.2], sel: { type: 'asset', id: 'ELEV_A' }, icon: 'access' },
  { id: 'MED', n: 11, name: 'First-aid station', pos: [50.5, 6.6, -101], sel: { type: 'asset', id: 'MED' }, icon: 'med' },
  { id: 'OPS', n: 12, name: 'Stadium operations center', pos: [-52, 15, -121], sel: { type: 'landmark', id: 'OPS' }, icon: 'ops' }
];
const AREAS = {
  overview: { label: 'Stadium Overview', pos: [-205, 205, -330], tgt: [0, 0, -38] },
  gates: { label: 'Gate Operations', pos: [-34, 50, -160], tgt: [-4, 0, -106] },
  concourse: { label: 'Concourse Intelligence', pos: [-24, 62, -136], tgt: [2, 0, -96] },
  amenities: { label: 'Amenities and Accessibility', pos: [-6, 44, -138], tgt: [-36, 0, -98] },
  emergency: { label: 'Emergency and Exit Operations', pos: [88, 52, -152], tgt: [36, 0, -101] }
};

const V3 = { glide: null, t: 0, flash: 0, lastBoard: -1, lastFill: -1, heatAcc: 0, display: null };
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();

/* density to colour-ramp position, aligned with the legend classes */
const DRAMP = [[0, 0x2C2F4A], [0.22, COL.low], [0.42, COL.mod], [0.62, COL.high], [0.8, COL.crit], [1, 0x9E2346]];
function kToT(k) { if (k <= 1.5) return 0.22 * k / 1.5; if (k <= 2.5) return 0.22 + 0.2 * (k - 1.5); if (k <= 3.5) return 0.42 + 0.2 * (k - 2.5); return Math.min(1, 0.62 + 0.38 * (k - 3.5) / 1.5); }
function dramp(t, out) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < DRAMP.length; i++) if (t <= DRAMP[i][0]) {
    const [t0, c0] = DRAMP[i - 1], [t1, c1] = DRAMP[i], a = (t - t0) / (t1 - t0);
    out.r = lerp(((c0 >> 16) & 255) / 255, ((c1 >> 16) & 255) / 255, a); out.g = lerp(((c0 >> 8) & 255) / 255, ((c1 >> 8) & 255) / 255, a); out.b = lerp((c0 & 255) / 255, (c1 & 255) / 255, a);
    return out.convertSRGBToLinear();
  }
  out.setHex(0x9E2346); return out;
}

/* which model the 3D view shows: the live twin, a scenario run, or a replay frame */
function displayModel() {
  if (S.mode === 'simulate' && S.scenario && S.scenario.run) return S.scenario.view === 'base' ? S.scenario.run.mb : S.scenario.run.mi;
  return TWIN.m;
}
/* zone values for the active metric and horizon (estimated state; replay uses recorded frames) */
function zoneMetric(j, metric) {
  if (S.mode === 'replay' && REC.frame) {
    const f = REC.frame.z[j];
    switch (metric) {
      case 'occupancy': return clamp(f.N / 340, 0, 1) * 0.9;
      case 'speed': return kToT(5 * (1 - f.v / 1.34));
      case 'queue': return clamp(f.q / 160, 0, 1);
      case 'uncertainty': return clamp((1 - f.conf) * 2.2, 0, 1);
      default: return kToT(f.k);
    }
  }
  const dm = displayModel();
  if (dm !== TWIN.m) {
    const z = dm.z[j];
    switch (metric) {
      case 'occupancy': return clamp(z.N / 340, 0, 1) * 0.9;
      case 'speed': return kToT(5 * (1 - z.v / 1.34));
      case 'queue': return clamp(zoneQueue(dm, j) / 160, 0, 1);
      case 'uncertainty': return 0.25;
      default: return kToT(z.k);
    }
  }
  const e = TWIN.est[j];
  const h = S.mode === 'predict' ? S.horizon : 0;
  switch (metric) {
    case 'occupancy': return clamp((h ? TWIN.predicted(j, h) * e.A : e.N) / 340, 0, 1) * 0.9;
    case 'speed': return kToT(5 * (1 - (h ? vk(TWIN.predicted(j, h)) : e.v) / 1.34));
    case 'queue': return clamp(zoneQueue(TWIN.m, j) / 160, 0, 1);
    case 'predicted': return kToT(TWIN.predicted(j, h || 5));
    case 'uncertainty': { const u = TWIN.fc ? TWIN.fc.unc(h)[j] : 0.2; return clamp(u / 0.9, 0, 1); }
    default: return kToT(h ? TWIN.predicted(j, h) : e.k);
  }
}
function zoneQueue(m, j) { let q = 0; for (const k in AMEN) if (zoneIdxAt(ATT[k].x) === j) q += m.a[k].Q; for (const g in GATES) if (zoneIdxAt(ATT[GATES[g].att].x) === j) q += m.g[g].xq; return q; }

/* ---------------- heat tiles ---------------- */
function updateHeat(dt) {
  const H = W3.heat, mesh = H.mesh;
  mesh.visible = S.overlay.density;
  if (!mesh.visible) return;
  V3.heatAcc += dt; if (V3.heatAcc < 0.12) return; V3.heatAcc = 0;
  // local variation from where agents are (kernel density on the 1.1 m grid)
  const kde = H.kde; kde.fill(0);
  const idxOf = (x, z) => { if (z < -97.7 || z > -91.1 || x < -55 || x >= 55) return -1; return Math.floor((x + 55) / 1.1) * 6 + Math.floor((z + 97.7) / 1.1); };
  for (const a of AG.list) { const i = idxOf(a.x, a.z); if (i >= 0 && i < kde.length) kde[i] += 1; }
  for (const s of AG.queueSlots) { const i = idxOf(s[0], s[1]); if (i >= 0 && i < kde.length) kde[i] += 1; }
  const zv = ZONES.map((z, j) => zoneMetric(j, S.overlay.metric));
  const dm = displayModel();
  const tnow = performance.now() / 1000;
  H.cells.forEach((c, i) => {
    let v;
    if (c.gate) {
      const g = S.mode === 'replay' && REC.frame ? REC.frame.g[c.gate] : dm.g[c.gate];
      v = S.overlay.metric === 'queue' ? clamp(g.Q / 300, 0, 1) : kToT(Math.min(4.6, 0.6 + g.Q / 90 + g.e / 40 + (g.xq || 0) / 25));
      if (!(S.mode === 'replay' ? g.open : dm.cfg.gateOpen[c.gate])) v = 0.02;
    } else {
      const f = (c.x - L.x0) / L.zl - 0.5, j0 = clamp(Math.floor(f), 0, L.nz - 1), j1 = clamp(j0 + 1, 0, L.nz - 1), a = clamp(f - j0, 0, 1);
      v = lerp(zv[j0], zv[j1], smooth(a));
      const loc = i < kde.length ? kde[i] : 0;
      v *= 0.8 + Math.min(0.45, loc * 0.12);
      if (S.overlay.metric === 'uncertainty') v *= 0.85 + 0.15 * Math.sin(tnow * 2 + c.x * 0.3);
    }
    c.v = lerp(c.v, v, 0.35);
    mesh.setColorAt(i, dramp(c.v, _c));
  });
  mesh.instanceColor.needsUpdate = true;
  mesh.material.opacity = S.mode === 'predict' ? 0.72 : 0.62;
}

/* ---------------- flow chevrons ---------------- */
function updateArrows(dt) {
  const A = W3.arrows, mesh = A.mesh;
  mesh.visible = S.overlay.flow;
  if (!mesh.visible) return;
  A.phase += dt;
  const dm = displayModel();
  const pred = S.mode === 'predict' && S.horizon && TWIN.fc ? (S.horizon === 2 ? TWIN.fc.h2 : TWIN.fc.h5) : null;
  let n = 0;
  const put = (x, z, ang, sc, col) => {
    if (n >= A.max) return;
    _q.setFromEuler(_e.set(0, ang, 0)); _s.set(sc, 1, sc * 0.8);
    _m4.compose(_v.set(x, 0.16, z), _q, _s); mesh.setMatrixAt(n, _m4); mesh.setColorAt(n, _c.setHex(col)); n++;
  };
  for (let j = 0; j < L.nz; j++) {
    const Z = ZONES[j];
    let aP, aN, v;
    if (S.mode === 'replay' && REC.frame) { const f = REC.frame.z[j]; aP = f.aP; aN = f.aN; v = f.v; }
    else if (pred) { aP = pred[j].aP; aN = pred[j].aN; v = pred[j].v; }
    else { const z = dm.z[j]; aP = z.aP; aN = z.aN; v = z.v; }
    for (const [F, dir, lz, col] of [[aP, 1, -92.9, COL.amber], [aN, -1, -96.1, COL.violet]]) {
      if (F < 6) continue;
      const cnt = F > 140 ? 3 : 2, sc = 0.55 + Math.min(1, F / 260) * 0.95;
      const spacing = L.zl / cnt, off = (A.phase * v * 1.4) % spacing;
      for (let c = 0; c < cnt; c++) {
        let x = Z.x0 + c * spacing + (dir > 0 ? off : spacing - off);
        if (x > Z.x1) x -= L.zl; if (x < Z.x0) x += L.zl;
        put(x, lz, dir > 0 ? 0 : Math.PI, sc, col);
      }
    }
  }
  // cross flows at gates, portals, stairs and amenities
  if (S.mode !== 'replay') {
    const atts = ['GATE_A', 'GATE_B', 'GATE_C', 'GATE_D', 'POR_102', 'POR_104', 'POR_108', 'STAIR_1', 'STAIR_2', 'CONC_A', 'CONC_B', 'REST_A', 'REST_B'];
    for (const at of atts) {
      const inF = dm.flowTo(at), outF = dm.flowFrom(at), side = ATT[at].side, x = ATT[at].x;
      const mouthZ = side === 'out' ? -97.6 : -91.6, dirIn = side === 'out' ? Math.PI / 2 : -Math.PI / 2;
      const ph = (A.phase * 0.9) % 1.6;
      if (inF > 5) { const sc = 0.5 + Math.min(1, inF / 200) * 0.8; for (let c = 0; c < 2; c++) put(x - 0.9, mouthZ + (side === 'out' ? 1 : -1) * (0.4 + c * 1.6 + ph), -dirIn + Math.PI, sc, side === 'out' ? COL.low : COL.ok); }
      if (outF > 5) { const sc = 0.5 + Math.min(1, outF / 200) * 0.8; for (let c = 0; c < 2; c++) put(x + 0.9, mouthZ + (side === 'out' ? 1 : -1) * (0.4 + c * 1.6 + (1.6 - ph)), dirIn + Math.PI, sc, side === 'out' ? COL.ok : COL.low); }
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/* ---------------- agents and queue figures ---------------- */
function drawAgents() {
  const mesh = W3.agents.mesh, rmesh = W3.agents.rmesh;
  let n = 0, r = 0;
  const cols = W3.agentColors, t = performance.now() / 1000;
  if (S.mode === 'replay' && REC.frame) {
    const f = REC.frame;
    for (let i = 0; i < f.na; i++) {
      const x = f.ax[i], z = f.az[i], kind = f.ak[i];
      _q.setFromAxisAngle(_v.set(0, 1, 0), f.ah[i]);
      _m4.compose(_v.set(x, f.ay[i], z), _q, _s.set(1.3, 1.3, 1.3));
      if (kind === 2) { if (r < 24) rmesh.setMatrixAt(r++, _m4); continue; }
      mesh.setMatrixAt(n, _m4); mesh.setColorAt(n, _c.setHex(cols[f.ac[i] % cols.length])); n++;
    }
    for (const s of queueSlots({ g: f.g, a: f.a })) {
      if (n >= 1100) break;
      _q.setFromAxisAngle(_v.set(0, 1, 0), s[2] === 'q' ? 0 : Math.PI);
      _m4.compose(_v.set(s[0], 0, s[1]), _q, _s.set(1.3, 1.3, 1.3));
      mesh.setMatrixAt(n, _m4); mesh.setColorAt(n, _c.setHex(cols[(s[3] * 7 | 0) % cols.length])); n++;
    }
  } else {
    for (const a of AG.list) {
      const sc = 1.3 * (1 - (a.fade || 0));
      _q.setFromAxisAngle(_v.set(0, 1, 0), a.hd);
      const bob = a.stop > 0 ? 0 : Math.abs(Math.sin(t * 7 + a.n)) * 0.04;
      _m4.compose(_v.set(a.x, a.y + bob, a.z), _q, _s.set(sc, sc, sc));
      if (a.kind === 'resp') { if (r < 24) rmesh.setMatrixAt(r++, _m4); continue; }
      if (n >= 1100) break;
      mesh.setMatrixAt(n, _m4); mesh.setColorAt(n, _c.setHex(a.access ? COL.ok : cols[a.col])); n++;
    }
    const slots = queueSlots(displayModel());
    for (const s of slots) {
      if (n >= 1100) break;
      const sway = Math.sin(t * 1.3 + s[3]) * 0.06;
      _q.setFromAxisAngle(_v.set(0, 1, 0), s[2] === 'q' ? 0 : s[2] === 'x' ? Math.PI : Math.PI);
      _m4.compose(_v.set(s[0] + sway, 0, s[1]), _q, _s.set(1.3, 1.3, 1.3));
      mesh.setMatrixAt(n, _m4); mesh.setColorAt(n, _c.setHex(cols[(s[3] * 7 | 0) % cols.length])); n++;
    }
  }
  mesh.count = n; rmesh.count = r;
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  rmesh.instanceMatrix.needsUpdate = true;
}

/* ---------------- turnstiles, gate shutters, stair barriers, elevator ---------------- */
function updateAssets(dtSim) {
  const dm = displayModel(), cfg = S.mode === 'replay' && REC.frame ? null : dm.cfg;
  for (const k in W3.turn) {
    const T = W3.turn[k];
    const open = cfg ? cfg.gateOpen[k] : REC.frame.g[k].open;
    T.shutter.visible = !open;
    const e = cfg ? dm.g[k].e : REC.frame.g[k].e;
    for (let i = 0; i < T.lanes; i++) {
      T.angle[i] += (e / T.lanes / 60) * (Math.PI * 2 / 3) * dtSim * (0.8 + 0.4 * Math.sin(i * 1.7));
      _q.setFromAxisAngle(_v.set(0, 0, 1), T.angle[i]);
      _m4.compose(_v.set(T.x - T.w / 2 + (i + 0.5) * T.w / T.lanes, 0.9, -103), _q, _s.set(1, 1, 1));
      T.group.children.find(c => c.isInstancedMesh && c.count === T.lanes).setMatrixAt(i, _m4);
    }
    T.group.children.find(c => c.isInstancedMesh && c.count === T.lanes).instanceMatrix.needsUpdate = true;
  }
  for (const s of ['STAIR_1', 'STAIR_2']) { const g = W3.lm[s]; if (g && g.userData.barrier) g.userData.barrier.visible = cfg ? !cfg.outletOpen[s] : false; }
  const eOpen = cfg ? cfg.outletOpen.ELEV_A : true;
  const car = W3.elevCar;
  if (eOpen) { V3.elevT = (V3.elevT || 0) + dtSim; const p = (Math.sin(V3.elevT / 9) + 1) / 2; car.position.y = 1.4 + p * 16.5; car.material.emissiveIntensity = 0.35; }
  else { car.position.y = 1.4; car.material.emissiveIntensity = 0; car.material.color.setHex(COL.crit); }
  if (eOpen) car.material.color.setHex(0xF8F1E7);
}

/* ---------------- sensors and data particles ---------------- */
function updateSensors(dt) {
  const t = performance.now() / 1000, on = S.sources;
  const show = S.overlay.sensors && S.mode !== 'replay';
  for (const c of W3.cams) {
    c.cone.visible = show && on.cctv;
    c.cone.material.opacity = 0.05 + 0.025 * Math.sin(t * 2 + c.c.x);
    c.led.material.color.setHex(on.cctv ? COL.ok : COL.crit);
  }
  for (const a of W3.aps) {
    a.halo.visible = a.halo2.visible = show && on.wifi;
    const p = (t * 0.6 + a.a.x * 0.02) % 1;
    a.halo.scale.setScalar(0.6 + p * 0.55); a.halo.material.opacity = 0.22 * (1 - p);
    a.led.material.color.setHex(on.wifi ? COL.violet : COL.crit);
  }
  for (const k in W3.turn) { const ts = W3.turn[k].group.children.find(c => c.isInstancedMesh && c.count === W3.turn[k].lanes + 1); if (ts) ts.material.color.setHex(on.turnstile ? 0xffffff : 0x6A6070); }
  // particles: sensor groups to the operations center
  const P = W3.parts, list = P.list;
  if (S.mode !== 'replay' && S.overlay.sensors) {
    const rate = { cctv: on.cctv ? 9 : 0, wifi: on.wifi ? 4 : 0, turnstile: on.turnstile ? 6 : 0 };
    for (const k in rate) {
      V3['pa_' + k] = (V3['pa_' + k] || 0) + rate[k] * dt;
      while (V3['pa_' + k] >= 1 && list.length < P.n) {
        V3['pa_' + k] -= 1;
        let from;
        if (k === 'cctv') { const c = pick(CAMERAS); from = [c.x, 6.4, c.z]; }
        else if (k === 'wifi') { const a = pick(WIFI); from = [a.x, 7.3, a.z]; }
        else { const g = pick(['A', 'B', 'C']); from = [ATT[GATES[g].att].x, 1.2, -103]; }
        list.push({ k, from, t: 0, sp: 0.32 + rnd() * 0.12 });
      }
    }
  }
  const pos = P.pts.geometry.attributes.position.array, col = P.pts.geometry.attributes.color.array;
  const to = W3.opsPoint;
  const cc = { cctv: new THREE.Color(COL.amber), wifi: new THREE.Color(COL.violet), turnstile: new THREE.Color(COL.ok) };
  for (let i = list.length - 1; i >= 0; i--) { list[i].t += dt * list[i].sp; if (list[i].t >= 1) list.splice(i, 1); }
  for (let i = 0; i < P.n; i++) {
    const p = list[i];
    if (!p) { pos[i * 3 + 1] = -999; continue; }
    const u = p.t, [x0, y0, z0] = p.from, mx = (x0 + to.x) / 2, mz = (z0 + to.z) / 2, my = Math.max(y0, to.y) + 16;
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    pos[i * 3] = a * x0 + b * mx + c * to.x; pos[i * 3 + 1] = a * y0 + b * my + c * to.y; pos[i * 3 + 2] = a * z0 + b * mz + c * to.z;
    const C = cc[p.k]; col[i * 3] = C.r; col[i * 3 + 1] = C.g; col[i * 3 + 2] = C.b;
  }
  P.pts.geometry.attributes.position.needsUpdate = true; P.pts.geometry.attributes.color.needsUpdate = true;
  P.pts.visible = S.overlay.sensors;
  W3.opsBeacon.material.color.setHex(Math.sin(t * 3) > 0 ? COL.amber : 0x6A4A20);
}

/* ---------------- seated crowd fill, other concourses, scoreboards ---------------- */
function updateStands(force) {
  const dm = displayModel();
  const clock = S.mode === 'replay' && REC.frame ? REC.frame.clock : dm.clock;
  const tick = Math.floor(clock / 3);
  if (!force && tick === V3.lastFill) return; V3.lastFill = tick;
  const seat = S.mode === 'replay' && REC.frame ? REC.frame.seat : dm.seat;
  const fill = {}; let avg = 0;
  for (const gr of GROUPS) { fill[gr.id] = clamp(seat[gr.id] / gr.cap, 0, 1); avg += fill[gr.id] / GROUPS.length; }
  const ph = phaseAt(clock);
  const other = ph === 'post' ? clamp(avg * 1.1, 0, 1) : avg;
  const SD = W3.seated, mesh = SD.mesh;
  SD.seats.forEach((s, i) => {
    const f = s.group ? fill[s.group] : other;
    const on = s.r < f;
    if (on !== s.on) { s.on = on; _m4.compose(_v.set(s.x, s.y, s.z), s.q, on ? _s.set(1.25, 1.25, 1.25) : _s.set(0.001, 0.001, 0.001)); mesh.setMatrixAt(i, _m4); SD.dirty = true; }
  });
  if (SD.dirty) { mesh.instanceMatrix.needsUpdate = true; SD.dirty = false; }
  // other concourses (illustrative, low level of detail)
  const R = W3.ring, st = dm.standing ? dm.standing(clock) : 0.3;
  for (const z of R.zones) {
    if (!z) continue;
    z.dk = clamp(st * 1.6 + 0.35 * Math.sin(clock / 70 + z.seed) + (ph === 'post' ? 1.4 : 0) + (ph === 'half' ? 0.4 : 0), 0.05, 4.6);
    R.mesh.setColorAt(z.inst, dramp(kToT(z.dk), _c));
  }
  R.mesh.instanceColor.needsUpdate = true;
  R.mesh.visible = S.overlay.density;
  const sec = Math.floor(clock);
  if (sec !== V3.lastBoard) { V3.lastBoard = sec; drawBoards(clock, ph); }
}

/* ---------------- environment: day/night and weather ---------------- */
function applyEnvironment() {
  const night = S.night;
  W3.scene.background.setHex(night ? COL.deep : 0x4B3D60);
  W3.scene.fog.color.setHex(night ? COL.deep : 0x4B3D60);
  W3.scene.fog.density = night ? 0.0017 : 0.0013;
  W3.hemi.intensity = night ? 0.85 : 1.3; W3.hemi.color.setHex(night ? 0x9A86C0 : 0xD8CCE8);
  W3.key.intensity = night ? 1.0 : 2.1; W3.key.color.setHex(night ? 0xFFE6C4 : 0xFFF1DE);
  for (const s of W3.flood) s.intensity = night ? 1.25 : 0.25;
  for (const g of W3.glows) g.visible = night;
  for (const l of W3.concLights) l.intensity = night ? 0.9 : 0.25;
  W3.field.material.emissiveIntensity = night ? 0.55 : 0.12;
  W3.renderer.toneMappingExposure = night ? 1.05 : 0.95;
  W3.rain.visible = S.weather !== 'clear';
  if (S.weather === 'storm') { W3.scene.fog.density *= 1.5; }
}
function updateWeather(dt) {
  if (!W3.rain.visible) return;
  const p = W3.rain.geometry.attributes.position.array, fall = (S.weather === 'storm' ? 70 : 48) * dt;
  for (let i = 0; i < p.length; i += 6) { p[i + 1] -= fall; p[i + 4] -= fall; if (p[i + 4] < 0) { p[i + 1] += 70; p[i + 4] += 70; } }
  W3.rain.geometry.attributes.position.needsUpdate = true;
  if (S.weather === 'storm') {
    if (V3.flash <= 0 && rnd() < dt * 0.12) V3.flash = 0.35;
    if (V3.flash > 0) { V3.flash -= dt; W3.hemi.intensity = (S.night ? 0.85 : 1.3) + (V3.flash > 0.2 ? 2.4 : V3.flash > 0.1 ? 0.2 : 1.6); if (V3.flash <= 0) W3.hemi.intensity = S.night ? 0.85 : 1.3; }
  }
}

/* ---------------- selection ring, incident marker and obstacles ---------------- */
function selectionAnchor(sel) {
  if (!sel) return null;
  switch (sel.type) {
    case 'zone': { const z = ZONES[sel.idx]; return { x: z.xc, y: 0.2, z: -94.5, r: 6.6, label: z.id }; }
    case 'cell': { const c = W3.heat.cells[sel.idx]; return { x: c.x, y: 0.2, z: c.z, r: 1.2, label: `${ZONES[c.zone].id} · cell ${sel.idx}` }; }
    case 'gate': { const x = ATT[GATES[sel.id].att].x; return { x, y: 0.2, z: -103, r: GATES[sel.id].w * 0.75, label: GATES[sel.id].label }; }
    case 'amen': return { x: ATT[sel.id].x, y: 0.2, z: -100, r: ATT[sel.id].w * 0.6, label: AMEN[sel.id].label };
    case 'asset': {
      const a = ATT[sel.id];
      if (sel.id === 'MED') return { x: a.x, y: 0.2, z: -100, r: 5.5, label: 'First-aid station' };
      return { x: a.x, y: 0.2, z: a.side === 'in' ? -88.5 : -100, r: 4.2, label: ATT[sel.id].label };
    }
    case 'landmark': {
      if (sel.id === 'MAIN') return { x: -2, y: 0.2, z: -131, r: 13, label: 'Main stadium entrance' };
      if (sel.id === 'OPS') return { x: -52, y: 0.2, z: -121, r: 10, label: 'Stadium operations center' };
      if (sel.id === 'CENTRAL') return { x: 0, y: 0.2, z: -94.5, r: 14, label: 'Central concourse' };
      if (sel.id === 'STAIRS') return { x: 18.5, y: 0.2, z: -88.5, r: 9, label: 'Main stair cluster' };
      break;
    }
    case 'camera': { const c = CAMERAS.find(c => c.id === sel.id); return { x: c.x, y: 0.2, z: c.z, r: 2, label: c.id }; }
    case 'wifi': { const a = WIFI.find(a => a.id === sel.id); return { x: a.x, y: 0.2, z: a.z, r: 3, label: a.id + ' (aggregate)' }; }
    case 'turnstile': { const x = ATT[GATES[sel.id].att].x; return { x, y: 0.2, z: -103, r: GATES[sel.id].w * 0.6, label: `${GATES[sel.id].label} turnstiles` }; }
    case 'section': return { x: sel.x, y: sel.y + 0.3, z: sel.z, r: 7, label: `Section ${sel.sec}` };
    case 'qr': { const n = G.nodes.get(QR.find(q => q.id === sel.id).node); return { x: n.x, y: 0.2, z: n.z - 2.6, r: 1.6, label: sel.id }; }
    case 'agent': { const a = AG.list.find(a => a.id === sel.id); if (!a) return null; return { x: a.x, y: 0.15, z: a.z, r: 1.1, label: 'Simulated agent (anonymous)' }; }
    case 'outer': { const z = W3.ring.zones.find(z => z && z.id === sel.id); return z ? { x: z.x, y: 0.2, z: z.z, r: 8, label: z.id } : null; }
  }
  return null;
}
function updateSelection(t) {
  const ring = W3.selRing, a = selectionAnchor(S.sel);
  ring.visible = !!a;
  if (!a) return;
  ring.position.set(a.x, a.y + 0.12, a.z);
  const p = 1 + 0.06 * Math.sin(t * 4);
  ring.scale.set(a.r * p, a.r * p, 1);
  V3.selAnchor = a;
}
function updateIncident(t) {
  const show = (S.role === 'responder' && S.mode === 'navigate') || (S.mode === 'simulate' && S.scenario && S.scenario.def.id === 'medical');
  W3.incident.visible = show;
  if (show) {
    const zi = S.mode === 'simulate' ? zoneById(S.scenario.P.asset).i : zoneById(S.responder.incidentZone).i;
    W3.incident.position.set(ZONES[zi].xc + 2, 0, -93.2);
    W3.incCone.rotation.y = t * 1.5; W3.incCone.position.y = 4.2 + Math.sin(t * 3) * 0.3;
    W3.incDisc.scale.setScalar(1 + (t * 0.8 % 1) * 0.8); W3.incDisc.material.opacity = 0.7 * (1 - (t * 0.8 % 1));
  }
  // crowd-density obstacles for responders
  const obs = W3.obstacles;
  const want = S.role === 'responder' && S.mode === 'navigate';
  if (!want) { obs.visible = false; return; }
  obs.visible = true;
  if (!obs.children.length) for (let j = 0; j < L.nz; j++) { const m = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.6, 40), new THREE.MeshBasicMaterial({ color: COL.crit, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(ZONES[j].xc, 0.2, -94.5); obs.add(m); }
  obs.children.forEach((m, j) => { m.visible = TWIN.est[j].k >= 3.0; m.scale.setScalar(1 + 0.08 * Math.sin(t * 5 + j)); });
}

/* ---------------- routes (crowd-aware and shortest) ---------------- */
function clearRoutes() { while (W3.routes.children.length) { const c = W3.routes.children.pop(); if (c.geometry) c.geometry.dispose(); } V3.pulse = null; }
function routeTube(nodes, color, radius, opacity, yoff) {
  const pts = []; let prev = null;
  for (const id of nodes) { const n = G.nodes.get(id); const p = new THREE.Vector3(n.x, (n.y || 0) + yoff, n.z); if (!prev || prev.distanceTo(p) > 0.3) pts.push(p); prev = p; }
  if (pts.length < 2) return null;
  const path = new THREE.CurvePath();
  for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
  const geo = new THREE.TubeGeometry(path, Math.max(8, pts.length * 6), radius, 6, false);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
  m.renderOrder = 6; W3.routes.add(m);
  // flattened wide band on the floor under the tube so the route reads from far away
  const band = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, pts.length * 6), radius * 3.2, 8, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.32, depthWrite: false, toneMapped: false }));
  band.scale.y = 0.04; band.position.y = 0.16 - yoff * 0.04; band.renderOrder = 5; W3.routes.add(band);
  return { mesh: m, path };
}
function drawRoute(res, which) {
  clearRoutes();
  if (!res || res.none) return;
  const aw = res.aware, sh = res.shortest;
  if (sh && (which === 'both' || which === 'short')) routeTube(sh.ps.nodes, COL.text, 0.28, 0.7, 0.8);
  if (aw && (which === 'both' || which === 'aware')) { const r = routeTube(aw.pa.nodes, COL.ok, 0.46, 0.95, 1.2); if (r) V3.pulse = { path: r.path, col: COL.ok }; }
  const end = G.nodes.get((which === 'short' ? sh : aw).c.node);
  const pin = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 10), new THREE.MeshBasicMaterial({ color: which === 'short' ? COL.text : COL.ok, toneMapped: false }));
  pin.rotation.x = Math.PI; pin.position.set(end.x, (end.y || 0) + 3, end.z); W3.routes.add(pin);
  const st = G.nodes.get(res.start);
  const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 20), new THREE.MeshBasicMaterial({ color: COL.text, toneMapped: false })); sp.position.set(st.x, (st.y || 0) + 0.25, st.z); W3.routes.add(sp);
  if (!V3.pulseMesh) { V3.pulseMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 8); W3.scene.add(V3.pulseMesh); }
}
/* glide so a whole route is in view, keeping the current viewing direction */
function fitNodes(nodes) {
  if (!nodes || !nodes.length) return;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const id of nodes) { const n = G.nodes.get(id); if (!n) continue; x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ext = Math.max(x1 - x0, z1 - z0, 12);
  const dir = W3.camera.position.clone().sub(W3.controls.target).normalize();
  if (dir.y < 0.55) { dir.y = 0.75; dir.normalize(); }
  const d = clamp(ext * 1.35 + 18, 40, 175);
  glideTo([cx + dir.x * d, dir.y * d, cz + dir.z * d], [cx, 0, cz], 1.2);
}
function drawResponderRoute(p, color) {
  clearRoutes();
  if (!p) return;
  const r = routeTube(p.nodes, color || COL.crit, 0.46, 0.95, 1.0);
  if (r) V3.pulse = { path: r.path, col: color || COL.crit };
}
function updatePulse(t) {
  const pm = V3.pulseMesh; if (!pm) return;
  if (!V3.pulse || !W3.routes.children.length) { pm.visible = false; return; }
  pm.visible = true; pm.material.color.setHex(V3.pulse.col);
  for (let i = 0; i < 8; i++) { const u = (t * 0.12 + i / 8) % 1; const p = V3.pulse.path.getPointAt(u); _m4.makeTranslation(p.x, p.y, p.z); pm.setMatrixAt(i, _m4); }
  pm.instanceMatrix.needsUpdate = true;
}

/* ---------------- labels (DOM, projected) ---------------- */
const LBL = { items: [], box: null };
function initLabels() {
  LBL.box = document.getElementById('labels');
  for (const L0 of LANDMARKS) {
    const el = document.createElement('button');
    el.className = 'lbl lm'; el.type = 'button';
    el.innerHTML = `<span class="lm-n mono">${String(L0.n).padStart(2, '0')}</span><span class="lm-t">${L0.name}</span>`;
    el.setAttribute('aria-label', `Select ${L0.name}`);
    el.addEventListener('click', e => { e.stopPropagation(); select(L0.sel, { glide: true }); });
    LBL.box.appendChild(el);
    LBL.items.push({ el, pos: new THREE.Vector3(...L0.pos), kind: 'lm', id: L0.id });
  }
  for (const z of ZONES) {
    const el = document.createElement('button'); el.className = 'lbl zl mono'; el.type = 'button'; el.textContent = z.short;
    el.addEventListener('click', e => { e.stopPropagation(); select({ type: 'zone', idx: z.i }, { glide: true }); });
    LBL.box.appendChild(el); LBL.items.push({ el, pos: new THREE.Vector3(z.xc, 0.4, -91.9), kind: 'zone', idx: z.i });
  }
  const sel = document.createElement('div'); sel.className = 'lbl sell'; LBL.box.appendChild(sel); LBL.sel = { el: sel, pos: new THREE.Vector3() };
  LBL.alerts = new Map();
  const eta = document.createElement('div'); eta.className = 'lbl eta'; LBL.box.appendChild(eta); LBL.eta = { el: eta, pos: new THREE.Vector3() };
  const pz = document.createElement('button'); pz.type = 'button'; pz.className = 'lbl pz mono'; pz.textContent = 'ACTIVE PILOT ZONE';
  pz.addEventListener('click', e => { e.stopPropagation(); select({ type: 'landmark', id: 'CENTRAL' }, { glide: true }); });
  LBL.box.appendChild(pz); LBL.pz = { el: pz, pos: new THREE.Vector3(-57, 2.2, -109) };
}
/* write styles only when they change: label repaints are the main per-frame DOM cost */
function setDisp(el, show) { const v = show ? '' : 'none'; if (el._d !== v) { el._d = v; el.style.display = v; } }
function setHTML(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
function project(pos, el, w, h, opt) {
  _v.copy(pos).project(W3.camera);
  const vis = _v.z < 1 && _v.x > -1.1 && _v.x < 1.1 && _v.y > -1.1 && _v.y < 1.1;
  if (!vis) { setDisp(el, false); return false; }
  setDisp(el, true);
  el._sx = Math.round((_v.x + 1) / 2 * w); el._sy = Math.round((1 - _v.y) / 2 * h);
  return true;
}
function updateLabels() {
  const w = W3.canvas.clientWidth, h = W3.canvas.clientHeight;
  const dist = W3.camera.position.distanceTo(W3.controls.target);
  const showLm = S.overlay.labels;
  for (const it of LBL.items) {
    if (it.kind === 'lm') { if (!showLm) { setDisp(it.el, false); continue; } project(it.pos, it.el, w, h); it.el.classList.toggle('far', dist > 330); it.el.classList.toggle('on', V3.selLm === it.id); }
    else { if (dist > 150 || !showLm) { setDisp(it.el, false); continue; } project(it.pos, it.el, w, h); const e = TWIN.est[it.idx]; const lv = densLevel(S.mode === 'predict' && S.horizon ? TWIN.predicted(it.idx, S.horizon) : e.k).id; if (it.el.dataset.lvl !== lv) it.el.dataset.lvl = lv; }
  }
  const a = V3.selAnchor;
  if (S.sel && a) { LBL.sel.pos.set(a.x, a.y + 2.4, a.z); if (LBL.sel.el.textContent !== a.label) LBL.sel.el.textContent = a.label; project(LBL.sel.pos, LBL.sel.el, w, h); }
  else setDisp(LBL.sel.el, false);
  // floating alerts over zones
  const live = new Set();
  if (S.mode !== 'replay' && S.mode !== 'simulate') for (const al of TWIN.alerts.values()) {
    live.add(al.key);
    let it = LBL.alerts.get(al.key);
    if (!it) { const el = document.createElement('button'); el.type = 'button'; el.className = 'lbl al sev' + al.sev; el.innerHTML = `<i></i>${al.label}`; el.addEventListener('click', e => { e.stopPropagation(); select({ type: 'zone', idx: al.zone }, { glide: true }); }); LBL.box.appendChild(el); it = { el, pos: new THREE.Vector3() }; LBL.alerts.set(al.key, it); }
    const stack = [...TWIN.alerts.values()].filter(b => b.zone === al.zone).indexOf(al);
    it.pos.set(ZONES[al.zone].xc + (al.asset ? 1.5 : 0), 9.8 + stack * 2.3, -94.5);
    project(it.pos, it.el, w, h);
    const op = dist > 420 ? '0' : '1'; if (it.el.style.opacity !== op) it.el.style.opacity = op;
  }
  for (const [k, it] of LBL.alerts) if (!live.has(k)) { it.el.remove(); LBL.alerts.delete(k); }
  // predicted bottleneck countdown
  const ne = TWIN.nextETA();
  const showEta = ne && (S.mode === 'predict' || S.mode === 'mirror') && dist < 520;
  if (showEta) {
    LBL.eta.pos.set(ZONES[ne.zone].xc, 15.5, -94.5);
    setHTML(LBL.eta.el, ne.eta > 0 ? `<b>PREDICTED BOTTLENECK</b><span class="mono">ETA ${fmtMS(ne.eta)}</span><em>${ZONES[ne.zone].id}</em>` : `<b>THRESHOLD REACHED</b><span class="mono">${BOTTLENECK_K} p/m²</span><em>${ZONES[ne.zone].id}</em>`);
    project(LBL.eta.pos, LBL.eta.el, w, h);
  } else setDisp(LBL.eta.el, false);
  if (showLm) project(LBL.pz.pos, LBL.pz.el, w, h); else setDisp(LBL.pz.el, false);
  declutter();
}
/* screen-space declutter: higher-priority labels keep their place, others move up or hide */
function declutter() {
  const now = performance.now(), remeasure = !LBL.mt || now - LBL.mt > 1000;
  if (remeasure) {
    LBL.mt = now;
    // interface panels that sit over the scene: labels under them are hidden
    LBL.ui = [];
    document.querySelectorAll('.topbar .glass, .topbar .avatar, .modes, .mode-q, #horizonBar, #leftcol, #right, #lab, #dock, #overlayBar, #planner, #replayBar, #sheetTabs').forEach(el => {
      if (!el.offsetParent || getComputedStyle(el).visibility === 'hidden') return;
      const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) LBL.ui.push([r.left, r.top, r.right, r.bottom]);
    });
  }
  const ui = LBL.ui || [];
  const list = [];
  const add = (el, pri, mode) => { if (el._d === 'none') return; if (remeasure || !el._W) { el._W = el.offsetWidth; el._H = el.offsetHeight; } list.push({ el, pri, mode }); };
  add(LBL.sel.el, 0, 'fix'); add(LBL.eta.el, 1, 'up'); add(LBL.pz.el, 1, 'up');
  for (const it of LBL.alerts.values()) add(it.el, 2, 'up');
  for (const it of LBL.items) add(it.el, it.kind === 'lm' ? 3 : 4, it.kind === 'lm' ? 'up' : 'hide');
  list.sort((a, b) => a.pri - b.pri);
  const placed = [];
  for (const L0 of list) {
    const el = L0.el, w = el._W + 4, h = el._H + 3;
    const vw = W3.canvas.clientWidth;
    let x = clamp(el._sx, w / 2 + 4, Math.max(w / 2 + 4, vw - w / 2 - 4)), y = Math.max(el._sy, h + 4), ok = true;
    if (L0.mode !== 'fix') for (const r of ui) if (x - w / 2 < r[2] && x + w / 2 > r[0] && y - h < r[3] && y > r[1]) { ok = false; break; }
    if (!ok) { if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'; continue; }
    for (let it = 0; it < 6; it++) {
      let hit = null;
      for (const r of placed) if (x - w / 2 < r[2] && x + w / 2 > r[0] && y - h < r[3] && y > r[1]) { hit = r; break; }
      if (!hit) break;
      if (L0.mode === 'hide' || L0.mode === 'fix') { ok = L0.mode === 'fix'; break; }
      y = hit[1] - 1;
    }
    if (!ok) { if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'; continue; }
    if (el.style.visibility === 'hidden') el.style.visibility = '';
    placed.push([x - w / 2, y - h, x + w / 2, y]);
    if (el._x !== x || el._y !== y) { el._x = x; el._y = y; el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; }
  }
}

/* ---------------- camera glides ---------------- */
function glideTo(pos, tgt, dur) {
  const c = W3.camera, ctl = W3.controls;
  V3.glide = { p0: c.position.clone(), t0: ctl.target.clone(), p1: new THREE.Vector3(...pos), t1: new THREE.Vector3(...tgt), u: 0, dur: dur || 1.4 };
}
function goArea(id) {
  const A = AREAS[id]; if (!A) return;
  S.area = id; glideTo(A.pos, A.tgt, 1.6);
  const sel = document.getElementById('areaSel'); if (sel && sel.value !== id) sel.value = id;
}
function focusAnchor(a, close) {
  if (!a) return;
  const ctl = W3.controls, c = W3.camera;
  const dir = c.position.clone().sub(ctl.target).normalize();
  if (dir.y < 0.35) { dir.y = 0.5; dir.normalize(); }
  const d = clamp(a.r * (close ? 4.2 : 6.5) + 14, 22, 160);
  const tgt = [a.x, a.y, a.z], pos = [a.x + dir.x * d, a.y + dir.y * d, a.z + dir.z * d];
  glideTo(pos, tgt, 1.2);
}
function updateGlide(dt) {
  const g = V3.glide; if (!g) return;
  g.u = Math.min(1, g.u + dt / g.dur);
  const e = g.u < 0.5 ? 4 * g.u ** 3 : 1 - Math.pow(-2 * g.u + 2, 3) / 2;
  W3.camera.position.lerpVectors(g.p0, g.p1, e); W3.controls.target.lerpVectors(g.t0, g.t1, e);
  if (g.u >= 1) V3.glide = null;
}
function followAgent() {
  if (!S.follow) return;
  const a = AG.list.find(a => a.id === S.follow);
  if (!a) { S.follow = null; UI && UI.toast('The followed agent left the pilot zone; follow ended.'); return; }
  const ctl = W3.controls, off = W3.camera.position.clone().sub(ctl.target);
  ctl.target.lerp(_v.set(a.x, 0, a.z), 0.12); W3.camera.position.copy(ctl.target).add(off);
}

/* ---------------- picking ---------------- */
const RAY = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function pickAt(cx, cy) {
  const r = W3.canvas.getBoundingClientRect();
  _ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  RAY.setFromCamera(_ndc, W3.camera);
  const hits = RAY.intersectObjects(PICK.filter(o => o.visible !== false && visibleChain(o)), false);
  for (const h of hits) {
    const p = h.object.userData.pick; if (!p) continue;
    if (p.type === 'agent') { const a = AG.list[h.instanceId]; if (a && S.mode !== 'replay') return { type: 'agent', id: a.id }; continue; }
    if (p.type === 'cell') { if (!S.overlay.density) continue; return { type: 'cell', idx: h.instanceId }; }
    if (p.type === 'floor') { const x = h.point.x; if (x >= L.x0 && x <= -L.x0) return { type: 'zone', idx: zoneIdxAt(x) }; continue; }
    if (p.type === 'section') { const sec = sectionOf(p.tier, h.point.x, h.point.z); return { type: 'section', sec, tier: p.tier, x: h.point.x, y: h.point.y, z: h.point.z }; }
    return Object.assign({}, p);
  }
  // other concourses (low detail band)
  const hit2 = RAY.intersectObject(W3.ring.mesh, false)[0];
  if (hit2 && W3.ring.mesh.visible) { const z = W3.ring.zones.filter(Boolean)[hit2.instanceId]; if (z) return { type: 'outer', id: z.id }; }
  return null;
}
function visibleChain(o) { while (o) { if (o.visible === false) return false; o = o.parent; } return true; }

/* ---------------- per-frame entry point ---------------- */
function updateView(dt, dtSim) {
  const t = performance.now() / 1000;
  updateGlide(dt); followAgent();
  updateHeat(dt); updateArrows(dt); drawAgents(); updateAssets(dtSim); updateSensors(dt); updateStands(false);
  updateWeather(dt); updateSelection(t); updateIncident(t); updatePulse(t);
  W3.pilotRibbon.children.forEach(m => m.material.opacity = 0.16 + 0.08 * Math.sin(t * 2));
  W3.svcHatch.material.opacity = (S.role === 'responder' && S.mode === 'navigate') || (S.mode === 'simulate' && S.scenario && S.scenario.def.id === 'medical') ? 0.75 : 0;
  W3.controls.update();
  W3.renderer.render(W3.scene, W3.camera);
  updateLabels();
}
