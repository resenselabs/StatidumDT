'use strict';
/* =====================================================================
   STADIUM-DT interface: modes, top bar, KPI cards, detail panel, pipeline tracker, tables, search
   ===================================================================== */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MODEQ = { mirror: 'What is happening now?', predict: 'What is likely to happen next?', simulate: 'What happens if we intervene?', navigate: 'Where should someone go?', replay: 'What happened and why?' };
const UI = {
  toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), 3600); },
  panelAcc: 0, kpiAcc: 0, tableAcc: 0, procAcc: 0, procStep: 0, lastPanelKey: ''
};

/* ---------------- selection ---------------- */
function select(sel, opt) {
  S.sel = sel;
  V3.selLm = null;
  if (sel) {
    const lm = LANDMARKS.find(l => JSON.stringify(l.sel) === JSON.stringify({ type: sel.type, id: sel.id }));
    if (lm) V3.selLm = lm.id;
    if (sel.type === 'zone') S.focusZone = ZONES[sel.idx].id;
    if (sel.type === 'cell') S.focusZone = ZONES[W3.heat.cells[sel.idx].zone].id;
    if (sel.type === 'qr') { S.nav.start = 'QR:' + sel.id; if (S.mode === 'navigate') { $('navStart').value = S.nav.start; OPS.planRoute(true); } }
    if (sel.type === 'section' && S.mode === 'navigate' && S.role !== 'responder') { S.nav.start = 'SEC:' + sel.sec; OPS.ensureStartOption(sel.sec); $('navStart').value = S.nav.start; OPS.planRoute(true); }
    if (S.follow && !(sel.type === 'agent' && sel.id === S.follow)) S.follow = null;
  } else S.follow = null;
  renderPanel(true);
  if (opt && opt.glide) { const a = selectionAnchor(sel); if (a) focusAnchor(a, sel.type === 'cell' || sel.type === 'agent' || sel.type === 'camera' || sel.type === 'wifi' || sel.type === 'qr'); }
  if (window.matchMedia('(max-width:760px)').matches && sel) setSheet('right');
  renderTable();
}

/* ---------------- modes ---------------- */
function setMode(m, quiet) {
  const prev = S.mode;
  if (prev === m) return;
  S.mode = m;
  document.body.dataset.mode = m;
  document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  $('modeQ').textContent = MODEQ[m];
  $('horizonBar').hidden = m !== 'predict';
  $('lab').hidden = m !== 'simulate';
  $('right').style.visibility = m === 'simulate' && !window.matchMedia('(max-width:760px)').matches ? 'hidden' : '';
  $('planner').hidden = m !== 'navigate';
  $('process').hidden = m === 'navigate';
  $('replayBar').hidden = m !== 'replay';
  $('replayVeil').hidden = m !== 'replay';
  $('simVeil').hidden = !(m === 'simulate' && S.scenario && S.scenario.run);
  $('sheetCtx').textContent = m === 'simulate' ? 'Lab' : m === 'navigate' ? 'Route' : m === 'replay' ? 'Timeline' : 'Pipeline';
  if (prev === 'navigate' || prev === 'simulate') { clearRoutes(); }
  if (prev === 'simulate' && S.scenario && S.scenario.run) { clearAgents(); AG.src = null; }
  if (prev === 'replay') { REC.frame = null; S.replay.playing = false; clearAgents(); }
  if (m === 'predict') { if (!S.horizon) setHorizon(2); }
  if (m === 'simulate') OPS.renderLab();
  if (m === 'navigate') { OPS.syncPlanner(); if (S.role === 'responder') OPS.planResponder(true); else OPS.planRoute(true); }
  if (m === 'replay') { REC.enter(); document.body.style.setProperty('--rph', $('replayBar').offsetHeight + 'px'); }
  if (m === 'simulate' && S.scenario && S.scenario.run) { clearAgents(); }
  if (!quiet) logEvent('operator', `Mode changed to ${m.toUpperCase()}`);
  if (window.matchMedia('(max-width:760px)').matches && (m === 'simulate' || m === 'navigate' || m === 'replay')) setSheet('ctx');
  renderPanel(true); renderProcess(true); renderTable();
}
function setHorizon(h) {
  S.horizon = h;
  document.querySelectorAll('#horizonBar button').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.h === h)));
  $('hzNote').textContent = h ? `Forecast +${h} min from the estimated state · uncertainty shown in panel` : 'Current estimated state';
  if (h) logEvent('predict', `Forecast view +${h} min opened`);
  renderPanel(true);
}

/* ---------------- top bar ---------------- */
function initTopbar() {
  const as = $('areaSel');
  for (const k in AREAS) { const o = document.createElement('option'); o.value = k; o.textContent = AREAS[k].label; as.appendChild(o); }
  as.addEventListener('change', () => { goArea(as.value); logEvent('operator', `Camera moved to ${AREAS[as.value].label}`); });
  const ps = $('phaseSel');
  for (const p of PHASES) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; ps.appendChild(o); }
  ps.addEventListener('change', () => jumpPhase(ps.value));
  document.querySelectorAll('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#horizonBar button').forEach(b => b.addEventListener('click', () => setHorizon(+b.dataset.h)));
  const wb = $('weatherBtn'), wp = $('weatherPop');
  wb.addEventListener('click', e => { e.stopPropagation(); wp.hidden = !wp.hidden; wb.setAttribute('aria-expanded', String(!wp.hidden)); $('avatarPop').hidden = true; });
  wp.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setWeather(b.dataset.w)));
  const ab = $('avatarBtn'), ap = $('avatarPop');
  ab.addEventListener('click', e => { e.stopPropagation(); ap.hidden = !ap.hidden; ab.setAttribute('aria-expanded', String(!ap.hidden)); wp.hidden = true; });
  document.addEventListener('click', e => { if (!wp.contains(e.target) && e.target !== wb) wp.hidden = true; if (!ap.contains(e.target) && e.target !== ab) ap.hidden = true; });
  $('dayBtn').addEventListener('click', () => { S.night = !S.night; $('dayBtn').setAttribute('aria-pressed', String(!S.night)); $('dayIcon').setAttribute('href', S.night ? '#i-sun' : '#i-moon'); $('dayBtn').title = S.night ? 'Switch to day lighting' : 'Switch to night lighting'; applyEnvironment(); });
  $('alertBtn').addEventListener('click', () => { setTab('events'); setFilter('alert'); if (window.matchMedia('(max-width:760px)').matches) setSheet('dock'); });
  $('openTargets').addEventListener('click', () => showTargets());
  $('targetsLink').addEventListener('click', () => showTargets());
  $('openAbout').addEventListener('click', () => showAbout());
  $('openKeys').addEventListener('click', () => showKeys());
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
}
function setWeather(w) {
  S.weather = w; TWIN.cfg.weather = w;
  document.querySelectorAll('#weatherPop button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.w === w)));
  $('weatherIcon').setAttribute('href', w === 'rain' ? '#i-rain' : w === 'storm' ? '#i-bolt' : '#i-cloud');
  $('weatherLbl').textContent = w === 'rain' ? 'Rain' : w === 'storm' ? 'Lightning' : 'Clear';
  $('weatherPop').hidden = true;
  applyEnvironment();
  logEvent('operator', `Weather context set to ${w === 'storm' ? 'lightning within 10 mi' : w}`, { interv: true });
  if (w === 'storm') { logEvent('alert', 'Weather: lightning within 10 mi. Severe-weather egress scenario available in the Scenario Lab'); UI.toast('Lightning context: open SIMULATE to evaluate a severe-weather egress (simulated).'); }
}
function jumpPhase(id) {
  const p = PHASES.find(x => x.id === id);
  $('loading').hidden = false; $('loadingT').textContent = `Rebuilding the synthetic state for ${p.label}…`;
  setTimeout(() => {
    TWIN.init(p.jump); clearAgents(); REC.reset(); S.scenario = null; OPS.renderLab();
    $('loading').hidden = true;
    logEvent('operator', `Game-day phase set to ${p.label} (${fmtHM(p.jump)})`);
    updateStands(true); renderPanel(true); renderTable(); updateTopbar();
  }, 30);
}
function updateTopbar() {
  const c = S.mode === 'replay' && REC.frame ? REC.frame.clock : TWIN.m.clock;
  $('clockT').textContent = fmtClock(c);
  const ph = phaseAt(c); $('clockPhase').textContent = phaseLabel(ph);
  const gc = gameClock(c); $('clockGame').textContent = `${gc.q} ${gc.t}`;
  if ($('phaseSel').value !== ph) $('phaseSel').value = ph;
  const n = TWIN.alerts.size; $('alertN').textContent = n; $('alertBtn').dataset.n = String(n);
  S.alertsOpen = n;
}

/* ---------------- KPI cards ---------------- */
function focusIdx() { const z = zoneById(S.focusZone); return z ? z.i : 4; }
function updateKPIs() {
  const j = focusIdx(), e = TWIN.est[j];
  let k = e.k, lvl;
  if (S.mode === 'replay' && REC.frame) k = REC.frame.z[j].k;
  const zs = zoneShown(j); if (zs.fc) k = zs.k;
  lvl = densLevel(k);
  $('kpi1V').textContent = fmt1(k);
  const c1 = $('kpi1Lvl'); c1.textContent = lvl.label; c1.className = 'chip ' + lvl.id;
  $('kpi1Sub').textContent = zs.fc ? `Forecast +${S.horizon} min ±${fmt1(zs.u)} · ${ZONES[j].id}` : S.mode === 'replay' && REC.frame ? `Replay ${fmtClock(REC.frame.clock)} · ${ZONES[j].id}` : `Selected pilot zone · ${ZONES[j].id}`;
  drawSpark($('kpi1Spark'), TWIN.hist[j], lvl.hex);
  const ne = TWIN.nextETA();
  if (ne) {
    $('kpi2V').textContent = ne.eta > 0 ? fmtMS(ne.eta) : 'NOW';
    $('kpi2U').textContent = ne.eta > 0 ? 'min:s' : '';
    $('kpi2Lvl').textContent = ne.eta > 0 ? 'FORECAST' : 'THRESHOLD'; $('kpi2Lvl').className = 'chip ' + (ne.eta > 0 ? 'warn' : 'high');
    $('kpi2Sub').textContent = ne.eta > 0 ? 'Predicted time to threshold' : 'Zone already above threshold';
    $('kpi2Foot').textContent = `${ZONES[ne.zone].id} · horizon 5 min · threshold ${BOTTLENECK_K} p/m²`;
  } else {
    $('kpi2V').textContent = '--:--'; $('kpi2U').textContent = ''; $('kpi2Lvl').textContent = 'CLEAR'; $('kpi2Lvl').className = 'chip ok';
    $('kpi2Sub').textContent = 'No zone forecast to reach the threshold';
    $('kpi2Foot').textContent = `All pilot zones · horizon 5 min · threshold ${BOTTLENECK_K} p/m²`;
  }
  const sc = S.scenario;
  if (S.mode === 'simulate' && sc && sc.fast && sc.fast.done) {
    const ri = sc.fast.ri;
    $('kpi3V').textContent = isFinite(ri.clearance) ? fmtDur(ri.clearance) : '> 45m';
    $('kpi3Sub').textContent = `Current simulation scenario · ${sc.def.label}`;
    $('kpi3Foot').textContent = `${OPS.clearLabel(sc.ctx)} · intervention`;
    $('kpi3Lvl').textContent = 'SCENARIO'; $('kpi3Lvl').className = 'chip violet';
  } else if (STAND.res) {
    $('kpi3V').textContent = isFinite(STAND.res.clearance) ? fmtDur(STAND.res.clearance) : '> 45m';
    $('kpi3Sub').textContent = 'Current simulation scenario · standing estimate';
    $('kpi3Foot').textContent = 'Full-catchment egress, current configuration';
    $('kpi3Lvl').textContent = 'SIM'; $('kpi3Lvl').className = 'chip';
  }
}
function drawSpark(cv, hist, hex) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (!hist || hist.length < 2) return;
  const pts = hist.slice(-300);
  const max = Math.max(4, ...pts.map(p => p[1]));
  ctx.strokeStyle = 'rgba(248,241,231,0.08)'; ctx.lineWidth = 1;
  for (const v of [1.5, 2.5, 3.5]) { const y = h - 2 - v / max * (h - 4); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const x = i => i / (pts.length - 1) * (w - 4) + 2, y = v => h - 2 - v / max * (h - 4);
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(x(i), y(p[1])) : ctx.moveTo(x(i), y(p[1])));
  ctx.lineTo(x(pts.length - 1), h); ctx.lineTo(x(0), h); ctx.closePath();
  ctx.fillStyle = hex + '33'; ctx.fill();
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(x(i), y(p[1])) : ctx.moveTo(x(i), y(p[1])));
  ctx.strokeStyle = hex; ctx.lineWidth = 1.6; ctx.stroke();
  const lx = x(pts.length - 1), ly = y(pts[pts.length - 1][1]);
  ctx.fillStyle = hex; ctx.beginPath(); ctx.arc(lx, ly, 2.6, 0, Math.PI * 2); ctx.fill();
}

/* standing clearance estimate for KPI 3: full-catchment egress under the current configuration */
const STAND = { job: null, res: null, acc: 1e9 };
function standingWork() {
  STAND.acc += 1;
  if (!STAND.job && STAND.acc > 600) {
    const m = TWIN.estimatedModel();
    if (!m.egress) { for (const gr of GROUPS) m.seat[gr.id] = gr.cap * ATTEND; for (const g in m.g) m.g[g].Q = 0; m.startEgress('post'); }
    STAND.job = { m, rec: recorder(m, 'egress') }; STAND.acc = 0;
  }
  if (STAND.job) {
    const J = STAND.job;
    for (let i = 0; i < 18 && !J.done; i++) { advance(J.m, J.rec, 3); if ((J.rec.clearance < Infinity) || J.rec.t >= SCEN_MAX) J.done = true; }
    if (J.done) { STAND.res = J.rec; STAND.job = null; }
  }
}

/* ---------------- detail panel ---------------- */
function kv(rows) { return `<dl class="kv">${rows.map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls || ''}">${v}</dd>`).join('')}</dl>`; }
function chip(l) { return `<span class="chip ${l.id}">${l.label}</span>`; }
function head(eyebrow, title, chipHtml, mono) { return `<div class="rp-head"><div><span class="eyebrow">${eyebrow}</span><h2 class="${mono ? 'mono' : ''}">${title}</h2></div>${chipHtml || ''}</div>`; }
function acts(list) { return `<div class="acts">${list.map(([id, l, cls]) => `<button class="btn ${cls || ''}" data-act="${id}">${l}</button>`).join('')}</div>`; }
function synthNote(extra) { return `<p class="note">${extra ? extra + ' ' : ''}These figures are synthetic and come from the demo model.</p>`; }
function zoneData(j) {
  if (S.mode === 'replay' && REC.frame) { const f = REC.frame.z[j]; return { N: f.N, k: f.k, v: f.v, fin: f.fin, fout: f.fout, conf: f.conf, dir: dirLabel(f.dx, f.dz), q: f.q, A: ZONES[j].area, replay: true }; }
  const e = TWIN.est[j];
  return { N: e.N, k: e.k, v: e.v, fin: e.fin, fout: e.fout, conf: e.conf, dir: e.dir, q: e.q, A: e.A, err: e.err, src: e.src, sig: e.sig };
}
function renderPanel(force) {
  const body = $('rightBody');
  const sel = S.sel;
  const key = JSON.stringify(sel) + S.mode + S.horizon;
  const keepScroll = !force || key === UI.lastPanelKey ? body.scrollTop : 0;
  UI.lastPanelKey = key;
  let html = '';
  if (!sel) html = panelDefault();
  else switch (sel.type) {
    case 'zone': html = panelZone(sel.idx); break;
    case 'cell': html = panelCell(sel.idx); break;
    case 'gate': html = panelGate(sel.id); break;
    case 'turnstile': html = panelGate(sel.id, true); break;
    case 'amen': html = panelAmen(sel.id); break;
    case 'asset': html = panelAsset(sel.id); break;
    case 'landmark': html = panelLandmark(sel.id); break;
    case 'camera': html = panelCamera(sel.id); break;
    case 'wifi': html = panelWifi(sel.id); break;
    case 'section': html = panelSection(sel); break;
    case 'qr': html = panelQR(sel.id); break;
    case 'agent': html = panelAgent(sel.id); break;
    case 'outer': html = panelOuter(sel.id); break;
    default: html = panelDefault();
  }
  body.innerHTML = html;
  body.scrollTop = keepScroll;
  body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => doAction(b.dataset.act, b)));
  body.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => select(JSON.parse(b.dataset.sel), { glide: true })));
  body.querySelectorAll('canvas[data-chart]').forEach(cv => drawPanelChart(cv));
}
function panelDefault() {
  const n = TWIN.alerts.size, conf = TWIN.meanConf();
  const pilotN = sum(TWIN.est.map(e => e.N)), att = attendance();
  const fcv = S.mode === 'predict' && S.horizon && TWIN.fc;
  const rows = ZONES.map((z, j) => { const d = zoneShown(j), l = densLevel(d.k); return `<tr data-sel='${JSON.stringify({ type: 'zone', idx: j })}'><td class="id">${z.id}</td><td class="num">${fmt1(d.k)}${d.fc ? ' ±' + fmt1(d.u) : ''}</td><td>${`<span class="risk"><i style="background:${l.hex}"></i>${l.label}</span>`}</td></tr>`; }).join('');
  const recent = EVENTS.filter(e => e.cat === 'alert' || e.cat === 'operator' || e.cat === 'sim' || e.cat === 'route').slice(-5).reverse();
  return head('DEFAULT VIEW', 'STADIUM OPERATIONS', '<span class="chip warn">CONCEPT DEMO</span>') +
    kv([
      ['System', 'CONCEPT DEMO'], ['Active Zone', 'PILOT CONCOURSE (WEST)'], ['Sensor Fusion', `SIMULATED · conf ${fmt2(conf)}`],
      ['Crowd Analytics', 'ACTIVE'], ['Bottleneck Forecast', 'ENABLED · 2 to 5 min'], ['Routing Engine', 'READY'],
      ['Privacy Mode', 'AGGREGATED'], ['Open Alerts', `<b style="color:${n ? HEX.high : HEX.ok}">${n}</b>`, 'big'],
      ['Simulated attendance', `${fmtInt(att)} / ${fmtInt(CAPACITY)}`], ['Pilot concourse occupancy (est.)', fmtInt(pilotN)]
    ]) +
    `<div class="sect"><div class="sect-h"><span class="eyebrow">DENSITY BY PILOT ZONE (${fcv ? 'FORECAST +' + S.horizon + ' MIN' : 'EST.'})</span><span class="mono dim" style="font-size:10.5px">p/m²</span></div><canvas class="minichart" data-chart="zones" width="640" height="184"></canvas></div>` +
    `<div class="sect"><div class="sect-h"><span class="eyebrow">ZONE STATUS${fcv ? ' AT +' + S.horizon + ' MIN' : ''}</span></div><table class="dt"><tbody>${rows}</tbody></table></div>` +
    `<div class="sect"><div class="sect-h"><span class="eyebrow">RECENT SIGNIFICANT EVENTS</span></div>${recent.length ? recent.map(e => `<div class="ev-row" style="grid-template-columns:62px 1fr;padding:5px 0"><span class="t">${fmtClock(e.clock)}</span><span>${esc(e.text)}</span></div>`).join('') : '<p class="note">No significant events yet.</p>'}</div>` +
    `<div class="privacy"><span>◆</span><span>Aggregated sensing only: counts, flows and queue estimates. No facial recognition, no names or ticket identities, no persistent device identifiers, and no raw footage in the central twin.</span></div>` +
    `<button class="btn wide" data-act="targets">Research targets</button>`;
}
function attendance() { const c = TWIN.m.clock; const fill = sum(GROUPS.map(g => TWIN.m.seat[g.id])) / CATCH; const ph = phaseAt(c); return Math.round(CAPACITY * ATTEND * clamp(ph === 'pregame' ? fill / ATTEND + 0.04 : ph === 'post' ? fill / ATTEND : 1, 0, 1)); }
function panelZone(j) {
  const z = ZONES[j], d = zoneData(j), l = densLevel(d.k);
  const p2 = TWIN.predicted(j, 2), p5 = TWIN.predicted(j, 5);
  const unc = TWIN.fc ? TWIN.fc.unc(5)[j] : 0;
  let q = 0, wait = 0; for (const k in AMEN) if (zoneIdxAt(ATT[k].x) === j) { q += TWIN.aest[k].Q; wait = Math.max(wait, TWIN.m.amenWait(k)); }
  for (const g in GATES) if (zoneIdxAt(ATT[GATES[g].att].x) === j && TWIN.m.g[g].xq > 0) q += TWIN.m.g[g].xq;
  const src = d.src || {};
  const ne = TWIN.nextETA();
  return head('ZONE', z.id, chip(l), true) +
    (d.replay ? `<p class="note" style="margin-top:0">Replay frame ${fmtClock(REC.frame.clock)}</p>` : '') +
    kv([
      ['Operational Status', `<b style="color:${l.hex}">${l.label}</b>`], ['Estimated Occupancy', fmtInt(d.N), 'big'], ['Density', `${fmt1(d.k)} people/m²`, 'big'],
      ['Flow In', `${fmtInt(d.fin)} people/min`], ['Flow Out', `${fmtInt(d.fout)} people/min`], ['Average Speed', `${fmt2(d.v)} m/s`],
      ['Dominant Flow', d.dir], ['Queue Length', fmtInt(q)], ['Estimated Wait', q > 0 ? `${fmt1(wait / 60)} min` : '0.0 min'], ['Fusion Confidence', fmt2(d.conf)],
      ['Effective walkable area', `${z.area} m² (illustrative)`]
    ]) +
    `<div class="sect"><div class="sect-h"><span class="eyebrow">FORECAST</span><span class="mono dim" style="font-size:10.5px">model run from the estimated state</span></div>` +
    kv([['Forecast +2 min', `${fmt1(p2)} people/m²`], ['Forecast +5 min', `${fmt1(p5)} ± ${fmt1(unc)} people/m²`], ['Risk at +5 min', `<b style="color:${densLevel(p5).hex}">${densLevel(p5).label}</b>`], ['Time to 3.5 p/m²', ne && ne.zone === j ? (ne.eta > 0 ? fmtMS(ne.eta) : 'reached') : (TWIN.fc && TWIN.fc.tt[j] < Infinity ? fmtMS(Math.max(0, TWIN.fc.tt[j] - (TWIN.m.clock - TWIN.fc.t0))) : 'not within 5 min')]]) +
    `<canvas class="minichart" data-chart="zone" data-j="${j}" width="640" height="184"></canvas></div>` +
    acts([['viewForecast', 'View forecast'], ['simDiversion', 'Simulate diversion'], ['altRoute', 'Find alternate route'], ['viewHistory', 'View history']]) +
    (d.replay ? '' : `<div class="sect"><div class="sect-h"><span class="eyebrow">SENSOR FUSION</span></div>${kv([['CCTV weight', src.cctv !== undefined ? fmt2(src.cctv) : 'disabled'], ['WiFi weight', src.wifi !== undefined ? fmt2(src.wifi) : 'disabled'], ['Flow-model weight', fmt2(src.model || 0)], ['Estimate error vs simulator truth', `${d.err >= 0 ? '+' : '−'}${fmt1(Math.abs(d.err * 100))}% (demo only)`]])}</div>`) +
    synthNote();
}
function panelCell(i) {
  const c = W3.heat.cells[i], j = c.zone, d = zoneData(j);
  const local = c.v;
  const kc = clamp(d.k * (0.8 + Math.min(0.45, (W3.heat.kde[i] || 0) * 0.12)), 0, 5.4);
  return head('CROWD-DENSITY CELL', `${ZONES[j].short} · C${String(i).padStart(3, '0')}`, chip(densLevel(kc)), true) +
    kv([['Cell size', '1.1 m × 1.1 m'], ['Estimated cell density', `${fmt1(kc)} people/m²`], ['Parent zone', ZONES[j].id], ['Zone density', `${fmt1(d.k)} people/m²`], ['Overlay metric', $('ovMetric').selectedOptions[0].textContent], ['Colour value', fmt2(local)]]) +
    `<p class="note">Cell values spread the fused zone estimate across the floor using where the rendered agents are. They are an illustration of local variation, not an independent measurement.</p>` +
    `<button class="btn wide" data-sel='${JSON.stringify({ type: 'zone', idx: j })}'>Open zone ${ZONES[j].id}</button>` + synthNote();
}
function gateCap(k) { return GATES[k].lanes * LANE_RATE * TWIN.cfg.gateCapMul; }
function panelGate(k, ts) {
  const G0 = GATES[k], g = TWIN.gest[k], m = TWIN.m.g[k], open = TWIN.cfg.gateOpen[k];
  const egr = !!TWIN.m.egress;
  const dir = egr ? (m.xout > 1 ? 'OUTBOUND' : 'IDLE') : (m.e > 1 ? 'INBOUND' : 'IDLE');
  const wait = open && gateCap(k) > 0 ? g.Q / gateCap(k) : 0;
  const thr = egr ? m.xout : g.thr;
  const sensor = S.sources.turnstile ? 'ONLINE' : 'DISABLED (estimated)';
  return head(ts ? 'TURNSTILE BANK' : 'GATE', ts ? `${G0.label.toUpperCase()} TURNSTILES` : G0.label.toUpperCase(), `<span class="chip ${open ? 'ok' : 'high'}">${open ? 'OPEN' : 'CLOSED'}</span>`) +
    kv([
      ['Status', open ? 'OPEN (simulated)' : 'CLOSED (simulated)'], ['Estimated Queue', `${fmtInt(g.Q)} people`, 'big'], ['Current Throughput', `${fmtInt(thr)} people/min`, 'big'],
      ['Average Wait', `${fmt1(wait)} min`], ['Movement Direction', dir], ['Sensor Status', sensor], ['Lanes', `${G0.lanes} screened lanes · ${fmtInt(gateCap(k))} people/min max`],
      ['Exit opening', `${G0.w} m · ${fmtInt(EXIT_CAP[G0.att])} people/min max`], ['Estimate confidence', fmt2(g.conf)], ['Zone', ZONES[zoneIdxAt(ATT[G0.att].x)].id]
    ]) +
    `<div class="sect"><div class="sect-h"><span class="eyebrow">FLOW HISTORY</span><span class="mono dim" style="font-size:10.5px">entries and queue, last 10 min</span></div><canvas class="minichart" data-chart="gate" data-k="${k}" width="640" height="184"></canvas></div>` +
    acts([['simClose:' + k, 'Simulate closure'], [k === 'D' ? 'simOpen' : open ? 'simOpen' : 'reopen:' + k, k === 'D' || open ? 'Simulate opening' : 'Reopen (sim)'], ['flowHistory:' + k, 'View flow history'], ['routes:' + k, 'Show connected routes']]) +
    `<p class="note">Gate controls act on the simulated venue only and do not connect to real infrastructure. Turnstile counts carry no ticket-holder identity.</p>` + synthNote();
}
function panelAmen(k) {
  const A = AMEN[k], ae = TWIN.aest[k], open = TWIN.cfg.amenOpen[k];
  const mu = (A.servers + TWIN.cfg.extraServers[k]) * A.rate, wait = ae.Q / mu * 60;
  const type = A.type === 'food' ? 'food' : 'restroom';
  const res = planRoute(OPS.startNode(), type, { access: S.nav.access });
  const me = res.rows.find(r => r.c.id === k);
  const best = res.aware;
  const alts = res.rows.filter(r => r.ok).sort((a, b) => a.total - b.total).map(r => {
    const isBest = best && r.c.id === best.c.id;
    const closer = r.distShort < (me ? me.distShort : Infinity) ? 'Closer' : 'Farther';
    const qd = r.wait < (me ? me.wait : 0) ? 'shorter queue' : r.wait > (me ? me.wait : 0) ? 'longer queue' : 'similar queue';
    return `<div class="alt ${isBest ? 'best' : ''}"><span class="an">${r.c.label}</span><span class="at">${fmtDur(r.total)}</span><span class="ad">${r.c.id === k ? 'This facility' : `${closer}, ${qd}`} · walk ${fmtDur(r.walk)} + queue ${fmtDur(r.wait)} · ${Math.round(r.dist)} m${isBest ? ' · <b style="color:#B9D8C1">fastest estimated option</b>' : ''}</span></div>`;
  }).join('');
  return head(A.type === 'food' ? 'CONCESSION' : 'RESTROOM', A.label.toUpperCase(), `<span class="chip ${open ? 'ok' : 'high'}">${open ? 'AVAILABLE' : 'CLOSED'}</span>`) +
    kv([
      ['Status', open ? 'AVAILABLE' : 'CLOSED'], ['Estimated Queue', `${fmtInt(ae.Q)} people`, 'big'],
      ['Walking Time', me ? fmtDur(me.walk) : 'n/a'], ['Estimated Queue Delay', fmtDur(wait)], ['Combined Estimated Time', me ? `<b>${fmtDur(me.walk + wait)}</b>` : 'n/a', 'big'],
      ['Service rate', `${fmt1(mu)} people/min (${A.servers + TWIN.cfg.extraServers[k]} ${A.type === 'food' ? 'windows' : 'fixtures'})`], ['Served now', `${fmt1(ae.served)} people/min`], ['Queue area before spillover', `${A.qcap} people`]
    ]) +
    `<p class="note" style="margin-top:6px">Walking times from ${esc(OPS.startLabel())}. Change the start in NAVIGATE.</p>` +
    `<div class="sect"><div class="sect-h"><span class="eyebrow">ALTERNATIVES · WALK + QUEUE</span></div><div class="alt-list">${alts}</div></div>` +
    acts([['navTo:' + type, 'Route here'], ['halftime', 'Simulate halftime rush']]) + synthNote();
}
function panelAsset(id) {
  const cfg = TWIN.cfg, m = TWIN.m;
  if (id === 'MED') {
    return head('LANDMARK 11', 'FIRST-AID STATION', '<span class="chip ok">STAFFED (SIM)</span>') +
      kv([['Responder teams (simulated)', '2 available'], ['Access', 'Concourse front and staff service corridor'], ['Zone', ZONES[zoneIdxAt(ATT.MED.x)].id], ['Nearest stair-free route', 'Concourse and service corridor']]) +
      acts([['responder', 'Responder routing'], ['medical', 'Simulate medical response']]) +
      `<p class="note">Emergency visualisation is for research and demonstration. It is not authorised emergency routing.</p>` + synthNote();
  }
  const o = OUTLETS[id];
  const open = cfg.outletOpen[id] !== false;
  const flow = m.flowTo(id) + m.flowFrom(id);
  const zj = zoneIdxAt(ATT[id].x);
  const title = id === 'POR_104' ? 'SECTION 104/105 ACCESS CORRIDOR' : ATT[id].label.toUpperCase();
  const util = o ? flow / o.cap : 0;
  const extra = id === 'ELEV_A' ? [['Service', open ? 'IN SERVICE' : 'OUT OF SERVICE (simulated)']] : [];
  const list = [['Status', open ? 'OPEN' : 'CLOSED (simulated)'], ...extra, ['Current flow (both directions)', `${fmtInt(flow)} people/min`, 'big'], ['Capacity', `${fmtInt(o.cap)} people/min`], ['Utilisation', `${Math.round(util * 100)}%`], ['Step-free', id === 'ELEV_A' || id === 'RAMP' || id.startsWith('POR') ? 'Yes' : 'No'], ['Zone', `${ZONES[zj].id} · ${fmt1(TWIN.est[zj].k)} p/m²`]];
  const a = [];
  if (id.startsWith('STAIR')) a.push(['simStair:' + id, 'Simulate closure']);
  if (id === 'ELEV_A') a.push(['elevToggle', open ? 'Simulate outage' : 'Restore service']);
  if (id.startsWith('POR')) a.push(['navSeatFrom:' + id, 'Route to seats']);
  a.push(['altRoute', 'Find alternate route']);
  return head(id.startsWith('STAIR') ? 'MAIN STAIR CLUSTER' : id.startsWith('POR') ? 'SEATING ACCESS' : 'ACCESSIBILITY', title, `<span class="chip ${open ? 'ok' : 'high'}">${open ? 'OPEN' : 'CLOSED'}</span>`) + kv(list) + acts(a) + synthNote();
}
function panelLandmark(id) {
  const m = TWIN.m;
  if (id === 'MAIN') {
    const arr = sum(Object.values(m.g).map(g => g.arr)), q = sum(Object.values(TWIN.gest).map(g => g.Q)), thr = sum(Object.values(m.g).map(g => g.e));
    return head('LANDMARK 01', 'MAIN STADIUM ENTRANCE', '<span class="chip">PLAZA</span>') +
      kv([['Arrivals at pilot gates', `${fmtInt(arr)} people/min`, 'big'], ['People queuing at gates (est.)', fmtInt(q)], ['Entries through gates', `${fmtInt(thr)} people/min`], ['Gates open', Object.keys(GATES).filter(k => TWIN.cfg.gateOpen[k]).map(k => GATES[k].label).join(', ')]]) +
      `<p class="note">The arch and gate names are illustrative spatial IDs for the demo, not verified venue locations.</p>` +
      acts([['area:gates', 'Gate operations view'], ['navTo:exit', 'Routes to exits']]) + synthNote();
  }
  if (id === 'OPS') {
    const ing = (S.sources.cctv ? CAMERAS.length * 1 : 0) + (S.sources.wifi ? WIFI.length / 30 : 0) + (S.sources.turnstile ? 4 : 0);
    return head('LANDMARK 12', 'STADIUM OPERATIONS CENTER', '<span class="chip ok">ONLINE (SIM)</span>') +
      kv([['Messages ingested', `${fmt1(ing)} per second`], ['Fusion cycle', '1 s'], ['Anomaly checks', 'every 2 s'], ['Forecast refresh', 'every 5 s · 2 and 5 min horizons'], ['Mean fusion confidence', fmt2(TWIN.meanConf())], ['Audit entries', fmtInt(EVENTS.filter(e => e.cat === 'operator' || e.cat === 'route' || e.cat === 'sim').length)]]) +
      `<div class="sect"><div class="sect-h"><span class="eyebrow">DATA SOURCES</span></div>${['cctv', 'wifi', 'turnstile'].map(k => `<div class="src-row"><span><span class="statusdot" style="background:${S.sources[k] ? HEX.ok : HEX.crit}"></span><span class="nm">${SRC_INFO[k].label}</span></span><span class="meta">${S.sources[k] ? 'ONLINE' : 'DISABLED'} · ${SRC_INFO[k].latency} s</span></div>`).join('')}</div>` +
      `<div class="privacy"><span>◆</span><span>Raw CCTV footage stays on edge nodes and does not enter the twin. WiFi telemetry arrives as per-access-point counts. No facial recognition, names, ticket identities or persistent device identifiers.</span></div>` +
      acts([['targets', 'Research targets'], ['process', 'Open pipeline']]) + synthNote();
  }
  if (id === 'CENTRAL') {
    const tot = sum(TWIN.est.map(e => e.N)), mean = tot / sum(ZONES.map(z => z.area));
    let hi = 0; TWIN.est.forEach((e, j) => { if (e.k > TWIN.est[hi].k) hi = j; });
    return head('LANDMARK 05', 'CENTRAL CONCOURSE', '<span class="chip warn">ACTIVE PILOT ZONE</span>') +
      kv([['Zones', `${ZONES[0].id} to ${ZONES[L.nz - 1].id}`], ['Estimated occupancy', fmtInt(tot), 'big'], ['Mean density', `${fmt2(mean)} people/m²`], ['Highest zone', `${ZONES[hi].id} · ${fmt1(TWIN.est[hi].k)} p/m²`], ['Corridor width', '7 m (illustrative)'], ['Open alerts', String(TWIN.alerts.size)]]) +
      `<p class="note">The pilot concourse is modelled in detail; the rest of the stadium is an illustrative overview at a lower level of detail. The layout is procedurally generated and not derived from BIM or as-built data.</p>` +
      `<div class="sect">${ZONES.map((z, j) => `<button class="btn sm" style="margin:2px" data-sel='${JSON.stringify({ type: 'zone', idx: j })}'>${z.short}</button>`).join('')}</div>` + synthNote();
  }
  if (id === 'STAIRS') {
    const r = s => { const f = TWIN.m.flowTo(s) + TWIN.m.flowFrom(s); return `${TWIN.cfg.outletOpen[s] ? 'OPEN' : 'CLOSED'} · ${fmtInt(f)} people/min of ${OUTLETS[s].cap}`; };
    return head('LANDMARK 09', 'MAIN STAIR CLUSTER', '') + kv([['Stair 1', r('STAIR_1')], ['Stair 2', r('STAIR_2')], ['Serves', 'Upper West sections 201–209'], ['Step-free alternative', 'Elevator A and accessible ramp']]) +
      acts([['simStair:STAIR_2', 'Simulate Stair 2 closure'], ['simStair:STAIR_1', 'Simulate Stair 1 closure']]) + `<button class="btn wide" data-sel='${JSON.stringify({ type: 'asset', id: 'STAIR_1' })}'>Stair 1 details</button><button class="btn wide" data-sel='${JSON.stringify({ type: 'asset', id: 'STAIR_2' })}'>Stair 2 details</button>` + synthNote();
  }
  return panelDefault();
}
function panelCamera(id) {
  const c = CAMERAS.find(c => c.id === id), on = S.sources.cctv;
  const zs = c.zones.map(j => ZONES[j].id).join(', ') || 'Gate B queue area';
  const count = c.zones.length ? sum(c.zones.map(j => TWIN.est[j].N)) : TWIN.gest.B.Q;
  const tracks = AG.list.filter(a => c.zones.includes(a.z <= -91 && a.z >= -98 ? zoneIdxAt(a.x) : -1)).length;
  return head('CCTV ANALYTICS NODE', id, `<span class="chip ${on ? 'ok' : 'high'}">${on ? 'ONLINE' : 'DISABLED'}</span>`, true) +
    kv([['Coverage', zs], ['Person count (estimate)', on ? fmtInt(count) : 'n/a'], ['Flow estimate', on && c.zones.length ? `${fmtInt(sum(c.zones.map(j => TWIN.est[j].fin)))} people/min` : 'n/a'], ['Movement direction', on && c.zones.length ? TWIN.est[c.zones[0]].dir : 'n/a'], ['Queue estimate', on ? (c.gate ? `${fmtInt(TWIN.gest.B.Q)} at Gate B` : 'computed for adjacent counters') : 'n/a'], ['Anonymous short-lived tracks', on ? `${tracks} (expire after 30 s)` : 'n/a'], ['Latency to twin', `${SRC_INFO.cctv.latency} s`]]) +
    `<div class="privacy"><span>◆</span><span>Video is processed on the edge node. Only counts, directions, flows, queue estimates and anonymous tracks that expire within 30 s leave the camera. No facial recognition.</span></div>` +
    acts([['src:cctv', on ? 'Disable CCTV source' : 'Enable CCTV source'], ['process', 'Open fusion step']]) + synthNote();
}
function panelWifi(id) {
  const a = WIFI.find(a => a.id === id), on = S.sources.wifi;
  const N = sum(a.zones.map(j => TWIN.m.z[j].N)), dev = N * TWIN.ratio;
  const h = TWIN.hist[a.zones[0]], prev = h.length > 60 ? h[h.length - 61][2] + (TWIN.hist[a.zones[1]][TWIN.hist[a.zones[1]].length - 61] || [0, 0, 0])[2] : N;
  return head('WIFI AGGREGATE ZONE', id, `<span class="chip ${on ? 'violet' : 'high'}">${on ? 'ONLINE' : 'DISABLED'}</span>`, true) +
    kv([['Zones covered', a.zones.map(j => ZONES[j].short).join(', ')], ['Aggregate device activity', on ? `${fmtInt(dev)} devices (30 s window)` : 'n/a'], ['Zone concentration proxy', on ? fmt2(dev / sum(a.zones.map(j => ZONES[j].area))) + ' devices/m²' : 'n/a'], ['Change over last minute', on ? `${N - prev >= 0 ? '+' : '−'}${fmtInt(Math.abs(N - prev) * TWIN.ratio)}` : 'n/a'], ['Latency to twin', `${SRC_INFO.wifi.latency} s`]]) +
    `<p class="note">WiFi activity is not a person count. The ratio of devices to people drifts during the event (now about ${fmt2(TWIN.ratio)} in the simulation; the fusion assumes 0.55), which is why this source can add bias as well as information.</p>` +
    `<div class="privacy"><span>◆</span><span>Counts per access point only. Device identifiers are not stored or forwarded.</span></div>` +
    acts([['src:wifi', on ? 'Disable WiFi source' : 'Enable WiFi source'], ['process', 'Open fusion step']]) + synthNote();
}
function panelSection(sel) {
  const gid = seatGroup(sel.tier, sel.sec);
  const gr = gid ? GROUPS.find(g => g.id === gid) : null;
  const fill = gr ? TWIN.m.seat[gid] / gr.cap : attendance() / CAPACITY;
  return head('SEATING SECTION', `SECTION ${sel.sec}`, `<span class="chip">${sel.tier.toUpperCase()} TIER</span>`) +
    kv([['Seating group', gr ? gr.label : 'Outside the pilot catchment'], ['Simulated occupancy', `${Math.round(fill * 100)}%`], ['Access', gr ? gr.outlets.map(o => OUTLETS[o].label).join(', ') : 'Other concourse (low detail)']]) +
    `<p class="note">Section numbers are illustrative spatial IDs for the demo.</p>` +
    (gr ? acts([['routeFromSec:' + sel.sec, 'Route from here'], ['seatDest:' + gid, 'Route to this section']]) : '') + synthNote();
}
function panelQR(id) {
  const q = QR.find(q => q.id === id);
  return head('QR MAP MARKER', id, '<span class="chip violet">YOU ARE HERE</span>', true) + kv([['Location', q.label.split('· ')[1]], ['Use', 'Start point for the simulated route planner']]) +
    `<p class="note">A spectator would scan the marker to set a starting point. The demo uses no device identifiers.</p>` + acts([['startHere:' + id, 'Set as route start']]) + synthNote();
}
function panelAgent(id) {
  const a = AG.list.find(a => a.id === id);
  if (!a) return head('SIMULATED AGENT', 'LEFT THE SCENE', '') + `<p class="note">The agent finished its trip. Agents exist only while visible.</p>`;
  const zi = a.z <= -91 && a.z >= -98 ? zoneIdxAt(a.x) : -1;
  const dstLbl = a.dst ? (ATT[a.dst] ? ATT[a.dst].label : a.dst.startsWith('Q:') ? `${GATES[a.dst.slice(2)].label} queue` : a.dst) : 'n/a';
  const following = S.follow === id;
  return head('SIMULATED AGENT', 'ANONYMOUS', `<span class="chip ${a.kind === 'resp' ? 'high' : 'violet'}">${a.kind === 'resp' ? 'RESPONDER' : 'SPECTATOR'}</span>`) +
    kv([['Session-only ID', a.id], ['Heading to', dstLbl], ['Walking speed', `${fmt2(Math.hypot(a.vx, a.vz))} m/s`], ['Current zone', zi >= 0 ? ZONES[zi].id : 'outside the corridor'], ['Step-free trip', a.access ? 'Yes' : 'No']]) +
    `<p class="note">Each rendered agent stands for about ${AGENT_SCALE} simulated people. Agents have no identity; the ID is random and is discarded when the agent leaves.</p>` +
    acts([['follow', following ? 'Stop following' : 'Follow this agent']]) + synthNote();
}
function panelOuter(id) {
  const z = W3.ring.zones.find(z => z && z.id === id);
  return head('OUTSIDE PILOT ZONE', id, chip(densLevel(z.dk)), true) + kv([['Illustrative density', `${fmt1(z.dk)} people/m²`], ['Level of detail', 'Low (overview only)'], ['Sensors', 'Not part of the pilot']]) +
    `<p class="note">The proposal starts with one concourse zone and expands later. Values outside the pilot are illustrative and not modelled in detail.</p>`;
}

/* small charts in the detail panel */
/* value shown for a zone: replay frame, forecast at the chosen horizon, or the current estimate */
function zoneShown(j) {
  if (S.mode === 'predict' && S.horizon && TWIN.fc) { const u = TWIN.fc.unc(S.horizon)[j]; return { k: TWIN.predicted(j, S.horizon), u, fc: true }; }
  return { k: zoneData(j).k, u: 0, fc: false };
}
function drawPanelChart(cv) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height, type = cv.dataset.chart;
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const X0 = pad.l, X1 = w - pad.r, Y0 = h - pad.b, Y1 = pad.t;
  ctx.font = '20px "JetBrains Mono", monospace'; ctx.fillStyle = '#A99DB4'; ctx.strokeStyle = 'rgba(248,241,231,0.08)'; ctx.lineWidth = 1;
  if (type === 'zones') {
    const max = 5; const bw = (X1 - X0) / L.nz;
    for (const v of [0, 1.5, 2.5, 3.5, 5]) { const y = Y0 - v / max * (Y0 - Y1); ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(X1, y); ctx.stroke(); ctx.fillText(v.toFixed(1), 0, y + 6); }
    ZONES.forEach((z, j) => {
      const d = zoneShown(j), l = densLevel(d.k); const bh = Math.min(max, d.k) / max * (Y0 - Y1);
      ctx.fillStyle = l.hex; ctx.globalAlpha = d.fc ? 0.75 : 1; ctx.fillRect(X0 + j * bw + 6, Y0 - bh, bw - 12, bh); ctx.globalAlpha = 1;
      if (d.fc) { const cx = X0 + j * bw + bw / 2, ya = Y0 - Math.min(max, d.k + d.u) / max * (Y0 - Y1), yb = Y0 - Math.max(0, d.k - d.u) / max * (Y0 - Y1); ctx.strokeStyle = '#F8F1E7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, ya); ctx.lineTo(cx, yb); ctx.moveTo(cx - 7, ya); ctx.lineTo(cx + 7, ya); ctx.moveTo(cx - 7, yb); ctx.lineTo(cx + 7, yb); ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(248,241,231,0.08)'; }
      ctx.fillStyle = '#A99DB4'; ctx.fillText(z.short.slice(2), X0 + j * bw + bw / 2 - 18, h - 2);
    });
    return;
  }
  if (type === 'zone') {
    const j = +cv.dataset.j, hist = TWIN.hist[j].slice(-240), fc = TWIN.fc;
    const pastSpan = 480, futSpan = 300, span = pastSpan + futSpan, now = TWIN.m.clock;
    const tx = t => X0 + (t - (now - pastSpan)) / span * (X1 - X0);
    const max = 5.2, ty = v => Y0 - clamp(v, 0, max) / max * (Y0 - Y1);
    for (const v of [1.5, 2.5, 3.5]) { ctx.beginPath(); ctx.moveTo(X0, ty(v)); ctx.lineTo(X1, ty(v)); ctx.stroke(); ctx.fillText(v.toFixed(1), 0, ty(v) + 6); }
    ctx.strokeStyle = 'rgba(216,78,104,0.6)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(X0, ty(BOTTLENECK_K)); ctx.lineTo(X1, ty(BOTTLENECK_K)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(248,241,231,0.35)'; ctx.beginPath(); ctx.moveTo(tx(now), Y1); ctx.lineTo(tx(now), Y0); ctx.stroke();
    if (hist.length > 1) { ctx.strokeStyle = '#FFB547'; ctx.lineWidth = 3; ctx.beginPath(); hist.forEach((p, i) => i ? ctx.lineTo(tx(p[0]), ty(p[1])) : ctx.moveTo(tx(p[0]), ty(p[1]))); ctx.stroke(); }
    if (fc) {
      const s = fc.series[j], e = TWIN.est[j], t0 = now;
      ctx.fillStyle = 'rgba(150,120,200,0.22)'; ctx.beginPath();
      s.forEach((v, i) => { const t = t0 + i * 20, u = Math.sqrt((e.sig / e.A) ** 2 + (v * 0.05 * (i * 20 / 60)) ** 2) * (1.6 - e.conf); const y = ty(v + u); i ? ctx.lineTo(tx(t), y) : ctx.moveTo(tx(t), y); });
      for (let i = s.length - 1; i >= 0; i--) { const v = s[i], t = t0 + i * 20, u = Math.sqrt((e.sig / e.A) ** 2 + (v * 0.05 * (i * 20 / 60)) ** 2) * (1.6 - e.conf); ctx.lineTo(tx(t), ty(Math.max(0, v - u))); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9678C8'; ctx.lineWidth = 3; ctx.setLineDash([10, 6]); ctx.beginPath(); s.forEach((v, i) => { const t = t0 + i * 20; i ? ctx.lineTo(tx(t), ty(v)) : ctx.moveTo(tx(t), ty(v)); }); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = '#A99DB4'; ctx.fillText('−8 min', X0, h - 2); ctx.fillText('now', tx(now) - 18, h - 2); ctx.fillText('+5 min', X1 - 70, h - 2);
    return;
  }
  if (type === 'gate') {
    const k = cv.dataset.k, hist = REC.gateHist(k);
    if (hist.length < 2) { ctx.fillText('Collecting history…', X0, h / 2); return; }
    const maxE = Math.max(20, ...hist.map(p => p[1])), maxQ = Math.max(50, ...hist.map(p => p[2]));
    const tx = i => X0 + i / (hist.length - 1) * (X1 - X0);
    ctx.strokeStyle = '#91B49A'; ctx.lineWidth = 3; ctx.beginPath(); hist.forEach((p, i) => { const y = Y0 - p[1] / maxE * (Y0 - Y1); i ? ctx.lineTo(tx(i), y) : ctx.moveTo(tx(i), y); }); ctx.stroke();
    ctx.strokeStyle = '#FFB547'; ctx.beginPath(); hist.forEach((p, i) => { const y = Y0 - p[2] / maxQ * (Y0 - Y1); i ? ctx.lineTo(tx(i), y) : ctx.moveTo(tx(i), y); }); ctx.stroke();
    ctx.fillStyle = '#91B49A'; ctx.fillText(`entries/min (max ${Math.round(maxE)})`, X0, Y1 + 12); ctx.fillStyle = '#FFB547'; ctx.fillText(`queue (max ${Math.round(maxQ)})`, X0 + 330, Y1 + 12);
  }
}

/* ---------------- panel actions ---------------- */
function doAction(act, btn) {
  const [a, arg] = act.split(':');
  switch (a) {
    case 'viewForecast': setMode('predict'); setHorizon(5); if (S.sel && S.sel.type === 'zone') focusAnchor(selectionAnchor(S.sel)); break;
    case 'simDiversion': { const z = S.sel && S.sel.type === 'zone' ? ZONES[S.sel.idx].id : S.focusZone; setMode('simulate'); OPS.pickScenario(phaseAt(TWIN.m.clock) === 'half' ? 'halftime' : 'redirect', { zone: z }); break; }
    case 'altRoute': { setMode('navigate'); const j = S.sel && S.sel.type === 'zone' ? S.sel.idx : focusIdx(); S.nav.start = 'Z:' + j; OPS.syncPlanner(); OPS.setDest('exit'); break; }
    case 'viewHistory': setMode('replay'); REC.seek(Math.max(REC.min(), REC.max() - 300)); break;
    case 'simClose': setMode('simulate'); OPS.pickScenario('gate_close', { gate: arg }); break;
    case 'simOpen': setMode('simulate'); OPS.pickScenario('gate_open'); break;
    case 'reopen': TWIN.cfg.gateOpen[arg] = true; logEvent('operator', `${GATES[arg].label} reopened in the simulated venue`, { interv: true }); renderPanel(true); break;
    case 'flowHistory': { const cv = $('rightBody').querySelector('canvas[data-chart="gate"]'); if (cv) cv.scrollIntoView({ behavior: 'smooth', block: 'center' }); break; }
    case 'routes': OPS.showGateRoutes(arg); break;
    case 'navTo': setMode('navigate'); OPS.setDest(arg); break;
    case 'halftime': setMode('simulate'); OPS.pickScenario('halftime'); break;
    case 'responder': setMode('navigate'); OPS.setRole('responder'); break;
    case 'medical': setMode('simulate'); OPS.pickScenario('medical', { zone: S.responder.incidentZone }); break;
    case 'simStair': setMode('simulate'); OPS.pickScenario('stair_close', { stair: arg }); break;
    case 'elevToggle': TWIN.cfg.outletOpen.ELEV_A = !TWIN.cfg.outletOpen.ELEV_A; TWIN.m._os = null; AG.pathCache.clear(); logEvent('operator', `Elevator A ${TWIN.cfg.outletOpen.ELEV_A ? 'returned to service' : 'set out of service'} (simulated)`, { interv: true }); renderPanel(true); if (S.mode === 'navigate') OPS.planRoute(true); break;
    case 'navSeatFrom': setMode('navigate'); OPS.setDest('seat'); break;
    case 'area': goArea(arg); break;
    case 'targets': showTargets(); break;
    case 'process': openStep(arg ? +arg : 1); if (window.matchMedia('(max-width:760px)').matches) setSheet('process'); break;
    case 'src': toggleSource(arg); break;
    case 'routeFromSec': setMode('navigate'); S.nav.start = 'SEC:' + arg; OPS.ensureStartOption(+arg); OPS.syncPlanner(); OPS.planRoute(true); break;
    case 'seatDest': setMode('navigate'); S.nav.seat = arg; OPS.setDest('seat'); break;
    case 'startHere': setMode('navigate'); S.nav.start = 'QR:' + arg; OPS.syncPlanner(); OPS.planRoute(true); break;
    case 'follow': S.follow = S.follow ? null : S.sel.id; if (S.follow) logEvent('operator', 'Camera follow started on an anonymous simulated agent'); renderPanel(true); break;
  }
}
function toggleSource(k) {
  S.sources[k] = !S.sources[k];
  const before = TWIN.meanConf();
  logEvent('operator', `${SRC_INFO[k].label} ${S.sources[k] ? 'enabled' : 'disabled'} (synthetic source)`, { interv: true });
  setTimeout(() => logEvent('system', `Fusion confidence ${fmt2(before)} → ${fmt2(TWIN.meanConf())} after ${SRC_INFO[k].short} ${S.sources[k] ? 'enabled' : 'disabled'}`), 4000);
  renderPanel(true); renderProcess(true);
}

/* ---------------- pipeline tracker ---------------- */
const STEPS = [
  { t: 'SENSOR INGEST', v: () => `${S.sources.cctv + S.sources.wifi + S.sources.turnstile}/3 sources` },
  { t: 'SPATIAL FUSION', v: () => `conf ${fmt2(TWIN.meanConf())}` },
  { t: 'CROWD STATE', v: () => `${fmtInt(sum(TWIN.est.map(e => e.N)))} in pilot` },
  { t: 'ANOMALY + FORECAST', v: () => { const n = TWIN.nextETA(); return `${TWIN.alerts.size} alerts${n ? ' · ' + (n.eta > 0 ? fmtMS(n.eta) : 'now') : ''}`; } },
  { t: 'SIMULATION + ROUTING', v: () => S.scenario && S.scenario.run ? 'scenario running' : S.nav.result ? 'route ready' : 'ready' },
  { t: 'OPERATOR ACTION + AUDIT', v: () => `${EVENTS.filter(e => e.cat === 'operator' || e.cat === 'route' || e.cat === 'sim').length} entries` }
];
function initProcess() {
  const ol = $('steps');
  STEPS.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" aria-expanded="false"><span class="sn">0${i + 1}</span><span class="st">${s.t}</span><span class="sv" id="sv${i}"></span></button>` + (i < STEPS.length - 1 ? '<div class="flow"><i></i></div>' : '');
    li.querySelector('button').addEventListener('click', () => openStep(i + 1));
    ol.appendChild(li);
  });
}
function openStep(n) {
  const d = $('stepDetail');
  if (UI.openStep === n && !d.hidden) { d.hidden = true; UI.openStep = null; document.querySelectorAll('#steps button').forEach(b => b.setAttribute('aria-expanded', 'false')); return; }
  UI.openStep = n; d.hidden = false;
  document.querySelectorAll('#steps button').forEach((b, i) => b.setAttribute('aria-expanded', String(i + 1 === n)));
  renderStepDetail();
}
function renderStepDetail() {
  const n = UI.openStep, d = $('stepDetail'); if (!n || d.hidden) return;
  const html = {
    1: `<b>Multi-source ingestion.</b> CCTV analytics (counts, direction, flow, queue estimates, anonymous short-lived tracks), WiFi aggregate telemetry (device activity per access point) and turnstile counts, plus context: stairs and elevator availability, incidents, weather and game phase.` +
      ['cctv', 'wifi', 'turnstile'].map(k => `<div class="src-row"><span><span class="statusdot" style="background:${S.sources[k] ? HEX.ok : HEX.crit}"></span><span class="nm">${SRC_INFO[k].short}</span> <span class="meta">${SRC_INFO[k].latency} s</span></span><label class="sw sm"><input type="checkbox" data-src="${k}" ${S.sources[k] ? 'checked' : ''}><span class="sw-ui"></span><span class="sw-t">${S.sources[k] ? 'ON' : 'OFF'}</span></label></div>`).join('') +
      `<span style="display:block;margin-top:6px">Disable a source to see the fusion confidence and estimates change. Raw footage never enters the central twin.</span>`,
    2: `<b>Spatial alignment and fusion.</b> Observations are normalised to common timestamps, zone IDs, coordinates, confidence scores and units, then fused per zone by inverse-variance weighting with a flow-conservation prediction. Mean confidence now <b>${fmt2(TWIN.meanConf())}</b>. More sources do not guarantee accuracy: WiFi carries a drifting device-to-person ratio and CCTV undercounts in dense crowds.`,
    3: `<b>Crowd state.</b> Each zone holds estimated occupancy, density, flow in and out, dominant direction, mean speed, queue length and confidence, updated every second.`,
    4: `<b>Anomaly rules and forecast.</b> Rules check accumulation, slowdown, queue spillover, counter-flow, stair demand and capacity every 2 s. The forecast runs the same flow model 5 minutes ahead from the estimated state every 5 s, using gate throughput, walking speed, closures, queues and the game schedule. Proposed target: detection within 30 s (not a measured result).`,
    5: `<b>Simulation and routing.</b> What-if runs compare baseline and intervention from one snapshot. Routing uses Dijkstra with cost = α·travel time + β·density + γ·queue delay + δ·closure risk + ε·accessibility + ζ·predicted congestion (α ${W8.alpha}, β ${W8.beta}, γ ${W8.gamma}, δ ${W8.delta} s, ε excludes stairs for step-free trips, ζ ${W8.zeta}).`,
    6: `<b>Operator action and audit.</b> Every simulated operator action, recommendation and scenario run is written to the event log with a timestamp and can be replayed. Recommendations are labelled simulated and subject to operator review.`
  }[n];
  d.innerHTML = html;
  d.querySelectorAll('input[data-src]').forEach(i => i.addEventListener('change', () => toggleSource(i.dataset.src)));
}
function renderProcess(force) {
  const active = S.mode === 'predict' ? 3 : S.mode === 'simulate' || S.mode === 'navigate' ? 4 : S.mode === 'replay' ? 5 : UI.procStep;
  document.querySelectorAll('#steps li').forEach((li, i) => li.classList.toggle('on', i === active));
  STEPS.forEach((s, i) => { const el = $('sv' + i); if (el) el.textContent = s.v(); });
  if (force) renderStepDetail();
}

/* ---------------- tables ---------------- */
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $('evFilters').hidden = t !== 'events';
  renderTable();
}
function setFilter(f) { S.evFilter = f; document.querySelectorAll('#evFilters button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === f))); renderTable(); }
function renderTable() {
  const body = $('dockBody'), st = body.scrollTop;
  if (S.tab === 'zones') {
    const rows = ZONES.map((z, j) => {
      const d = zoneData(j), l = densLevel(d.k), tr = S.mode === 'replay' ? 'n/a' : TWIN.trend(j), risk = S.mode === 'replay' ? l : TWIN.risk(j, 2);
      const cls = tr === 'Rising' ? 'up' : tr === 'Falling' ? 'down' : 'flat';
      const sel = S.sel && ((S.sel.type === 'zone' && S.sel.idx === j));
      return `<tr class="${sel ? 'sel' : ''}" data-zone="${j}"><td class="id">${z.id}</td><td class="num">${fmtInt(d.N)}</td><td class="num">${fmt1(d.k)}</td><td class="num">${fmt2(d.v)}</td><td><span class="trend ${cls}">${tr === 'Rising' ? '▲' : tr === 'Falling' ? '▼' : '■'} ${tr}</span></td><td><span class="risk"><i style="background:${risk.hex}"></i>${risk.label[0] + risk.label.slice(1).toLowerCase()}</span></td><td class="num">${fmt2(d.conf)}</td></tr>`;
    });
    const outer = W3.ring.zones.filter(z => z && (z.id === 'CONC-E-008' || z.id === 'CONC-N-001' || z.id === 'CONC-S-019')).map(z => `<tr data-outer="${z.id}"><td class="id">${z.id}</td><td class="num">${fmtInt(z.dk * 80)}</td><td class="num">${fmt1(z.dk)}</td><td class="num">${fmt2(vk(z.dk))}</td><td><span class="trend flat">■ n/a</span></td><td><span class="risk"><i style="background:${densLevel(z.dk).hex}"></i>${densLevel(z.dk).label[0] + densLevel(z.dk).label.slice(1).toLowerCase()}</span></td><td class="num dim">illustr.</td></tr>`);
    body.innerHTML = `<table class="dt"><thead><tr><th>ZONE ID</th><th class="num">OCCUPANCY</th><th class="num">DENSITY p/m²</th><th class="num">MEAN SPEED m/s</th><th>FORECAST +2 MIN</th><th>RISK</th><th class="num">CONFIDENCE</th></tr></thead><tbody>${rows.join('')}${outer.join('')}</tbody></table>`;
    body.querySelectorAll('tr[data-zone]').forEach(tr => tr.addEventListener('click', () => select({ type: 'zone', idx: +tr.dataset.zone }, { glide: true })));
    body.querySelectorAll('tr[data-outer]').forEach(tr => tr.addEventListener('click', () => select({ type: 'outer', id: tr.dataset.outer }, { glide: true })));
  } else if (S.tab === 'assets') {
    const m = TWIN.m, cfg = TWIN.cfg, egr = !!m.egress;
    const rows = [];
    for (const k of ['A', 'B', 'C', 'D']) { const g = TWIN.gest[k]; rows.push([GATES[k].label, 'Gate', cfg.gateOpen[k] ? 'OPEN' : 'CLOSED', fmtInt(g.Q), `${fmtInt(egr ? m.g[k].xout : g.thr)}/min`, ZONES[zoneIdxAt(ATT[GATES[k].att].x)].short, { type: 'gate', id: k }]); }
    for (const s of ['STAIR_1', 'STAIR_2']) rows.push([OUTLETS[s].label, 'Stair', cfg.outletOpen[s] ? 'OPEN' : 'CLOSED', '0', `${fmtInt(m.flowTo(s) + m.flowFrom(s))}/min`, ZONES[zoneIdxAt(ATT[s].x)].short, { type: 'asset', id: s }]);
    rows.push(['Elevator A', 'Elevator', cfg.outletOpen.ELEV_A ? 'IN SERVICE' : 'OUT OF SERVICE', fmtInt(Math.min(12, (m.flowTo('ELEV_A') + m.flowFrom('ELEV_A')) * 0.6)), `${fmtInt(m.flowTo('ELEV_A') + m.flowFrom('ELEV_A'))}/min`, ZONES[zoneIdxAt(ATT.ELEV_A.x)].short, { type: 'asset', id: 'ELEV_A' }]);
    for (const k of ['REST_A', 'REST_B', 'CONC_A', 'CONC_B']) rows.push([AMEN[k].label, AMEN[k].type === 'food' ? 'Concession' : 'Restroom', cfg.amenOpen[k] ? (TWIN.aest[k].Q > AMEN[k].qcap ? 'SPILLOVER' : 'AVAILABLE') : 'CLOSED', fmtInt(TWIN.aest[k].Q), `${fmt1(TWIN.aest[k].served)}/min`, ZONES[zoneIdxAt(ATT[k].x)].short, { type: 'amen', id: k }]);
    rows.push(['Medical Station', 'First aid', 'STAFFED', '0', '-', ZONES[zoneIdxAt(ATT.MED.x)].short, { type: 'asset', id: 'MED' }]);
    body.innerHTML = `<table class="dt"><thead><tr><th>ASSET</th><th>TYPE</th><th>STATUS</th><th class="num">QUEUE</th><th class="num">THROUGHPUT</th><th>ZONE</th></tr></thead><tbody>${rows.map(r => `<tr data-sel='${JSON.stringify(r[6])}' class="${S.sel && JSON.stringify(S.sel) === JSON.stringify(r[6]) ? 'sel' : ''}"><td class="id">${r[0]}</td><td>${r[1]}</td><td><span class="chip ${/CLOSED|OUT/.test(r[2]) ? 'high' : r[2] === 'SPILLOVER' ? 'elevated' : 'ok'}">${r[2]}</span></td><td class="num">${r[3]}</td><td class="num">${r[4]}</td><td class="mono">${r[5]}</td></tr>`).join('')}</tbody></table>`;
    body.querySelectorAll('tr[data-sel]').forEach(tr => tr.addEventListener('click', () => select(JSON.parse(tr.dataset.sel), { glide: true })));
  } else {
    const f = S.evFilter;
    const list = EVENTS.filter(e => f === 'all' ? e.cat !== 'system' || true : e.cat === f).slice(-160).reverse();
    $('evCount').textContent = `(${EVENTS.length})`;
    const near = S.mode === 'replay' && REC.frame ? REC.frame.clock : null;
    body.innerHTML = list.length ? list.map(e => `<div class="ev-row ${near !== null && Math.abs(e.clock - near) < 6 ? 'near' : ''}" data-ev="${e.id}"><span class="t">${fmtClock(e.clock)}</span><span class="c" style="color:${EVCAT[e.cat].hex}">${EVCAT[e.cat].label}</span><span>${esc(e.text)}</span></div>`).join('') : '<p class="note" style="padding:0 12px">No events in this category yet.</p>';
    body.querySelectorAll('.ev-row').forEach(r => r.addEventListener('click', () => { const ev = EVENTS.find(e => e.id === +r.dataset.ev); if (!ev) return; if (S.mode === 'replay') REC.seek(ev.clock); if (ev.zone !== undefined) select({ type: 'zone', idx: ev.zone }, { glide: true }); }));
    body.scrollTop = st; return;
  }
  body.scrollTop = st;
}

/* ---------------- search ---------------- */
const SEARCH = [];
function initSearch() {
  for (const z of ZONES) SEARCH.push([z.id, 'Concourse zone', { type: 'zone', idx: z.i }, z.short]);
  for (const k in GATES) SEARCH.push([GATES[k].label, 'Gate', { type: 'gate', id: k }, 'gate ' + k]);
  for (const s of ['STAIR_1', 'STAIR_2']) SEARCH.push([OUTLETS[s].label, 'Staircase', { type: 'asset', id: s }]);
  SEARCH.push(['Main stair cluster', 'Landmark', { type: 'landmark', id: 'STAIRS' }]);
  for (const k in AMEN) SEARCH.push([AMEN[k].label, AMEN[k].type === 'food' ? 'Concession' : 'Restroom', { type: 'amen', id: k }]);
  SEARCH.push(['Medical station (first aid)', 'Medical', { type: 'asset', id: 'MED' }, 'first aid medical']);
  SEARCH.push(['Elevator A', 'Accessibility', { type: 'asset', id: 'ELEV_A' }], ['Accessible ramp', 'Accessibility', { type: 'asset', id: 'RAMP' }]);
  SEARCH.push(['Section 104/105 access corridor', 'Portal', { type: 'asset', id: 'POR_104' }], ['Portal 102', 'Portal', { type: 'asset', id: 'POR_102' }], ['Portal 108', 'Portal', { type: 'asset', id: 'POR_108' }]);
  SEARCH.push(['Stadium operations center', 'Landmark', { type: 'landmark', id: 'OPS' }], ['Main stadium entrance', 'Landmark', { type: 'landmark', id: 'MAIN' }], ['Central concourse', 'Landmark', { type: 'landmark', id: 'CENTRAL' }]);
  const secPos = s => { const ranges = [[-66, -44], [-44, -22], [-22, -11], [-11, 0], [0, 11], [11, 22], [22, 33], [33, 44], [44, 66]]; const r = ranges[(s % 100) - 1]; const x = (r[0] + r[1]) / 2; return s > 200 ? { x, y: 26, z: -78 } : { x, y: 8, z: -52 }; };
  for (let s = 101; s <= 109; s++) { const p = secPos(s); SEARCH.push(['Section ' + s, 'Seating section', Object.assign({ type: 'section', sec: s, tier: 'lower' }, p), 'sec ' + s]); }
  for (let s = 201; s <= 209; s++) { const p = secPos(s); SEARCH.push(['Section ' + s, 'Seating section', Object.assign({ type: 'section', sec: s, tier: 'upper' }, p), 'sec ' + s]); }
  for (const c of CAMERAS) SEARCH.push([c.id, 'CCTV analytics', { type: 'camera', id: c.id }]);
  for (const a of WIFI) SEARCH.push([a.id, 'WiFi aggregate zone', { type: 'wifi', id: a.id }]);
  for (const q of QR) SEARCH.push([q.id, 'QR marker', { type: 'qr', id: q.id }, q.label]);
  const inp = $('search'), list = $('searchList');
  let cur = [], idx = 0;
  const show = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); return; }
    cur = SEARCH.filter(s => (s[0] + ' ' + (s[3] || '') + ' ' + s[1]).toLowerCase().includes(q)).slice(0, 9);
    idx = 0;
    list.innerHTML = cur.length ? cur.map((s, i) => `<button role="option" aria-selected="${i === 0}" data-i="${i}"><span>${esc(s[0])}</span><span>${esc(s[1])}</span></button>`).join('') : '<div class="pop-note">No match. Try CONC-W-014, Gate B, Stair 2, Restroom A or Section 104.</div>';
    list.hidden = false; inp.setAttribute('aria-expanded', 'true');
    list.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); go(+b.dataset.i); }));
  };
  const go = i => { const s = cur[i]; if (!s) return; select(s[2], { glide: true }); list.hidden = true; inp.value = s[0]; inp.blur(); logEvent('operator', `Search: ${s[0]}`); };
  inp.addEventListener('input', show);
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = clamp(idx + (e.key === 'ArrowDown' ? 1 : -1), 0, cur.length - 1); list.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === idx))); }
    if (e.key === 'Enter') { e.preventDefault(); go(idx); }
    if (e.key === 'Escape') { list.hidden = true; inp.blur(); }
  });
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
}

/* ---------------- overlays, dock, sheets ---------------- */
function initOverlays() {
  $('ovDensity').addEventListener('change', e => { S.overlay.density = e.target.checked; logEvent('operator', `Density overlay ${S.overlay.density ? 'on' : 'off'}`); });
  $('ovFlow').addEventListener('change', e => { S.overlay.flow = e.target.checked; });
  $('ovSensors').addEventListener('change', e => { S.overlay.sensors = e.target.checked; });
  $('ovLabels').addEventListener('change', e => { S.overlay.labels = e.target.checked; });
  $('ovMetric').addEventListener('change', e => { S.overlay.metric = e.target.value; S.overlay.density = true; $('ovDensity').checked = true; logEvent('operator', `Overlay metric: ${e.target.selectedOptions[0].textContent}`); if (S.sel && S.sel.type === 'cell') renderPanel(true); });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.querySelectorAll('#evFilters button').forEach(b => b.addEventListener('click', () => setFilter(b.dataset.f)));
  document.querySelectorAll('#sheetTabs button').forEach(b => b.addEventListener('click', () => setSheet(b.dataset.sheet)));
  ['kpi1', 'kpi2', 'kpi3'].forEach((id, i) => {
    const f = () => { if (i === 0) select({ type: 'zone', idx: focusIdx() }, { glide: true }); if (i === 1) { const n = TWIN.nextETA(); setMode('predict'); setHorizon(5); if (n) select({ type: 'zone', idx: n.zone }, { glide: true }); } if (i === 2) setMode('simulate'); };
    $(id).addEventListener('click', f); $(id).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f(); } });
  });
  evListeners.push(ev => { if (S.tab === 'events') UI.tableDirty = true; if (ev.cat === 'alert' && !ev.cleared) UI.alertFlash = 1; });
}
function setSheet(s) { document.body.dataset.sheet = s; document.querySelectorAll('#sheetTabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sheet === s))); }

/* ---------------- dialogs ---------------- */
function openModal(title, html) { $('modalTitle').textContent = title; $('modalBody').innerHTML = html; $('modal').hidden = false; $('modalClose').focus(); }
function closeModal() { $('modal').hidden = true; }
function showTargets() {
  openModal('Research targets', `<p>These are the proposal's proposed validation targets. The demonstration does not measure or achieve them; they are shown here so they are not confused with the simulated operational values.</p>
  <table class="tgt-table"><thead><tr><th>Target</th><th>Proposed value</th><th>Status in this demo</th></tr></thead><tbody>
  <tr><td>End-to-end telemetry latency</td><td>under 5 seconds</td><td>Not measured (synthetic sources)</td></tr>
  <tr><td>Density-anomaly detection</td><td>within 30 seconds</td><td>Not measured; demo rules need 6 s of persistence</td></tr>
  <tr><td>Bottleneck forecast horizon</td><td>2 to 5 minutes</td><td>Demo forecasts at +2 and +5 min; accuracy not validated</td></tr>
  <tr><td>Evacuation clearance-time error</td><td>within 10% of comparable observed clearance times</td><td>Not validated; demo clearance times come from a synthetic model</td></tr>
  <tr><td>Geo-referenced pilot alignment</td><td>sub-metre at validated reference points</td><td>Not applicable; the layout is procedurally generated</td></tr>
  </tbody></table>
  <p>Stadium capacity cited by the proposal: ${fmtInt(CAPACITY)}. Displayed attendance is simulated.</p>`);
}
function showAbout() {
  openModal('About this demonstration', `<p><b>STADIUM-DT</b> is a technical proposal for a privacy-preserving digital twin for crowd safety, prediction and navigation at Beaver Stadium. This page is a functional concept demonstration that runs entirely on synthetic data.</p>
  <ul><li>No access to real Beaver Stadium systems, CCTV, WiFi telemetry, ticketing or spectators.</li><li>The 3D model is a stylised, procedurally generated concept, not derived from BIM or as-built data. Gate and section labels are illustrative spatial IDs.</li><li>The crowd model is a zone flow model with sampled agents (about one rendered agent per ${AGENT_SCALE} simulated people). Forecasts and what-if results are model outputs, not validated predictions.</li><li>Nothing here is an emergency instruction or authorised routing guidance. Controls act on the simulated venue only.</li><li>The session starts with seven minutes of synthetic history so the replay has content. One entry in it, marked “Demo history”, is a scripted operator action, not a real one.</li></ul>
  <p>Mirror the present. Predict the future. Simulate alternatives. Guide safer movement. Replay what happened.</p>`);
}
function showKeys() {
  openModal('Keyboard shortcuts', `<table class="tgt-table"><tbody>
  <tr><td><kbd>1</kbd> to <kbd>5</kbd></td><td>Mirror, Predict, Simulate, Navigate, Replay</td></tr>
  <tr><td><kbd>/</kbd></td><td>Search</td></tr><tr><td><kbd>D</kbd> / <kbd>F</kbd></td><td>Density overlay / flow vectors</td></tr>
  <tr><td>Arrow keys</td><td>Pan the scene (scene focused)</td></tr><tr><td><kbd>+</kbd> / <kbd>−</kbd></td><td>Zoom</td></tr>
  <tr><td><kbd>Space</kbd></td><td>Play or pause replay and scenario playback</td></tr><tr><td><kbd>P</kbd> / <kbd>,</kbd> <kbd>.</kbd></td><td>Pause the demo clock / slower or faster (1×, 2×, 5×, 10×)</td></tr><tr><td><kbd>Esc</kbd></td><td>Clear selection, close dialogs</td></tr>
  <tr><td>Mouse</td><td>Left-drag pan, right-drag rotate, wheel zoom, double-click focus</td></tr><tr><td>Touch</td><td>One finger pan, two fingers pinch to zoom and rotate</td></tr></tbody></table>`);
}

/* ---------------- pointer and keyboard on the scene ---------------- */
function initPointer() {
  const cv = W3.canvas;
  let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; V3.glide = null; });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (moved > 6 || dt > 500 || e.button !== 0) return;
    const p = pickAt(e.clientX, e.clientY);
    if (p) select(p); else if (S.sel) select(null);
  });
  cv.addEventListener('dblclick', e => {
    const p = pickAt(e.clientX, e.clientY);
    if (p) { select(p); focusAnchor(selectionAnchor(p), true); }
    else if (S.sel) focusAnchor(selectionAnchor(S.sel), true);
  });
  let hov = 0;
  cv.addEventListener('pointermove', e => { const n = performance.now(); if (n - hov < 90 || e.buttons) return; hov = n; const p = pickAt(e.clientX, e.clientY); cv.style.cursor = p ? 'pointer' : ''; });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  W3.controls.listenToKeyEvents(cv);
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else if (S.follow) S.follow = null; else select(null); return; }
    if (/^[1-5]$/.test(e.key)) setMode(['mirror', 'predict', 'simulate', 'navigate', 'replay'][+e.key - 1]);
    if (e.key === '/') { e.preventDefault(); $('search').focus(); }
    if (e.key === 'd' || e.key === 'D') { $('ovDensity').click(); }
    if (e.key === 'f' || e.key === 'F') { $('ovFlow').click(); }
    if ((e.key === '+' || e.key === '=') && document.activeElement === cv) { const c = W3.camera, t = W3.controls.target; c.position.lerp(t, 0.15); }
    if ((e.key === '-' || e.key === '_') && document.activeElement === cv) { const c = W3.camera, t = W3.controls.target; c.position.sub(t).multiplyScalar(1.15).add(t); }
    if (e.key === ' ' && (S.mode === 'replay' || S.mode === 'simulate')) { e.preventDefault(); if (S.mode === 'replay') REC.toggle(); else OPS.togglePlay(); }
  });
}

/* ---------------- periodic refresh ---------------- */
function uiTick(dt) {
  UI.kpiAcc += dt; UI.panelAcc += dt; UI.tableAcc += dt; UI.procAcc += dt;
  if (UI.kpiAcc > 0.5) { UI.kpiAcc = 0; updateKPIs(); updateTopbar(); }
  if (UI.panelAcc > 1.0) { UI.panelAcc = 0; if (!document.activeElement || !$('rightBody').contains(document.activeElement)) renderPanel(false); }
  if (UI.tableAcc > 1.5 || UI.tableDirty) { UI.tableAcc = 0; UI.tableDirty = false; if (!$('dockBody').matches(':hover')) renderTable(); }
  if (UI.procAcc > 0.8) { UI.procAcc = 0; UI.procStep = (UI.procStep + 1) % 6; renderProcess(false); }
}
