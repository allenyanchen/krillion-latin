// Krillion Latin: Survival Island's storm voyage as a hand-drawn Three.js film.
// Flat cartoon shading plus an ink pass that traces every object's edges with wobbly black lines.
// The film is a pure function of the elapsed time, so everyone in the room sees the same shot at
// the same moment, and someone who joins late lands in the right place.
// island.js builds the plan (intro, one shot per captain, set sail, one segment per obstacle, ending),
// calls begin() when the voyage starts, render(e) every frame, and stop() when the game goes back
// to the lobby. If WebGL or the Three.js download fails, island.js keeps its 2D pixel version.
window.Voyage3D = (() => {
  'use strict';
  const URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js',
  ];
  let T = null, loading = null, failed = false;
  function webgl() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  function preload() {
    if (T || failed) return Promise.resolve(T);
    if (!loading) loading = (async () => {
      if (!webgl()) { failed = true; return null; }
      for (const u of URLS) { try { T = await import(u); return T; } catch (e) { /* try the next CDN */ } }
      failed = true; return null;
    })();
    return loading;
  }

  // ---------- small helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const seg01 = (u, a, b) => clamp((u - a) / (b - a), 0, 1);
  const mix32 = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16; return h >>> 0; };
  const rnd = (a, b = 0, c = 0) => mix32((mix32(a + 0x9e37) ^ Math.imul(b + 1, 0x85ebca6b) ^ Math.imul(c + 7, 0xc2b2ae35)) >>> 0) / 4294967296;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  // ---------- runtime ----------
  let R = null;      // renderer, scenes, shared objects (built once)
  let F = null;      // the current film: ships, plan, data (built per voyage)
  let root = null, cv = null, ui = null;

  function setupRenderer(container) {
    root = container;
    root.innerHTML = '';
    cv = el('canvas', 'cine-cv'); root.appendChild(cv);
    ui = {
      bar: el('div', 'cine-bar'), hearts: el('div', 'cine-hearts'), title: el('div', 'cine-title'),
      cap: el('div', 'cine-cap'), board: el('div', 'cine-board'), skip: el('button', 'cine-skip', 'Skip to results'), fade: el('div', 'cine-fade'),
    };
    ui.cap.append(el('b'), el('p'));
    ui.title.append(el('span', 'ic'), el('b'), el('small'));
    for (const k of ['fade', 'bar', 'hearts', 'title', 'board', 'cap', 'skip']) root.appendChild(ui[k]);
    ui.skip.hidden = true;
    ui.skip.addEventListener('click', () => F && F.data.onSkip && F.data.onSkip());

    const r = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const scene = new T.Scene();
    const cam = new T.PerspectiveCamera(50, 1, 0.1, 900);
    // flat cartoon shading: three tones per material
    const grad = new T.DataTexture(new Uint8Array([90, 175, 255]), 3, 1, T.RedFormat);
    grad.minFilter = grad.magFilter = T.NearestFilter; grad.needsUpdate = true;
    const toon = (color, extra = {}) => new T.MeshToonMaterial({ color, gradientMap: grad, ...extra });

    // sky dome
    const skyU = { top: { value: new T.Color('#25304a') }, bot: { value: new T.Color('#6b7690') } };
    const sky = new T.Mesh(new T.SphereGeometry(500, 24, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying float h; void main(){ gl_FragColor = vec4(mix(bot, top, smoothstep(-0.02, 0.45, h)), 1.0); \n#include <colorspace_fragment>\n }',
    }));
    sky.layers.set(1); sky.renderOrder = -1; scene.add(sky);
    scene.fog = new T.Fog('#6b7690', 60, 190);

    const hemi = new T.HemisphereLight('#dfe9ff', '#30405a', 1.1); scene.add(hemi);
    const sun = new T.DirectionalLight('#ffffff', 1.6); sun.position.set(-30, 50, 20); scene.add(sun);

    // render targets for the ink pass: colour, and normals + depth of solid objects
    const rtC = new T.WebGLRenderTarget(4, 4, { samples: 4 });
    const rtN = new T.WebGLRenderTarget(4, 4);
    rtN.depthTexture = new T.DepthTexture(4, 4); rtN.depthTexture.type = T.UnsignedIntType;
    const normalMat = new T.ShaderMaterial({
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vN; void main(){ gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }',
    });
    // the sea outputs a flat normal and alpha 0 so waves don't get scribbled on, only where things meet the water
    const waterNormalMat = new T.ShaderMaterial({
      vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 up; void main(){ gl_FragColor = vec4(up * 0.5 + 0.5, 0.0); }',
      uniforms: { up: { value: new T.Vector3(0, 1, 0) } },
    });
    const post = new T.ShaderMaterial({
      uniforms: {
        tC: { value: rtC.texture }, tN: { value: rtN.texture }, tD: { value: rtN.depthTexture },
        res: { value: new T.Vector2(4, 4) }, near: { value: cam.near }, far: { value: cam.far }, time: { value: 0 }, w: { value: 1.6 }, flash: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tC; uniform sampler2D tN; uniform sampler2D tD; uniform vec2 res; uniform float near; uniform float far; uniform float time; uniform float w; uniform float flash;
        varying vec2 vUv;
        float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main(){
          float tq = floor(time * 6.0);
          vec2 px = 1.0 / res;
          vec2 jit = (vec2(noise(vUv * vec2(11.0, 7.0) + tq * 3.1), noise(vUv * vec2(11.0, 7.0) + tq * 1.7 + 5.0)) - 0.5) * 2.2 * px;
          vec2 uv = vUv + jit;
          vec4 c0 = texture2D(tN, uv);
          float d0 = lin(texture2D(tD, uv).x);
          float de = 0.0, ne = 0.0, dmin = d0;
          vec2 dirs[4]; dirs[0] = vec2(1.0, 0.0); dirs[1] = vec2(-1.0, 0.0); dirs[2] = vec2(0.0, 1.0); dirs[3] = vec2(0.0, -1.0);
          for (int i = 0; i < 4; i++) {
            vec2 q = uv + dirs[i] * px * w;
            vec4 c = texture2D(tN, q);
            float d = lin(texture2D(tD, q).x);
            dmin = min(dmin, d);
            float bothWater = step(c0.a, 0.5) * step(c.a, 0.5);
            de = max(de, (1.0 - bothWater) * abs(d - d0) / max(min(d, d0), 0.001));
            ne = max(ne, 1.0 - dot(c.xyz * 2.0 - 1.0, c0.xyz * 2.0 - 1.0));
          }
          float edge = max(smoothstep(0.035, 0.09, de), smoothstep(0.22, 0.42, ne));
          edge *= 1.0 - smoothstep(210.0, 330.0, dmin);
          edge *= 0.75 + 0.25 * noise(gl_FragCoord.xy * 0.08 + tq);
          vec3 col = texture2D(tC, vUv).rgb;
          float grain = noise(gl_FragCoord.xy * 0.6) * 0.05 + hash(gl_FragCoord.xy + tq) * 0.025;
          col = col * (1.0 - grain) + vec3(0.03, 0.025, 0.0) * grain;
          col = mix(col, vec3(0.05, 0.045, 0.06), clamp(edge, 0.0, 1.0) * 0.95);
          col = mix(col, vec3(1.0, 0.98, 0.9), flash);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const quadScene = new T.Scene(); const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quadScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), post));

    R = { r, scene, cam, toon, grad, sky, skyU, hemi, sun, rtC, rtN, normalMat, waterNormalMat, post, quadScene, quadCam, w: 0, h: 0, swaps: [] };
    buildWorld();
  }

  // ---------- the world ----------
  const SEA = 280, SEG = 140;
  let sea = null;
  function buildWorld() {
    const { scene, toon } = R;
    const g = new T.PlaneGeometry(SEA, SEA, SEG, SEG); g.rotateX(-Math.PI / 2);
    const seaMat = toon('#2f6f9f'); R.seaAmp = { value: 0.6 };
    g.setAttribute('aFoam', new T.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    seaMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFoam; varying float vF;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvF = aFoam;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vF;').replace('#include <fog_fragment>',
        'float foam = smoothstep(0.45, 0.6, vF); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.82, 0.93, 0.98), foam * 0.88);\n' +
        'float trough = smoothstep(-0.45, -0.6, vF); gl_FragColor.rgb *= 1.0 - trough * 0.22;\n' +
        'float face = smoothstep(-1.5, -1.9, vF); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.03, 0.16, 0.2), face * 0.6);\n#include <fog_fragment>');
    };
    sea = new T.Mesh(g, seaMat);
    sea.userData.water = true; scene.add(sea);
    R.sea = sea;
    // clouds: puffs of spheres, outlined like doodles
    R.clouds = new T.Group(); scene.add(R.clouds);
    const cloudMat = toon('#9aa3b5', { fog: false }); R.cloudMat = cloudMat;
    for (let i = 0; i < 16; i++) {
      const c = new T.Group(), n = 4 + Math.floor(rnd(1, i) * 3);
      for (let k = 0; k < n; k++) { const big = k === Math.floor(n / 2), s = new T.Mesh(new T.SphereGeometry(big ? 9 : 5 + rnd(2, i, k) * 3, 14, 10), cloudMat); s.position.set((k - n / 2) * 6.5, big ? 3 : rnd(3, i, k) * 2, rnd(4, i, k) * 3); s.scale.y = 0.75; c.add(s); }
      const flat = new T.Mesh(new T.CylinderGeometry(n * 3.6, n * 3.6, 2, 16), cloudMat); flat.scale.z = 0.35; flat.position.y = -2; c.add(flat);
      const a = (i / 16) * Math.PI * 2 + rnd(5, i) * 0.3, d = 150 + rnd(6, i) * 40;
      c.position.set(Math.cos(a) * d, 40 + rnd(7, i) * 22, Math.sin(a) * d); c.userData.a = a; c.userData.d = d;
      R.clouds.add(c);
    }
    // rain (no ink: it's on layer 1)
    const rainN = 1400, rp = new Float32Array(rainN * 6);
    const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(rp, 3));
    R.rain = new T.LineSegments(rg, new T.LineBasicMaterial({ color: '#c8d6e8', transparent: true, opacity: 0.55, fog: false }));
    R.rain.layers.set(1); R.rain.frustumCulled = false; scene.add(R.rain);
    // particles: spray, splinters, bubbles, confetti
    R.parts = new T.InstancedMesh(new T.IcosahedronGeometry(0.22, 0), new T.MeshBasicMaterial({ color: '#ffffff' }), 400);
    R.parts.layers.set(1); R.parts.frustumCulled = false; R.parts.instanceMatrix.setUsage(T.DynamicDrawUsage);
    R.parts.setColorAt(0, new T.Color('#fff')); scene.add(R.parts);

    R.reef = buildReef(); R.bolt = buildBolt(); R.whirl = buildWhirl(); R.kraken = buildKraken(); R.harbor = buildHarbor(); R.debris = buildDebris();
    R.wallFoam = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 120, 8, 1), toon('#f2fbff')); R.wallFoam.rotation.z = Math.PI / 2; scene.add(R.wallFoam);
    R.fogRocks = new T.Group(); for (let i = 0; i < 5; i++) { const m = new T.Mesh(new T.ConeGeometry(2 + rnd(9, i) * 2, 5 + rnd(10, i) * 5, 5), toon('#4a4f5c')); m.position.set((i % 2 ? 1 : -1) * (9 + rnd(11, i) * 8), 1, -20 - i * 14); R.fogRocks.add(m); } scene.add(R.fogRocks);
    for (const o of [R.reef, R.bolt, R.whirl, R.kraken, R.harbor, R.debris, R.wallFoam, R.fogRocks]) o.visible = false;
  }
  function buildReef() {
    const g = new T.Group(), mat = R.toon('#5b6170'), top = R.toon('#7b8292');
    const spots = [[-7, -2], [-12, 6], [6, -6], [12, 2], [-4, 12], [9, 14], [-15, -9], [16, -12], [3, 22], [-9, 26]];
    spots.forEach(([x, z], i) => {
      const h = 2.5 + rnd(20, i) * 4.5, m = new T.Mesh(new T.ConeGeometry(1.4 + rnd(21, i) * 1.8, h, 5), i % 3 ? mat : top);
      m.position.set(x, h / 2 - 1.2, z); m.rotation.set(rnd(22, i) * 0.4 - 0.2, rnd(23, i) * 3, rnd(24, i) * 0.4 - 0.2); g.add(m);
    });
    R.scene.add(g); return g;
  }
  function buildBolt() {
    const g = new T.Group(), mat = new T.MeshBasicMaterial({ color: '#fff4a8', fog: false });
    let x = 0, y = 40;
    for (let i = 0; i < 9; i++) {
      const nx = x + (rnd(30, i) - 0.5) * 6, ny = y - 4.6;
      const len = Math.hypot(nx - x, ny - y), m = new T.Mesh(new T.BoxGeometry(0.55, len, 0.55), mat);
      m.position.set((x + nx) / 2, (y + ny) / 2, 0); m.rotation.z = Math.atan2(-(nx - x), ny - y); g.add(m);
      x = nx; y = ny;
    }
    R.scene.add(g); return g;
  }
  function buildWhirl() {
    const g = new T.Group(), mat = R.toon('#e6f6ff');
    for (let arm = 0; arm < 3; arm++) {
      const pts = [];
      for (let i = 0; i <= 60; i++) { const a = arm * 2.09 + i * 0.17, r = 2 + i * 0.32; pts.push(new T.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
      g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 120, 0.28, 5), mat));
    }
    R.scene.add(g); return g;
  }
  function buildKraken() {
    const g = new T.Group(), mat = R.toon('#7a3f8f'), dots = R.toon('#e3b7f2');
    g.userData.arms = [];
    for (let i = 0; i < 6; i++) {
      const arm = new T.Group(), a = (i / 6) * Math.PI * 2 + 0.3;
      arm.position.set(Math.cos(a) * 11, -1, Math.sin(a) * 11 - 2); arm.userData.a = a;
      const segs = [];
      for (let k = 0; k < 9; k++) {
        const r = 1.1 - k * 0.1, m = new T.Mesh(new T.SphereGeometry(r, 10, 8), mat);
        if (k % 2 === 0) { const d = new T.Mesh(new T.SphereGeometry(r * 0.32, 6, 5), dots); d.position.set(0, 0, r * 0.9); m.add(d); }
        arm.add(m); segs.push(m);
      }
      arm.userData.segs = segs; g.add(arm); g.userData.arms.push(arm);
    }
    const head = new T.Mesh(new T.SphereGeometry(5, 16, 12), mat); head.position.set(0, -2, -22); head.scale.set(1.2, 1, 1); g.add(head); g.userData.head = head;
    for (const s of [-1, 1]) { const eye = new T.Mesh(new T.SphereGeometry(1.1, 10, 8), R.toon('#fff3a8')); eye.position.set(s * 2.2, 1.4, 4.3); const pupil = new T.Mesh(new T.BoxGeometry(0.35, 1.3, 0.3), R.toon('#111')); pupil.position.z = 1; eye.add(pupil); head.add(eye); }
    R.scene.add(g); return g;
  }
  function buildHarbor() {
    // the island's harbor: green hills, palms, a wooden dock and a striped lighthouse with a lamp
    const g = new T.Group(), { toon } = R;
    const sand = new T.Mesh(new T.CylinderGeometry(40, 46, 3, 24), toon('#f0d9a0')); sand.position.set(0, -0.6, 52); g.add(sand);
    for (const [x, z, r, h] of [[-18, 60, 16, 14], [10, 66, 20, 20], [30, 56, 12, 10], [-30, 52, 10, 8]]) {
      const hill = new T.Mesh(new T.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#6cbf5a')); hill.scale.y = h / r; hill.position.set(x, 0.5, z); g.add(hill);
    }
    for (let i = 0; i < 7; i++) {
      const palm = new T.Group(), x = -30 + i * 10 + rnd(40, i) * 4, z = 26 + rnd(41, i) * 8;
      const trunk = new T.Mesh(new T.CylinderGeometry(0.35, 0.5, 6, 6), toon('#9c6a3a')); trunk.position.y = 3; trunk.rotation.z = (rnd(42, i) - 0.5) * 0.3; palm.add(trunk);
      for (let k = 0; k < 5; k++) { const leaf = new T.Mesh(new T.ConeGeometry(0.7, 4.2, 4), toon('#3f9d4a')); leaf.position.set(Math.cos(k * 1.26) * 1.6, 6, Math.sin(k * 1.26) * 1.6); leaf.rotation.set(Math.sin(k * 1.26) * 1.2, 0, -Math.cos(k * 1.26) * 1.2); palm.add(leaf); }
      palm.position.set(x, 0.5, z); g.add(palm);
    }
    const dock = new T.Group();
    const deck = new T.Mesh(new T.BoxGeometry(70, 0.5, 4), toon('#b07a45')); deck.position.y = 1.2; dock.add(deck);
    const walk = new T.Mesh(new T.BoxGeometry(4, 0.5, 14), toon('#b07a45')); walk.position.set(0, 1.2, 8); dock.add(walk);
    for (let x = -34; x <= 34; x += 6) { const post = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 4, 6), toon('#6b3e1c')); post.position.set(x, -0.2, 1.8); dock.add(post); }
    dock.position.set(0, 0, 8); g.add(dock);
    // lighthouse on its own rock, clearly a lighthouse: white tower, red stripes, glowing lamp
    const lh = new T.Group();
    const rock = new T.Mesh(new T.CylinderGeometry(5, 7, 4, 8), toon('#6d7380')); rock.position.y = 0; lh.add(rock);
    for (let k = 0; k < 5; k++) { const ring = new T.Mesh(new T.CylinderGeometry(2.3 - k * 0.22, 2.5 - k * 0.22, 3, 14), toon(k % 2 ? '#e2453c' : '#f7f3ea')); ring.position.y = 3.5 + k * 3; lh.add(ring); }
    const room = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, 2.2, 10), new T.MeshBasicMaterial({ color: '#ffe48a' })); room.position.y = 19.6; lh.add(room);
    const roof = new T.Mesh(new T.ConeGeometry(2.2, 2.4, 10), toon('#e2453c')); roof.position.y = 21.9; lh.add(roof);
    const beam = new T.Mesh(new T.ConeGeometry(5, 40, 16, 1, true), new T.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.16, depthWrite: false, fog: false, blending: T.AdditiveBlending }));
    beam.rotation.z = Math.PI / 2; beam.position.set(20, 0, 0); beam.layers.set(1);
    const sweep = new T.Group(); sweep.position.y = 19.6; sweep.add(beam); lh.add(sweep);
    const glow = new T.PointLight('#ffd27a', 40, 60); glow.position.y = 19.6; lh.add(glow);
    lh.position.set(-34, 0, 18); g.add(lh); g.userData.beam = sweep; g.userData.lh = lh;
    R.scene.add(g); return g;
  }
  function buildDebris() {
    const g = new T.Group();
    for (let i = 0; i < 10; i++) { const m = new T.Mesh(new T.BoxGeometry(2.4, 0.3, 0.6), R.toon('#8a5a2c')); m.position.set((rnd(50, i) - 0.5) * 14, 0, (rnd(51, i) - 0.5) * 14); m.rotation.y = rnd(52, i) * 3; g.add(m); }
    R.scene.add(g); return g;
  }

  // ---------- characters and ships ----------
  // The captain is the player's own pixel character (the same drawing as everywhere else on the site),
  // on a flat cutout that always turns to the camera. The ink pass outlines its silhouette.
  const PX = 0.1; // world units per character pixel
  function character(look) {
    const cw = 24, ch = 30, cv2 = document.createElement('canvas'); cv2.width = cw; cv2.height = ch;
    const x = cv2.getContext('2d'); x.imageSmoothingEnabled = false;
    if (window.Scene && Scene.drawCharacter) Scene.drawCharacter(x, cw / 2, ch - 1, look || {}, {});
    const tex = new T.CanvasTexture(cv2); tex.colorSpace = T.SRGBColorSpace;
    tex.magFilter = tex.minFilter = T.NearestFilter; tex.generateMipmaps = false;
    const geo = new T.PlaneGeometry(cw * PX, ch * PX); geo.translate(0, (ch * PX) / 2 - PX, 0);
    const card = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: T.DoubleSide }));
    // for the ink pass: a flat, camera-facing normal, cut to the drawing's shape
    card.userData.nmat = new T.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main(){ if (texture2D(map, vUv).a < 0.5) discard; gl_FragColor = vec4(0.5, 0.5, 1.0, 1.0); }',
      side: T.DoubleSide,
    });
    const g = new T.Group(); g.add(card); g.userData.card = card;
    return g;
  }
  function label(text, color) {
    const c = document.createElement('canvas'), x = c.getContext('2d'), fs = 44;
    x.font = `700 ${fs}px "Patrick Hand", "Nunito", sans-serif`;
    const w = Math.ceil(x.measureText(text).width) + 36; c.width = w; c.height = 72;
    x.font = `700 ${fs}px "Patrick Hand", "Nunito", sans-serif`;
    x.fillStyle = '#fbf6e9'; x.strokeStyle = '#141018'; x.lineWidth = 5;
    x.beginPath(); x.roundRect(3, 3, w - 6, 64, 14); x.fill(); x.stroke();
    x.fillStyle = color; x.fillRect(16, 26, 10, 18); x.strokeRect(16, 26, 10, 18);
    x.fillStyle = '#141018'; x.textBaseline = 'middle'; x.fillText(text, 32, 37);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map: t, depthTest: false, fog: false, transparent: true }));
    s.scale.set(w / 72 * 1.1, 1.1, 1); s.layers.set(1); s.renderOrder = 10;
    return s;
  }
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; }
  function sailMesh(w, h, tex) {
    const g = new T.PlaneGeometry(w, h, 8, 6), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2); p.setZ(i, -(1 - x * x) * (0.75 - 0.2 * y) * w * 0.18); }
    g.computeVertexNormals();
    return new T.Mesh(g, R.toon('#ffffff', { map: tex, side: T.DoubleSide, emissive: '#3a3a3a' }));
  }
  const DIMS = [{ L: 5, W: 2.8, H: 0.7 }, { L: 6.2, W: 2.6, H: 1.3 }, { L: 7.2, W: 3, H: 1.5 }, { L: 8.2, W: 3.2, H: 1.7 }];
  function buildShip(sh, look, color, name) {
    const g = new T.Group(), tier = sh.h || 0, d = DIMS[tier], x = sh.x || [], { toon } = R;
    const parts = {}, deckY = tier === 0 ? 0.45 : d.H * 0.55;
    if (tier === 0) {
      for (let i = 0; i < 5; i++) { const log = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, d.L, 8), toon(i % 2 ? '#9c6a3a' : '#b98250')); log.rotation.x = Math.PI / 2; log.position.set((i - 2) * 0.58, 0.15, 0); g.add(log); }
      for (const z of [-1.6, 1.6]) { const bar = new T.Mesh(new T.BoxGeometry(3.2, 0.18, 0.4), toon('#6b3e1c')); bar.position.set(0, 0.48, z); g.add(bar); }
    } else {
      const hw = d.W / 2, hl = d.L / 2, s = new T.Shape();
      s.moveTo(-hw, -hl); s.lineTo(hw, -hl); s.lineTo(hw, hl * 0.35); s.quadraticCurveTo(hw * 0.85, hl * 0.85, 0, hl * 1.08); s.quadraticCurveTo(-hw * 0.85, hl * 0.85, -hw, hl * 0.35); s.closePath();
      const hullCol = ['', '#c48a52', '#8a5530', '#6f4022'][tier];
      const geo = new T.ExtrudeGeometry(s, { depth: d.H, bevelEnabled: false }); geo.rotateX(-Math.PI / 2); geo.translate(0, -d.H * 0.45, 0);
      g.add(new T.Mesh(geo, toon(hullCol)));
      const deckGeo = new T.ShapeGeometry(s); deckGeo.rotateX(-Math.PI / 2);
      const deck = new T.Mesh(deckGeo, toon('#ffffff', { map: canvasTex(64, 128, (c, w, h) => { c.fillStyle = '#d9a96a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#6b4220'; c.lineWidth = 2; for (let xx = 8; xx < w; xx += 11) { c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx + 1, h); c.stroke(); } }) }));
      deck.position.y = d.H * 0.55 + 0.01; g.add(deck);
      // a strake line around the hull
      const strake = new T.Mesh(new T.BoxGeometry(d.W + 0.06, 0.12, d.L * 0.8), toon(['', '#8a5a2c', '#5a3618', '#4a2a12'][tier])); strake.position.y = 0; g.add(strake);
      if (tier >= 2) for (const sx of [-1, 1]) { const rail = new T.Mesh(new T.BoxGeometry(0.12, 0.12, d.L * 0.9), toon('#3d2410')); rail.position.set(sx * (hw - 0.06), deckY + 0.5, 0); g.add(rail); for (let z = -hl + 0.4; z < hl * 0.7; z += 1.1) { const post = new T.Mesh(new T.BoxGeometry(0.1, 0.5, 0.1), toon('#3d2410')); post.position.set(sx * (hw - 0.06), deckY + 0.25, z); g.add(post); } }
      if (tier === 3) {
        const band = new T.Mesh(new T.BoxGeometry(d.W + 0.08, 0.3, d.L * 0.85), toon('#d9823b')); band.position.y = -d.H * 0.3; g.add(band);
        for (const sx of [-1, 1]) for (let z = -2.4; z <= 1.6; z += 2) { const ph = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.1, 10), new T.MeshBasicMaterial({ color: '#ffd166' })); ph.rotation.z = Math.PI / 2; ph.position.set(sx * (hw + 0.04), 0.3, z); g.add(ph); }
      }
    }
    // keel
    if (sh.k === 1) for (let i = 0; i < 3; i++) { const st = new T.Mesh(new T.DodecahedronGeometry(0.28, 0), toon('#8d96a2')); st.position.set(-0.4 + i * 0.4, deckY + 0.2, 0.6); g.add(st); }
    if (sh.k >= 2) { const fin = new T.Mesh(new T.BoxGeometry(0.25, 1.4, d.L * 0.55), toon(sh.k === 3 ? '#6f7884' : '#5a3618')); fin.position.y = -d.H * 0.45 - 0.6; g.add(fin); if (sh.k === 3) { const bulb = new T.Mesh(new T.SphereGeometry(0.45, 10, 8), toon('#4f5864')); bulb.scale.z = 2.2; bulb.position.y = -d.H * 0.45 - 1.3; g.add(bulb); } }
    // masts and sails
    const mast = (z, h) => { const m = new T.Mesh(new T.CylinderGeometry(0.12, 0.16, h, 7), toon('#5a3618')); m.position.set(0, deckY + h / 2, z); g.add(m); return m; };
    const plain = canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#f4f1e8'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(80,60,40,.5)'; c.lineWidth = 1.5; for (let y = 16; y < h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } });
    let flagY = deckY + 2.2, flagZ = -d.L * 0.3;
    parts.sails = [];
    if (!sh.s) { mast(-d.L * 0.3, 2.2); }
    else if (sh.s === 1) {
      mast(-0.4, 4.2); flagY = deckY + 4.2; flagZ = -0.4;
      const tex = canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#e9dcb8'; c.fillRect(0, 0, w, h); c.fillStyle = '#c9a46a'; c.fillRect(8, 10, 16, 14); c.fillRect(38, 34, 18, 14); c.strokeStyle = '#6b4a20'; c.setLineDash([3, 3]); c.lineWidth = 2; c.strokeRect(8, 10, 16, 14); c.strokeRect(38, 34, 18, 14); });
      const s1 = sailMesh(2.6, 2.4, tex); s1.position.set(0, deckY + 2.6, -0.25); g.add(s1); parts.sails.push(s1);
    } else if (sh.s === 2) {
      mast(-0.6, 5.8); flagY = deckY + 5.8; flagZ = -0.6;
      for (const [y, w] of [[4.6, 2.6], [2.8, 3.2]]) { const s2 = sailMesh(w, 1.6, plain); s2.position.set(0, deckY + y, -0.45); g.add(s2); parts.sails.push(s2); }
      const jib = new T.Mesh(new T.BufferGeometry().setFromPoints([new T.Vector3(0, deckY + 5.4, -0.7), new T.Vector3(0, deckY + 0.6, -0.8), new T.Vector3(0, deckY + 0.6, -d.L * 0.55)]), toon('#efe9da', { side: T.DoubleSide })); jib.geometry.computeVertexNormals(); g.add(jib);
    } else {
      const striped = canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = color; c.fillRect(0, 26, w, 12); });
      for (const z of [-1.8, 1.2]) { mast(z, z < 0 ? 6.2 : 5.2); for (const [y, w, tx] of [[z < 0 ? 5 : 4.2, 2.6, striped], [z < 0 ? 3.1 : 2.6, 3.2, plain]]) { const s3 = sailMesh(w, 1.6, tx); s3.position.set(0, deckY + y, z + 0.15); g.add(s3); parts.sails.push(s3); } }
      flagY = deckY + 6.2; flagZ = -1.8;
    }
    const flag = new T.Mesh(new T.PlaneGeometry(1, 0.6), R.toon(color, { side: T.DoubleSide })); flag.position.set(0, flagY - 0.3, flagZ + 0.55); flag.rotation.y = Math.PI / 2; g.add(flag); parts.flag = flag;
    // extras
    const at = (m, px, py, pz) => { m.position.set(px, deckY + py, pz); g.add(m); return m; };
    const hl = d.L / 2;
    if (x.includes('oars')) for (const sx of [-1, 1]) { const o = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 3.2, 6), toon('#b98250')); o.rotation.z = sx * 1.1; at(o, sx * (d.W / 2 + 0.9), -0.5, 0.6); const blade = new T.Mesh(new T.BoxGeometry(0.1, 0.8, 0.35), toon('#d9a96a')); blade.position.y = -1.6; o.add(blade); }
    if (x.includes('rope')) { const r = new T.Mesh(new T.TorusGeometry(0.32, 0.12, 6, 14), toon('#d8c08a')); r.rotation.x = Math.PI / 2; at(r, 0.7, 0.12, 1.4); }
    if (x.includes('tar')) at(new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 0.7, 10), toon('#2b2b33')), -0.75, 0.35, 1.6);
    if (x.includes('pump')) { const p = at(new T.Mesh(new T.CylinderGeometry(0.15, 0.15, 1, 8), toon('#8d96a2')), 0.8, 0.5, -1.2); const hnd = new T.Mesh(new T.BoxGeometry(0.7, 0.08, 0.08), toon('#5f6974')); hnd.position.y = 0.5; p.add(hnd); }
    if (x.includes('anchor')) { const a = new T.Group(); a.add(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 1.1, 6), toon('#8a96a3'))); const arc = new T.Mesh(new T.TorusGeometry(0.4, 0.07, 6, 12, Math.PI), toon('#8a96a3')); arc.rotation.z = Math.PI; arc.position.y = -0.45; a.add(arc); at(a, d.W / 2 + 0.15, -0.2, -hl * 0.6); }
    if (x.includes('lantern')) { const l = at(new T.Mesh(new T.BoxGeometry(0.3, 0.42, 0.3), new T.MeshBasicMaterial({ color: '#ffd166' })), -0.55, 1.6, -0.2); const glow = new T.PointLight('#ffcc66', 6, 9); l.add(glow); parts.lantern = l; }
    if (x.includes('compass')) { const c = at(new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.14, 12), toon('#c99a12')), 0.9, 0.9, hl * 0.15); const post = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.8, 6), toon('#5a3618')); post.position.y = -0.45; c.add(post); }
    if (x.includes('spyglass')) { const s = at(new T.Mesh(new T.CylinderGeometry(0.07, 0.11, 0.9, 8), toon('#c99a12')), -0.9, 0.15, hl * 0.1); s.rotation.x = Math.PI / 2; }
    if (x.includes('water')) for (const sx of [-0.85, -0.25]) { const b = at(new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.6, 10), toon('#a8693a')), sx, 0.3, -hl * 0.55); const band = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.1, 10), toon('#4cc9f0')); b.add(band); }
    if (x.includes('food')) for (const [sx, sy] of [[0.65, 0.25], [0.65, 0.75]]) at(new T.Mesh(new T.BoxGeometry(0.55, 0.5, 0.55), toon('#c79a5c')), sx, sy, -hl * 0.45);
    if (x.includes('net')) { const n = new T.Mesh(new T.PlaneGeometry(1.4, 0.9), toon('#ffffff', { map: canvasTex(32, 32, (c) => { c.fillStyle = '#c9a46a'; c.fillRect(0, 0, 32, 32); c.strokeStyle = '#5a3a18'; c.lineWidth = 1.5; for (let i = 0; i < 32; i += 6) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 32); c.moveTo(0, i); c.lineTo(32, i); c.stroke(); } }), side: T.DoubleSide })); n.rotation.y = Math.PI / 2; at(n, -d.W / 2 - 0.03, -0.3, 0.4); }
    if (x.includes('figure')) { const f = new T.Group(); const b = new T.Mesh(new T.ConeGeometry(0.3, 1, 8), toon('#e0ad1a')); b.rotation.x = -1.1; f.add(b); const head = new T.Mesh(new T.SphereGeometry(0.28, 10, 8), toon('#ffd166')); head.position.set(0, 0.3, -0.45); f.add(head); at(f, 0, 0.1, -hl * 1.05); }
    // the captain at the helm, facing the bow (-z)
    const cap = character(look); cap.position.set(0, deckY, hl * 0.55); g.add(cap);
    const lab = label(name, color); lab.position.set(0, deckY + 3, hl * 0.55); g.add(lab);
    const holder = new T.Group(); holder.add(g); R.scene.add(holder);
    return { holder, ship: g, cap, label: lab, parts, deckY, len: d.L };
  }

  // ---------- story ----------
  const STORY = {
    choppy: 'The sea turns rough. Waves slam into every hull from every side.',
    reef: 'Sharp rocks hide just under the water. Only a careful navigator finds the way through.',
    squall: 'Lightning splits the sky! Only a fast ship can outrun the squall.',
    whirl: 'A whirlpool opens up, dragging everything into its spin.',
    fog: 'A thick fog swallows the fleet. Which way is home?',
    wave: 'A wall of water rises, taller than any mast…',
    kraken: 'Something huge stirs beneath the waves… the KRAKEN!',
    haul: 'The storm passes, but home is still days away. Is there enough food and water?',
  };
  const PASS = {
    choppy: 'rides the waves without a wobble', reef: 'threads between the rocks', squall: 'outruns the lightning', whirl: 'slips past the edge of the whirlpool',
    fog: 'finds the way through the fog', wave: 'climbs the wave and crashes down the other side', kraken: 'escapes the Kraken’s grip', haul: 'has plenty to eat and drink',
  };
  const FAIL = {
    choppy: 'rocks hard and takes on water', reef: 'scrapes the rocks', squall: 'is struck by lightning', whirl: 'spins round and round in the whirlpool',
    fog: 'bumps into rocks in the fog', wave: 'is smashed by the wave', kraken: 'is squeezed by the Kraken', haul: 'runs out of supplies',
  };
  function shipLine(sh, data) {
    const parts = [data.partName('h', sh.h || 0), sh.s ? data.partName('s', sh.s) : 'no sail'];
    const n = (sh.x || []).length + (sh.k ? 1 : 0);
    if (n) parts.push(`${n} extra${n === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }

  // ---------- film setup ----------
  function begin(container, data) {
    if (!T) return false;
    if (!R || root !== container) setupRenderer(container);
    clearFilm();
    const ships = new Map();
    for (const p of data.players) {
      const b = buildShip(data.ships[p.id] || { h: 0, s: 0, k: 0, x: [] }, p.look, p.color, p.name);
      b.id = p.id; b.p = p; b.res = data.V.res[p.id]; ships.set(p.id, b);
    }
    F = { data, ships, plan: data.plan, key: data.V.at, last: -1 };
    // route progress strip
    ui.bar.innerHTML = '';
    data.V.route.forEach((k) => { const n = el('span', 'node'); n.append(el('i', null, data.OBST[k].icon), el('em', null, data.OBST[k].name)); ui.bar.appendChild(n); });
    const home = el('span', 'node home'); home.append(el('i', null, '⚓'), el('em', null, 'Home')); ui.bar.appendChild(home);
    ui.skip.hidden = !data.canSkip;
    root.hidden = false;
    return true;
  }
  function clearFilm() {
    if (!F) return;
    for (const b of F.ships.values()) { R.scene.remove(b.holder); b.holder.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    F = null;
  }
  function stop() { clearFilm(); if (root) root.hidden = true; }

  // ---------- timeline queries ----------
  function segAt(e) {
    const segs = F.plan.segs;
    let s = segs[segs.length - 1];
    for (const x of segs) if (e >= x.t0 && e < x.t0 + x.dur) { s = x; break; }
    return { s, u: clamp((e - s.t0) / s.dur, 0, 1) };
  }
  const aliveAt = (b, i) => !b.res || b.res.sunk < 0 || b.res.sunk >= i;
  function focusFor(s) {
    const d = F.data, me = F.ships.get(d.meId), rank = d.V.rank.map((id) => F.ships.get(id)).filter(Boolean);
    if (s.kind === 'crew') return F.ships.get(s.id);
    if (s.kind === 'obs') { if (me && d.playing && aliveAt(me, s.i)) return me; return rank.find((b) => aliveAt(b, s.i)) || rank[0]; }
    if (s.kind === 'end') { if (me && d.playing && me.res && me.res.sunk < 0) return me; return rank.find((b) => b.res && b.res.sunk < 0) || null; }
    return (me && d.playing) ? me : rank[0];
  }

  // ---------- sea surface ----------
  const W = { amp: 0.6, len: 1, wallZ: 1e9, wallA: 0, whirlX: 0, whirlZ: -1e9, whirlD: 0, t: 0 };
  // base swell (scaled by the mood's amplitude), plus the big wave and the whirlpool funnel
  const baseH = (x, z) => { const t = W.t, k = W.len; return Math.sin((x * 0.21 + z * 0.13) * k + t * 1.3) * 0.55 + Math.sin((x * -0.11 + z * 0.27) * k + t * 1.7) * 0.4 + Math.sin((x * 0.5 - z * 0.42) * k + t * 2.6) * 0.18; };
  const wallH = (z) => { if (!W.wallA) return 0; const q = (z - W.wallZ) / 6.5; return W.wallA * Math.exp(-q * q) * (1 + 0.35 * Math.tanh(-q)); };
  function seaH(x, z) {
    let h = baseH(x, z) * W.amp + wallH(z);
    if (W.whirlD) { const dx = x - W.whirlX, dz = z - W.whirlZ, r2 = dx * dx + dz * dz; h -= W.whirlD * Math.exp(-r2 / 160); }
    return h;
  }
  function updateSea(cx, cz) {
    const g = sea.geometry, p = g.attributes.position, step = SEA / SEG;
    const ox = Math.round(cx / step) * step, oz = Math.round(cz / step) * step;
    sea.position.set(ox, 0, oz);
    const fa = g.attributes.aFoam, A = W.wallA;
    for (let i = 0; i < p.count; i++) {
      const x = ((i % (SEG + 1)) / SEG - 0.5) * SEA + ox, z = (Math.floor(i / (SEG + 1)) / SEG - 0.5) * SEA + oz;
      p.setY(i, seaH(x, z));
      const b = baseH(x, z) / 1.13; // -1..1
      let f = b > 0.62 ? (b - 0.62) * 4 : b < -0.55 ? (b + 0.55) * 3 : 0;
      if (A > 1) { const w = wallH(z) / (A * 1.12); if (w > 0.72) f = Math.max(f, (w - 0.72) * 6); else if (w > 0.12 && z > W.wallZ) f = -2; } // white lip, deep-green face
      fa.array[i] = f;
    }
    p.needsUpdate = true; fa.needsUpdate = true; g.computeVertexNormals();
  }

  // ---------- moods (sky, light, fog, waves) ----------
  const MOOD = {
    dusk: { top: '#3b3f6b', bot: '#e59a6b', sea: '#2f6f9f', fog: '#c98f76', amp: 0.35, rain: 0, light: 1.4, near: 70, far: 220, clouds: '#b48aa0' },
    storm: { top: '#1b2132', bot: '#566178', sea: '#24557d', fog: '#566178', amp: 0.8, rain: 1, light: 0.9, near: 50, far: 170, clouds: '#59627a' },
    choppy: { top: '#1d2436', bot: '#5b6680', sea: '#24557d', fog: '#5b6680', amp: 1.6, rain: 1, light: 0.95, near: 50, far: 170, clouds: '#5f6880' },
    squall: { top: '#11141f', bot: '#353d52', sea: '#1d4466', fog: '#353d52', amp: 1.0, rain: 1, light: 0.75, near: 45, far: 150, clouds: '#3c4357' },
    fog: { top: '#8d97a6', bot: '#b9c2cc', sea: '#4f7d9b', fog: '#b9c2cc', amp: 0.5, rain: 0, light: 1.1, near: 2, far: 30, clouds: '#c5ccd5' },
    kraken: { top: '#1a1427', bot: '#463c5c', sea: '#28406a', fog: '#463c5c', amp: 0.9, rain: 1, light: 0.85, near: 45, far: 160, clouds: '#4d4462' },
    haul: { top: '#5f8fc4', bot: '#f6c487', sea: '#3484b8', fog: '#f0c79b', amp: 0.4, rain: 0, light: 1.6, near: 80, far: 230, clouds: '#f4e1d0' },
    dawn: { top: '#5aa7e0', bot: '#ffd6a0', sea: '#3aa0d0', fog: '#ffd9b0', amp: 0.3, rain: 0, light: 1.8, near: 90, far: 260, clouds: '#ffffff' },
    lost: { top: '#2a3142', bot: '#6c7486', sea: '#2a5576', fog: '#6c7486', amp: 0.45, rain: 0.3, light: 1.0, near: 60, far: 190, clouds: '#7a8296' },
  };
  const moodOf = (s) => {
    if (s.kind === 'intro' || s.kind === 'crew') return 'dusk';
    if (s.kind === 'sail') return 'storm';
    if (s.kind === 'end') return F.ships.size && [...F.ships.values()].some((b) => b.res && b.res.sunk < 0) ? 'dawn' : 'lost';
    return { choppy: 'choppy', reef: 'storm', squall: 'squall', whirl: 'storm', fog: 'fog', wave: 'storm', kraken: 'kraken', haul: 'haul' }[s.ob] || 'storm';
  };
  const cur = { top: null, bot: null, sea: null, fog: null, clouds: null, amp: 0.4, rain: 0, light: 1.2, near: 60, far: 200 };
  function applyMood(name, dt, snap) {
    const m = MOOD[name], k = snap ? 1 : 1 - Math.exp(-dt * 1.6);
    if (!cur.top) { cur.top = new T.Color(m.top); cur.bot = new T.Color(m.bot); cur.sea = new T.Color(m.sea); cur.fog = new T.Color(m.fog); cur.clouds = new T.Color(m.clouds); }
    cur.top.lerp(new T.Color(m.top), k); cur.bot.lerp(new T.Color(m.bot), k); cur.sea.lerp(new T.Color(m.sea), k); cur.fog.lerp(new T.Color(m.fog), k); cur.clouds.lerp(new T.Color(m.clouds), k);
    for (const key of ['amp', 'rain', 'light', 'near', 'far']) cur[key] = lerp(cur[key], m[key], k);
    R.skyU.top.value.copy(cur.top); R.skyU.bot.value.copy(cur.bot);
    R.scene.fog.color.copy(cur.fog); R.scene.fog.near = cur.near; R.scene.fog.far = cur.far;
    sea.material.color.copy(cur.sea); R.cloudMat.color.copy(cur.clouds);
    R.sun.intensity = cur.light; R.hemi.intensity = 0.55 + cur.light * 0.35;
    W.amp = cur.amp;
  }

  // ---------- particles (pure functions of time) ----------
  const P = { n: 0, m: null, c: null };
  function partReset() { P.n = 0; }
  function part(x, y, z, s, color) {
    if (P.n >= 400) return;
    if (!P.m) { P.m = new T.Matrix4(); P.c = new T.Color(); }
    P.m.makeScale(s, s, s); P.m.setPosition(x, y, z); R.parts.setMatrixAt(P.n, P.m); R.parts.setColorAt(P.n, P.c.set(color)); P.n++;
  }
  function burst(seed, ox, oy, oz, age, n, speed, colors, size = 1, grav = 9) {
    if (age < 0 || age > 2.2) return;
    for (let i = 0; i < n; i++) {
      const a = rnd(seed, i, 1) * Math.PI * 2, up = 0.4 + rnd(seed, i, 2) * 0.9, v = speed * (0.4 + rnd(seed, i, 3));
      const x = ox + Math.cos(a) * v * age, z = oz + Math.sin(a) * v * age, y = oy + up * v * age - grav * age * age * 0.5;
      if (y < -1) continue;
      part(x, y, z, size * (1 - age / 2.4), colors[i % colors.length]);
    }
  }
  function partFlush() { R.parts.count = P.n; R.parts.instanceMatrix.needsUpdate = true; if (R.parts.instanceColor) R.parts.instanceColor.needsUpdate = true; }

  // ---------- layout: where each ship is during a segment ----------
  const SLOTS = [[0, 0], [-11, 8], [11, 8], [-21, 17], [21, 17], [-9, 24], [9, 24], [0, 32]];
  function layout(s, focus) {
    const all = [...F.ships.values()], d = F.data;
    const out = new Map();
    if (s.kind === 'intro' || s.kind === 'crew' || s.kind === 'sail') {
      const n = all.length;
      all.forEach((b, k) => out.set(b.id, [(k - (n - 1) / 2) * 11, 0]));
      return out;
    }
    let list;
    if (s.kind === 'obs') list = all.filter((b) => aliveAt(b, s.i));
    else list = all.filter((b) => b.res && b.res.sunk < 0);
    list.sort((a, b) => (a === focus ? -1 : b === focus ? 1 : d.V.rank.indexOf(a.id) - d.V.rank.indexOf(b.id)));
    list.slice(0, SLOTS.length).forEach((b, k) => out.set(b.id, s.kind === 'end' ? [(k - (Math.min(list.length, 8) - 1) / 2) * 11, 0] : SLOTS[k]));
    return out;
  }

  // ---------- one frame ----------
  let lastT = 0;
  const perf = { acc: 0, n: 0, level: 0 };
  function adapt(dt) {
    perf.acc += dt; perf.n++;
    if (perf.acc < 2) return;
    const fps = perf.n / perf.acc; perf.acc = 0; perf.n = 0;
    const ratios = [Math.min(window.devicePixelRatio || 1, 1.5), 1, 0.75, 0.6];
    if (fps < 28 && perf.level < ratios.length - 1) { perf.level++; R.r.setPixelRatio(ratios[perf.level]); R.w = 0; }
  }
  const V3 = () => new T.Vector3();
  const tmp = { a: null, b: null };
  function render(e, over, now) {
    if (!F || !R) return;
    const t = now / 1000, dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016; lastT = now;
    adapt(dt); resize();
    if (over) e = Math.min(e, F.plan.total - 1);
    const { s, u } = segAt(e), d = F.data, route = d.V.route;
    const snap = s.t0 !== F.last; F.last = s.t0;
    const focus = focusFor(s);
    applyMood(moodOf(s), dt, snap && s.kind === 'intro');
    W.t = t;
    partReset();
    // reset obstacle state
    W.wallA = 0; W.wallZ = 1e9; W.whirlD = 0;
    for (const o of [R.reef, R.bolt, R.whirl, R.kraken, R.harbor, R.debris, R.wallFoam, R.fogRocks]) o.visible = false;
    let flash = 0;
    const kind = s.kind === 'obs' ? s.ob : s.kind;
    const fRes = focus && focus.res, step = s.kind === 'obs' && fRes ? fRes.steps[s.i] : null, pass = step ? !!step.p : true;
    const impact = 0.55, hitAge = (u - impact) * s.dur / 1000;

    // obstacles
    if (s.kind === 'obs') {
      if (kind === 'reef') { R.reef.visible = true; R.reef.position.set(0, 0, lerp(-70, 50, u)); }
      if (kind === 'squall') {
        R.bolt.visible = (Math.floor(e / 900) % 3 === 0 && (e % 900) < 140) || (!pass && Math.abs(u - impact) < 0.025);
        const strikeFocus = !pass && Math.abs(u - impact) < 0.025;
        R.bolt.position.set(strikeFocus ? 0 : (rnd(60, Math.floor(e / 900)) - 0.5) * 60, 0, strikeFocus ? 0 : -30 - rnd(61, Math.floor(e / 900)) * 30);
        if (R.bolt.visible) flash = strikeFocus ? 0.55 : 0.25;
      }
      if (kind === 'whirl') { R.whirl.visible = true; const wz = lerp(-40, 20, u); W.whirlX = pass ? 9 : 0; W.whirlZ = wz; W.whirlD = 3.2; R.whirl.position.set(W.whirlX, 0.2, wz); R.whirl.rotation.y = -t * 1.4; }
      if (kind === 'fog') R.fogRocks.visible = true, R.fogRocks.position.z = lerp(-10, 70, u);
      if (kind === 'wave') { W.wallZ = lerp(-70, 70, u); W.wallA = 11 * (1 - ease(seg01(u, 0.68, 0.8))); R.wallFoam.visible = W.wallA > 1; R.wallFoam.position.set(0, W.wallA * 1.02 + 0.3, W.wallZ - 1.2); }
      if (kind === 'kraken') {
        R.kraken.visible = true; const rise = ease(seg01(u, 0.25, 0.5)) * (1 - ease(seg01(u, 0.82, 1)) * (pass ? 1 : 0.4));
        R.kraken.position.set(0, 0, 0);
        R.kraken.userData.arms.forEach((arm, i) => {
          arm.userData.segs.forEach((m, k) => {
            const f = k / 8, sway = Math.sin(t * 2 + i + k * 0.5) * (0.5 + f), reach = !pass && u > impact ? (1 - f) * 0.6 : 0;
            m.position.set(Math.sin(arm.userData.a) * sway - Math.cos(arm.userData.a) * f * f * 4 * reach, (k * 1.1 + 0.5) * rise - 1.5, Math.cos(arm.userData.a) * sway);
          });
        });
        R.kraken.userData.head.position.y = -6 + rise * 4;
      }
    }
    if (s.kind === 'intro' || s.kind === 'crew') { R.harbor.visible = true; R.harbor.position.set(0, 0, 0); }
    if (s.kind === 'sail') { R.harbor.visible = true; R.harbor.position.set(0, 0, ease(u) * 70); }
    if (s.kind === 'end') {
      const alive = [...F.ships.values()].some((b) => b.res && b.res.sunk < 0);
      if (alive) { R.harbor.visible = true; R.harbor.position.set(0, 0, lerp(-95, -12, ease(seg01(u, 0, 0.55)))); R.harbor.rotation.y = Math.PI; }
      else { R.debris.visible = true; R.debris.children.forEach((m, i) => { m.position.y = Math.sin(t * 1.2 + i) * 0.2 + 0.1; }); }
    } else R.harbor.rotation.y = 0;
    if (R.harbor.visible) R.harbor.userData.beam.rotation.y = t * 0.8;

    // ships
    const lay = layout(s, focus);
    for (const b of F.ships.values()) {
      const slot = lay.get(b.id);
      b.holder.visible = !!slot;
      if (!slot) continue;
      const r = b.res, mine = r && s.kind === 'obs' ? r.steps[s.i] : null, sinkingNow = r && s.kind === 'obs' && r.sunk === s.i;
      let x = slot[0], z = slot[1], lift = 0, roll = 0, pitch = 0, yaw = 0, shake = 0;
      if (s.kind === 'end' && R.harbor.visible) z = lerp(0, -4, ease(seg01(u, 0.3, 0.7)));
      const h = seaH(x, z), hf = seaH(x, z - 1.5), hb = seaH(x, z + 1.5), hl2 = seaH(x - 1.2, z), hr = seaH(x + 1.2, z);
      pitch = Math.atan2(hf - hb, 3); roll = Math.atan2(hl2 - hr, 2.4) * 0.8;
      if (mine && !mine.p && u > impact && u < impact + 0.14) { shake = Math.sin(t * 60) * 0.15 * (1 - (u - impact) / 0.14); roll += shake * 1.5; }
      if (s.kind === 'obs' && kind === 'whirl' && mine && !mine.p && u > 0.45) yaw = (u - 0.45) * 14;
      if (s.kind === 'obs' && kind === 'choppy' && mine && !mine.p) roll += Math.sin(t * 3) * 0.25;
      let y = h + 0.15 + lift;
      if (sinkingNow && u > 0.7) { const q = (u - 0.7) / 0.3; y -= q * q * 5.5; roll += q * 0.7; pitch -= q * 0.6; }
      b.holder.position.set(x + shake, y, z);
      b.holder.rotation.set(-pitch, yaw, roll, 'YXZ');
      // captain hops for joy, droops when hurt
      const cap = b.cap;
      let hop = 0, squash = 1;
      if (s.kind === 'crew' && b === focus) hop = Math.max(0, Math.sin(u * Math.PI * 4)) * 0.5;
      if (s.kind === 'end' && r && r.sunk < 0 && u > 0.5) hop = Math.max(0, Math.sin(t * 7 + b.id.length)) * 0.6;
      if (mine && u > 0.7) { if (mine.p) hop = Math.max(0, Math.sin((u - 0.7) * 30)) * 0.4; else squash = 0.82; }
      cap.position.y = b.deckY + hop; cap.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      const closeShot = s.kind === 'crew' || (s.kind === 'obs' && u >= 0.72) || (s.kind === 'end' && u >= 0.5);
      b.label.visible = b === focus ? s.kind === 'intro' || s.kind === 'sail' : s.kind !== 'crew' && !closeShot;
      for (const sl of b.parts.sails) sl.scale.z = 1 + Math.sin(t * 2 + b.id.length) * 0.15;
      b.parts.flag.rotation.x = Math.sin(t * 6) * 0.25;
      // effects around this ship
      const seed = (s.t0 | 0) + b.id.length * 31;
      if (mine && !mine.p) {
        if (kind === 'reef' || kind === 'fog') burst(seed, x, y + 0.8, z, hitAge, 18, 3, ['#8a5a2c', '#c79a5c'], 0.9);
        if (kind === 'wave' || kind === 'choppy' || kind === 'kraken') burst(seed, x, y + 0.5, z, hitAge, 40, 5, ['#ffffff', '#cfefff'], 1.4);
        if (kind === 'squall' && b === focus) burst(seed, x, y + 4, z, hitAge, 24, 4, ['#fff4a8', '#ffffff'], 0.7, 4);
      }
      if (sinkingNow && u > 0.7) for (let i = 0; i < 12; i++) { const a = ((t * 0.8 + rnd(seed, i)) % 1); part(x + (rnd(seed, i, 2) - 0.5) * 3, y + a * 6, z + (rnd(seed, i, 3) - 0.5) * 3, 0.5 * (1 - a), '#dff6ff'); }
      if (s.kind === 'end' && r && r.sunk < 0 && u > 0.5) for (let i = 0; i < 30; i++) { const a = ((t * 0.5 + rnd(seed, i)) % 1); part(x + (rnd(seed, i, 2) - 0.5) * 6, y + 8 - a * 8, z + (rnd(seed, i, 3) - 0.5) * 4, 0.35, ['#ff6b6b', '#ffd166', '#4cc9f0', '#7bd389', '#f15bb5'][i % 5]); }
      // wake
      if (s.kind === 'obs' || s.kind === 'sail') for (let i = 0; i < 6; i++) { const a = ((t * 0.9 + i / 6) % 1); part(x + (i % 2 ? 0.9 : -0.9) * (1 + a * 2), seaH(x, z + 3 + a * 10) + 0.1, z + b.len / 2 + a * 10, 0.6 * (1 - a), '#e9f7ff'); }
    }
    // the giant wave lifts ships as it passes (already in seaH); spray on its crest
    if (W.wallA) for (let i = 0; i < 40; i++) { const xx = (rnd(70, i) - 0.5) * 80, a = (t * 0.7 + rnd(71, i)) % 1; part(xx, W.wallA + 0.6 + a * 2, W.wallZ - 1 - a * 2, 0.5 * (1 - a), '#ffffff'); }

    // rain around the camera
    const rainOn = cur.rain > 0.05;
    R.rain.visible = rainOn;

    // camera
    const cam = R.cam, F0 = focus ? focus.holder.position.clone() : new T.Vector3(0, 0, 0);
    const shot = cameraFor(s, u, focus, F0, t);
    shot.pos.y = Math.max(shot.pos.y, seaH(shot.pos.x, shot.pos.z) + 1.3);
    cam.position.copy(shot.pos); cam.lookAt(shot.look); cam.fov = shot.fov || 50; cam.updateProjectionMatrix();
    R.sky.position.copy(cam.position);
    faceCamera(cam);
    updateSea(cam.position.x, cam.position.z - 40);
    if (rainOn) {
      const p = R.rain.geometry.attributes.position, n = p.count / 2;
      for (let i = 0; i < n; i++) {
        const rx = cam.position.x + (rnd(80, i) - 0.5) * 60, rz = cam.position.z + (rnd(81, i) - 0.5) * 60 - 10;
        const ry = cam.position.y + 20 - ((t * 26 + rnd(82, i) * 40) % 40);
        p.setXYZ(i * 2, rx, ry, rz); p.setXYZ(i * 2 + 1, rx - 0.25, ry - 1.2, rz);
      }
      p.needsUpdate = true; R.rain.material.opacity = 0.5 * cur.rain;
    }
    R.clouds.children.forEach((c, i) => { const a = c.userData.a + t * 0.006; c.position.set(cam.position.x + Math.cos(a) * c.userData.d, c.position.y, cam.position.z + Math.sin(a) * c.userData.d); });
    partFlush();
    R.post.uniforms.flash.value = flash;
    R.post.uniforms.time.value = t;
    draw();
    overlay(s, u, focus, e, over);
    ui.skip.hidden = !F.data.canSkip || over;
  }

  // turn each captain cutout to face the camera (around the vertical axis), whatever the ship is doing
  const _q = { p: null, w: null, t: null, e: null };
  function faceCamera(cam) {
    if (!_q.p) { _q.p = new T.Quaternion(); _q.w = new T.Vector3(); _q.t = new T.Quaternion(); _q.e = new T.Euler(); }
    for (const b of F.ships.values()) {
      if (!b.holder.visible) continue;
      const cap = b.cap; cap.parent.updateWorldMatrix(true, false);
      cap.getWorldPosition(_q.w);
      _q.t.setFromEuler(_q.e.set(0, Math.atan2(cam.position.x - _q.w.x, cam.position.z - _q.w.z), 0));
      cap.parent.getWorldQuaternion(_q.p);
      cap.quaternion.copy(_q.p.invert().multiply(_q.t));
    }
  }

  // ---------- camera work ----------
  function v(x, y, z) { return new T.Vector3(x, y, z); }
  // close-ups are framed from behind-right of the captain, where no mast or sail is in the way
  const CU = [3.4, 1.7, 4.4];
  function closeUp(focus, k) { const c = focus.cap.getWorldPosition(new T.Vector3()); return { pos: v(c.x + CU[0] - k * 0.5, c.y + CU[1], c.z + CU[2] - k * 0.7), look: v(c.x, c.y + 0.75, c.z), fov: 40 }; }
  function cameraFor(s, u, focus, F0, t) {
    const sway = (k) => Math.sin(t * 0.6 + k) * 0.4;
    if (s.kind === 'intro') {
      // wide over the harbor at dusk, slowly pushing in, storm on the horizon
      const k = ease(u);
      return { pos: v(lerp(46, 24, k), lerp(16, 9, k), lerp(-34, -26, k)), look: v(0, 3, 8), fov: 46 };
    }
    if (s.kind === 'crew') return closeUp(focus, ease(u));
    if (s.kind === 'sail') {
      const k = ease(u);
      return { pos: v(lerp(-30, -18, k), lerp(20, 12, k), lerp(-30, 8, k)), look: v(0, 1, lerp(0, 4, k)), fov: 52 };
    }
    if (s.kind === 'end') {
      if (!focus) return { pos: v(10 + sway(1), 6, 14), look: v(0, 0, 0), fov: 48 };
      if (u < 0.5) { const k = ease(u / 0.5); return { pos: v(F0.x - lerp(10, 6, k), lerp(9, 5, k), F0.z + lerp(18, 11, k)), look: v(F0.x + 8, 5, F0.z - 16), fov: 50 }; }
      return closeUp(focus, ease((u - 0.5) / 0.5));
    }
    // obstacles: A b-roll (0-.36), B challenge (.36-.72), C reaction (.72-1)
    const ob = s.ob, ua = u / 0.36, ub = (u - 0.36) / 0.36, uc = (u - 0.72) / 0.28;
    if (u < 0.36) {
      const k = ease(ua);
      if (ob === 'choppy') return { pos: v(F0.x + 13 - k * 2, 2.6 + sway(2) * 0.5, F0.z - 10 + k * 3), look: v(F0.x, 1.4, F0.z), fov: 50 };
      if (ob === 'reef') { const rz = lerp(-70, 50, u); return { pos: v(3, 2.2, rz - 8), look: v(0, 1.5, rz + 20), fov: 46 }; }
      if (ob === 'squall') return { pos: v(F0.x + 4, 3.5 + k * 2, F0.z + 15), look: v(F0.x + 2, 15, F0.z - 40), fov: 58 };
      if (ob === 'whirl') { const wz = lerp(-40, 20, u); return { pos: v(W.whirlX + 10, 58 - k * 10, wz + 26), look: v(W.whirlX, 0, wz - 2), fov: 50 }; }
      if (ob === 'fog') return { pos: v(F0.x + 1.5, 3.6, F0.z + 9), look: v(F0.x, 2.2, F0.z - 18), fov: 50 };
      if (ob === 'wave') return { pos: v(F0.x + 38 - k * 6, 6, F0.z - 10), look: v(F0.x, 5, (W.wallZ + F0.z) / 2), fov: 52 }; // side-on: the wave's shape against the sky
      if (ob === 'kraken') return { pos: v(F0.x - 10, 1.4, F0.z - 10 + k * 3), look: v(F0.x, 2.5, F0.z - 16), fov: 52 };
      return { pos: v(F0.x + 22 - k * 4, 9, F0.z + 2), look: v(F0.x, 1, F0.z - 4), fov: 46 }; // haul
    }
    if (u < 0.72) {
      const k = ease(ub);
      if (ob === 'wave') return { pos: v(F0.x + 22, 5, F0.z + 1), look: v(F0.x, 3 + W.wallA * 0.3, F0.z - 2), fov: 52 };
      if (ob === 'whirl') return { pos: v(F0.x + 6, 12, F0.z + 15), look: v(F0.x, 0, F0.z - 4), fov: 50 };
      return { pos: v(F0.x + lerp(10, 8, k), 3.5 + sway(3) * 0.4, F0.z + lerp(4, 1, k)), look: v(F0.x, 1.6, F0.z - 2), fov: 48 };
    }
    // reaction: close-up of the captain, or a wide shot of the ship going down
    if (focus && focus.res && focus.res.sunk === s.i) return { pos: v(F0.x + 8.5 - uc, 3.6, F0.z + 7.5 - uc), look: v(F0.x, 0.6, F0.z), fov: 44 };
    return closeUp(focus, ease(uc));
  }

  // ---------- drawing with the ink pass ----------
  function resize() {
    const w = root.clientWidth || 1, h = root.clientHeight || 1;
    if (w === R.w && h === R.h) return;
    R.w = w; R.h = h; R.r.setSize(w, h, false);
    const pr = R.r.getPixelRatio(), W2 = Math.round(w * pr), H2 = Math.round(h * pr);
    R.rtC.setSize(W2, H2); R.rtN.setSize(W2, H2);
    R.post.uniforms.res.value.set(W2, H2); R.post.uniforms.w.value = Math.max(1.2, 1.4 * pr);
    R.cam.aspect = w / h; R.cam.updateProjectionMatrix();
  }
  function draw() {
    const { r, scene, cam } = R;
    // 1) colour
    cam.layers.enableAll();
    r.setRenderTarget(R.rtC); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, cam);
    // 2) normals + depth of solid things (layer 0), with the sea flattened
    cam.layers.set(0);
    R.waterNormalMat.uniforms.up.value.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
    const sw = R.swaps; sw.length = 0;
    scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) { sw.push(o, o.material); o.material = o.userData.water ? R.waterNormalMat : o.userData.nmat || R.normalMat; } });
    const fog = scene.fog; scene.fog = null;
    r.setRenderTarget(R.rtN); r.setClearColor(0x8080ff, 1); r.clear(); r.render(scene, cam);
    scene.fog = fog;
    for (let i = 0; i < sw.length; i += 2) sw[i].material = sw[i + 1];
    cam.layers.enableAll();
    // 3) ink
    r.setRenderTarget(null); r.render(R.quadScene, R.quadCam);
  }

  // ---------- captions and HUD ----------
  let capKey = '', titleKey = '', boardKey = '';
  function setCap(key, head, body, tone) {
    if (key === capKey) return; capKey = key;
    ui.cap.hidden = !head && !body;
    ui.cap.className = 'cine-cap' + (tone ? ' ' + tone : '');
    ui.cap.querySelector('b').textContent = head || ''; ui.cap.querySelector('p').textContent = body || '';
    ui.cap.classList.remove('in'); void ui.cap.offsetWidth; ui.cap.classList.add('in');
  }
  function setTitle(key, icon, name, sub) {
    if (key === titleKey) return; titleKey = key;
    ui.title.hidden = !name;
    if (!name) return;
    ui.title.querySelector('.ic').textContent = icon || ''; ui.title.querySelector('b').textContent = name; ui.title.querySelector('small').textContent = sub || '';
    ui.title.classList.remove('in'); void ui.title.offsetWidth; ui.title.classList.add('in');
  }
  function overlay(s, u, focus, e, over) {
    const d = F.data, route = d.V.route, n = route.length;
    // fade in from black at the start and between scenes
    const startFade = e < 900 ? 1 - e / 900 : 0;
    ui.fade.style.opacity = String(startFade);
    // route progress
    const nodes = ui.bar.children;
    const prog = s.kind === 'obs' ? s.i + (u >= 0.55 ? 1 : 0) : s.kind === 'end' ? n + 1 : 0;
    for (let i = 0; i < nodes.length; i++) { nodes[i].classList.toggle('done', i < prog); nodes[i].classList.toggle('now', s.kind === 'obs' ? i === s.i : s.kind === 'end' && i === n); }
    ui.bar.hidden = !(s.kind === 'obs' || s.kind === 'end' || s.kind === 'sail');
    // hearts of the ship we follow
    const r = focus && focus.res;
    if (r && (s.kind === 'obs' || s.kind === 'end' || s.kind === 'sail')) {
      let hp = r.hp0;
      if (s.kind === 'obs') { hp = s.i === 0 ? r.hp0 : (r.steps[s.i - 1] || { hp: r.hp }).hp; if (u >= 0.55 && r.steps[s.i]) hp = r.steps[s.i].hp; }
      if (s.kind === 'end') hp = r.hp;
      const who = focus.id === d.meId ? 'Your ship' : `${focus.p.name}'s ship`;
      const key = who + hp + '/' + r.hp0;
      if (ui.hearts.dataset.k !== key) { ui.hearts.dataset.k = key; ui.hearts.innerHTML = ''; ui.hearts.append(el('b', null, who)); const row = el('span'); for (let i = 0; i < r.hp0; i++) row.append(el('i', i < hp ? 'on' : 'off', '♥')); ui.hearts.append(row); }
      ui.hearts.hidden = false;
    } else ui.hearts.hidden = true;
    // captions
    if (s.kind === 'intro') {
      setTitle('', ''); setCap('intro', 'The last evening on the island', `${d.players.length === 1 ? 'One ship is' : `${d.players.length} ships are`} tied up in the harbor. Out at sea, black clouds are rolling in…`);
    } else if (s.kind === 'crew') {
      const b = focus, mine = b.id === d.meId;
      setTitle('crew' + b.id, '', ''); setCap('crew' + b.id, `Captain ${b.p.name}${mine ? ' (you)' : ''}`, shipLine(d.ships[b.id] || {}, d), 'crew');
    } else if (s.kind === 'sail') {
      setTitle('', ''); setCap('sail', 'Ropes off!', `The fleet sails out into the storm. ${n} dangers stand between them and home.`);
    } else if (s.kind === 'obs') {
      const o = d.OBST[s.ob], st = r && r.steps[s.i], name = focus.id === d.meId ? 'Your ship' : `${focus.p.name}'s ship`;
      setTitle('t' + s.i, o.icon, o.name, `Danger ${s.i + 1} of ${n}`);
      if (u < 0.36) setCap('a' + s.i, '', STORY[s.ob]);
      else if (u < 0.72) setCap('b' + s.i + focus.id, `Needs ${o.stats.map((k) => d.STAT_NAME[k]).join(' + ')} ${st ? st.need : ''}`, `${name} has ${st ? st.v : 0}.`);
      else {
        const sunk = r && r.sunk === s.i;
        if (sunk) setCap('c' + s.i + focus.id, `${name} sinks!`, focus.id === d.meId ? 'Your crew swims for a floating barrel. Let’s watch the others…' : `${focus.p.name}'s crew abandons ship.`, 'bad');
        else if (st && st.p) setCap('c' + s.i + focus.id, 'Cleared!', `${name} ${PASS[s.ob]}.`, 'good');
        else setCap('c' + s.i + focus.id, `−${o.dmg} ♥`, `${name} ${FAIL[s.ob]}.`, 'bad');
      }
      // everyone's result for this danger
      const key = 'r' + s.i + (u >= 0.72 ? 'x' : '');
      if (key !== boardKey) {
        boardKey = key; ui.board.innerHTML = '';
        if (u >= 0.72 && F.ships.size > 1) {
          for (const id of d.V.rank) {
            const b = F.ships.get(id); if (!b || !b.res || !aliveAt(b, s.i)) continue;
            const st2 = b.res.steps[s.i]; const row = el('span', st2 && st2.p ? 'ok' : b.res.sunk === s.i ? 'sunk' : 'hit');
            row.append(el('i'), document.createTextNode(`${b.p.name}  ${st2 && st2.p ? '✓' : b.res.sunk === s.i ? 'sank' : `−${o.dmg}♥`}`));
            row.querySelector('i').style.background = b.p.color; ui.board.appendChild(row);
          }
        }
      }
      ui.board.hidden = !(u >= 0.72 && F.ships.size > 1);
    } else if (s.kind === 'end') {
      const home = d.V.rank.map((id) => F.ships.get(id)).filter((b) => b && b.res && b.res.sunk < 0);
      setTitle('end', home.length ? '⚓' : '🌊', home.length ? 'Safe harbor' : 'Lost at sea', '');
      if (home.length) {
        const names = home.map((b) => b.p.name);
        const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
        setCap('end', 'Dawn breaks over the harbor', `The lighthouse guides ${list} home. ${over ? '' : 'Final results coming up…'}`, 'good');
      } else setCap('end', 'No ship made it home', 'The sea keeps its secrets tonight. The ship that sailed furthest wins.', 'bad');
      ui.board.hidden = true;
    }
    if (s.kind !== 'obs') { ui.board.hidden = true; boardKey = ''; }
    if (s.kind === 'intro' || s.kind === 'sail' || s.kind === 'crew') { if (titleKey) setTitle('', ''); }
  }

  return {
    preload,
    ready: () => !!T,
    failed: () => failed,
    begin, render, stop,
    active: () => !!F,
    key: () => (F ? F.key : null),
  };
})();
