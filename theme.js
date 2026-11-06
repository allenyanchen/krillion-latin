// Krillion Latin: site themes.
// Approach (from common design-system practice):
//  - One user-chosen seed (accent color) + a mode (dark / light) generates every color token.
//  - Colors are built in OKLCH, where lightness steps look even across hues (unlike HSL).
//  - Neutrals are lightly tinted toward the theme hue instead of flat grey; no pure black / pure white.
//  - Every text/background pair is checked against WCAG contrast (4.5:1 body text, 3:1 large text/UI)
//    and nudged lighter or darker until it passes.
//  - Components only use semantic tokens (CSS variables), so changing the theme restyles everything.
// Loaded in <head> (not deferred) so the saved theme applies before the page paints.
window.Theme = (() => {
  'use strict';
  const KEY = 'kl-theme';
  const DEFAULT = { accent: '#ffb238', mode: 'dark', tint: 250, preset: 'lantern' };
  const PRESETS = [
    // tint = background hue (null = follow the accent)
    { id: 'lantern', name: 'Lantern', accent: '#ffb238', mode: 'dark', tint: 250 },
    { id: 'lagoon', name: 'Lagoon', accent: '#2ec4b6', mode: 'dark', tint: 225 },
    { id: 'vesuvius', name: 'Vesuvius', accent: '#ff6b5a', mode: 'dark', tint: 20 },
    { id: 'imperial', name: 'Imperial', accent: '#a77bff', mode: 'dark', tint: null },
    { id: 'olive', name: 'Olive Grove', accent: '#9bd14f', mode: 'dark', tint: 150 },
    { id: 'rosa', name: 'Rosa', accent: '#ff7eb6', mode: 'dark', tint: 330 },
    { id: 'aegean', name: 'Aegean', accent: '#4cb4ff', mode: 'dark', tint: null },
    { id: 'parchment', name: 'Parchment', accent: '#c2621a', mode: 'light', tint: 75 },
    { id: 'marble', name: 'Marble', accent: '#2f7fd8', mode: 'light', tint: 250 },
  ];

  // ---------- color math: sRGB ⇄ OKLCH, WCAG contrast ----------
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);
  const hexToRgb = (h) => { h = String(h).replace('#', ''); if (h.length === 3) h = [...h].map((x) => x + x).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
  const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
  const isHex = (h) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(h).trim());
  function rgbToOklch(rgb) {
    const [r, g, b] = rgb.map(toLin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
  }
  function oklchRaw(L, C, h) {
    const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(fromLin);
  }
  // OKLCH → hex, reducing chroma until the color fits in sRGB (keeps lightness and hue).
  function oklch(L, C, h) {
    L = Math.max(0, Math.min(1, L));
    for (let c = C; c > 0; c -= 0.004) { const rgb = oklchRaw(L, c, h); if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return rgbToHex(rgb); }
    return rgbToHex(oklchRaw(L, 0, h));
  }
  const luminance = (hex) => { const [r, g, b] = hexToRgb(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // Move lightness (up or down) until the color reaches the contrast target against every background.
  function ensure(L, C, h, bgs, min, dir) {
    let hex = oklch(L, C, h);
    for (let i = 0; i < 80 && bgs.some((bg) => contrast(hex, bg) < min); i++) { L += dir * 0.01; hex = oklch(L, C, h); }
    return hex;
  }

  // ---------- token generation ----------
  function build(t) {
    t = { ...DEFAULT, ...t };
    const [La, Ca, ha] = rgbToOklch(hexToRgb(t.accent));
    const hs = t.tint == null ? ha : t.tint;            // background hue
    const cs = Math.min(0.05, Math.max(0.014, Ca * 0.28)); // gentle tint for neutrals
    const k = {};
    if (t.mode === 'light') {
      Object.assign(k, {
        bg: oklch(0.955, cs * 0.5, hs), 'bg-2': oklch(0.93, cs * 0.6, hs), well: oklch(0.975, cs * 0.35, hs), 'well-2': oklch(0.945, cs * 0.5, hs),
        panel: oklch(0.99, cs * 0.25, hs), 'panel-2': oklch(0.955, cs * 0.45, hs), 'panel-3': oklch(0.915, cs * 0.6, hs),
        line: oklch(0.83, cs * 0.8, hs), hi: '#ffffff', edge: oklch(0.32, cs, hs), 'edge-2': oklch(0.87, cs * 0.6, hs),
        'side-1': oklch(0.945, cs * 0.5, hs), 'side-2': oklch(0.915, cs * 0.6, hs), 'btn-shade': oklch(0.82, cs * 0.8, hs),
      });
      k.ink = ensure(0.25, 0.02, hs, [k.panel, k['panel-3'], k.bg], 7, -1);
      k.muted = ensure(0.47, 0.03, hs, [k.panel, k['panel-3'], k.bg], 4.5, -1);
      k.dim = ensure(0.58, 0.03, hs, [k.panel, k.bg], 3, -1);
      k.accent = ensure(Math.min(La, 0.68), Ca, ha, [k.panel], 3, -1);
      k['accent-hi'] = ensure(Math.min(La, 0.52), Math.min(Ca, 0.17), ha, [k.panel, k.well, k['panel-3']], 4.5, -1);
    } else {
      Object.assign(k, {
        bg: oklch(0.17, cs, hs), 'bg-2': oklch(0.205, cs, hs), well: oklch(0.155, cs * 1.05, hs), 'well-2': oklch(0.215, cs, hs),
        panel: oklch(0.255, cs, hs), 'panel-2': oklch(0.305, cs, hs), 'panel-3': oklch(0.355, cs * 1.1, hs),
        line: oklch(0.39, cs * 1.25, hs), hi: oklch(0.45, cs * 1.35, hs), edge: oklch(0.115, cs * 0.8, hs), 'edge-2': oklch(0.2, cs, hs),
        'side-1': oklch(0.235, cs, hs), 'side-2': oklch(0.185, cs, hs), 'btn-shade': oklch(0.245, cs, hs),
      });
      k.ink = ensure(0.95, 0.012, hs, [k.panel, k['panel-3']], 7, 1);
      k.muted = ensure(0.78, 0.035, hs, [k.panel, k['panel-3'], k.well], 4.5, 1);
      k.dim = ensure(0.63, 0.03, hs, [k.panel, k.well], 3, 1);
      k.accent = ensure(Math.max(La, 0.7), Ca, ha, [k.panel, k.bg], 3, 1);
      k['accent-hi'] = ensure(Math.max(La, 0.86), Math.min(Ca, 0.15), ha, [k.panel, k.well, k['panel-3']], 4.5, 1);
    }
    // Text on accent buttons: pick dark or light ink, then nudge the accent until it reads at 4.5:1.
    const darkInk = oklch(0.2, 0.05, ha), lightInk = oklch(0.98, 0.01, ha);
    let [Lk] = rgbToOklch(hexToRgb(k.accent));
    const useDark = contrast(darkInk, k.accent) >= contrast(lightInk, k.accent);
    k['accent-ink'] = useDark ? darkInk : lightInk;
    for (let i = 0; i < 40 && contrast(k['accent-ink'], k.accent) < 4.5; i++) { Lk += useDark ? 0.01 : -0.01; k.accent = oklch(Lk, Ca, ha); }
    k['accent-dark'] = oklch(Lk - (t.mode === 'light' ? 0.12 : 0.17), Ca * 0.9, ha);
    // status colors, kept readable as text on cards in either mode
    const dir = t.mode === 'light' ? -1 : 1, base = t.mode === 'light' ? 0.55 : 0.78;
    k.teal = ensure(base, 0.12, 185, [k.panel, k.well], 4.5, dir);
    k.good = ensure(base + 0.04, 0.15, 150, [k.panel], 3, dir);
    k.bad = ensure(base - 0.08, 0.19, 25, [k.panel], 3, dir);
    k.pink = ensure(base - 0.05, 0.18, 350, [k.panel], 3, dir);
    k.dot = t.mode === 'light' ? 'rgba(40, 60, 90, .07)' : 'rgba(170, 210, 240, .06)';
    return { tokens: k, mode: t.mode, theme: t };
  }

  // Contrast of the most important pairs, for the profile page.
  function report(tokens) {
    const r = (fg, bg, min, label) => ({ label, ratio: contrast(tokens[fg], tokens[bg]), min });
    return [
      r('ink', 'panel', 4.5, 'Main text on cards'),
      r('muted', 'panel', 4.5, 'Secondary text'),
      r('accent-ink', 'accent', 4.5, 'Text on buttons'),
      r('accent-hi', 'panel', 4.5, 'Highlights & codes'),
      r('accent', 'panel', 3, 'Buttons stand out'),
    ];
  }

  function apply(t) {
    const { tokens, mode } = build(t);
    const root = document.documentElement;
    for (const [name, v] of Object.entries(tokens)) root.style.setProperty('--' + name, v);
    root.style.setProperty('color-scheme', mode);
    root.dataset.mode = mode;
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = tokens.bg;
    return tokens;
  }
  function load() { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { ...DEFAULT }; } }
  function save(t, fromCloud = false) {
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) {}
    const tokens = apply(t);
    window.dispatchEvent(new CustomEvent('kl-theme', { detail: { theme: t, fromCloud } }));
    return tokens;
  }

  apply(load()); // before first paint

  return { PRESETS, DEFAULT, load, save, apply, build, report, contrast, rgbToOklch, hexToRgb, oklch, isHex };
})();
