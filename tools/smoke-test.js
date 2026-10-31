// Smoke test: serves the repo, opens the demo in headless Chromium, switches through all five
// modes, runs one what-if scenario and fails on any page error.
// Usage: npm install && npm test
'use strict';
const { chromium } = require('playwright');
const { createServer } = require('./serve.js');
const PORT = 8782;

(async () => {
  const server = createServer().listen(PORT);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Resource failures are checked by URL: only the repo's own files count (web fonts are optional).
  page.on('requestfailed', r => { if (r.url().startsWith(`http://localhost:${PORT}/`)) errors.push(`failed to load ${r.url()}`); });
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => document.getElementById('loading').hidden || getComputedStyle(document.getElementById('loading')).display === 'none', null, { timeout: 180000 });
  const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(name); };
  check('twin initialised with 10 zones', await page.evaluate(() => TWIN && TWIN.est.length === 10));
  for (const mode of ['mirror', 'predict', 'simulate', 'navigate', 'replay']) {
    await page.click(`button[data-mode="${mode}"]`);
    await page.waitForTimeout(800);
    check(`mode ${mode}`, await page.evaluate(m => S.mode === m, mode));
  }
  await page.click('button[data-mode="simulate"]');
  await page.click('button[data-scen="gate_open"]');
  await page.click('#scRun');
  await page.waitForFunction(() => S.scenario && S.scenario.fast && S.scenario.fast.done, null, { timeout: 600000, polling: 2000 });
  check('Gate D scenario shortens queue clearance', await page.evaluate(() => S.scenario.fast.ri.clearance < S.scenario.fast.rb.clearance));
  await browser.close(); server.close();
  if (errors.length) { console.error('\nErrors:\n' + errors.join('\n')); process.exit(1); }
  console.log('\nAll checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
