'use strict';
/* =====================================================================
   STADIUM-DT scene: a stylised, procedurally generated model of Beaver Stadium.
   Built entirely in code. Not derived from BIM, survey or as-built data.
   Units are metres; x runs north-south along the field, z east-west (west = negative).
   ===================================================================== */
const W3 = {};                         // handles to scene objects
const PICK = [];                       // meshes that can be clicked
const NSE = 3;                         // superellipse exponent of the bowl
function se(a, b, t, out) {
  const c = Math.cos(t), s = Math.sin(t);
  const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / NSE), z = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / NSE);
  if (out) { out.x = x; out.z = z; return out; }
  return [x, z];
}
function seParam(x, z, a, b) { const u = Math.sign(x) * Math.pow(Math.abs(x / a), NSE / 2), v = Math.sign(z) * Math.pow(Math.abs(z / b), NSE / 2); let t = Math.atan2(v, u); if (t < 0) t += Math.PI * 2; return t; }

const MATS = new Map();
function mat(hex, o) {
  const key = hex + JSON.stringify(o || {});
  if (MATS.has(key)) return MATS.get(key);
  const m = new THREE.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.86, metalness: 0.04 }, o || {}));
  MATS.set(key, m); return m;
}
function basic(hex, o) { return new THREE.MeshBasicMaterial(Object.assign({ color: hex }, o || {})); }
function addBox(g, w, h, d, m, x, y, z, o) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  if (o && o.ry) mesh.rotation.y = o.ry;
  mesh.castShadow = !!(o && o.cast); mesh.receiveShadow = !(o && o.noRecv);
  g.add(mesh); return mesh;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  t.userData = { canvas: c, ctx: x };
  return t;
}
function glowTex() {
  return canvasTex(128, 128, (x, w) => {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,240,215,1)'); g.addColorStop(0.18, 'rgba(255,214,150,0.55)'); g.addColorStop(0.5, 'rgba(255,181,71,0.12)'); g.addColorStop(1, 'rgba(255,181,71,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
}
/* merge simple geometries (non-indexed) into one, keeping a per-part colour */
function mergeColored(parts) {
  let n = 0; const geos = parts.map(([g, col]) => { const ng = g.index ? g.toNonIndexed() : g; n += ng.attributes.position.count; return [ng, col]; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), colr = new Float32Array(n * 3);
  let o = 0; const c = new THREE.Color();
  for (const [g, col] of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    c.set(col); for (let i = 0; i < g.attributes.position.count; i++) { colr[(o + i) * 3] = c.r; colr[(o + i) * 3 + 1] = c.g; colr[(o + i) * 3 + 2] = c.b; }
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  return out;
}

/* palette of the 3D world (night); day mode scales lights */
const PAL = {
  ground: 0x1B1624, lot: 0x221B2C, plaza: 0x2D2438, plazaLine: 0x3A3047, conc: 0x3A2F48, concLine: 0x4A3D5A,
  struct: 0x433852, structDark: 0x2A2236, steel: 0x352C42, seatA: 0x4E4060, seatB: 0x584970, aisle: 0x7A6A8E,
  glass: 0x9678C8, field: 0x3FA14C, field2: 0x37904A, endzone: 0x2D3274, tree: 0x2F3A34, tree2: 0x3A4A3C
};

function initScene() {
  if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;   // hex colours are sRGB, as authored
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.deep);
  scene.fog = new THREE.FogExp2(COL.deep, 0.0017);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 2600);
  camera.position.set(-170, 210, -360);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 0, -40);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.minDistance = 14; controls.maxDistance = 760; controls.maxPolarAngle = 1.36;
  controls.zoomSpeed = 0.9; controls.panSpeed = 0.9; controls.rotateSpeed = 0.55;
  Object.assign(W3, { renderer, scene, camera, controls, canvas });

  /* lights */
  const hemi = new THREE.HemisphereLight(0x9A86C0, 0x241A30, 0.85); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xFFE6C4, 0.85);
  key.position.set(-120, 220, -230); key.target.position.set(0, 0, -100);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera; sc.left = -110; sc.right = 110; sc.top = 90; sc.bottom = -90; sc.near = 60; sc.far = 520;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.6;
  scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0x9678C8, 0.28); fill.position.set(160, 120, 140); scene.add(fill);
  const conc1 = new THREE.PointLight(0xFFC46E, 0.9, 70, 1.6); conc1.position.set(-28, 7, -95); scene.add(conc1);
  const conc2 = new THREE.PointLight(0xFFC46E, 0.9, 70, 1.6); conc2.position.set(26, 7, -95); scene.add(conc2);
  Object.assign(W3, { hemi, key, fill, concLights: [conc1, conc2] });

  W3.world = new THREE.Group(); scene.add(W3.world);
  buildGround(); buildField(); buildBowl(); buildLights(); buildScoreboards(); buildPilot(); buildPlaza(); buildSensors(); buildOtherGates();
  buildSeatedCrowd(); buildHeat(); buildArrows(); buildAgentMeshes(); buildParticles(); buildMarkers(); buildWeather();
  onResize();
}

/* ---------------- ground, lots, trees ---------------- */
function buildGround() {
  const g = W3.world;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), mat(PAL.ground, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; g.add(ground);
  // parking and tailgate lots with instanced cars (illustrative)
  const lots = [[-250, -230, 150, 110], [-40, -250, 120, 70], [180, -230, 150, 110], [-300, 40, 120, 200], [300, 60, 120, 200], [0, 230, 300, 110]];
  const carG = new THREE.BoxGeometry(4.4, 1.5, 1.9);
  const cars = new THREE.InstancedMesh(carG, mat(0xffffff, { roughness: 0.55, metalness: 0.2 }), 1400);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const carCols = [0x6E6480, 0x8E86A0, 0x4A4458, 0xB8B0C6, 0x5C4F78, 0x7D6A55, 0x3B3546];
  let n = 0;
  const rr = mulberry32(7);
  for (const [cx, cz, w, d] of lots) {
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(PAL.lot, { roughness: 1 }));
    lot.rotation.x = -Math.PI / 2; lot.position.set(cx, 0.01, cz); lot.receiveShadow = true; g.add(lot);
    for (let x = cx - w / 2 + 4; x < cx + w / 2 - 4; x += 3) for (let z = cz - d / 2 + 5; z < cz + d / 2 - 5; z += 7) {
      if (rr() < 0.32 || n >= 1400) continue;
      q.setFromEuler(new THREE.Euler(0, Math.PI / 2 + (rr() - 0.5) * 0.12, 0));
      m4.compose(new THREE.Vector3(x, 0.75, z), q, new THREE.Vector3(1, 1, 1));
      cars.setMatrixAt(n, m4); cars.setColorAt(n, col.setHex(carCols[Math.floor(rr() * carCols.length)])); n++;
    }
  }
  cars.count = n; cars.receiveShadow = true; g.add(cars);
  // trees around the plaza and campus edge
  const tg = mergeColored([[new THREE.ConeGeometry(3.2, 8, 7).translate(0, 7.5, 0), PAL.tree2], [new THREE.ConeGeometry(2.4, 6, 7).translate(0, 11, 0), PAL.tree], [new THREE.CylinderGeometry(0.4, 0.5, 4, 6).translate(0, 2, 0), 0x3A2E2A]]);
  const trees = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 220);
  let t = 0;
  const place = (x, z, s) => { m4.compose(new THREE.Vector3(x, 0, z), q.setFromEuler(new THREE.Euler(0, rr() * 6, 0)), new THREE.Vector3(s, s, s)); trees.setMatrixAt(t++, m4); };
  for (let i = 0; i < 26; i++) place(-130 + i * 10.4 + (rr() - 0.5) * 3, -182 + (rr() - 0.5) * 4, 0.8 + rr() * 0.4);
  for (let i = 0; i < 12; i++) { place(-128 + (rr() - 0.5) * 4, -112 - i * 6, 0.8 + rr() * 0.3); place(128 + (rr() - 0.5) * 4, -112 - i * 6, 0.8 + rr() * 0.3); }
  for (let i = 0; i < 140 && t < 220; i++) { const a = rr() * Math.PI * 2, r = 175 + rr() * 140; const x = Math.cos(a) * r * 1.2, z = Math.sin(a) * r; if (z < -100 && Math.abs(x) < 140) continue; if (lots.some(([cx, cz, w, d]) => Math.abs(x - cx) < w / 2 + 4 && Math.abs(z - cz) < d / 2 + 4)) continue; place(x, z, 0.7 + rr() * 0.6); }
  trees.count = t; trees.castShadow = true; g.add(trees);
}

/* ---------------- field ---------------- */
function buildField() {
  const g = W3.world;
  // sideline apron inside the bowl
  const shp = new THREE.Shape();
  for (let i = 0; i <= 160; i++) { const [x, z] = se(64, 38, i / 160 * Math.PI * 2); if (i === 0) shp.moveTo(x, -z); else shp.lineTo(x, -z); }
  const apron = new THREE.Mesh(new THREE.ShapeGeometry(shp), mat(0x2F6B3A, { roughness: 0.95 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = 0.02; apron.receiveShadow = true; g.add(apron);
  const tex = canvasTex(2048, 1024, (x, w, h) => {
    const px = w / 120;                          // field texture spans 120 m x 60 m
    x.fillStyle = HEX.text; x.fillRect(0, 0, w, h);
    x.fillStyle = '#3B9748'; x.fillRect(0, 0, w, h);
    const fx0 = (60 - 54.86) * px, fx1 = (60 + 54.86) * px, fz0 = (30 - 24.38) * px, fz1 = (30 + 24.38) * px;
    for (let i = 0; i < 20; i++) { x.fillStyle = i % 2 ? '#43A752' : '#3A9A4A'; x.fillRect(fx0 + (9.14 + i * 4.572) * px, fz0, 4.572 * px, fz1 - fz0); }
    x.fillStyle = '#2B3178'; x.fillRect(fx0, fz0, 9.14 * px, fz1 - fz0); x.fillRect(fx1 - 9.14 * px, fz0, 9.14 * px, fz1 - fz0);
    x.strokeStyle = 'rgba(248,241,231,0.10)'; x.lineWidth = 10;
    for (let k = -8; k < 14; k++) { const ex0 = fx0, ex1 = fx1 - 9.14 * px; for (const ex of [ex0, ex1]) { x.save(); x.beginPath(); x.rect(ex, fz0, 9.14 * px, fz1 - fz0); x.clip(); x.beginPath(); x.moveTo(ex + k * 45, fz0); x.lineTo(ex + k * 45 + 180, fz1); x.stroke(); x.restore(); } }
    x.strokeStyle = '#F8F1E7'; x.lineWidth = 4; x.strokeRect(fx0, fz0, fx1 - fx0, fz1 - fz0);
    for (let yd = 0; yd <= 100; yd += 5) {
      const xx = fx0 + (9.14 + yd * 0.9144) * px;
      x.lineWidth = yd % 10 === 0 ? 4 : 3; x.beginPath(); x.moveTo(xx, fz0); x.lineTo(xx, fz1); x.stroke();
      if (yd % 10 === 0 && yd > 0 && yd < 100) {
        const num = String(yd <= 50 ? yd : 100 - yd);
        x.save(); x.fillStyle = '#F8F1E7'; x.font = `600 ${Math.round(1.8 * px)}px "Big Shoulders Display", "Figtree", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.translate(xx, fz1 - 8.2 * px); x.fillText(num, 0, 0); x.restore();
        x.save(); x.fillStyle = '#F8F1E7'; x.font = `600 ${Math.round(1.8 * px)}px "Big Shoulders Display", "Figtree", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.translate(xx, fz0 + 8.2 * px); x.rotate(Math.PI); x.fillText(num, 0, 0); x.restore();
      }
    }
    x.lineWidth = 2;
    for (let yd = 1; yd < 100; yd++) { const xx = fx0 + (9.14 + yd * 0.9144) * px; for (const hz of [fz0 + 0.3 * px, fz1 - 0.9 * px, h / 2 - 3.1 * px, h / 2 + 2.5 * px]) { x.beginPath(); x.moveTo(xx, hz); x.lineTo(xx, hz + 0.6 * px); x.stroke(); } }
    x.strokeStyle = 'rgba(255,181,71,0.55)'; x.lineWidth = 5; x.beginPath(); x.arc(w / 2, h / 2, 4.5 * px, 0, Math.PI * 2); x.stroke();
  });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, emissive: 0x153D1C, emissiveIntensity: 0.55 }));
  field.rotation.x = -Math.PI / 2; field.position.y = 0.05; field.receiveShadow = true; g.add(field);
  W3.field = field;
  // goal posts
  const gp = mat(0xFFD27A, { emissive: 0x4A3A10, emissiveIntensity: 0.5 });
  for (const s of [-1, 1]) {
    const x = s * 55.2;
    addBox(g, 0.3, 3.05, 0.3, gp, x, 1.52, 0);
    addBox(g, 0.25, 0.25, 5.64, gp, x, 3.05, 0);
    addBox(g, 0.2, 6, 0.2, gp, x, 6, -2.82); addBox(g, 0.2, 6, 0.2, gp, x, 6, 2.82);
  }
}

/* ---------------- bowl: two tiers of seating, cross-aisle, suites, rim and facade ---------------- */
const TIERS = [
  { id: 'lower', a0: 64, b0: 38, a1: 90, b1: 64, y0: 1.6, y1: 14.2, rows: 24, num: 100 },
  { id: 'upper', a0: 94, b0: 68, a1: 114, b1: 88, y0: 17.2, y1: 35.4, rows: 26, num: 200 }
];
const NSEG = 240, NSECT = 36;
function sectionOf(tier, x, z) {
  const T = TIERS[tier === 'upper' ? 1 : 0];
  if (z < 0 && Math.abs(x) < 66) {
    const ranges = [[-66, -44], [-44, -22], [-22, -11], [-11, 0], [0, 11], [11, 22], [22, 33], [33, 44], [44, 66]];
    for (let i = 0; i < ranges.length; i++) if (x >= ranges[i][0] && x < ranges[i][1]) return T.num + 1 + i;
  }
  const t = seParam(x, z, (T.a0 + T.a1) / 2, (T.b0 + T.b1) / 2);
  return T.num + 10 + Math.floor(((t + Math.PI * 0.5) % (Math.PI * 2)) / (Math.PI * 2) * 30);
}
function buildBowl() {
  const g = W3.world;
  const tmp = { x: 0, z: 0 }, tmp2 = { x: 0, z: 0 };
  W3.tiers = [];
  for (const T of TIERS) {
    const pos = [], col = [], c = new THREE.Color();
    const push = (x, y, z, cc) => { pos.push(x, y, z); col.push(cc.r, cc.g, cc.b); };
    for (let r = 0; r < T.rows; r++) {
      const f0 = r / T.rows, f1 = (r + 1) / T.rows;
      const a0 = lerp(T.a0, T.a1, f0), b0 = lerp(T.b0, T.b1, f0), a1 = lerp(T.a0, T.a1, f1), b1 = lerp(T.b0, T.b1, f1);
      const y0 = lerp(T.y0, T.y1, f0), y1 = lerp(T.y0, T.y1, f1);
      for (let sgi = 0; sgi < NSEG; sgi++) {
        const t0 = sgi / NSEG * Math.PI * 2, t1 = (sgi + 1) / NSEG * Math.PI * 2;
        const sect = Math.floor(sgi / (NSEG / NSECT)), aisle = sgi % (NSEG / NSECT) === 0;
        c.setHex(aisle ? PAL.aisle : (sect % 2 ? PAL.seatA : PAL.seatB)).multiplyScalar(0.82 + 0.25 * f0);
        const p00 = se(a0, b0, t0), p01 = se(a0, b0, t1), p10 = se(a1, b1, t0), p11 = se(a1, b1, t1);
        // tread at y0 from ring r to ring r+1
        push(p00[0], y0, p00[1], c); push(p10[0], y0, p10[1], c); push(p01[0], y0, p01[1], c);
        push(p01[0], y0, p01[1], c); push(p10[0], y0, p10[1], c); push(p11[0], y0, p11[1], c);
        // riser at ring r+1 from y0 to y1
        const cr = c.clone().multiplyScalar(0.62);
        push(p10[0], y0, p10[1], cr); push(p10[0], y1, p10[1], cr); push(p11[0], y0, p11[1], cr);
        push(p11[0], y0, p11[1], cr); push(p10[0], y1, p10[1], cr); push(p11[0], y1, p11[1], cr);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    mesh.userData.pick = { type: 'section', tier: T.id };
    g.add(mesh); PICK.push(mesh); W3.tiers.push(mesh);
  }
  // field wall, cross-aisle walkway, rim parapet, outer walls
  const ringStrip = (a0, b0, a1, b1, y0, y1, color, opts) => {
    const pos = [];
    for (let i = 0; i < NSEG; i++) {
      const t0 = i / NSEG * Math.PI * 2, t1 = (i + 1) / NSEG * Math.PI * 2;
      if (opts && opts.skip && opts.skip(t0, t1)) continue;
      const p00 = se(a0, b0, t0), p01 = se(a0, b0, t1), p10 = se(a1, b1, t0), p11 = se(a1, b1, t1);
      pos.push(p00[0], y0, p00[1], p10[0], y1, p10[1], p01[0], y0, p01[1], p01[0], y0, p01[1], p10[0], y1, p10[1], p11[0], y1, p11[1]);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, opts && opts.material ? opts.material : mat(color, { side: THREE.DoubleSide }));
    m.receiveShadow = true; g.add(m); return m;
  };
  const wall = (a, b, y0, y1, color, opts) => ringStrip(a, b, a, b, y0, y1, color, opts);
  wall(63.2, 37.2, 0, 1.6, 0x2A2236);
  ringStrip(90, 64, 94, 68, 14.2, 14.2, 0x3E3350);
  wall(94, 68, 14.2, 17.2, 0x322841);
  ringStrip(114, 88, 115.6, 89.6, 35.4, 35.4, 0x4A3D5A);
  wall(115.6, 89.6, 35.4, 37.2, 0x5A4A6C);
  const pilotSeg = (t0, t1) => { const [x0, z0] = se(115.6, 89.6, t0), [x1, z1] = se(115.6, 89.6, t1); return z0 < 0 && z1 < 0 && Math.abs(x0) < 62 && Math.abs(x1) < 62; };
  W3.facadeLow = wall(115.6, 89.6, 0, 9, PAL.structDark, { skip: pilotSeg });
  W3.facadeHigh = wall(115.6, 89.6, 9, 35.4, PAL.struct);
  // amber light band along the rim and at concourse level
  const bandM = basic(COL.amber, { transparent: true, opacity: 0.85 });
  W3.rimBand = wall(115.75, 89.75, 33.4, 33.9, 0, { material: bandM });
  W3.midBand = wall(115.75, 89.75, 9.1, 9.45, 0, { material: basic(0xFFC46E, { transparent: true, opacity: 0.6 }), skip: pilotSeg });
  // facade ribs (instanced)
  const rib = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 26.4, 1.4), mat(PAL.steel), 120);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 120; i++) {
    const t = i / 120 * Math.PI * 2, [x, z] = se(116.2, 90.2, t), [x2, z2] = se(116.2, 90.2, t + 0.01);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(z2 - z, x2 - x));
    m4.compose(new THREE.Vector3(x, 22.2, z), q, new THREE.Vector3(1, 1, 1)); rib.setMatrixAt(i, m4);
  }
  rib.castShadow = true; g.add(rib);
  // west suites and press box between the tiers (glass band)
  const suites = new THREE.Group();
  const glassM = mat(0x2B2140, { emissive: 0xFFB15A, emissiveIntensity: 0.32, roughness: 0.3, metalness: 0.3 });
  addBox(suites, 96, 5.2, 3.2, glassM, 0, 19.8, -69.6);
  addBox(suites, 98, 0.6, 4.4, mat(PAL.struct), 0, 22.6, -69.8);
  addBox(suites, 98, 0.6, 4.4, mat(PAL.struct), 0, 17.0, -69.8);
  for (let x = -45; x <= 45; x += 6) addBox(suites, 0.25, 5.2, 0.2, mat(0x1E1828), x, 19.8, -68.0);
  g.add(suites);
  // pilot inner block closing the gap between the straight west wall and the curved facade
  const shp = new THREE.Shape();
  shp.moveTo(-62, 91); for (let i = 0; i <= 60; i++) { const x = -62 + i * 124 / 60; const t = seParam(x, -89, 115.6, 89.6); const [px, pz] = se(115.6, 89.6, t); shp.lineTo(x, -pz); } shp.lineTo(62, 91); shp.lineTo(-62, 91);
  const blk = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: 9, bevelEnabled: false }), mat(PAL.structDark));
  blk.rotation.x = -Math.PI / 2; blk.position.y = 0; g.add(blk);
}

/* ---------------- floodlight masts ---------------- */
function buildLights() {
  const g = W3.world; W3.flood = []; W3.glows = [];
  const gt = glowTex();
  const mastM = mat(0x2F2740, { metalness: 0.3, roughness: 0.6 });
  const headM = new THREE.MeshStandardMaterial({ color: 0xFFF3DF, emissive: 0xFFE6B8, emissiveIntensity: 1.6 });
  for (const t of [Math.PI * 0.2, Math.PI * 0.8, Math.PI * 1.2, Math.PI * 1.8]) {
    const [x, z] = se(119, 93, t);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 64, 8), mastM); mast.position.set(x, 32, z); mast.castShadow = true; g.add(mast);
    const head = new THREE.Group(); head.position.set(x, 66, z); head.lookAt(0, 0, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 1.2), mastM); head.add(frame);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.2, 0.4), headM, 24);
    const m4 = new THREE.Matrix4(); let k = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { m4.makeTranslation(-4.4 + i * 1.76, -2.4 + j * 1.6, 0.7); lamps.setMatrixAt(k++, m4); }
    head.add(lamps); g.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: 0xFFE4B8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
    glow.position.set(x * 0.985, 66, z * 0.985); glow.scale.set(46, 46, 1); g.add(glow); W3.glows.push(glow);
    const sp = new THREE.SpotLight(0xFFE7C2, 1.25, 420, 0.62, 0.55, 1.1);
    sp.position.set(x, 66, z); sp.target.position.set(x * 0.05, 0, z * 0.05); g.add(sp); g.add(sp.target); W3.flood.push(sp);
  }
}

/* ---------------- scoreboards (simulated clock only) ---------------- */
function buildScoreboards() {
  const g = W3.world; W3.boards = [];
  const make = (x, w, h, y, face) => {
    const tex = canvasTex(1024, Math.round(1024 * h / w), () => {});
    const grp = new THREE.Group(); grp.position.set(x, y, 0); grp.rotation.y = face;
    addBox(grp, w + 1.4, h + 1.4, 1.4, mat(0x231B2E), 0, 0, -0.8);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.z = 0.01; grp.add(scr);
    addBox(grp, 1.2, y, 1.2, mat(PAL.steel), -w / 3, -y / 2, -1.2); addBox(grp, 1.2, y, 1.2, mat(PAL.steel), w / 3, -y / 2, -1.2);
    g.add(grp); W3.boards.push({ tex, w, h });
  };
  make(-121, 46, 16, 44, Math.PI / 2);
  make(120, 26, 9, 42, -Math.PI / 2);
}
function drawBoards(clock, phaseId) {
  const gc = gameClock(clock);
  for (const b of W3.boards) {
    const c = b.tex.userData.ctx, w = c.canvas.width, h = c.canvas.height;
    c.fillStyle = '#120D1C'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#FFB547'; c.fillRect(0, h - 10, w, 10);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#F8F1E7'; c.font = `700 ${Math.round(h * 0.34)}px "Big Shoulders Display", "Figtree", sans-serif`;
    c.fillText(`${gc.q}  ${gc.t}`, w / 2, h * 0.36);
    c.fillStyle = '#A99DB4'; c.font = `600 ${Math.round(h * 0.12)}px "JetBrains Mono", monospace`;
    c.fillText(`${phaseLabel(phaseId)} · SIMULATED CLOCK`, w / 2, h * 0.7);
    c.fillStyle = '#FFB547'; c.font = `600 ${Math.round(h * 0.085)}px "JetBrains Mono", monospace`;
    c.fillText('STADIUM-DT CONCEPT DEMO · SYNTHETIC DATA', w / 2, h * 0.86);
    b.tex.needsUpdate = true;
  }
}

/* ---------------- the pilot concourse (west side), detailed ---------------- */
const SIGN_TEX = new Map();
function signTex(text, o) {
  o = o || {};
  const key = text + JSON.stringify(o);
  if (SIGN_TEX.has(key)) return SIGN_TEX.get(key);
  const w = o.w || 512, h = o.h || 128;
  const t = canvasTex(w, h, (x) => {
    x.fillStyle = o.bg || '#1C1428'; x.fillRect(0, 0, w, h);
    if (o.bar) { x.fillStyle = o.bar; x.fillRect(0, 0, 12, h); }
    x.fillStyle = o.fg || '#F8F1E7'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `${o.weight || 700} ${o.size || Math.round(h * 0.52)}px ${o.font || '"Big Shoulders Display", "Figtree", sans-serif'}`;
    x.fillText(text, w / 2 + (o.bar ? 6 : 0), h / 2 + 2);
  });
  SIGN_TEX.set(key, t); return t;
}
function signPlane(text, w, h, o) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: signTex(text, o), toneMapped: false, transparent: !!(o && o.transparent) }));
  return m;
}
function pickable(obj, pick) { obj.traverse(o => { if (o.isMesh) { o.userData.pick = pick; PICK.push(o); } }); obj.userData.pick = pick; return obj; }
function buildPilot() {
  const g = new THREE.Group(); W3.pilot = g; W3.world.add(g);
  W3.lm = {};
  const floorM = mat(PAL.conc, { roughness: 0.8 });
  // concourse floor and its curb
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(132, 7), floorM); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.03, -94.5); floor.receiveShadow = true; g.add(floor);
  W3.concFloor = floor; floor.userData.pick = { type: 'floor' }; PICK.push(floor);
  for (let x = -55; x <= 55; x += 11) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 7), basic(COL.amber, { transparent: true, opacity: 0.35 })); l.rotation.x = -Math.PI / 2; l.position.set(x, 0.06, -94.5); g.add(l); }
  // inner wall (bowl side) with openings
  const openings = [[-50, -42], [-40.2, -36.8], [-29.6, -25.4], [-8, -3], [10.4, 15.6], [21.4, 26.6], [36.4, 40.6]];
  const wallM = mat(0x3B3049);
  let x0 = -62;
  for (const [a, b] of [...openings, [62, 62]]) { if (a > x0) addBox(g, a - x0, 6, 0.8, wallM, (a + x0) / 2, 3, -90.6, { cast: true }); x0 = b; }
  for (const [a, b] of openings) addBox(g, b - a, 2.2, 0.8, wallM, (a + b) / 2, 4.9, -90.6);
  // portals into the lower bowl
  const portal = (key, x, w, label) => {
    const grp = new THREE.Group();
    addBox(grp, w, 0.2, 8, mat(0x2C2338), x, 1.2, -86.8);
    const tun = addBox(grp, w + 0.6, 0.3, 8.4, mat(0x241C2E), x, 3.9, -86.8);
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.35), basic(COL.amber)); lip.position.set(x, 3.5, -91.05); lip.rotation.y = Math.PI; grp.add(lip);
    const s = signPlane(label, 4.2, 0.9, { bg: '#1C1428', fg: '#FFB547', size: 70 }); s.position.set(x, 5.4, -91.05); s.rotation.y = Math.PI; grp.add(s);
    g.add(grp); return pickable(grp, { type: 'asset', id: key });
  };
  W3.lm.POR_102 = portal('POR_102', -27.5, 3.2, 'SEC 101–103');
  W3.lm.POR_104 = portal('POR_104', -5.5, 4.4, 'SEC 104 · 105');
  W3.lm.POR_108 = portal('POR_108', 38.5, 3.2, 'SEC 106–109');
  // main stair cluster: two flights rising into the stand structure
  const stairs = new THREE.Group();
  for (const [key, x] of [['STAIR_1', 13], ['STAIR_2', 24]]) {
    const sg = new THREE.Group();
    for (let s = 0; s < 22; s++) addBox(sg, 4.6, 0.4, 0.46, mat(s % 2 ? 0x564868 : 0x4E4160), x, 0.2 + s * 0.4, -91.2 + s * 0.46);
    addBox(sg, 0.2, 1.1, 10.4, mat(0xFFB547, { emissive: 0x6A4710, emissiveIntensity: 0.6 }), x - 2.4, 5, -86.2).rotation.x = -0.72;
    addBox(sg, 0.2, 1.1, 10.4, mat(0xFFB547, { emissive: 0x6A4710, emissiveIntensity: 0.6 }), x + 2.4, 5, -86.2).rotation.x = -0.72;
    addBox(sg, 5.4, 9.5, 0.4, mat(0x2A2236), x, 4.75, -80.6);
    const s = signPlane(key === 'STAIR_1' ? 'STAIR 1' : 'STAIR 2', 3.6, 0.9, { bg: '#1C1428', fg: '#F8F1E7', size: 72, bar: '#FFB547' }); s.position.set(x, 6.4, -91.05); s.rotation.y = Math.PI; sg.add(s);
    const bar = new THREE.Group();          // closure barrier, shown when the stair is closed in the simulation
    addBox(bar, 4.8, 0.25, 0.25, mat(COL.crit, { emissive: COL.crit, emissiveIntensity: 0.6 }), x, 1.1, -91.6); addBox(bar, 4.8, 0.25, 0.25, mat(COL.crit, { emissive: COL.crit, emissiveIntensity: 0.6 }), x, 0.6, -91.6);
    bar.visible = false; sg.add(bar); sg.userData.barrier = bar;
    stairs.add(sg); W3.lm[key] = pickable(sg, { type: 'asset', id: key });
  }
  g.add(stairs);
  // elevator tower and accessible ramp
  const eg = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(3.2, 20, 2.8), new THREE.MeshStandardMaterial({ color: 0x9678C8, transparent: true, opacity: 0.22, roughness: 0.2, metalness: 0.2, depthWrite: false }));
  shaft.position.set(-38.5, 10, -89.2); eg.add(shaft);
  for (const sx of [-1.6, 1.6]) for (const sz of [-1.4, 1.4]) addBox(eg, 0.16, 20, 0.16, mat(0x6A5A80), -38.5 + sx, 10, -89.2 + sz);
  const car = addBox(eg, 2.6, 2.6, 2.2, mat(0xF8F1E7, { emissive: 0xFFB547, emissiveIntensity: 0.35 }), -38.5, 1.4, -89.2); W3.elevCar = car;
  const es = signPlane('ELEVATOR A', 3.4, 0.8, { bg: '#1C1428', fg: '#91B49A', size: 64 }); es.position.set(-38.5, 4.4, -90.62); es.rotation.y = Math.PI; eg.add(es);
  W3.lm.ELEV_A = pickable(eg, { type: 'asset', id: 'ELEV_A' }); g.add(eg);
  const rg = new THREE.Group();
  const rampM = mat(0x5A4B6E);
  const seg = (xa, za, ya, xb, zb, yb) => { const len = Math.hypot(xb - xa, zb - za); const m = addBox(rg, len, 0.3, 2.0, rampM, (xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2); m.rotation.y = -Math.atan2(zb - za, xb - xa); m.rotation.z = Math.atan2(yb - ya, len) * Math.sign(xb - xa); return m; };
  seg(-49.5, -88.5, 0.2, -42.5, -88.5, 2.2); seg(-42.5, -86.2, 2.2, -49.5, -86.2, 4.4); seg(-49.5, -83.9, 4.4, -42.5, -83.9, 6.6); seg(-42.5, -81.6, 6.6, -49.5, -81.6, 8.8);
  const rs = signPlane('ACCESSIBLE RAMP', 4.6, 0.8, { bg: '#1C1428', fg: '#91B49A', size: 60 }); rs.position.set(-46, 4.4, -91.05); rs.rotation.y = Math.PI; rg.add(rs);
  W3.lm.RAMP = pickable(rg, { type: 'asset', id: 'RAMP' }); g.add(rg);
  // amenity band: buildings on the plaza side
  const bands = [
    ['REST_A', -55, -44, 'RESTROOM A', '#9678C8'], ['CONC_A', -21, -9, 'CONCESSION A', '#FFB547'], ['CONC_B', 4, 15, 'CONCESSION B', '#FFB547'],
    ['KIOSK', 16, 22, 'GUEST SERVICES', '#A99DB4'], ['REST_B', 34, 44, 'RESTROOM B', '#9678C8'], ['MED', 46, 55, 'FIRST AID', '#91B49A']
  ];
  const bodyM = mat(0x3A2F4A), wallM2 = mat(0x2E2539), fasciaM = mat(0x241C2E);
  for (const [key, a, b, label, accent] of bands) {
    const bg = new THREE.Group(), w = b - a, cx = (a + b) / 2;
    // cutaway building: back-of-house block, low side walls, open front with a fascia carrying the sign
    addBox(bg, w, 2.8, 2.2, bodyM, cx, 1.4, -104.1, { cast: true });
    addBox(bg, w + 0.2, 0.18, 2.4, mat(0x4A3D5A), cx, 2.88, -104.1);
    for (const sx of [a + 0.15, b - 0.15]) addBox(bg, 0.3, 2.2, 6.8, wallM2, sx, 1.1, -101.8, { cast: true });
    for (const sx of [a + 0.15, b - 0.15]) addBox(bg, 0.3, 3.9, 0.3, fasciaM, sx, 1.95, -98.2);
    addBox(bg, w, 0.6, 0.3, fasciaM, cx, 3.75, -98.2);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, 0.08), basic(new THREE.Color(accent).getHex())); strip.position.set(cx, 3.43, -98.04); bg.add(strip);
    const sign = signPlane(label, Math.min(w - 1, 7.5), 0.95, { bg: '#1C1428', fg: accent, size: 64 }); sign.position.set(cx, 3.95, -98.03); bg.add(sign);
    if (key.startsWith('CONC')) {
      addBox(bg, w - 1.2, 1.05, 0.7, mat(0x5A4A6E), cx, 0.53, -100.9);
      addBox(bg, w - 1.2, 0.08, 0.8, mat(0xFFB547, { emissive: 0x6A4710, emissiveIntensity: 0.5 }), cx, 1.08, -100.9);
      for (let i = 0; i < 6; i++) { const mb = new THREE.Mesh(new THREE.PlaneGeometry((w - 2) / 6 - 0.2, 0.9), basic(i % 2 ? 0xFFB547 : 0xF27868, { transparent: true, opacity: 0.85 })); mb.position.set(a + 1 + (i + 0.5) * (w - 2) / 6, 2.0, -102.98); bg.add(mb); }
    } else if (key.startsWith('REST')) {
      for (const dx of [-w / 4, w / 4]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.3), basic(0x120D1C)); d.position.set(cx + dx, 1.15, -102.98); bg.add(d); const ic = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), basic(0x9678C8)); ic.position.set(cx + dx, 2.55, -102.97); bg.add(ic); }
    } else if (key === 'MED') {
      const cross = canvasTex(128, 128, (x) => { x.fillStyle = '#91B49A'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#F8F1E7'; x.fillRect(48, 18, 32, 92); x.fillRect(18, 48, 92, 32); });
      const cm = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: cross, toneMapped: false })); cm.position.set(cx - 1.6, 1.6, -102.98); bg.add(cm);
      const d = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.4), basic(0x120D1C)); d.position.set(cx + 1.8, 1.2, -102.98); bg.add(d);
      addBox(bg, 2.2, 0.7, 1.0, mat(0xE9E1F2), cx - 2.2, 0.35, -100.6);
    } else {
      addBox(bg, w - 1.4, 1.05, 0.7, mat(0x4A3D5A), cx, 0.53, -100.9);
    }
    addBox(bg, w, 0.12, 6.4, mat(0x2F2540), cx, 0.06, -101.6);
    g.add(bg);
    if (key !== 'KIOSK') W3.lm[key] = pickable(bg, { type: key === 'MED' ? 'asset' : 'amen', id: key });
  }
  // gates with turnstile lines
  W3.turn = {};
  const tsGeo = mergeColored([[new THREE.BoxGeometry(0.34, 1.0, 0.7).translate(0, 0.5, 0), 0x6A5A80], [new THREE.BoxGeometry(0.36, 0.06, 0.72).translate(0, 1.02, 0), 0xFFB547]]);
  const armGeo = mergeColored([[new THREE.BoxGeometry(0.05, 0.05, 0.62).translate(0, 0, 0.31), 0xC9BEDA], [new THREE.BoxGeometry(0.05, 0.05, 0.62).translate(0, 0, 0.31).rotateX(Math.PI * 2 / 3), 0xC9BEDA], [new THREE.BoxGeometry(0.05, 0.05, 0.62).translate(0, 0, 0.31).rotateX(-Math.PI * 2 / 3), 0xC9BEDA]]);
  for (const k of ['A', 'B', 'C', 'D']) {
    const G0 = GATES[k], x = ATT[G0.att].x, w = G0.w, gg = new THREE.Group();
    const lanes = G0.lanes, frameM = mat(0x2C2338), pylonM = mat(0x4A3D5A);
    addBox(gg, 0.8, 7, 0.8, pylonM, x - w / 2 - 0.4, 3.5, -98.6, { cast: true }); addBox(gg, 0.8, 7, 0.8, pylonM, x + w / 2 + 0.4, 3.5, -98.6, { cast: true });
    addBox(gg, w + 2.4, 1.4, 1.2, frameM, x, 7.4, -98.6, { cast: true });
    const sign = signPlane(G0.aux ? 'GATE D' : 'GATE ' + k, Math.min(w, 6), 1.05, { bg: '#1C1428', fg: '#FFB547', size: 78 });
    sign.position.set(x, 7.4, -99.22); sign.rotation.y = Math.PI; gg.add(sign);
    const sign2 = sign.clone(); sign2.position.set(x, 7.4, -97.98); sign2.rotation.y = 0; gg.add(sign2);
    addBox(gg, w + 0.4, 0.1, 9.6, mat(0x332A40), x, 0.04, -103.6);
    const ts = new THREE.InstancedMesh(tsGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), lanes + 1);
    const arms = new THREE.InstancedMesh(armGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.4 }), lanes);
    const m4 = new THREE.Matrix4(), lw = w / lanes;
    for (let i = 0; i <= lanes; i++) { m4.makeTranslation(x - w / 2 + i * lw, 0, -103); ts.setMatrixAt(i, m4); }
    for (let i = 0; i < lanes; i++) { m4.makeTranslation(x - w / 2 + (i + 0.5) * lw, 0.9, -103); arms.setMatrixAt(i, m4); }
    ts.castShadow = true; gg.add(ts); gg.add(arms);
    const shutter = addBox(gg, w, 3.2, 0.25, mat(COL.crit, { emissive: COL.crit, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }), x, 1.6, -106.2);
    shutter.visible = false;
    for (const sx of [-w / 2 - 0.4, w / 2 + 0.4]) addBox(gg, 0.3, 3.4, 9.6, mat(0x2E2539), x + sx, 1.7, -103.6);
    g.add(gg);
    W3.turn[k] = { arms, lanes, x, w, angle: new Float32Array(lanes), shutter, group: gg };
    W3.lm['GATE_' + k] = pickable(gg, { type: 'gate', id: k });
  }
  // walls between amenity buildings and gates on the plaza side (fence line)
  const fence = [[-55, -43], [-37, -32], [-23, -21], [-9, -7], [3, 4], [15, 23], [32, 34], [44, 46], [55, 62], [-62, -55]];
  for (const [a, b] of fence) addBox(g, b - a, 3.6, 0.5, mat(0x2E2539), (a + b) / 2, 1.8, -105.3);
  // service corridor behind the buildings (staff only)
  const svc = new THREE.Mesh(new THREE.PlaneGeometry(116, 3.2), mat(0x2A2134, { roughness: 1 })); svc.rotation.x = -Math.PI / 2; svc.position.set(0, 0.04, -106.9); g.add(svc);
  const hatch = canvasTex(256, 64, (x, w, h) => { x.fillStyle = 'rgba(150,120,200,0.0)'; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(150,120,200,0.9)'; x.lineWidth = 6; for (let i = -4; i < 16; i++) { x.beginPath(); x.moveTo(i * 24, h); x.lineTo(i * 24 + h, 0); x.stroke(); } });
  hatch.wrapS = THREE.RepeatWrapping; hatch.repeat.set(24, 1);
  const svcH = new THREE.Mesh(new THREE.PlaneGeometry(116, 3.2), new THREE.MeshBasicMaterial({ map: hatch, transparent: true, opacity: 0.0, depthWrite: false }));
  svcH.rotation.x = -Math.PI / 2; svcH.position.set(0, 0.07, -106.9); g.add(svcH); W3.svcHatch = svcH;
  addBox(g, 116, 1.1, 0.25, mat(0x3B3049), 0, 0.55, -108.55);
  // service door into W-014
  const sd = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), basic(0x9678C8, { transparent: true, opacity: 0.6 })); sd.position.set(-8.5, 1.2, -98.0); g.add(sd);
  // roof cutaway: glazing with beams at zone boundaries and hanging zone signs
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(124, 7.6), new THREE.MeshStandardMaterial({ color: 0x9678C8, transparent: true, opacity: 0.07, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide }));
  glass.rotation.x = -Math.PI / 2; glass.position.set(0, 7.8, -94.5); g.add(glass); W3.roof = glass;
  const beamM = mat(0x2F2740);
  for (let i = 0; i <= 10; i++) {
    const x = -55 + i * 11;
    addBox(g, 0.4, 0.5, 7.8, beamM, x, 7.7, -94.5, { cast: true });
    if (!(x === 0)) addBox(g, 0.42, 7.6, 0.42, beamM, x, 3.8, -97.75, { cast: true });
  }
  addBox(g, 124, 0.45, 0.4, beamM, 0, 7.7, -98.1, { cast: true }); addBox(g, 124, 0.45, 0.4, beamM, 0, 7.7, -90.9);
  W3.zoneSigns = [];
  for (const z of ZONES) {
    const s = signPlane(z.short, 2.4, 0.7, { bg: '#1C1428', fg: '#FFB547', size: 62, font: '"JetBrains Mono", monospace', weight: 600 });
    s.position.set(z.xc, 6.6, -97.4); s.rotation.y = Math.PI; g.add(s);
    const s2 = s.clone(); s2.rotation.y = 0; s2.position.z = -97.38; g.add(s2);
    W3.zoneSigns.push(s);
  }
  // pilot zone amber boundary (glowing outline)
  const pts = [[-57, -89.6], [57, -89.6], [57, -109], [-57, -109], [-57, -89.6]];
  const bpos = [];
  for (let i = 0; i < pts.length - 1; i++) { const [xa, za] = pts[i], [xb, zb] = pts[i + 1]; bpos.push(xa, 0.12, za, xb, 0.12, zb); }
  const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
  W3.pilotLine = new THREE.LineSegments(bgeo, new THREE.LineBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.95 })); g.add(W3.pilotLine);
  const ribbon = new THREE.Group();
  const rm = basic(COL.amber, { transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  for (let i = 0; i < pts.length - 1; i++) { const [xa, za] = pts[i], [xb, zb] = pts[i + 1]; const len = Math.hypot(xb - xa, zb - za); const p = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.6), rm); p.position.set((xa + xb) / 2, 0.8, (za + zb) / 2); p.rotation.y = -Math.atan2(zb - za, xb - xa); ribbon.add(p); }
  g.add(ribbon); W3.pilotRibbon = ribbon;
}

/* ---------------- plaza, main entrance, operations center, queue lanes ---------------- */
function buildPlaza() {
  const g = W3.world;
  const tex = canvasTex(512, 512, (x, w) => { x.fillStyle = '#2D2438'; x.fillRect(0, 0, w, w); x.strokeStyle = 'rgba(80,64,100,0.55)'; x.lineWidth = 2; for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, w); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); } });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 9);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(260, 72), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(0, 0.02, -145); plaza.receiveShadow = true; g.add(plaza);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(14, 60), mat(0x352B43)); walk.rotation.x = -Math.PI / 2; walk.position.set(-2, 0.025, -190); walk.receiveShadow = true; g.add(walk);
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(250, 8), mat(0x251D30)); ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.015, -109); g.add(ring);
  // main entrance arch (illustrative)
  const arch = new THREE.Group(), am = mat(0x4A3D5A), am2 = mat(0x2C2338);
  addBox(arch, 3, 14, 3, am, -11, 7, -131, { cast: true }); addBox(arch, 3, 14, 3, am, 7, 7, -131, { cast: true });
  addBox(arch, 24, 3, 3.4, am2, -2, 14.5, -131, { cast: true });
  const as = signPlane('MAIN ENTRANCE', 15, 2.2, { bg: '#1C1428', fg: '#FFB547', size: 82, w: 1024, h: 150 }); as.position.set(-2, 14.5, -132.75); as.rotation.y = Math.PI; arch.add(as);
  const as2 = as.clone(); as2.position.z = -129.25; as2.rotation.y = 0; arch.add(as2);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(24, 0.3), basic(COL.amber)); strip.position.set(-2, 12.85, -132.72); strip.rotation.y = Math.PI; arch.add(strip);
  g.add(arch); W3.lm.MAIN = pickable(arch, { type: 'landmark', id: 'MAIN' });
  // operations center pavilion
  const ops = new THREE.Group();
  addBox(ops, 16, 0.6, 11, mat(0x2C2338), -52, 0.3, -121);
  const glassM = new THREE.MeshStandardMaterial({ color: 0x3A2E55, emissive: 0xFFB547, emissiveIntensity: 0.22, roughness: 0.25, metalness: 0.4 });
  addBox(ops, 14, 5, 9, glassM, -52, 3.1, -121, { cast: true });
  addBox(ops, 15, 0.5, 10, mat(0x4A3D5A), -52, 5.8, -121, { cast: true });
  const mastM = mat(0x6A5A80);
  addBox(ops, 0.25, 7, 0.25, mastM, -46.5, 9.4, -118.5);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(0xC9BEDA, { side: THREE.DoubleSide })); dish.position.set(-55, 6.6, -123); dish.rotation.x = 2.3; ops.add(dish);
  const os = signPlane('STADIUM OPERATIONS', 10, 1.1, { bg: '#1C1428', fg: '#FFB547', size: 70, w: 1024, h: 120 }); os.position.set(-52, 4.7, -125.55); os.rotation.y = Math.PI; ops.add(os);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), basic(COL.amber)); beacon.position.set(-46.5, 13, -118.5); ops.add(beacon); W3.opsBeacon = beacon;
  g.add(ops); W3.lm.OPS = pickable(ops, { type: 'landmark', id: 'OPS' });
  W3.opsPoint = new THREE.Vector3(-52, 6.5, -121);
  // queue lanes (stanchions) in front of each gate
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 1.0, 6).translate(0, 0.5, 0), mat(0xC9BEDA, { metalness: 0.5, roughness: 0.4 }), 600);
  const m4 = new THREE.Matrix4(); let n = 0;
  W3.lanes = {};
  for (const k of ['A', 'B', 'C', 'D']) {
    const x = ATT[GATES[k].att].x, w = GATES[k].w;
    const nl = Math.max(3, Math.round(w / 2.2)), lw = w / nl;
    W3.lanes[k] = { x, w, nl, lw };
    for (let i = 0; i <= nl; i++) for (let j = 0; j < 9; j++) { if (n >= 600) break; m4.makeTranslation(x - w / 2 + i * lw, 0, -110 - j * 1.8); post.setMatrixAt(n++, m4); }
  }
  post.count = n; g.add(post);
  // plaza light posts
  const lp = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 8, 6).translate(0, 4, 0), mat(0x3A3047), 24);
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6).translate(0, 8.1, 0), basic(0xFFD69A), 24);
  let k2 = 0;
  for (let i = 0; i < 12; i++) { const x = -115 + i * 21; for (const z of [-140, -168]) { if (k2 >= 24) break; m4.makeTranslation(x, 0, z); lp.setMatrixAt(k2, m4); lamps.setMatrixAt(k2, m4); k2++; } }
  lp.count = lamps.count = k2; g.add(lp); g.add(lamps);
  // QR-style "you are here" markers used by the route planner
  W3.qr = {};
  for (const q of QR) {
    const n0 = G.nodes.get(q.node);
    const grp = new THREE.Group(); grp.position.set(n0.x + (q.id === 'QR-06' ? 6 : 0), 0, n0.z + (q.id === 'QR-06' ? 0 : -2.6));
    const t = canvasTex(128, 128, (x) => { x.fillStyle = '#F8F1E7'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#1C1428'; const r = mulberry32(q.id.charCodeAt(3) * 31); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (r() > 0.5) x.fillRect(16 + i * 12, 16 + j * 12, 12, 12); x.fillRect(16, 16, 30, 30); x.fillRect(82, 16, 30, 30); x.fillRect(16, 82, 30, 30); x.fillStyle = '#F8F1E7'; x.fillRect(22, 22, 18, 18); x.fillRect(88, 22, 18, 18); x.fillRect(22, 88, 18, 18); x.fillStyle = '#1C1428'; x.fillRect(26, 26, 10, 10); x.fillRect(92, 26, 10, 10); x.fillRect(26, 92, 10, 10); });
    addBox(grp, 0.12, 1.3, 0.12, mat(0x6A5A80), 0, 0.65, 0);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })); pl.position.set(0, 1.55, -0.07); pl.rotation.y = Math.PI; grp.add(pl);
    const pl2 = pl.clone(); pl2.rotation.y = 0; pl2.position.z = 0.07; grp.add(pl2);
    g.add(grp); W3.qr[q.id] = pickable(grp, { type: 'qr', id: q.id });
  }
}

/* ---------------- low-detail gates around the rest of the stadium ---------------- */
function buildOtherGates() {
  const g = W3.world; W3.otherGates = [];
  const names = [['N', 0.05], ['NE', 0.3], ['E', 0.5], ['SE', 0.7], ['S', 0.95], ['SW', 1.25], ['NW', 1.75]];
  for (const [nm, f] of names) {
    const t = f * Math.PI, [x, z] = se(116.5, 90.5, t), [x2, z2] = se(116.5, 90.5, t + 0.02);
    const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = -Math.atan2(z2 - z, x2 - x);
    addBox(grp, 8, 6, 1.2, mat(0x2C2338), 0, 3, 0);
    const s = signPlane('GATE ' + nm, 5, 1, { bg: '#1C1428', fg: '#A99DB4', size: 70 }); s.position.set(0, 4.5, 0.62 * (z > 0 ? 1 : -1)); if (z < 0) s.rotation.y = Math.PI; grp.add(s);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), mat(0x2A2134)); pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.02, z > 0 ? 7 : -7); grp.add(pad);
    g.add(grp); W3.otherGates.push(grp);
  }
  // other concourses: coarse ground band coloured by an illustrative density (low level of detail)
  const n = 36, inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }), n);
  W3.ring = { mesh: inst, n, zones: [] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n * Math.PI * 2, [x, z] = se(121, 95, t), [x2, z2] = se(121, 95, t + 0.01);
    const len = (Math.PI * 2 * 105) / n * 1.05;
    if (z < -60 && Math.abs(x) < 64) { W3.ring.zones.push(null); continue; }
    q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.atan2(z2 - z, x2 - x)));
    m4.compose(new THREE.Vector3(x, 0.06, z), q, new THREE.Vector3(len, 6, 1));
    inst.setMatrixAt(k, m4); inst.setColorAt(k, new THREE.Color(COL.low));
    const side = Math.abs(x) > Math.abs(z) * 1.25 ? (x > 0 ? 'N' : 'S') : (z > 0 ? 'E' : 'W');
    W3.ring.zones.push({ inst: k, side, id: `CONC-${side}-${String(i + 1).padStart(3, '0')}`, t, x, z, seed: i * 1.7, dk: 0.5 });
    k++;
  }
  inst.count = k; g.add(inst);
}

/* ---------------- sensors: CCTV with viewing cones, WiFi halos ---------------- */
function buildSensors() {
  const g = new THREE.Group(); W3.sensors = g; W3.world.add(g);
  W3.cams = []; W3.aps = [];
  const camM = mat(0xE8E0F0, { roughness: 0.4 }), lensM = basic(0x120D1C);
  for (const c of CAMERAS) {
    const grp = new THREE.Group();
    const h = c.gate ? 6.5 : 6.2;
    grp.position.set(c.x, h, c.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.45), camM); grp.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10), lensM); lens.rotation.z = Math.PI / 2; lens.position.x = 0.48; grp.add(lens);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), basic(COL.ok)); led.position.set(0.3, 0.26, 0); grp.add(led);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(4.2, 9, 20, 1, true), new THREE.MeshBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    cone.geometry.translate(0, -4.5, 0); cone.geometry.rotateZ(Math.PI / 2); cone.position.x = 0.5;
    grp.add(cone);
    grp.rotation.y = c.yaw; grp.rotation.z = -0.55;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 6), mat(0x4A3D5A)); pole.position.set(c.x, h / 2, c.z); g.add(pole);
    g.add(grp);
    W3.cams.push({ c, grp, cone, led });
    pickable(grp, { type: 'camera', id: c.id });
  }
  for (const a of WIFI) {
    const grp = new THREE.Group(); grp.position.set(a.x, 7.2, a.z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 16), mat(0xF8F1E7)); grp.add(disc);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), basic(COL.violet)); led.position.y = -0.1; grp.add(led);
    g.add(grp);
    const halo = new THREE.Mesh(new THREE.RingGeometry(9.5, 11, 48), new THREE.MeshBasicMaterial({ color: COL.violet, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.set(a.x, 0.09, a.z); g.add(halo);
    const halo2 = new THREE.Mesh(new THREE.CircleGeometry(11, 48), new THREE.MeshBasicMaterial({ color: COL.violet, transparent: true, opacity: 0.035, depthWrite: false }));
    halo2.rotation.x = -Math.PI / 2; halo2.position.set(a.x, 0.08, a.z); g.add(halo2);
    W3.aps.push({ a, grp, halo, halo2, led });
    pickable(grp, { type: 'wifi', id: a.id });
  }
}

/* ---------------- seated spectators (instanced), filled by the simulated attendance ---------------- */
function buildSeatedCrowd() {
  const geo = mergeColored([[new THREE.BoxGeometry(0.5, 0.75, 0.45).translate(0, 0.38, 0), 0xffffff], [new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, 0.92, 0), 0xffffff]]);
  const max = 9800;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.9 }), max);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), rr = mulberry32(11);
  const seats = [];
  const shirt = [0xF8F1E7, 0xF8F1E7, 0xF8F1E7, 0xE9E1F2, 0x9678C8, 0x698AB0, 0xFFB547, 0xF8F1E7, 0xD8CFE4];
  for (const T of TIERS) {
    for (let r = 1; r < T.rows; r += 2) {
      const f = (r + 0.5) / T.rows, a = lerp(T.a0, T.a1, f), b = lerp(T.b0, T.b1, f), y = lerp(T.y0, T.y1, r / T.rows);
      const per = Math.round(4 * (a + b) * 0.9 / 1.55);
      for (let i = 0; i < per; i++) {
        if (seats.length >= max) break;
        const t = (i + rr() * 0.5) / per * Math.PI * 2, [x, z] = se(a, b, t);
        if (rr() < 0.04) continue;
        const sec = sectionOf(T.id, x, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-x, -z));
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1.25, 1.25, 1.25));
        mesh.setMatrixAt(seats.length, m4); mesh.setColorAt(seats.length, c.setHex(shirt[Math.floor(rr() * shirt.length)]));
        seats.push({ x, y, z, q: q.clone(), sec, tier: T.id, r: rr(), on: true, group: seatGroup(T.id, sec) });
      }
    }
  }
  mesh.count = seats.length; mesh.castShadow = false;
  W3.world.add(mesh);
  W3.seated = { mesh, seats, last: -1 };
}
function seatGroup(tier, sec) {
  if (tier === 'upper') return sec >= 201 && sec <= 209 ? 'GUP' : null;
  if (sec >= 101 && sec <= 103) return 'G102';
  if (sec >= 104 && sec <= 105) return 'G104';
  if (sec >= 106 && sec <= 109) return 'G108';
  return null;
}

/* ---------------- heat tiles over the concourse floor ---------------- */
function buildHeat() {
  const cells = [];
  for (let x = -55; x < 55; x += 1.1) for (let z = -97.7; z < -91.2; z += 1.1) cells.push({ x: x + 0.55, z: z + 0.55, zone: zoneIdxAt(x + 0.55), v: 0 });
  // gate passages and amenity alcoves
  for (const k of ['A', 'B', 'C', 'D']) { const x = ATT[GATES[k].att].x, w = GATES[k].w; for (let xx = x - w / 2; xx < x + w / 2 - 0.2; xx += 1.1) for (let z = -102.2; z < -98; z += 1.1) cells.push({ x: xx + 0.55, z: z + 0.55, zone: zoneIdxAt(xx + 0.55), gate: k, v: 0 }); }
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false, toneMapped: false }), cells.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), s = new THREE.Vector3(1, 1, 1);
  cells.forEach((c, i) => { m4.compose(new THREE.Vector3(c.x, 0.1, c.z), q, s); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, new THREE.Color(COL.low)); });
  mesh.renderOrder = 2;
  W3.pilot.add(mesh);
  mesh.userData.pick = { type: 'cell' }; PICK.push(mesh);
  W3.heat = { mesh, cells, kde: new Float32Array(cells.length) };
}

/* ---------------- flow chevrons ---------------- */
function buildArrows() {
  const shape = new THREE.Shape();
  shape.moveTo(0.9, 0); shape.lineTo(-0.5, 0.62); shape.lineTo(-0.15, 0); shape.lineTo(-0.5, -0.62); shape.lineTo(0.9, 0);
  const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
  const max = 260;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false }), max);
  mesh.renderOrder = 3; mesh.count = 0;
  W3.pilot.add(mesh);
  W3.arrows = { mesh, max, phase: 0 };
}

/* ---------------- agent meshes (instanced, anonymous, short-lived) ---------------- */
function buildAgentMeshes() {
  const body = mergeColored([
    [new THREE.CylinderGeometry(0.2, 0.25, 0.95, 7).translate(0, 0.62, 0), 0xffffff],
    [new THREE.CylinderGeometry(0.1, 0.12, 0.2, 6).translate(0, 1.15, 0), 0xE8D9C8],
    [new THREE.SphereGeometry(0.17, 8, 6).translate(0, 1.36, 0), 0xE8D9C8],
    [new THREE.CylinderGeometry(0.08, 0.09, 0.2, 5).translate(-0.1, 0.1, 0), 0x2A2236], [new THREE.CylinderGeometry(0.08, 0.09, 0.2, 5).translate(0.1, 0.1, 0), 0x2A2236]
  ]);
  const colM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  const mesh = new THREE.InstancedMesh(body, colM, 1100);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true; mesh.count = 0; mesh.frustumCulled = false;
  W3.world.add(mesh);
  mesh.userData.pick = { type: 'agent' }; PICK.push(mesh);
  const resp = mergeColored([
    [new THREE.CylinderGeometry(0.24, 0.28, 1.05, 8).translate(0, 0.66, 0), 0xD84E68],
    [new THREE.BoxGeometry(0.5, 0.18, 0.52).translate(0, 0.9, 0), 0xF8F1E7],
    [new THREE.SphereGeometry(0.18, 8, 6).translate(0, 1.38, 0), 0xE8D9C8],
    [new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8).translate(0, 1.56, 0), 0xD84E68]
  ]);
  const rmesh = new THREE.InstancedMesh(resp, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x3A0A16, emissiveIntensity: 0.6 }), 24);
  rmesh.count = 0; rmesh.castShadow = true; rmesh.frustumCulled = false; W3.world.add(rmesh);
  W3.agents = { mesh, rmesh };
  W3.agentColors = [0xF8F1E7, 0xEDE3F5, 0x9678C8, 0x698AB0, 0xFFB547, 0xC9BEDA, 0x7D8FB0, 0xE7C9A0, 0xB7A4D6, 0xF27868];
}

/* ---------------- data particles from sensors to the operations center ---------------- */
function buildParticles() {
  const n = 220;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTex(), toneMapped: false }));
  pts.frustumCulled = false;
  W3.world.add(pts);
  W3.parts = { pts, n, list: [] };
}

/* ---------------- markers: selection ring, route tubes, incident beacon ---------------- */
function buildMarkers() {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 5;
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 64), new THREE.MeshBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  ring2.rotation.x = -Math.PI / 2; ring.add(ring2); ring2.position.z = 0.001;
  W3.scene.add(ring); W3.selRing = ring;
  W3.routes = new THREE.Group(); W3.scene.add(W3.routes);
  const inc = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), new THREE.MeshBasicMaterial({ color: COL.crit, toneMapped: false })); cone.position.y = 4.2; inc.add(cone);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), new THREE.MeshBasicMaterial({ color: COL.crit, transparent: true, opacity: 0.6 })); beam.position.y = 2; inc.add(beam);
  const disc = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.7, 40), new THREE.MeshBasicMaterial({ color: COL.crit, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.15; inc.add(disc);
  inc.visible = false; W3.scene.add(inc); W3.incident = inc; W3.incCone = cone; W3.incDisc = disc;
  W3.obstacles = new THREE.Group(); W3.scene.add(W3.obstacles);
}

/* ---------------- weather: rain streaks ---------------- */
function buildWeather() {
  const n = 1600, pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) { const x = (rnd() - 0.5) * 220, y = rnd() * 70, z = -40 - rnd() * 150; pos.set([x, y, z, x + 0.15, y - 1.6, z + 0.1], i * 6); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xC9BEDA, transparent: true, opacity: 0.32, depthWrite: false }));
  rain.visible = false; rain.frustumCulled = false; W3.scene.add(rain); W3.rain = rain;
}

function onResize() {
  const { renderer, camera, canvas } = W3;
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
