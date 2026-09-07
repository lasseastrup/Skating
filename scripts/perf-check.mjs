// Headless perf + determinism gate. Serves the production build, opens it in Chromium with a
// phone viewport and 4x CPU throttling, samples the loop for a few seconds, and prints budgets.
//
// Caveat printed with the results: headless Chromium here rasterises WebGL in software
// (SwiftShader), so GPU-bound numbers are pessimistic and not a phone. The CPU-side sim/JS
// numbers and the draw-call / triangle counts are exact.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 5199;
const SCENES = (process.env.SCENES ?? 'main,playground').split(',');
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 5000);
const CPU_THROTTLE = Number(process.env.CPU_THROTTLE ?? 4);
const LOW_RES = process.env.LOW_RES === '1';
const BUDGET = { frameMs: 14, drawCalls: 80, triangles: 120_000 };

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find(existsSync);

function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const onData = (d) => {
      if (String(d).includes(`${PORT}`)) resolve(proc);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (c) => reject(new Error(`preview exited ${c}`)));
    setTimeout(() => reject(new Error('preview did not start')), 15000);
  });
}

async function measureScene(browser, scene) {
  const ctx = await browser.newContext({
    viewport: LOW_RES ? { width: 200, height: 432 } : { width: 390, height: 844 },
    deviceScaleFactor: LOW_RES ? 1 : 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  await page.goto(`http://localhost:${PORT}/?scene=${scene}&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__coping && window.__coping.loop.stats.renderFramesTotal > 30, null, {
    timeout: 20000,
  });

  // Sample frame times in-page so the harness doesn't perturb the loop.
  const result = await page.evaluate(async (ms) => {
    const stats = window.__coping.loop.stats;
    const frames = [];
    const sims = [];
    const draws = [];
    const start = performance.now();
    await new Promise((done) => {
      const tick = () => {
        frames.push(stats.frameMs);
        sims.push(stats.simMs);
        draws.push(stats.renderMs);
        if (performance.now() - start < ms) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    frames.sort((a, b) => a - b);
    const q = (p) => frames[Math.min(frames.length - 1, Math.floor(p * frames.length))];
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    const simAvg = sims.reduce((a, b) => a + b, 0) / sims.length;
    const drawAvg = draws.reduce((a, b) => a + b, 0) / draws.length;
    const snap = window.__coping.snapshot();
    const det = window.__coping.runDeterminism(2400);
    return { n: frames.length, avg, p50: q(0.5), p95: q(0.95), max: frames[frames.length - 1], simAvg, drawAvg, snap, det };
  }, SAMPLE_MS);

  await ctx.close();
  return { scene, errors, ...result };
}

const preview = await startPreview();
let exitCode = 0;
try {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  console.log(`chromium ${browser.version()}  cpu throttle ${CPU_THROTTLE}x  viewport ${LOW_RES ? '200x432@1x (LOW_RES)' : '390x844@3x'}  sample ${SAMPLE_MS}ms`);
  console.log('NOTE: software WebGL (SwiftShader). Frame times are not a phone. Draw calls, tris, sim ms and determinism are exact.\n');
  for (const scene of SCENES) {
    const r = await measureScene(browser, scene);
    const s = r.snap;
    const ok = (v, b) => (v <= b ? 'ok ' : 'OVER');
    console.log(`[${r.scene}]`);
    const work = r.simAvg + r.drawAvg;
    console.log(`  interval avg ${r.avg.toFixed(2)}ms  p50 ${r.p50.toFixed(2)}  p95 ${r.p95.toFixed(2)}  max ${r.max.toFixed(2)}  (${r.n} frames; 16.7 = vsync-locked 60Hz)`);
    console.log(`  cpu work ${work.toFixed(3)}ms/frame  (sim ${r.simAvg.toFixed(3)} + render ${r.drawAvg.toFixed(3)} JS-side incl. GL submit)  budget ${BUDGET.frameMs}ms ${ok(work, BUDGET.frameMs)}`);
    console.log(`  sim      steps ${s.simStepsTotal}  dropped ${s.droppedSteps}`);
    console.log(`  draw    calls ${s.drawCalls}/${BUDGET.drawCalls} ${ok(s.drawCalls, BUDGET.drawCalls)}  tris ${s.triangles}/${BUDGET.triangles} ${ok(s.triangles, BUDGET.triangles)}  programs ${s.programs}  geometries ${s.geometries}  textures ${s.textures}`);
    console.log(`  determ  ${r.det.ok ? 'OK' : 'FAIL'}  ${r.det.steps} steps  hash ${r.det.hashA}${r.det.ok ? '' : ' != ' + r.det.hashB + ' at step ' + r.det.firstDivergence}  ${r.det.ms.toFixed(1)}ms`);
    if (r.errors.length) {
      console.log(`  errors  ${r.errors.length}`);
      for (const e of r.errors) console.log('    ' + e);
    }
    if (!r.det.ok || work > BUDGET.frameMs || s.drawCalls > BUDGET.drawCalls || s.triangles > BUDGET.triangles || r.errors.length) exitCode = 1;
    console.log('');
  }
  await browser.close();
} finally {
  preview.kill();
}
process.exit(exitCode);
