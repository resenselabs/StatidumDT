'use strict';
/* =====================================================================
   STADIUM-DT main loop and boot sequence
   The live twin advances in fixed 0.5 s substeps of simulated time; rendering,
   agents and the interface run every animation frame.
   ===================================================================== */
const MAIN = { last: 0, acc: 0, fpsT: 0, fpsN: 0, fps: 60, low: false, started: false };
const START_CLOCK = T('19:06');
const PREROLL = 420;                       // seconds of synthetic history recorded before the first frame
const SPEEDS = [1, 2, 5, 10];

function agentStep(model, dtA) {
  if (dtA <= 0) return;
  spawnFromModel(model, dtA);
  let rem = Math.min(dtA, 1.5);
  while (rem > 1e-6) { const h = Math.min(0.1, rem); stepAgents(h, model); rem -= h; }
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.max(0, (now - MAIN.last) / 1000);
  const dt = Math.min(0.1, raw || 0.016);
  MAIN.last = now;

  // live twin: fixed substeps of simulated time
  let dtSim = 0;
  if (!S.paused) {
    MAIN.acc += dt * S.speed;
    let n = 0;
    while (MAIN.acc >= 0.5 && n < 12) { TWIN.step(0.5); REC.tick(0.5); MAIN.acc -= 0.5; dtSim += 0.5; n++; }
    if (n === 12) MAIN.acc = 0;
  }
  if (TWIN.job) TWIN.forecastWork(MAIN.low ? 4 : 8);
  standingWork();

  // scenario lab (comparison computed in slices, playback at the chosen speed)
  OPS.tick(dt);
  OPS.navTick(dt);
  decayRecommendations(dt * S.speed);
  REC.play(dt);

  // agents follow whichever model is on display
  if (S.mode !== 'replay') {
    const sc = S.mode === 'simulate' && S.scenario && S.scenario.run;
    if (sc) agentStep(displayModel(), S.scenario.run.playing ? dt * S.scenario.speed : 0);
    else agentStep(TWIN.m, S.paused ? 0 : dt * S.speed);
  }
  const dtView = S.mode === 'simulate' && S.scenario && S.scenario.run ? (S.scenario.run.playing ? dt * S.scenario.speed : 0) : dtSim;
  updateView(dt, dtView);
  uiTick(dt);

  // adaptive detail: drop pixel ratio if the frame rate stays low
  MAIN.fpsN++; MAIN.fpsT += Math.min(raw, 1);
  if (MAIN.fpsT > 2) {
    MAIN.fps = MAIN.fpsN / MAIN.fpsT; MAIN.fpsN = 0; MAIN.fpsT = 0;
    if (MAIN.fps < 32 && !MAIN.low) { MAIN.low = true; W3.renderer.setPixelRatio(1); W3.renderer.shadowMap.autoUpdate = false; AG.max = 600; onResize(); }
  }
}

function setSpeed(v) {
  S.speed = v;
  const b = $('clockSpeed');
  b.textContent = S.paused ? 'II' : v + '×';
  b.setAttribute('aria-label', S.paused ? 'Demo clock paused' : `Demo clock speed ${v}×`);
}
function initClockControls() {
  const b = $('clockSpeed');
  b.addEventListener('click', e => {
    e.stopPropagation();
    if (S.paused) { S.paused = false; setSpeed(S.speed); return; }
    const i = SPEEDS.indexOf(S.speed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
    logEvent('operator', `Demo clock speed ${S.speed}×`);
  });
  b.addEventListener('contextmenu', e => { e.preventDefault(); S.paused = !S.paused; setSpeed(S.speed); });
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'p' || e.key === 'P') { S.paused = !S.paused; setSpeed(S.speed); logEvent('operator', S.paused ? 'Demo clock paused' : 'Demo clock resumed'); }
    if (e.key === '.') { const i = SPEEDS.indexOf(S.speed); setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]); }
    if (e.key === ',') { const i = SPEEDS.indexOf(S.speed); setSpeed(SPEEDS[Math.max(0, i - 1)]); }
  });
}

/* run the twin and the agents for a few minutes so the scene, sparklines and replay
   start with synthetic history instead of an empty venue */
function preroll() {
  TWIN.init(START_CLOCK - PREROLL);
  let t = 0;
  while (t < PREROLL) {
    TWIN.step(0.5); t += 0.5;
    if (TWIN.job) TWIN.forecastWork(20);
    spawnFromModel(TWIN.m, 0.5); for (let i = 0; i < 5; i++) stepAgents(0.1, TWIN.m);
    if (t === 160) {
      // one recorded intervention in the synthetic history so the replay has something to jump to
      TWIN.cfg.extraServers.REST_A = 4;
      logEvent('operator', 'Demo history (synthetic): overflow facility opened beside Restroom A (+4 fixtures)', { zone: zoneIdxAt(ATT.REST_A.x), interv: true });
    }
    REC.tick(0.5);
  }
  if (TWIN.job) while (TWIN.job) TWIN.forecastWork(20); else TWIN.forecast();
}

function bootError(msg) {
  const l = $('loading');
  l.hidden = false;
  l.querySelector('.spinner').style.display = 'none';
  $('loadingT').innerHTML = `<b>STADIUM-DT could not start.</b><br>${esc(msg)}`;
}

function boot() {
  if (typeof THREE === 'undefined' || !THREE.OrbitControls) { bootError('Three.js did not load from the CDN (cdn.jsdelivr.net). Check the network connection and reload.'); return; }
  try {
    initScene();
    new Twin();
    logEvent('system', 'STADIUM-DT concept demo started. All data are synthetic.');
    logEvent('system', 'Sources: synthetic CCTV aggregate counts, synthetic WiFi association counts (30 s windows), synthetic turnstile counts. No images, identities or device IDs.');
    preroll();
    logEvent('system', `Live synthetic twin at ${fmtClock(TWIN.m.clock)}. Replay holds ${Math.round(PREROLL / 60)} min of recorded synthetic history.`);
    initLabels(); initTopbar(); initOverlays(); initProcess(); initSearch();
    OPS.initPlanner(); REC.init(); initPointer(); initClockControls();
    $('labClose').addEventListener('click', () => setMode('mirror'));
    document.body.dataset.mode = S.mode;
    setSheet('right');
    $('modeQ').textContent = MODEQ[S.mode];
    applyEnvironment();
    S.area = 'overview'; W3.camera.position.set(...AREAS.overview.pos); W3.controls.target.set(...AREAS.overview.tgt); V3.glide = null;
    updateStands(true); updateKPIs(); updateTopbar(); renderPanel(true); renderProcess(true); setTab('zones'); OPS.renderLab();
    setSpeed(1);
    $('loading').hidden = true;
    MAIN.last = performance.now();
    MAIN.started = true;
    requestAnimationFrame(frame);
    // open on the pilot concourse after a short establishing view
    setTimeout(() => { if (S.area === 'overview' && !S.sel) goArea('concourse'); }, 2600);
  } catch (err) {
    console.error(err);
    bootError(err && err.message ? err.message : String(err));
  }
}

/* wait briefly for the display font so canvas signs and scoreboards use it */
function start() {
  const fontWait = document.fonts && document.fonts.load ? Promise.all([
    document.fonts.load('700 48px "Big Shoulders Display"'), document.fonts.load('600 16px "JetBrains Mono"'), document.fonts.load('500 14px "Figtree"')
  ]).catch(() => null) : Promise.resolve();
  Promise.race([fontWait, new Promise(r => setTimeout(r, 1800))]).then(() => setTimeout(boot, 20));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
