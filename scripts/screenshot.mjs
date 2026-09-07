// Screenshots both scenes with the debug overlay visible. Output: scratch/<scene>.png (or OUT_DIR).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 5198;
const OUT = process.env.OUT_DIR ?? 'scratch';
mkdirSync(OUT, { recursive: true });
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
try {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  for (const scene of ['main', 'playground']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/?scene=${scene}&debug=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__coping && window.__coping.loop.stats.renderFramesTotal > 60, null, { timeout: 20000 });
    // Hold "forward" on the keyboard for a moment so the box is mid-motion.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${scene}.png` });
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
    await ctx.close();
    console.log(`wrote ${OUT}/${scene}.png`);
  }
  await browser.close();
} finally {
  preview.kill();
}
