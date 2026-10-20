/* Boot the built site in a headless browser and fail loudly if it does not play.
 *
 *   node web/tools/smoke_test.mjs [site-dir]
 *
 * A green build does not prove the game starts: the shell can be broken, the
 * wasm can be served with the wrong type, or the compressed loader can fail to
 * hand bytes to Emscripten. This checks the page reaches onRuntimeInitialized
 * and logs any console/page/network error, then writes a screenshot for review.
 *
 * Requires Playwright (`npm i playwright && npx playwright install chromium`).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(process.argv[2] || 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = join(ROOT, decodeURIComponent(url.pathname));
    try {
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    } catch { path = join(ROOT, 'index.html'); }   // client-side route fallback
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const port = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
const base = `http://127.0.0.1:${port}/`;

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
});

const problems = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));

  await page.goto(`${base}?autostart=1`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => document.body.classList.contains('playing'), null, { timeout: 180_000 });

  // Leave the title screen to prove input and the frame loop are live.
  await page.keyboard.press('Space');
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => ({
    canvas: [document.getElementById('canvas').width, document.getElementById('canvas').height],
    err: (document.getElementById('err').textContent || '').trim(),
  }));
  if (state.err) problems.push(`in-page error: ${state.err}`);
  if (!state.canvas[0] || !state.canvas[1]) problems.push('canvas has no size');

  await page.screenshot({ path: 'smoke.png' });
  console.log(`engine booted, canvas ${state.canvas[0]}x${state.canvas[1]}, screenshot -> smoke.png`);
} catch (e) {
  problems.push(`boot failed: ${e.message}`);
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error('\nsmoke test FAILED:');
  for (const p of [...new Set(problems)]) console.error('  - ' + p);
  process.exit(1);
}
console.log('smoke test passed');
