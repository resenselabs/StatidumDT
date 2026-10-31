// Regenerates the synthetic game-day dataset by running the demo's own model headlessly.
// Usage: npm install && npm run generate-data            (writes to data/generated/)
//        node tools/generate-dataset.js <output-folder>
// three.js is replaced by tools/three-stub.js (rendering only); the crowd model runs unchanged.
// The demo seeds its random numbers, but the page draws some while loading, so sensor noise
// can differ slightly from the shipped dataset in data/synthetic_game_day/.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createServer, ROOT } = require('./serve.js');

const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'data', 'generated'));
const PORT = 8781;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = createServer().listen(PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.route(/vendor\/three\/three\.min\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'three-stub.js')) }));
  await page.route(/vendor\/three\/OrbitControls\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => typeof TWIN !== 'undefined' && TWIN, null, { timeout: 120000 });
  await page.waitForTimeout(2000);

  const r = await page.evaluate(() => {
    const Z = [], G = [], A = [], E = [];
    const record = seg => {
      const c = fmtClock(TWIN.m.clock), ph = phaseLabel(phaseAt(TWIN.m.clock));
      TWIN.est.forEach((e, j) => Z.push([c, ph, seg, ZONES[j].id, ZONES[j].area, Math.round(TWIN.m.z[j].N), Math.round(e.N), e.k.toFixed(2), densLevel(e.k).label, e.v.toFixed(2), e.dir, Math.round(e.fin), Math.round(e.fout), Math.round(e.q), e.conf.toFixed(2), (e.src.cctv || 0).toFixed(2), (e.src.wifi || 0).toFixed(2), (e.src.model || 0).toFixed(2)]));
      for (const k in TWIN.gest) { const g = TWIN.gest[k]; G.push([c, ph, seg, k, TWIN.cfg.gateOpen ? String(TWIN.cfg.gateOpen[k] !== false) : '', (+g.thr).toFixed(1), Math.round(g.Q), g.conf]); }
      for (const k in TWIN.aest) A.push([c, ph, seg, k, AMEN[k].type, Math.round(TWIN.aest[k].Q), AMEN[k].qcap, TWIN.aest[k].conf]);
    };
    // Twin advances in 0.5 s steps (sensing every 1 s, rules every 2 s); one record per simulated minute.
    const runSegment = (seg, start, end) => {
      EVENTS.length = 0; TWIN.init(start);
      while (TWIN.m.clock < end) { record(seg); for (let s = 0; s < 120; s++) TWIN.step(0.5); }
      for (const e of EVENTS) E.push([fmtClock(e.clock), seg, e.cat, e.text.replace(/<[^>]+>/g, '')]);
    };
    runSegment('A_continuous_18:30-22:33', T('18:30'), T('22:34'));
    // A continuous run never starts post-game egress, so the model is re-initialised at the final
    // whistle with the seated catchment released (what the demo does when POST-GAME is selected).
    runSegment('B_postgame_reinit_22:34', T('22:34'), T('23:00'));
    return { Z, G, A, E };
  });

  const esc = v => /[,"]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
  const write = (name, header, rows) => fs.writeFileSync(path.join(OUT, name), [header, ...rows.map(x => x.map(esc).join(','))].join('\n') + '\n');
  write('zones.csv', 'time,phase,segment,zone_id,area_m2,true_people,estimated_people,density_ppm2,density_level,speed_mps,flow_direction,inflow_per_min,outflow_per_min,amenity_queue,confidence,weight_cctv,weight_wifi,weight_model', r.Z);
  write('gates.csv', 'time,phase,segment,gate,open,throughput_per_min,queue_people,confidence', r.G);
  write('amenities.csv', 'time,phase,segment,amenity,type,queue_people,queue_capacity,confidence', r.A);
  write('events.csv', 'time,segment,category,text', r.E);
  console.log(`Wrote ${r.Z.length} zone rows, ${r.G.length} gate rows, ${r.A.length} amenity rows and ${r.E.length} events to ${OUT}`);
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
