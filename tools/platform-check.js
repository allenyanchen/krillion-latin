// Puffer platform check: visits every page and main action on desktop and phone, and reports script errors,
// console errors/warnings, failed or 4xx/5xx requests, and steps that could not be done.
// Run (needs playwright-core and Google Chrome):  python3 -m http.server 8765   then   node tools/platform-check.js <out-dir>
// Run it after every big change, together with tools/ui-audit.js and a two-player join test (see CLAUDE.md).
const { chromium } = require('playwright-core');
const OUT = process.argv[2] || '.';
const BASE = 'http://localhost:8765/';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const problems = [];
  const watch = (p, tag) => {
    p.on('pageerror', (e) => problems.push(`${tag} PAGE ERROR: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${tag} console.${m.type()}: ${m.text().slice(0, 200)}`); });
    p.on('requestfailed', (r) => { if (!/supabase\.co\/realtime|fonts\.gstatic/.test(r.url())) problems.push(`${tag} request failed: ${r.url()} (${r.failure() && r.failure().errorText})`); });
    p.on('response', (r) => { if (r.status() >= 400) problems.push(`${tag} HTTP ${r.status()}: ${r.url()}`); });
  };
  const step = async (label, fn) => {
    const t0 = Date.now();
    try { await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('took over 20 s')), 20000))]); }
    catch (e) { problems.push(`STEP FAILED [${label}]: ${e.message.split('\n')[0]}`); }
    console.log(`  ${label}: ${Date.now() - t0} ms`);
  };
  for (const [tag, opts] of [['desktop', { viewport: { width: 1366, height: 768 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]]) {
    const c = await b.newContext(opts); const p = await c.newPage(); p.setDefaultTimeout(4000); watch(p, tag);
    const go = async (h) => { await p.goto(BASE + h, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(500); };
    await step('dashboard', async () => { await go('#/dashboard'); if (!(await p.textContent('.brand-text').catch(() => 'n/a')).includes('Puffer') && tag === 'desktop') problems.push('brand text is not Puffer'); });
    await step('title', async () => { const t = await p.title(); if (!/Puffer/.test(t)) problems.push(`${tag} title: ${t}`); });
    await step('quick join bad code', async () => { await go('#/join'); await p.fill('#jCode, .code-in', 'ZZZZ').catch(() => {}); });
    await step('sets search+filters', async () => {
      await go('#/sets');
      const s = await p.$('input[type=search], #setSearch'); if (s) { await s.fill('imperfect'); await p.waitForTimeout(200); await s.fill(''); }
      for (const t of await p.$$('.seg button, .tabs button')) {
        if (!(await t.isVisible())) continue;
        await t.click({ timeout: 1500 }).catch((e) => problems.push(`${tag} could not click a sets filter: ${e.message.split('\n')[0]}`));
        await p.waitForTimeout(80);
      }
    });
    await step('set page', async () => { await go('#/set/subjunctive-all'); await go('#/set/present-subjunctive'); await go('#/set/does-not-exist'); });
    await step('editor', async () => {
      await go('#/sets/new');
      const title = await p.$('#eTitle, input[placeholder*="itle"]'); if (title) await title.fill('Audit set');
      const add = await p.$('.add-q, #addQ'); if (add) await add.click();
      await p.waitForTimeout(200);
      p.once('dialog', (d) => d.accept());
      await go('#/dashboard');
      const ok = await p.$('#confirmModal [data-ok]'); if (ok && await ok.isVisible()) await ok.click();
    });
    await step('host pages', async () => { await go('#/host/subjunctive-all'); for (const m of ['factory', 'island', 'puffer']) { await p.click(`.mode[data-mode="${m}"]`); await p.waitForTimeout(150); } await go('#/host'); await go('#/host/nope'); });
    await step('characters', async () => { await go('#/characters'); const opts = await p.$$('.char-card, .swatch, .opt'); for (const o of opts.slice(0, 6)) { await o.click().catch(() => {}); } });
    await step('profile + themes', async () => { await go('#/profile'); for (const pr of (await p.$$('.preset')).slice(0, 9)) { await pr.click().catch(() => {}); await p.waitForTimeout(60); } const first = await p.$('.preset'); if (first) await first.click(); });
    await step('signin', async () => { await go('#/signin'); });
    await step('unknown route', async () => { await go('#/this-page-does-not-exist'); });
    await step('legal', async () => { await p.goto(BASE + 'privacy.html'); await p.waitForTimeout(300); await p.goto(BASE + 'terms.html'); await p.waitForTimeout(300); const t = await p.title(); if (!/Puffer/.test(t)) problems.push(`${tag} legal title: ${t}`); });
    await step('game route without game', async () => { await go('#/game'); });
    await p.screenshot({ path: `${OUT}/pf-${tag}-end.png` });
    await c.close();
  }
  console.log(problems.length ? problems.join('\n') : 'no problems found');
  await b.close();
})().catch((e) => { console.log('ERR', e.stack); process.exit(1); });
