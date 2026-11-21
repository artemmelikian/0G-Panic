const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const hangarPath = process.argv[2];
const outDir = process.argv[3];
const src = fs.readFileSync(hangarPath, 'utf8');

const num = (name) => {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
  if (!m) throw new Error('not found: ' + name);
  return m[1];
};
const block = (name) => {
  const start = src.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0, i = src.indexOf('[', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') depth++;
    if (src[j] === ']') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unterminated ' + name);
};
const C = {
  TILE: eval(num('TILE')), GRID_W: 30, GRID_H: 15, OX: 40, OY: 80,
  WALL: eval(num('WALL')), WALL_H: eval(num('WALL_H')), FRONT_WALL_H: eval(num('FRONT_WALL_H')),
  LOW_H: eval(num('LOW_H')), HIGH_H: eval(num('HIGH_H')),
  CAMERA_TILT_DEG: Number(num('CAMERA_TILT').match(/DegToRad\(([\d.]+)\)/)[1]),
  CAMERA_DIST: eval(num('CAMERA_DIST')),
  SCREEN_BOX: eval('(' + num('SCREEN_BOX') + ')'),
};
{ const m = src.match(/const GRID_W = (\d+), GRID_H = (\d+);/); C.GRID_W = +m[1]; C.GRID_H = +m[2]; }
{ const m = src.match(/const OX = (\d+), OY = (\d+);/); C.OX = +m[1]; C.OY = +m[2]; }
const FRONT_WALL_H = C.FRONT_WALL_H;
const MODE = process.argv[4] || 'hangar';
const WALLS = eval(block('WALLS'));
const STATIONS = eval(block(MODE === 'ship' ? 'SHIP_STATIONS' : MODE === 'surface' ? 'SURF_STATIONS' : 'STATIONS'));
const X = {};
if (MODE === 'ship') X.ring = eval('(' + num('SHIP') + ')');
if (MODE === 'surface') { X.ring = eval('(' + num('LANDER') + ')'); X.rocks = eval(block('SURF_ROCKS')); }
const PREFIX = { hangar: 'lvl_', ship: 'shp_', surface: 'srf_' }[MODE];
const FOLDER = { hangar: 'level', ship: 'ship', surface: 'surface' }[MODE];

const SCALE = Number(process.env.LEVEL_SCALE || 2);

const root = __dirname;
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(8799, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => { if (!m.text().includes('GL Driver')) console.log('page:', m.text()); });
  await page.goto('http://localhost:8799/level.html');
  await page.waitForFunction(() => window.READY, null, { timeout: 120000 });
  const t0 = Date.now();
  const result = await page.evaluate(([C, WALLS, STATIONS, SCALE, MODE, X]) => window.renderLevel(C, WALLS, STATIONS, SCALE, MODE, X),
    [C, WALLS, STATIONS, SCALE, MODE, X]);
  console.log(`rendered ${result.layers.length} layers in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(outDir, f));
  const v = Date.now();
  const files = [];
  const meta = { scale: SCALE, layers: [] };
  for (const L of result.layers) {
    fs.writeFileSync(path.join(outDir, L.key + '.png'), Buffer.from(L.data.split(',')[1], 'base64'));
    files.push({ type: 'image', key: PREFIX + L.key, url: `assets/${FOLDER}/${L.key}.png?v=${v}` });
    meta.layers.push({ key: PREFIX + L.key, x: L.x, y: L.y, depth: L.depth });
  }
  fs.writeFileSync(path.join(outDir, 'pack.json'), JSON.stringify({ [FOLDER]: { files } }, null, 1));
  fs.writeFileSync(path.join(outDir, 'level.json'), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(outDir, '..', `${FOLDER}_preview.png`), Buffer.from(result.preview.split(',')[1], 'base64'));
  await browser.close();
  server.close();
})();
