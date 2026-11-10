// Krillion Latin UI audit: visits every page and game state, applies every theme preset, and
//  1. measures the contrast of every visible piece of text against what is really behind it,
//  2. flags text that spills out of its box or is cut off, and things pushed off-screen,
//  3. saves a screenshot of each screen in each theme.
//
// Run (needs playwright-core and Google Chrome):
//   python3 -m http.server 8765            # in the repo folder
//   node tools/ui-audit.js /path/to/output  [--themes lantern,parchment] [--only island]
// Output: <out>/report.txt plus <out>/<screen>--<theme>.png
// Text over a game canvas (no solid panel behind it) is skipped: its background is the game world.
const { chromium } = require('playwright-core');
const fs = require('fs');

const OUT = process.argv[2] || './ui-audit-out';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--base') || 'http://localhost:8765/';
const ONLY = arg('--only');
fs.mkdirSync(OUT, { recursive: true });

// ---------- runs inside the page ----------
function auditPage() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const rgba = (str) => {
    if (cache.has(str)) return cache.get(str);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data, v = [d[0], d[1], d[2], d[3] / 255];
    cache.set(str, v); return v;
  };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (!a) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const gradColors = (img) => (img.match(/(rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|#[0-9a-f]{3,8})/gi) || []).map(rgba);
  const name = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) return s + '#' + el.id;
    if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    const p = el.parentElement;
    return (p ? (p.id ? '#' + p.id : p.classList[0] ? '.' + p.classList[0] : p.tagName.toLowerCase()) + ' > ' : '') + s;
  };
  // what is behind el: composite background layers up the tree until something opaque
  function backdrop(el) {
    const layers = []; let canvas = false, node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      let bg = rgba(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        const cols = gradColors(cs.backgroundImage);
        if (cols.length) {
          const opaque = cols.filter((c) => c[3] > 0.5);
          if (opaque.length) { // average the solid stops of a gradient
            const avg = [0, 1, 2].map((i) => opaque.reduce((a, c) => a + c[i], 0) / opaque.length);
            bg = over([...avg, Math.min(...opaque.map((c) => c[3]))], bg);
          }
        }
      }
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] >= 0.85) break;
      if (node.id === 'gamePage' || node.classList.contains('game-page')) { canvas = true; break; }
      node = node.parentElement;
    }
    // reached the game page without a solid panel: the backdrop is the game canvas
    if (canvas && !layers.some((l) => l[3] >= 0.85)) return null;
    let c = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    if (!layers.length) c = rgba(getComputedStyle(document.body).backgroundColor);
    return c;
  }
  const issues = [], seen = new Set();
  const vw = innerWidth, vh = innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'CANVAS', 'svg', 'OPTION'].includes(el.tagName)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own || !/[\p{L}\p{N}]/u.test(own)) continue;
    if (!el.checkVisibility || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    // is something else drawn on top of it? (hidden under a modal, etc.)
    const mx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), my = Math.min(vh - 1, Math.max(0, r.top + Math.min(r.height / 2, 10)));
    const topEl = document.elementFromPoint(mx, my);
    if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
      const tcs = getComputedStyle(topEl);
      if (tcs.pointerEvents !== 'none') continue; // covered by something: not visible to the user
    }
    let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    if (op < 0.5) continue; // deliberately faded (disabled, unavailable)
    if (el.closest(':disabled, [aria-disabled="true"]')) continue;
    const cs = getComputedStyle(el);
    const fg = rgba(cs.color);
    const bg = backdrop(el);
    const key = name(el) + '|' + own.slice(0, 30);
    if (seen.has(key)) continue; seen.add(key);
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (bg) {
      const f = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
      const k = ratio(f, bg);
      if (k < need) issues.push({ kind: 'contrast', el: name(el), text: own.slice(0, 40), ratio: Math.round(k * 100) / 100, need });
    }
    // text cut off or spilling
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && cs.whiteSpace.includes('nowrap')) issues.push({ kind: 'spill', el: name(el), text: own.slice(0, 40) });
    if (r.right > vw + 1 || r.left < -1) issues.push({ kind: 'offscreen', el: name(el), text: own.slice(0, 40) });
  }
  return issues;
}

// ---------- helpers ----------
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); // WebGL on, for the storm film
  const report = [];
  const errs = [];
  const newPage = async (name, opts = {}) => {
    const c = await b.newContext({ viewport: { width: 1366, height: 768 }, ...opts });
    // no color transitions: otherwise a theme switch can be measured mid-fade
    await c.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*, *::before, *::after { transition: none !important; }'; document.head.append(s); }));
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(name + ': ' + m.text()));
    await p.goto(BASE + '#/dashboard'); await p.waitForTimeout(400);
    return p;
  };
  const presets = await (async () => { const p = await newPage('probe'); const r = await p.evaluate(() => Theme.PRESETS); await p.context().close(); return r; })();
  const want = arg('--themes') ? arg('--themes').split(',') : presets.map((x) => x.id);
  const themes = presets.filter((x) => want.includes(x.id));
  const sweep = async (p, screen, prep) => {
    if (ONLY && !screen.includes(ONLY)) return;
    for (const th of themes) {
      await p.evaluate((t) => Theme.save({ accent: t.accent, mode: t.mode, tint: t.tint, preset: t.id }), th);
      if (prep) await prep(); else await p.waitForTimeout(400); // let color transitions finish
      const issues = await p.evaluate(auditPage);
      await p.screenshot({ path: `${OUT}/${screen}--${th.id}.png` });
      for (const i of issues) report.push({ screen, theme: th.id, ...i });
    }
    console.log('checked', screen);
  };

  // ---------- site pages ----------
  {
    const p = await newPage('site');
    const setId = 'subjunctive-all';
    for (const [screen, hash, extra] of [
      ['dashboard', '#/dashboard'], ['sets', '#/sets'], ['set-page', '#/set/' + setId], ['editor-new', '#/sets/new'],
      ['host-puffer', '#/host/' + setId], ['host-factory', '#/host/' + setId, '.mode[data-mode="factory"]'], ['host-island', '#/host/' + setId, '.mode[data-mode="island"]'],
      ['characters', '#/characters'], ['join', '#/join'], ['signin', '#/signin'], ['profile', '#/profile'],
    ]) {
      if (ONLY && !screen.includes(ONLY)) continue;
      await p.goto(BASE + hash); await p.waitForTimeout(400);
      if (extra) { await p.click(extra); await p.waitForTimeout(150); }
      await sweep(p, screen);
    }
    // phone width
    await p.setViewportSize({ width: 390, height: 844 });
    for (const [screen, hash] of [['phone-dashboard', '#/dashboard'], ['phone-host', '#/host/' + setId]]) {
      if (ONLY && !screen.includes(ONLY)) continue;
      await p.goto(BASE + hash); await p.waitForTimeout(400); await sweep(p, screen);
    }
    await p.context().close();
  }

  // ---------- Pufferfish Party ----------
  if (!ONLY || 'puffer'.includes(ONLY) || ONLY.includes('puffer')) {
    const h = await newPage('puffer-host');
    await h.goto(BASE + '#/host/present-subjunctive'); await h.waitForTimeout(400);
    await h.fill('#hName', 'Magistra'); await h.click('#hLives [data-v="1"]'); await h.click('#hGo'); await h.waitForTimeout(1500);
    const code = (await h.textContent('#lobbyCode')).trim();
    const g = await newPage('puffer-guest', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); // guest on a phone
    await g.goto(BASE + '#/join/' + code); await g.waitForTimeout(300); await g.fill('#jName', 'Quintus'); await g.click('#jGo');
    await h.waitForFunction(() => /2 players/.test(document.querySelector('#gPlayers').textContent), null, { timeout: 15000 });
    await sweep(h, 'puffer-lobby-host'); await sweep(g, 'puffer-lobby-guest');
    await h.click('#startBtn'); await h.waitForTimeout(2500);
    await sweep(h, 'puffer-play-host'); await sweep(g, 'puffer-play-guest');
    await h.click('#chatToggle'); await h.waitForTimeout(200); await sweep(h, 'puffer-chat');
    await h.waitForSelector('#overModal:not([hidden])', { timeout: 90000 }); await h.waitForTimeout(1200);
    await sweep(h, 'puffer-over');
    await h.context().close(); await g.context().close();
  }

  // ---------- Factory and Survival Island ----------
  const movement = async (mode) => {
    if (ONLY && !mode.includes(ONLY) && !ONLY.includes(mode)) return;
    const p = await newPage(mode);
    await p.goto(BASE + '#/host/subjunctive-all'); await p.waitForTimeout(400);
    await p.click(`.mode[data-mode="${mode}"]`); await p.fill('#hName', 'Marcus'); await p.click('#hGo');
    await p.waitForTimeout(1600);
    await sweep(p, mode + '-lobby');
    await p.click('#startBtn');
    const M = mode === 'island' ? 'Island' : 'Factory';
    await p.waitForFunction((m) => window[m].debug().started, M, { timeout: 12000 });
    await p.waitForSelector('#fxqChoices .tile', { timeout: 8000 });
    await sweep(p, mode + '-quiz');
    const hostId = await p.evaluate(() => Game.debugState().hostId);
    const right = await p.evaluate(({ m, id }) => window[m].host.qstate.get(id).cur.right, { m: M, id: hostId });
    for (const t of await p.$$('#fxqChoices .tile')) if (!(await t.textContent()).includes(right)) { await t.click(); break; }
    await p.waitForTimeout(3300); await sweep(p, mode + '-quiz-wrong');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.evaluate(({ id }) => { const s = Game.debugState(); s.fx.energy[id] = 30; }, { id: hostId });
    if (mode === 'island') {
      await p.evaluate((id) => { const f = Game.debugState().fx; f.pack[id] = [0, 6, 13, 18]; f.money[id] = 260; }, hostId);
      await p.evaluate(() => { const t = Island.debug().trader; Island.test.warp(t.x, t.y + 8); });
      await p.waitForTimeout(500); await sweep(p, 'island-play');
      await p.evaluate(() => { const t = Island.debug().market; Island.test.warp(t.x, t.y + 8); }); await p.waitForTimeout(300);
      await p.keyboard.press('e'); await p.waitForTimeout(500);
      await p.click('#isParts [data-part="h1"]'); await p.waitForTimeout(500);
      await sweep(p, 'island-shop');
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      await p.evaluate((id) => { Game.debugState().fx.energy[id] = 0; }, hostId); await p.waitForTimeout(600);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      await sweep(p, 'island-frozen');
      await p.evaluate(() => { Game.debugState().fx.endAt = Date.now() + 200; });
      await p.waitForFunction(() => Game.debugState().phase === 'voyage', null, { timeout: 5000 });
      await p.evaluate(() => { Game.debugState().fx.voyage.endsAt = Date.now() + 60000; }); // the film is long; hold it, then end it
      await p.waitForTimeout(9000); await sweep(p, 'island-voyage');
      await p.evaluate(() => { Game.debugState().fx.voyage.endsAt = Date.now(); });
      await p.waitForFunction(() => Game.debugState().phase === 'over', null, { timeout: 40000 }); await p.waitForTimeout(800);
      await sweep(p, 'island-over');
    } else {
      await p.evaluate((id) => { const f = Game.debugState().fx; f.held[id] = 17; f.money[id] = 420; }, hostId);
      await p.waitForTimeout(500); await sweep(p, 'factory-play');
      await p.evaluate((id) => { Game.debugState().fx.energy[id] = 0; }, hostId); await p.waitForTimeout(600);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      await sweep(p, 'factory-frozen');
      await p.evaluate(() => { Game.debugState().fx.endAt = Date.now() + 200; });
      await p.waitForSelector('#overModal:not([hidden])', { timeout: 8000 }); await p.waitForTimeout(800);
      await sweep(p, 'factory-over');
    }
    await p.context().close();
    // phone
    const ph = await newPage(mode + '-phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await ph.goto(BASE + '#/host/subjunctive-all'); await ph.waitForTimeout(400);
    await ph.click(`.mode[data-mode="${mode}"]`); await ph.fill('#hName', 'Livia'); await ph.click('#hGo'); await ph.waitForTimeout(1600);
    await sweep(ph, mode + '-phone-lobby');
    await ph.click('#startBtn');
    await ph.waitForFunction((m) => window[m].debug().started, M, { timeout: 12000 });
    await ph.waitForSelector('#fxqChoices .tile', { timeout: 8000 });
    await sweep(ph, mode + '-phone-quiz');
    await ph.tap('#fxQuizClose'); await ph.waitForTimeout(300);
    if (mode === 'island') await ph.evaluate(() => { const id = Game.debugState().hostId, f = Game.debugState().fx; f.pack[id] = [0, 6]; f.energy[id] = 300; });
    await ph.waitForTimeout(400);
    await sweep(ph, mode + '-phone-play');
    if (mode === 'island') {
      await ph.evaluate(() => { const t = Island.debug().market; Island.test.warp(t.x, t.y + 8); }); await ph.waitForTimeout(300);
      await ph.tap('#fxUse'); await ph.waitForTimeout(500); await sweep(ph, 'island-phone-shop');
    }
    await ph.context().close();
  };
  await movement('factory');
  await movement('island');

  // ---------- report ----------
  const lines = [];
  const byKey = new Map();
  for (const r of report) {
    const k = `${r.kind} | ${r.screen} | ${r.el} | "${r.text}"`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r.theme + (r.ratio ? ` ${r.ratio}` : ''));
  }
  for (const [k, v] of [...byKey].sort()) lines.push(`${k}\n    ${v.join(', ')}`);
  lines.push('', `errors: ${JSON.stringify(errs)}`, `${byKey.size} distinct issues`);
  fs.writeFileSync(OUT + '/report.txt', lines.join('\n'));
  console.log(lines.slice(-3).join('\n'));
  await b.close();
})().catch((e) => { console.log('ERR', e.stack); process.exit(1); });
