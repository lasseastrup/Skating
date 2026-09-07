// Collapse the Vite build into one self-contained HTML file (dist/coping.html) so the game can be
// hosted anywhere a single static page works. Run `vite build` first.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('dist');
let html = readFileSync(resolve(dist, 'index.html'), 'utf8');

html = html.replace(/<script type="module"[^>]*src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_m, src) => {
  const js = readFileSync(resolve(dist, src), 'utf8').replace(/<\/script/g, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});
html = html.replace(/<link rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/g, (_m, href) => {
  return `<style>\n${readFileSync(resolve(dist, href), 'utf8')}\n</style>`;
});
html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');

const out = resolve(dist, 'coping.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
