'use strict';
/* =====================================================================
   STADIUM-DT operations: scenario lab (what-if), route planner (spectator, accessibility,
   responder) and replay recorder. All results come from the synthetic model.
   ===================================================================== */
const OPS = {};

/* ======================= SCENARIO LAB ======================= */
OPS.defaultP = (def, preset) => {
  preset = preset || {};
  const P = { asset: null, demand: 1, gateCap: 1, width: 0.4, compliance: 0.75, opt: {} };
  if (def.asset) {
    if (def.asset.type === 'gate') P.asset = preset.gate || def.asset.def;
    else if (def.asset.type === 'stair') P.asset = preset.stair || def.asset.def;
    else if (def.asset.type === 'zone') P.asset = preset.zone || def.asset.def;
  }
  if (def.id === 'halftime') P.opt = { guide: true, windows: true };
  if (def.id === 'medical') P.opt = { lane: true };
  if (def.id === 'weather') P.opt = { gateD: true, guide: true, phased: true };
  if (def.id === 'mass_exit') P.opt = { guide: true, gateD: true };
  return P;
};
OPS.pickScenario = (id, preset) => {
  const def = SCEN.find(s => s.id === id);
  if (S.scenario && S.scenario.run) OPS.reset(true);
  S.scenario = { def, P: OPS.defaultP(def, preset), view: 'int', speed: S.scenario ? S.scenario.speed : 5 };
  logEvent('operator', `Scenario selected: ${def.label}${S.scenario.P.asset ? ' (' + OPS.assetLabel(def, S.scenario.P.asset) + ')' : ''}`);
  OPS.renderLab();
};
OPS.assetLabel = (def, a) => !def.asset ? '' : def.asset.type === 'gate' ? GATES[a].label : def.asset.type === 'stair' ? OUTLETS[a].label : a;
OPS.clearLabel = ctx => ({ ingress: 'Gate-queue clearance (queues ≤ 30)', egress: 'Egress clearance (98% of catchment out)', evac: 'Evacuation clearance (98% out)', amenity: 'Queue spillover cleared', medical: 'Responder arrival time' }[ctx] || 'Clearance');
OPS.affected = (def, P) => {
  switch (def.id) {
    case 'gate_close': return `${GATES[P.asset].label} closed`;
    case 'gate_open': return 'Gate D (auxiliary) opened';
    case 'stair_close': return `${OUTLETS[P.asset].label} closed`;
    case 'restrict': return `${P.asset} at ${Math.round(P.width * 100)}% width`;
    case 'halftime': return [P.opt.guide && 'crowd-aware amenity guidance', P.opt.windows && '+4 windows at Concession B'].filter(Boolean).join(', ') || 'no change (baseline only)';
    case 'medical': return `Incident in ${P.asset}${P.opt.lane ? ', responder lane reserved' : ''}`;
    case 'weather': return [P.opt.gateD && 'Gate D opened', P.opt.guide && 'crowd-aware guidance', P.opt.phased && 'phased lower-bowl release'].filter(Boolean).join(', ') || 'no change';
    case 'mass_exit': return [P.opt.guide && 'crowd-aware exit guidance', P.opt.gateD && 'Gate D opened'].filter(Boolean).join(', ') || 'no change';
    case 'redirect': return `${Math.round(P.compliance * 100)}% follow crowd-aware guidance (baseline 25%)`;
  }
  return '';
};
OPS.routeAvail = (m) => {
  if (!m) return '';
  const c = m.cfg, out = [];
  for (const k in GATES) out.push(`${GATES[k].label.replace(' (auxiliary)', '')}: ${c.gateOpen[k] ? 'open' : 'closed'}`);
  for (const s of ['STAIR_1', 'STAIR_2']) out.push(`${OUTLETS[s].label}: ${c.outletOpen[s] ? 'open' : 'closed'}`);
  out.push(`Elevator A: ${c.outletOpen.ELEV_A ? 'in service' : 'out'}`);
  const r = c.restrict.map((v, j) => v < 1 ? `${ZONES[j].short} ${Math.round(v * 100)}%` : null).filter(Boolean);
  if (r.length) out.push('Restricted: ' + r.join(', '));
  return out.join(' · ');
};
OPS.run = () => {
  const sc0 = S.scenario; if (!sc0) return;
  const built = buildScenario(sc0.def, sc0.P);
  sc0.ctx = built.ctx; sc0.snap = TWIN.m.clock; sc0.built = built;
  sc0.fast = pairRunner(built, sc0.def, sc0.P);
  const mb = built.base.clone(), mi = built.intv.clone();
  sc0.run = { mb, mi, rb: recorder(mb, built.ctx), ri: recorder(mi, built.ctx), acc: 0, playing: true, ended: false };
  if (built.ctx === 'medical') { const z = zoneById(sc0.P.asset).i; sc0.run.rb.resp = responderETA(mb, z, false); sc0.run.ri.resp = responderETA(mi, z, true); }
  clearAgents(); AG.src = sc0.view === 'base' ? mb : mi;
  $('simVeil').hidden = false;
  OPS.spawnScenarioResponder();
  logEvent('sim', `Snapshot saved at ${fmtClock(sc0.snap)} for ${sc0.def.label}`);
  logEvent('sim', `Scenario run started: ${sc0.def.label} · ${OPS.affected(sc0.def, sc0.P)} · demand ×${fmt2(sc0.P.demand)} · gate capacity ${Math.round(sc0.P.gateCap * 100)}%`);
  OPS.renderLab();
};
OPS.spawnScenarioResponder = () => {
  const sc = S.scenario; if (!sc || !sc.run || sc.ctx !== 'medical') return;
  const r = sc.view === 'base' ? sc.run.rb.resp : sc.run.ri.resp;
  if (r && r.path) { const pts = r.path.nodes.map(id => { const n = G.nodes.get(id); return { x: n.x, z: n.z, y: n.y || 0, id }; }); const a = spawnResponder(pts); if (a) { a.spd = sc.view === 'base' ? 1.15 : 1.55; } drawResponderRoute(r.path, sc.view === 'base' ? COL.amber : COL.crit); }
};
OPS.togglePlay = () => { const r = S.scenario && S.scenario.run; if (!r) { OPS.run(); return; } r.playing = !r.playing; logEvent('sim', `Scenario playback ${r.playing ? 'resumed' : 'paused'}`); OPS.renderLab(); };
OPS.reset = (quiet) => {
  const sc = S.scenario; if (!sc) return;
  sc.run = null; sc.fast = null; sc.built = null;
  AG.src = null; clearAgents(); clearRoutes();
  $('simVeil').hidden = true;
  if (!quiet) logEvent('sim', `Scenario reset: ${sc.def.label}. Live twin shown again.`);
  OPS.renderLab();
};
OPS.setView = v => {
  const sc = S.scenario; if (!sc) return;
  sc.view = v;
  if (sc.run) { AG.src = v === 'base' ? sc.run.mb : sc.run.mi; clearAgents(); OPS.spawnScenarioResponder(); }
  $('simVeilText').textContent = `SIMULATION · ${v === 'base' ? 'BASELINE' : 'INTERVENTION'} · NOT LIVE`;
  logEvent('sim', `Comparison view: ${v === 'base' ? 'baseline' : 'intervention'}`);
  OPS.renderLab();
};
/* per-frame work: finish the fast comparison and advance playback */
OPS.tick = (dt) => {
  const sc = S.scenario; if (!sc) return;
  if (sc.fast && !sc.fast.done) {
    sc.fast.work(45, 3);
    if (sc.fast.done) {
      const rb = sc.fast.rb, ri = sc.fast.ri;
      logEvent('sim', `${sc.def.label}: ${OPS.clearLabel(sc.ctx).toLowerCase()} ${fmtDur(rb.clearance)} → ${fmtDur(ri.clearance)}, peak ${fmt1(rb.peak)} → ${fmt1(ri.peak)} p/m²`);
      const rec = OPS.recommend(sc);
      if (rec) logEvent('route', `Simulated recommendation (operator review): ${rec.text}`);
      OPS.renderLab();
    } else if (Math.random() < 0.2) OPS.renderLabProgress();
  }
  const r = sc.run;
  if (r && r.playing && !r.ended) {
    r.acc += dt * sc.speed;
    let n = 0;
    while (r.acc >= 1 && n < 40) {
      r.acc -= 1; n++;
      advance(r.mb, r.rb, 1); advance(r.mi, r.ri, 1);
      const lim = sc.fast && sc.fast.done ? sc.fast.rb.t : SCEN_MAX;
      if (r.rb.t >= lim || r.rb.t >= SCEN_MAX) { r.ended = true; r.playing = false; logEvent('sim', `Scenario playback reached the end of the comparison window (${fmtDur(r.rb.t)})`); OPS.renderLab(); break; }
    }
    OPS.labAcc = (OPS.labAcc || 0) + dt;
    if (OPS.labAcc > 0.5) { OPS.labAcc = 0; OPS.renderLabProgress(); }
  }
};
OPS.recommend = sc => {
  const f = sc.fast; if (!f || !f.done) return null;
  const rb = f.rb, ri = f.ri;
  let best = -1, bestD = 0;
  for (let j = 0; j < L.nz; j++) { const d = rb.above[j] - ri.above[j]; if (d > bestD) { bestD = d; best = j; } }
  const dC = pctDiff(rb.clearance, ri.clearance), dP = pctDiff(rb.peak, ri.peak);
  const zone = best >= 0 ? ZONES[best].short : rb.peakZone >= 0 ? ZONES[rb.peakZone].short : 'W-014';
  let text;
  if (sc.ctx === 'medical') text = ri.clearance < rb.clearance ? `A reserved responder lane may shorten simulated responder arrival by ${fmtDur(rb.clearance - ri.clearance)}, at the cost of higher spectator density on the lane (peak ${fmt1(ri.peak)} p/m²).` : 'The responder lane did not shorten the simulated arrival time in this run.';
  else if ((isFinite(dC) && dC < -2) || dP < -3) text = best >= 0 || rb.peakZone >= 0 ? `Alternative routing may reduce crowd concentration in Zone ${zone}.` : `The intervention may shorten clearance by ${Math.abs(dC).toFixed(0)}%.`;
  else if (dC > 2 || dP > 3) text = `This change may increase crowd concentration${ri.peakZone >= 0 ? ' in Zone ' + ZONES[ri.peakZone].short : ''}; review alternatives before acting.`;
  else text = 'The intervention makes little difference in this simulation.';
  return { text };
};
OPS.renderLabProgress = () => {
  const sc = S.scenario; if (!sc) return;
  const p = $('labProg'); if (p && sc.run) p.style.width = `${Math.min(100, sc.run.rb.t / (sc.fast && sc.fast.done ? sc.fast.rb.t : SCEN_MAX) * 100)}%`;
  const t = $('labSimT'); if (t && sc.run) t.textContent = `T+${fmtMS(sc.run.rb.t)} · ${fmtClock(sc.snap + sc.run.rb.t)}`;
  const st = $('labState'); if (st && sc.fast) st.textContent = sc.fast.done ? 'Comparison computed' : `Computing comparison… ${Math.round(sc.fast.rb.t / 60)} min simulated`;
  const cv = $('labChart'); if (cv) OPS.drawLabChart(cv);
};
OPS.renderLab = () => {
  const body = $('labBody'); if (!body) return;
  const sc = S.scenario;
  let html = `<div class="scen-list" role="group" aria-label="Scenario">${SCEN.map(s => `<button data-scen="${s.id}" aria-pressed="${sc && sc.def.id === s.id}">${s.label}</button>`).join('')}</div>`;
  if (!sc) {
    html += `<p class="note">Choose a scenario. The run takes a snapshot of the current estimated state, then simulates a baseline and an intervention in the same flow model and compares them. Results are synthetic and are not emergency instructions.</p>`;
    body.innerHTML = html; OPS.bindLab(); return;
  }
  const def = sc.def, P = sc.P, ctx = sc.ctx || scenarioContext(def, TWIN.m.clock);
  html += `<p class="note">${def.desc}</p>`;
  if (def.asset) {
    const opts = def.asset.opts.map(o => `<option value="${o}" ${o === P.asset ? 'selected' : ''}>${OPS.assetLabel(def, o)}</option>`).join('');
    html += `<div class="field"><label for="scAsset">${def.asset.type === 'zone' ? 'Affected zone' : def.asset.type === 'gate' ? 'Gate' : 'Stair'}</label><select id="scAsset">${opts}</select></div>`;
  }
  if (def.id === 'restrict') html += `<div class="field slider"><label for="scWidth">Remaining width</label><span class="sv" id="scWidthV">${Math.round(P.width * 100)}%</span><input type="range" id="scWidth" min="0.2" max="0.9" step="0.05" value="${P.width}"></div>`;
  if (def.id === 'redirect') html += `<div class="field slider"><label for="scComp">Share following guidance</label><span class="sv" id="scCompV">${Math.round(P.compliance * 100)}%</span><input type="range" id="scComp" min="0.3" max="1" step="0.05" value="${P.compliance}"></div>`;
  const optDefs = { halftime: [['guide', 'Crowd-aware amenity guidance'], ['windows', 'Open 4 extra windows at Concession B']], medical: [['lane', 'Reserve a responder lane and allow the service corridor']], weather: [['gateD', 'Open Gate D'], ['guide', 'Crowd-aware exit guidance'], ['phased', 'Phased release of the lower bowl (first 3 min)']], mass_exit: [['guide', 'Crowd-aware exit guidance'], ['gateD', 'Open Gate D']] }[def.id];
  if (optDefs) html += `<div class="field"><label>Intervention options</label><div class="opt">${optDefs.map(([k, l]) => `<label class="tog"><input type="checkbox" data-opt="${k}" ${P.opt[k] ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>`;
  html += `<div class="field slider"><label for="scDemand">Crowd demand multiplier</label><span class="sv" id="scDemandV">×${fmt2(P.demand)}</span><input type="range" id="scDemand" min="0.6" max="1.6" step="0.05" value="${P.demand}"></div>`;
  html += `<div class="field slider"><label for="scGate">Gate capacity</label><span class="sv" id="scGateV">${Math.round(P.gateCap * 100)}%</span><input type="range" id="scGate" min="0.5" max="1.5" step="0.05" value="${P.gateCap}"></div>`;
  html += `<div class="field"><label>Simulation speed</label><div class="speed-seg" role="group">${[1, 2, 5, 10].map(v => `<button data-speed="${v}" aria-pressed="${sc.speed === v}">${v}×</button>`).join('')}</div></div>`;
  const running = !!sc.run;
  html += `<div class="run-row"><button class="btn primary" id="scRun">${running ? (sc.run.playing ? 'Running…' : 'Re-run') : 'Run'}</button><button class="btn" id="scPause" ${running ? '' : 'disabled'}>${running && sc.run.playing ? 'Pause' : 'Play'}</button><button class="btn" id="scReset" ${running ? '' : 'disabled'}>Reset</button></div>`;
  html += `<div class="cmp-row"><button class="btn sm" id="scViewInt" aria-pressed="${sc.view !== 'base'}" ${running ? '' : 'disabled'} style="${sc.view !== 'base' && running ? 'border-color:var(--amber);color:var(--amber-ink)' : ''}">Show intervention</button><button class="btn sm" id="scViewBase" ${running ? '' : 'disabled'} style="${sc.view === 'base' && running ? 'border-color:var(--amber);color:var(--amber-ink)' : ''}">Compare baseline</button></div>`;
  html += `<div class="progress"><i id="labProg"></i></div><div class="mono dim" style="font-size:10.5px;margin-top:4px;display:flex;justify-content:space-between"><span id="labSimT">${running ? '' : 'Not running'}</span><span id="labState"></span></div>`;
  const f = sc.fast && sc.fast.done ? sc.fast : null;
  html += `<dl class="scen-meta"><dt>Scenario name</dt><dd>${def.label}</dd><dt>Affected assets</dt><dd>${esc(OPS.affected(def, P))}</dd><dt>Start time</dt><dd>${sc.snap ? fmtClock(sc.snap) + ' (snapshot)' : 'at Run (' + fmtClock(TWIN.m.clock) + ')'}</dd><dt>Simulated duration</dt><dd>${f ? fmtDur(f.rb.t) : running ? 'computing' : 'until clearance, max 45 min'}</dd><dt>Context</dt><dd>${{ ingress: 'Ingress, pre-game', egress: 'Egress, full west catchment', evac: 'Evacuation, west catchment', amenity: 'Halftime amenities', medical: 'Responder dispatch' }[ctx]}</dd><dt>Crowd demand multiplier</dt><dd>×${fmt2(P.demand)}</dd><dt>Route availability</dt><dd style="white-space:normal">${sc.built ? esc(OPS.routeAvail(sc.built.intv)) : 'from the live configuration'}</dd><dt>Predicted clearance</dt><dd>${f ? (isFinite(f.ri.clearance) ? fmtDur(f.ri.clearance) : '> 45m') : 'pending'}</dd><dt>Peak density</dt><dd>${f ? fmt1(f.ri.peak) + ' p/m²' : 'pending'}</dd></dl>`;
  if (f) {
    const rb = f.rb, ri = f.ri;
    const row = (lbl, a, b, fmt, lowerBetter) => { const d = pctDiff(a, b); const good = lowerBetter ? b < a : b > a; const cls = !isFinite(d) || Math.abs(d) < 0.5 ? '' : good ? 'good' : 'bad'; return `<div class="result-r"><div>${lbl}</div><div>${fmt(a)}</div><div>${fmt(b)}</div><div class="${cls}">${isFinite(a) && isFinite(b) ? (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%' : 'n/a'}</div></div>`; };
    const bottl = r => { const z = []; r.above.forEach((s, j) => { if (s >= 30) z.push(ZONES[j].short); }); return z.length ? z.join(', ') : 'none'; };
    const cong = r => r.above.filter(s => s > 0).length;
    const util = r => { const tot = sum(Object.values(r.routeUse)) || 1; return Object.entries(r.routeUse).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${(ATT[k] ? ATT[k].label : k).replace('Concession', 'Conc.').replace(' (auxiliary)', '').replace(' concourse link', '')} ${Math.round(v / tot * 100)}%`).join(', '); };
    html += `<div class="result"><div class="result-h"><div>METRIC</div><div style="text-align:right">BASELINE</div><div style="text-align:right">INTERVENTION</div><div style="text-align:right">Δ</div></div>` +
      row(ctx === 'medical' ? 'Responder arrival' : 'Estimated clearance', rb.clearance, ri.clearance, v => isFinite(v) ? fmtDur(v) : '> 45m', true) +
      row('Peak density', rb.peak, ri.peak, v => fmt1(v) + ' p/m²', true) +
      `<div class="result-r"><div>Bottleneck locations</div><div style="white-space:normal">${bottl(rb)}</div><div style="white-space:normal">${bottl(ri)}</div><div></div></div>` +
      row(ctx === 'ingress' ? 'People processed' : 'Total throughput', rb.throughput, ri.throughput, v => fmtInt(v), false) +
      row('Congested zones', cong(rb), cong(ri), v => String(v), true) +
      `<div class="result-r"><div>Route utilisation</div><div style="white-space:normal;font-size:10.5px">${util(rb)}</div><div style="white-space:normal;font-size:10.5px">${util(ri)}</div><div></div></div></div>`;
    html += `<div class="sect"><div class="sect-h"><span class="eyebrow">BEFORE / AFTER</span><span class="mono dim" style="font-size:10.5px">peak zone density over time</span></div><canvas class="minichart" id="labChart" width="800" height="230"></canvas></div>`;
    const rec = OPS.recommend(sc);
    html += `<div class="reco"><b>Recommendation.</b> ${esc(rec.text)}<small>SIMULATED · SUBJECT TO OPERATOR REVIEW · NOT AN EMERGENCY INSTRUCTION</small></div>`;
    html += `<p class="fine">Hybrid simulation: a zone flow model produces every number; the rendered agents sample its flows. This is not a validated evacuation model. The proposal's validation target for clearance-time error is listed under <button class="linkbtn" id="labTargets">Research targets</button>.</p>`;
  } else if (running) html += `<p class="note" id="labWait">Computing the baseline and intervention comparison…</p>`;
  body.innerHTML = html;
  OPS.bindLab(); OPS.renderLabProgress();
};
OPS.bindLab = () => {
  const body = $('labBody'), sc = S.scenario;
  body.querySelectorAll('[data-scen]').forEach(b => b.addEventListener('click', () => OPS.pickScenario(b.dataset.scen)));
  if (!sc) return;
  const P = sc.P;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('scAsset', 'change', e => { P.asset = e.target.value; OPS.changed('Affected asset: ' + OPS.assetLabel(sc.def, P.asset)); });
  on('scWidth', 'input', e => { P.width = +e.target.value; $('scWidthV').textContent = Math.round(P.width * 100) + '%'; });
  on('scWidth', 'change', () => OPS.changed(`Width set to ${Math.round(P.width * 100)}%`));
  on('scComp', 'input', e => { P.compliance = +e.target.value; $('scCompV').textContent = Math.round(P.compliance * 100) + '%'; });
  on('scComp', 'change', () => OPS.changed(`Guidance share set to ${Math.round(P.compliance * 100)}%`));
  on('scDemand', 'input', e => { P.demand = +e.target.value; $('scDemandV').textContent = '×' + fmt2(P.demand); });
  on('scDemand', 'change', () => OPS.changed(`Crowd demand ×${fmt2(P.demand)}`));
  on('scGate', 'input', e => { P.gateCap = +e.target.value; $('scGateV').textContent = Math.round(P.gateCap * 100) + '%'; });
  on('scGate', 'change', () => OPS.changed(`Gate capacity ${Math.round(P.gateCap * 100)}%`));
  body.querySelectorAll('[data-opt]').forEach(i => i.addEventListener('change', () => { P.opt[i.dataset.opt] = i.checked; OPS.changed(`Option ${i.parentElement.textContent.trim()} ${i.checked ? 'on' : 'off'}`); }));
  body.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => { sc.speed = +b.dataset.speed; logEvent('sim', `Simulation speed ${sc.speed}×`); OPS.renderLab(); }));
  on('scRun', 'click', () => OPS.run());
  on('scPause', 'click', () => OPS.togglePlay());
  on('scReset', 'click', () => OPS.reset());
  on('scViewInt', 'click', () => OPS.setView('int'));
  on('scViewBase', 'click', () => OPS.setView('base'));
  on('labTargets', 'click', () => showTargets());
};
OPS.changed = msg => {
  const sc = S.scenario;
  logEvent('operator', `Scenario parameter: ${msg}`);
  if (sc.run) { OPS.reset(true); UI.toast('Parameters changed. Press Run to simulate again.'); }
  OPS.renderLab();
};
OPS.drawLabChart = cv => {
  const sc = S.scenario; if (!sc || !sc.fast || !sc.fast.done) return;
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const rb = sc.fast.rb, ri = sc.fast.ri, sb = rb.series, si = ri.series;
  const pad = { l: 46, r: 150, t: 14, b: 30 }, X0 = pad.l, X1 = w - pad.r, Y0 = h - pad.b, Y1 = pad.t;
  const T = Math.max(rb.t, 60), maxK = 5.2;
  const tx = t => X0 + t / T * (X1 - X0), ty = k => Y0 - clamp(k, 0, maxK) / maxK * (Y0 - Y1);
  ctx.font = '19px "JetBrains Mono", monospace'; ctx.strokeStyle = 'rgba(248,241,231,0.08)'; ctx.fillStyle = '#A99DB4';
  for (const v of [1.5, 2.5, 3.5, 5]) { ctx.beginPath(); ctx.moveTo(X0, ty(v)); ctx.lineTo(X1, ty(v)); ctx.stroke(); ctx.fillText(v.toFixed(1), 2, ty(v) + 6); }
  ctx.strokeStyle = 'rgba(216,78,104,0.55)'; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.moveTo(X0, ty(BOTTLENECK_K)); ctx.lineTo(X1, ty(BOTTLENECK_K)); ctx.stroke(); ctx.setLineDash([]);
  const line = (s, col, dash) => { ctx.strokeStyle = col; ctx.lineWidth = 3.2; ctx.setLineDash(dash || []); ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(tx(p.t), ty(p.kmax)) : ctx.moveTo(tx(p.t), ty(p.kmax))); ctx.stroke(); ctx.setLineDash([]); };
  line(sb, '#A99DB4', [10, 7]); line(si, '#FFB547');
  if (sc.run) { ctx.strokeStyle = 'rgba(150,120,200,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx(sc.run.rb.t), Y1); ctx.lineTo(tx(sc.run.rb.t), Y0); ctx.stroke(); }
  ctx.fillStyle = '#A99DB4'; ctx.fillText('0', X0, h - 6); ctx.fillText(fmtDur(T), X1 - 100, h - 6);
  // clearance bars on the right
  const bx = X1 + 26, bw = 44, cmax = Math.max(isFinite(rb.clearance) ? rb.clearance : SCEN_MAX, isFinite(ri.clearance) ? ri.clearance : SCEN_MAX);
  const bar = (v, x, col, lbl) => { const vv = isFinite(v) ? v : SCEN_MAX; const bh = vv / cmax * (Y0 - Y1); ctx.fillStyle = col; ctx.fillRect(x, Y0 - bh, bw, bh); ctx.fillStyle = '#A99DB4'; ctx.fillText(lbl, x + 4, h - 6); };
  bar(rb.clearance, bx, 'rgba(169,157,180,0.75)', 'B'); bar(ri.clearance, bx + bw + 12, '#FFB547', 'I');
  ctx.fillStyle = '#F8F1E7'; ctx.fillText('clearance', bx - 2, Y1 + 4);
  ctx.fillStyle = '#A99DB4'; ctx.fillText('- - baseline', X0 + 8, Y1 + 18); ctx.fillStyle = '#FFB547'; ctx.fillText('── intervention', X0 + 190, Y1 + 18);
};

/* ======================= ROUTE PLANNER ======================= */
const START_OPTS = () => [
  ...QR.map(q => ['QR:' + q.id, q.label]),
  ...GROUPS.map(g => ['G:' + g.id, `Seat: ${g.label}`]),
  ...['A', 'B', 'C'].map(k => ['P:' + k, `Plaza outside ${GATES[k].label}`]),
  ...ZONES.map(z => ['Z:' + z.i, `Concourse ${z.id}`])
];
OPS.startNode = () => {
  const s = S.nav.start || 'QR:QR-03', [t, v] = [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)];
  if (t === 'QR') return QR.find(q => q.id === v).node;
  if (t === 'G') return 'SEAT:' + v;
  if (t === 'P') return 'PL:' + v;
  if (t === 'Z') return 'SP:' + nearestSpineX(ZONES[+v].xc);
  if (t === 'SEC') { const n = +v, g = seatGroup(n > 200 ? 'upper' : 'lower', n); return g ? 'SEAT:' + g : 'LK:N'; }
  return 'SP:-5.5';
};
OPS.startLabel = () => { const s = S.nav.start || 'QR:QR-03'; const o = START_OPTS().find(o => o[0] === s); if (o) return o[1]; if (s.startsWith('SEC:')) return 'Section ' + s.slice(4); return s; };
OPS.ensureStartOption = sec => { const sel = $('navStart'); if (!sel.querySelector(`option[value="SEC:${sec}"]`)) { const o = document.createElement('option'); o.value = 'SEC:' + sec; o.textContent = 'Section ' + sec; sel.appendChild(o); } };
OPS.initPlanner = () => {
  const ns = $('navStart');
  ns.innerHTML = START_OPTS().map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  ns.value = S.nav.start = 'QR:' + 'QR-03';
  ns.addEventListener('change', () => { S.nav.start = ns.value; OPS.planRoute(true); });
  const types = [['restroom', 'Restroom'], ['food', 'Food'], ['seat', 'Seat'], ['exit', 'Exit'], ['medical', 'Medical'], ['accessible', 'Accessible']];
  $('destGrid').innerHTML = types.map(([k, l]) => `<button role="radio" data-dest="${k}" aria-checked="${S.nav.dest === k}">${l}</button>`).join('');
  $('destGrid').querySelectorAll('button').forEach(b => b.addEventListener('click', () => OPS.setDest(b.dataset.dest)));
  $('navSeat').innerHTML = GROUPS.map(g => `<option value="${g.id}">${g.label}</option>`).join('');
  $('navSeat').value = S.nav.seat = 'G104';
  $('navSeat').addEventListener('change', e => { S.nav.seat = e.target.value; OPS.planRoute(true); });
  $('navAccess').addEventListener('change', e => { S.nav.access = e.target.checked; OPS.planRoute(true); });
  $('navAware').addEventListener('change', e => { S.nav.crowdAware = e.target.checked; S.nav.show = e.target.checked ? 'aware' : 'short'; OPS.syncPlanner(); OPS.planRoute(true); });
  document.querySelectorAll('.route-tabs button').forEach(b => b.addEventListener('click', () => { S.nav.show = b.dataset.r; OPS.syncPlanner(); OPS.renderRoute(); }));
  document.querySelectorAll('.role-seg button').forEach(b => b.addEventListener('click', () => OPS.setRole(b.dataset.role)));
  $('incZone').innerHTML = ZONES.map(z => `<option value="${z.id}">${z.id}</option>`).join('');
  $('incZone').value = S.responder.incidentZone;
  $('incZone').addEventListener('change', e => { S.responder.incidentZone = e.target.value; logEvent('operator', `Incident marker moved to ${e.target.value}`); OPS.planResponder(true); });
  $('respStairFree').addEventListener('change', e => { S.responder.stairFree = e.target.checked; OPS.planResponder(); });
  $('respAware').addEventListener('change', () => OPS.planResponder());
  $('dispatchBtn').addEventListener('click', () => OPS.dispatch());
};
OPS.syncPlanner = () => {
  $('navStart').value = S.nav.start; if ($('navStart').value !== S.nav.start && S.nav.start.startsWith('SEC:')) { OPS.ensureStartOption(S.nav.start.slice(4)); $('navStart').value = S.nav.start; }
  document.querySelectorAll('#destGrid button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.dest === S.nav.dest)));
  document.querySelectorAll('.role-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.role === S.role)));
  document.querySelectorAll('.route-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.r === S.nav.show)));
  $('seatField').hidden = S.nav.dest !== 'seat';
  $('navAccess').checked = S.nav.access; $('navAware').checked = S.nav.crowdAware;
  $('plannerSpect').hidden = S.role === 'responder'; $('plannerResp').hidden = S.role !== 'responder';
  $('plannerTitle').textContent = S.role === 'responder' ? 'EMERGENCY RESPONDER ROUTING' : S.role === 'access' ? 'ACCESSIBLE ROUTE PLANNER' : 'SPECTATOR ROUTE PLANNER';
};
OPS.setRole = r => {
  S.role = r;
  if (r === 'access') { S.nav.access = true; if (S.nav.dest === 'exit' || S.nav.dest === 'restroom') { } }
  if (r === 'spectator') S.nav.access = false;
  logEvent('operator', `Route planner role: ${r === 'access' ? 'accessibility-focused spectator' : r}`);
  OPS.syncPlanner();
  if (r === 'responder') { OPS.planResponder(true); }
  else OPS.planRoute(true);
};
OPS.setDest = d => { S.nav.dest = d; OPS.syncPlanner(); OPS.planRoute(true); };
OPS.planRoute = (explicit) => {
  if (S.mode !== 'navigate' || S.role === 'responder') return;
  const start = OPS.startNode();
  const res = planRoute(start, S.nav.dest, { access: S.nav.access || S.role === 'access' });
  const prev = S.nav.result;
  S.nav.result = res;
  if (!res.none) {
    const changed = !prev || prev.none || prev.aware.c.id !== res.aware.c.id || prev.type !== res.type || prev.start !== res.start;
    if (explicit) { fitNodes(res.aware.pa.nodes.concat(res.shortest.ps.nodes)); noteRecommendation(res); logEvent('route', `Route recommendation: ${OPS.startLabel()} → ${res.aware.c.label} · ${fmtDur(res.aware.total)} total (${S.nav.crowdAware ? 'crowd-aware' : 'shortest'})`); }
    else if (changed) logEvent('route', `Route updated: ${res.aware.c.label} now fastest from ${OPS.startLabel()} (${fmtDur(res.aware.total)})`);
  }
  OPS.renderRoute();
};
OPS.renderRoute = () => {
  const res = S.nav.result, out = $('routeOut');
  if (!res) return;
  if (res.none) { out.innerHTML = '<div class="rec"><div class="rd">No feasible route</div><p class="note">Every candidate is closed or unreachable with the current options.</p></div>'; clearRoutes(); return; }
  const showAware = S.nav.show === 'aware';
  drawRoute(res, 'both');
  const r = showAware ? res.aware : res.shortest;
  const walk = showAware ? r.walk : res.shortTotal - r.wait;
  const total = showAware ? r.total : res.shortTotal;
  const dist = showAware ? r.dist : r.distShort;
  const cong = congestionOf(showAware ? r.pa : r.ps);
  const saves = res.shortTotal - res.aware.total;
  const kMax = p => p.zones.reduce((m, z) => Math.max(m, TWIN.est[z].k), 0);
  const kA = kMax(res.aware.pa), kS = kMax(res.shortest.ps);
  const same = res.aware.c.id === res.shortest.c.id && res.aware.pa.nodes.join() === res.shortest.ps.nodes.join();
  let why = '';
  if (same) why = 'The crowd-aware and shortest routes are the same at the moment.';
  else if (saves > 5) why = `The crowd-aware route ${res.aware.dist > res.shortest.distShort + 3 ? 'is ' + Math.round(res.aware.dist - res.shortest.distShort) + ' m longer but ' : ''}saves about ${fmtDur(saves)} of combined walking and waiting.`;
  else if (saves < -5) why = `The crowd-aware route takes about ${fmtDur(-saves)} longer but its densest zone is ${fmt1(kA)} p/m² instead of ${fmt1(kS)} p/m².`;
  else why = `Similar total time; the crowd-aware route's densest zone is ${fmt1(kA)} p/m² (shortest route: ${fmt1(kS)} p/m²).`;
  const mix = OPS.recMix(res.type);
  out.innerHTML = `<div class="rec"><span class="eyebrow"><i class="rsw" style="background:${showAware ? HEX.ok : HEX.text}"></i>${showAware ? 'CROWD-AWARE ROUTE (green)' : 'SHORTEST ROUTE (white)'}</span><div class="rd">${esc(r.c.label)}</div>
    <div class="rgrid"><div>Walking<b>${fmtDur(walk)}</b></div><div>Queue delay<b>${fmtDur(r.wait)}</b></div><div>Total<b>${fmtDur(total)}</b></div><div>Distance<b>${Math.round(dist)} m</b></div><div>Congestion<b style="color:${cong.hex}">${cong.label}</b></div><div>Step-free<b>${S.nav.access || S.role === 'access' ? 'yes' : 'not required'}</b></div></div>
    <div class="why">${why}</div></div>
    <div class="sect"><div class="sect-h"><span class="eyebrow">DESTINATION COMPARISON</span></div><div class="alt-list">${res.rows.filter(x => x.ok).sort((a, b) => a.total - b.total).map(x => `<div class="alt ${x.c.id === res.aware.c.id ? 'best' : ''}"><span class="an">${esc(x.c.label)}</span><span class="at">${fmtDur(x.total)}</span><span class="ad">walk ${fmtDur(x.walk)} + queue ${fmtDur(x.wait)} · ${Math.round(x.dist)} m</span></div>`).join('')}</div></div>
    ${mix ? `<p class="note">Distribution-aware: recent simulated recommendations for this type went ${mix}. Recommended load is added to route costs so one route is not sent everyone.</p>` : ''}`;
};
OPS.recMix = type => {
  const ids = type === 'restroom' ? ['REST_A', 'REST_B', 'REST_S'] : type === 'food' ? ['CONC_A', 'CONC_B', 'CONC_N'] : null;
  if (!ids) return '';
  const tot = sum(ids.map(i => recDest[i] || 0)); if (tot < 1) return '';
  return ids.map(i => `${i.replace('_', ' ').replace('REST', 'Restroom').replace('CONC', 'Concession')} ${Math.round((recDest[i] || 0) / tot * 100)}%`).join(', ');
};
/* simulated app users asking for amenities; keeps the recommendation distribution realistic */
OPS.appUsers = () => {
  for (let i = 0; i < 2; i++) {
    const q = pick(QR.slice(0, 5)), type = rnd() < 0.5 ? 'restroom' : 'food';
    const r = planRoute(q.node, type, {});
    if (!r.none) noteRecommendation(r);
  }
};
OPS.planResponder = (explicit) => {
  if (S.mode !== 'navigate' || S.role !== 'responder') return;
  const zi = zoneById(S.responder.incidentZone).i, aware = $('respAware').checked;
  const p = responderPath(zi, aware, S.responder.stairFree, !aware);
  S.responder.path = p;
  const out = $('respOut');
  if (!p) { out.innerHTML = '<div class="rec"><div class="rd">No feasible route</div></div>'; clearRoutes(); return; }
  drawResponderRoute(p, COL.crit);
  if (explicit) fitNodes(p.nodes);
  let t = 45, svc = false, stairs = false, dense = 0;
  for (const e of p.edges) { let v = 1.7; if (e.zone >= 0) { v = 1.7 * Math.max(0.28, 1 - TWIN.est[e.zone].k / 5.2); if (TWIN.est[e.zone].k >= 3) dense++; } if (e.kind === 'stair') { v = 0.8; stairs = true; } if (e.restricted) svc = true; t += e.len / v; }
  out.innerHTML = `<div class="rec"><span class="eyebrow">SIMULATED RESPONDER ROUTE</span><div class="rd">First aid → ${ZONES[zi].id}</div>
    <div class="rgrid"><div>ETA incl. 45 s dispatch<b>${fmtDur(t)}</b></div><div>Distance<b>${Math.round(p.len)} m</b></div><div>Service corridor<b>${svc ? 'used' : 'not used'}</b></div><div>Stairs<b>${stairs ? 'used' : 'none'}</b></div><div>Elevator A<b>${TWIN.cfg.outletOpen.ELEV_A ? 'available' : 'out (excluded)'}</b></div><div>Dense zones crossed<b>${dense}</b></div></div></div>
    <p class="note">Red rings mark zones at or above 3.0 p/m². The hatched band is the staff service corridor (restricted to staff and responders).</p>`;
};
OPS.dispatch = () => {
  const p = S.responder.path; if (!p) return;
  const pts = p.nodes.map(id => { const n = G.nodes.get(id); return { x: n.x, z: n.z, y: n.y || 0, id }; });
  const a = spawnResponder(pts);
  logEvent('operator', `Simulated responder dispatched to ${S.responder.incidentZone}`, { interv: true });
  if (a) { UI.toast('Simulated responder dispatched. Nearby agents yield.'); }
};
OPS.showGateRoutes = k => {
  setMode('navigate');
  S.nav.start = 'P:' + k; OPS.syncPlanner(); OPS.setDest('seat');
};
OPS.navTick = (() => { let acc = 0, app = 0; return dt => { if (S.mode !== 'navigate') return; acc += dt; app += dt; if (app > 5) { app = 0; OPS.appUsers(); } if (acc > 4) { acc = 0; if (S.role === 'responder') OPS.planResponder(); else OPS.planRoute(false); } }; })();

/* ======================= REPLAY RECORDER ======================= */
const REC = { frames: [], max: 1500, acc: 0, frame: null };
REC.record = () => {
  const m = TWIN.m;
  const n = Math.min(AG.list.length, 520);
  const f = {
    clock: m.clock, ph: phaseAt(m.clock),
    z: TWIN.est.map((e, j) => ({ N: e.N, k: e.k, v: e.v, fin: e.fin, fout: e.fout, conf: e.conf, dx: e.dx, dz: e.dz, aP: e.aP, aN: e.aN, q: e.q })),
    g: Object.fromEntries(Object.keys(GATES).map(k => [k, { open: m.cfg.gateOpen[k], Q: TWIN.gest[k].Q, e: m.g[k].e, xq: m.g[k].xq }])),
    a: Object.fromEntries(Object.keys(AMEN).map(k => [k, { Q: TWIN.aest[k].Q }])),
    seat: Object.assign({}, m.seat),
    alerts: [...TWIN.alerts.values()].map(a => ({ label: a.label, zone: a.zone, sev: a.sev })),
    na: n, ax: new Float32Array(n), az: new Float32Array(n), ay: new Float32Array(n), ah: new Float32Array(n), ak: new Uint8Array(n), ac: new Uint8Array(n)
  };
  for (let i = 0; i < n; i++) { const a = AG.list[i]; f.ax[i] = a.x; f.az[i] = a.z; f.ay[i] = a.y; f.ah[i] = a.hd; f.ak[i] = a.kind === 'resp' ? 2 : 1; f.ac[i] = a.col; }
  REC.frames.push(f);
  if (REC.frames.length > REC.max) REC.frames.shift();
};
REC.tick = dtSim => { REC.acc += dtSim; if (REC.acc >= 2) { REC.acc = 0; REC.record(); } };
REC.reset = () => { REC.frames.length = 0; REC.frame = null; REC.acc = 0; };
REC.min = () => REC.frames.length ? REC.frames[0].clock : TWIN.m.clock;
REC.max = () => REC.frames.length ? REC.frames[REC.frames.length - 1].clock : TWIN.m.clock;
REC.at = t => { const F = REC.frames; if (!F.length) return null; let lo = 0, hi = F.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (F[mid].clock <= t) lo = mid; else hi = mid - 1; } return F[lo]; };
REC.enter = () => {
  if (!REC.frames.length) REC.record();
  S.replay.t = Math.max(REC.min(), REC.max() - 120);
  S.replay.playing = false;
  REC.seek(S.replay.t, true);
  logEvent('operator', 'Replay opened');
};
REC.seek = (t, quiet) => {
  S.replay.t = clamp(t, REC.min(), REC.max());
  REC.frame = REC.at(S.replay.t);
  REC.syncUI();
  updateStands(true);
};
REC.toggle = () => { S.replay.playing = !S.replay.playing; if (S.replay.playing && S.replay.t >= REC.max() - 1) S.replay.t = REC.min(); REC.syncUI(); };
REC.play = dt => {
  if (S.mode !== 'replay') return;
  if (S.replay.playing) { S.replay.t += dt * S.replay.rate; if (S.replay.t >= REC.max()) { S.replay.t = REC.max(); S.replay.playing = false; } REC.frame = REC.at(S.replay.t); }
  REC.uiAcc = (REC.uiAcc || 0) + dt;
  if (REC.uiAcc > 0.25) { REC.uiAcc = 0; REC.syncUI(); }
};
REC.syncUI = () => {
  const s = $('rpSlider'), lo = REC.min(), hi = REC.max();
  s.min = lo; s.max = hi; if (document.activeElement !== s) s.value = S.replay.t;
  $('rpMin').textContent = fmtClock(lo); $('rpMax').textContent = fmtClock(hi) + ' (live)';
  $('rpT').textContent = fmtClock(S.replay.t);
  $('replayClock').textContent = fmtClock(S.replay.t);
  $('rpPlayIcon').setAttribute('href', S.replay.playing ? '#i-pause' : '#i-play');
  const marks = $('rpMarks');
  const evs = EVENTS.filter(e => e.clock >= lo && e.clock <= hi && !e.cleared && (['alert', 'route', 'predict'].includes(e.cat) || e.interv || (e.cat === 'sim' && /run started/.test(e.text))));
  const key = evs.length + ':' + lo + ':' + hi;
  if (marks.dataset.key !== key) {
    marks.dataset.key = key;
    const span = Math.max(1, hi - lo);
    marks.innerHTML = evs.slice(-180).map(e => `<button class="${e.cat}" style="left:${((e.clock - lo) / span * 100).toFixed(2)}%" title="${fmtClock(e.clock)} · ${esc(e.text)}" data-t="${e.clock}"></button>`).join('');
    marks.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { REC.seek(+b.dataset.t); }));
  }
};
REC.jump = cats => {
  const evs = EVENTS.filter(e => (cats === 'interv' ? (e.interv || (e.cat === 'sim' && /run started/.test(e.text))) : cats.includes(e.cat)) && !e.cleared && e.clock >= REC.min() && e.clock <= REC.max()).map(e => e.clock).sort((a, b) => a - b);
  if (!evs.length) { UI.toast('No matching events in the recorded range yet.'); return; }
  const next = evs.find(t => t > S.replay.t + 1);
  REC.seek(next !== undefined ? next : evs[0]);
};
REC.gateHist = k => REC.frames.slice(-300).map(f => [f.clock, f.g[k].e, f.g[k].Q]);
REC.init = () => {
  $('rpPlay').addEventListener('click', REC.toggle);
  $('rpBack').addEventListener('click', () => REC.seek(S.replay.t - 10));
  $('rpFwd').addEventListener('click', () => REC.seek(S.replay.t + 10));
  $('rpRate').addEventListener('change', e => { S.replay.rate = +e.target.value; });
  $('rpAlert').addEventListener('click', () => REC.jump(['alert']));
  $('rpInterv').addEventListener('click', () => REC.jump('interv'));
  $('rpReset').addEventListener('click', () => setMode('mirror'));
  $('rpSlider').addEventListener('input', e => REC.seek(+e.target.value));
};
