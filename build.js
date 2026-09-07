#!/usr/bin/env node
/**
 * build.js — flattens the app into one self-contained HTML file.
 *
 * The modular source is what you edit; the single file is what you hand to
 * someone. No dependencies, no bundler config: the modules only import each
 * other by relative path, so concatenating them in dependency order and
 * dropping the import/export keywords is a correct bundle.
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const ORDER = ['src/acoustics.js', 'src/brir.js', 'src/venues.js', 'src/engine.js', 'src/app.js'];

const flatten = (src) => src
  .replace(/^import[\s\S]*?from\s*['"][^'"]*['"];?[ \t]*$/gm, '')
  .replace(/^export\s*\{[\s\S]*?\}\s*;?[ \t]*$/gm, '')
  .replace(/^export\s+(default\s+)?(async\s+function|function|const|let|var|class)\b/gm, '$2');

const bundle = ORDER.map((f) => `/* ===== ${f} ===== */\n${flatten(read(f))}`).join('\n');
const css = read('src/style.css');
const html = read('index.html');

const body = html
  .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script type="module"[\s\S]*?<\/script>/, '')
  .trim();

const fontLink = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];

const out = `<title>Sound Stage</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLink}
<style>
${css}
</style>
${body}
<script type="module">
${bundle}
</script>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/sound-stage.html'), out);
console.log(`dist/sound-stage.html — ${(out.length / 1024).toFixed(1)} kB`);
