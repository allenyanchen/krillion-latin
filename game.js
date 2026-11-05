// Krillion Latin — Pufferfish Party: Subjunctive Set
// The host's browser runs the game and broadcasts the state.
// Other players send "answer" and "pass" actions to the host.
// Messages go through Supabase Realtime (online), or BroadcastChannel (local test mode).
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  const QS = window.SUBJUNCTIVE_SET;
  const cfg = window.KRILLION_CONFIG || {};
  const ONLINE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  // Game tuning
  const FUSE_MIN = 25000, FUSE_MAX = 40000; // hidden fuse per round (ms)
  const WRONG_PENALTY = 4000;               // wrong answer burns this much fuse
  const POP_PAUSE = 3000;                   // pause after a pop
  const POINTS = 100;

  const SET_NAMES = { both: 'Present + Imperfect', present: 'Present subjunctive', imperfect: 'Imperfect subjunctive' };

  function getId() {
    try {
      let id = sessionStorage.getItem('kl-id');
      if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('kl-id', id); }
      return id;
    } catch (e) { return Math.random().toString(36).slice(2, 10); }
  }

  const me = { id: getId(), name: '', host: false };
  let transport = null;
  let S = null;            // latest game state
  let code = '';
  let localFuseEnd = 0;    // this browser's estimate of when the fuse ends
  let lastQKey = '';
  let joinTimer = null;
  let roster = [];

  // ---------- Answer checking ----------
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/j/g, 'i').replace(/[^a-z]/g, '');
  function isCorrect(given, q) {
    const ok = [q.answer];
    if (q.voice === 'passive' && /ris$/.test(q.answer)) ok.push(q.answer.replace(/ris$/, 're')); // -ris / -re
    const g = norm(given);
    return ok.some((a) => norm(a) === g);
  }
  const promptFor = (q) => `Form the <span class="kind">${q.tense} ${q.voice}</span> subjunctive of <b>${esc(q.verb)}</b>`;

  // ---------- Transports ----------
  function supabaseTransport(room, h) {
    const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const ch = client.channel('krillion-puffer-' + room, {
      config: { broadcast: { self: true }, presence: { key: me.id } },
    });
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => h.onMessage(payload));
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState();
      h.onRoster(Object.values(st).map((arr) => arr[0]).filter(Boolean));
    });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ id: me.id, name: me.name, host: me.host });
        h.onReady();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        toast('Connection problem (' + status + '). Check config.js / your internet.');
      }
    });
    return { send: (msg) => ch.send({ type: 'broadcast', event: 'msg', payload: msg }) };
  }

  // Local test mode: open several tabs in the same browser.
  function localTransport(room, h) {
    const bc = new BroadcastChannel('krillion-puffer-' + room);
    const peers = new Map();
    const self = () => ({ id: me.id, name: me.name, host: me.host });
    let lastKey = '';
    const emitRoster = () => {
      const now = Date.now();
      for (const [id, p] of peers) if (now - p.seen > 5000) peers.delete(id);
      const list = [self(), ...[...peers.values()].map((p) => p.info)];
      const key = list.map((p) => p.id).sort().join(',');
      if (key !== lastKey) { lastKey = key; h.onRoster(list); }
    };
    bc.onmessage = ({ data }) => {
      if (data.kind === 'hb') { peers.set(data.info.id, { info: data.info, seen: Date.now() }); emitRoster(); }
      else if (data.kind === 'bye') { peers.delete(data.id); emitRoster(); }
      else if (data.kind === 'msg') h.onMessage(data.msg);
    };
    const beat = () => bc.postMessage({ kind: 'hb', info: self() });
    beat(); setInterval(() => { beat(); emitRoster(); }, 1500);
    window.addEventListener('beforeunload', () => bc.postMessage({ kind: 'bye', id: me.id }));
    setTimeout(() => { emitRoster(); h.onReady(); }, 50);
    return {
      send: (msg) => { bc.postMessage({ kind: 'msg', msg }); setTimeout(() => h.onMessage(msg), 0); },
    };
  }

  function connect(room) {
    const handlers = {
      onMessage: (m) => { if (me.host) Host.onMessage(m); else Client.onMessage(m); },
      onRoster: (list) => { roster = list; if (me.host) Host.onRoster(list); else Client.onRoster(list); },
      onReady: () => { if (me.host) Host.broadcast(); },
    };
    transport = ONLINE ? supabaseTransport(room, handlers) : localTransport(room, handlers);
  }

  // ---------- Host (authoritative game logic) ----------
  const Host = {
    deck: [], cur: null, fuseEnd: 0, popTimer: null,

    init() {
      S = {
        phase: 'lobby', code, hostId: me.id, set: 'both', lives: 3,
        players: [], holder: null, awaitingPass: false,
        q: null, qSerial: 0, fuseLeft: 0, fuseTotal: 1,
        round: 0, feed: [], result: null, popped: null, winner: null,
      };
      setInterval(() => this.tick(), 250);
      setInterval(() => this.broadcast(), 3000); // resync for late joiners / dropped messages
    },

    player(id) { return S.players.find((p) => p.id === id); },
    alive() { return S.players.filter((p) => !p.out && !p.gone); },
    log(text) { S.feed.unshift(text); S.feed = S.feed.slice(0, 8); },

    broadcast() {
      if (!S) return;
      if (S.phase === 'play') S.fuseLeft = Math.max(0, this.fuseEnd - Date.now());
      transport && transport.send({ t: 'state', s: S });
      render(S);
    },

    onRoster(list) {
      for (const r of list) {
        const p = this.player(r.id);
        if (p) { p.gone = false; p.name = r.name; }
        else {
          const late = S.phase !== 'lobby';
          S.players.push({ id: r.id, name: r.name, lives: late ? 0 : S.lives, score: 0, out: late, gone: false });
          if (late) this.log(`👀 ${r.name} joined as a spectator`);
        }
      }
      const ids = new Set(list.map((r) => r.id));
      if (S.phase === 'lobby') S.players = S.players.filter((p) => ids.has(p.id));
      else for (const p of S.players) if (!ids.has(p.id) && !p.gone) { p.gone = true; this.log(`🔌 ${p.name} left`); }

      if (S.phase === 'play' && this.player(S.holder)?.gone) {
        const next = this.alive();
        if (next.length >= 2) { this.giveTo(next[Math.floor(Math.random() * next.length)].id); }
      }
      if (S.phase === 'play' || S.phase === 'pop') this.checkWin();
      this.broadcast();
    },

    onMessage(m) {
      if (m.t === 'answer') this.answer(m.from, m.text);
      else if (m.t === 'pass') this.pass(m.from, m.to);
    },

    configure(set, lives) {
      if (S.phase !== 'lobby') return;
      S.set = set; S.lives = lives;
      S.players.forEach((p) => (p.lives = lives));
      this.broadcast();
    },

    start() {
      S.players = S.players.filter((p) => !p.gone);
      if (S.players.length < 2) return toast('You need at least 2 players.');
      S.players.forEach((p) => { p.lives = S.lives; p.score = 0; p.out = false; });
      const src = S.set === 'both' ? [...QS.present, ...QS.imperfect] : QS[S.set];
      this.src = src;
      this.deck = shuffle(src.slice());
      S.round = 0; S.feed = []; S.winner = null;
      this.log('🎉 The party has started!');
      const a = this.alive();
      this.newRound(a[Math.floor(Math.random() * a.length)].id);
    },

    newRound(holderId) {
      S.round++;
      S.phase = 'play';
      S.fuseTotal = Math.round(rand(FUSE_MIN, FUSE_MAX));
      this.fuseEnd = Date.now() + S.fuseTotal;
      S.popped = null;
      this.giveTo(holderId);
      this.broadcast();
    },

    giveTo(id) { S.holder = id; S.awaitingPass = false; S.result = null; this.nextQuestion(); },

    nextQuestion() {
      if (!this.deck.length) this.deck = shuffle(this.src.slice());
      this.cur = this.deck.pop();
      S.q = { verb: this.cur.verb, tense: this.cur.tense, voice: this.cur.voice };
      S.qSerial++;
    },

    answer(from, text) {
      if (S.phase !== 'play' || from !== S.holder || S.awaitingPass) return;
      const p = this.player(from);
      if (isCorrect(text, this.cur)) {
        p.score += POINTS;
        S.awaitingPass = true;
        S.result = { id: from, ok: true, answer: this.cur.answer };
        this.log(`✅ ${p.name}: ${this.cur.verb} → ${this.cur.answer}`);
      } else {
        this.fuseEnd -= WRONG_PENALTY;
        S.result = { id: from, ok: false, given: String(text).slice(0, 30), answer: this.cur.answer, verb: this.cur.verb };
        this.log(`❌ ${p.name}: ${this.cur.verb} → ${this.cur.answer} (puff!)`);
        this.nextQuestion();
      }
      this.broadcast();
    },

    pass(from, to) {
      if (S.phase !== 'play' || from !== S.holder || !S.awaitingPass || from === to) return;
      const t = this.player(to);
      if (!t || t.out || t.gone) return;
      this.log(`🐡 ${this.player(from).name} passed to ${t.name}`);
      this.giveTo(to);
      this.broadcast();
    },

    tick() {
      if (S && S.phase === 'play' && Date.now() >= this.fuseEnd) this.pop();
    },

    pop() {
      const p = this.player(S.holder);
      S.phase = 'pop';
      S.popped = p ? p.id : null;
      if (p) {
        p.lives = Math.max(0, p.lives - 1);
        if (p.lives === 0) p.out = true;
        this.log(`💥 POP! ${p.name} got puffed${p.out ? ' and is out' : ''}`);
      }
      this.broadcast();
      clearTimeout(this.popTimer);
      this.popTimer = setTimeout(() => {
        if (S.phase !== 'pop') return;
        if (this.checkWin()) return this.broadcast();
        const a = this.alive();
        this.newRound(a[Math.floor(Math.random() * a.length)].id);
      }, POP_PAUSE);
    },

    checkWin() {
      const a = this.alive();
      if (a.length > 1) return false;
      const ranked = S.players.slice().sort((x, y) => (y.lives - x.lives) || (y.score - x.score));
      S.winner = (a[0] || ranked[0] || {}).id || null;
      S.phase = 'over';
      clearTimeout(this.popTimer);
      return true;
    },

    backToLobby() {
      S.phase = 'lobby';
      S.players = S.players.filter((p) => !p.gone);
      S.players.forEach((p) => { p.lives = S.lives; p.out = false; p.score = 0; });
      S.feed = []; S.result = null; S.winner = null; S.holder = null;
      this.broadcast();
    },
  };

  // ---------- Client ----------
  const Client = {
    onMessage(m) {
      if (m.t !== 'state' || m.s.code !== code) return;
      clearTimeout(joinTimer);
      S = m.s;
      render(S);
    },
    hostGoneTimer: null,
    onRoster(list) {
      // Only warn if the host stays missing (brief reconnects are normal).
      if (list.some((r) => r.host)) { clearTimeout(this.hostGoneTimer); this.hostGoneTimer = null; return; }
      if (S && !this.hostGoneTimer) {
        this.hostGoneTimer = setTimeout(() => {
          if (!roster.some((r) => r.host)) toast('The host left the game. Refresh to start a new room.', 10000);
          this.hostGoneTimer = null;
        }, 8000);
      }
    },
  };

  function act(msg) { transport.send({ ...msg, from: me.id }); }

  // ---------- Rendering ----------
  function setHTML(sel, html) { const el = $(sel); if (el.innerHTML !== html) el.innerHTML = html; }
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }

  function render(s) {
    if (s.phase === 'lobby') return renderLobby(s);
    if (s.phase === 'over') return renderOver(s);
    renderGame(s);
  }

  function renderLobby(s) {
    show('lobby');
    $('#popOverlay').classList.remove('show');
    $('#lobbyCode').textContent = s.code;
    $('#pCount').textContent = `(${s.players.length})`;
    $('#lobbyPlayers').innerHTML = s.players
      .map((p) => `<li class="${p.id === me.id ? 'me' : ''}">${p.id === s.hostId ? '👑 ' : ''}${esc(p.name)}</li>`)
      .join('');
    $('#hostOpts').style.display = me.host ? '' : 'none';
    $('#guestWait').style.display = me.host ? 'none' : '';
    if (me.host) {
      if (document.activeElement !== $('#setSel')) $('#setSel').value = s.set;
      if (document.activeElement !== $('#livesSel')) $('#livesSel').value = String(s.lives);
      const enough = s.players.length >= 2;
      $('#startBtn').disabled = !enough;
      $('#startHint').textContent = enough ? '' : 'Pufferfish Party needs at least 2 players. Share the code!';
    }
  }

  function renderGame(s) {
    show('game');
    const holder = s.players.find((p) => p.id === s.holder);
    const mine = s.holder === me.id && s.phase === 'play';
    const meP = s.players.find((p) => p.id === me.id);

    $('#hudRound').textContent = `Round ${s.round}`;
    $('#hudSet').textContent = SET_NAMES[s.set];
    $('#hudCode').textContent = `Room ${s.code}`;

    localFuseEnd = me.host ? Host.fuseEnd : Date.now() + s.fuseLeft;

    $('#holderLabel').textContent = !holder ? '' : mine ? '🐡 You have the pufferfish!' : `🐡 ${holder.name} has the pufferfish`;

    // Question area
    const qKey = `${s.qSerial}`;
    const newQ = qKey !== lastQKey;
    lastQKey = qKey;
    $('#qPrompt').innerHTML = s.q ? (mine ? '' : `<span class="muted">${esc(holder ? holder.name : '')} is answering:</span><br>`) + promptFor(s.q) : '';
    $('#answerForm').style.display = mine && !s.awaitingPass ? '' : 'none';
    $('#passBox').style.display = mine && s.awaitingPass ? 'block' : 'none';
    if (newQ) {
      $('#answerIn').value = '';
      if (mine && !s.awaitingPass) setTimeout(() => $('#answerIn').focus(), 30);
    }
    const fb = $('#feedback');
    const r = s.result;
    if (r && r.id === me.id && s.holder === me.id) {
      fb.className = 'feedback ' + (r.ok ? 'good' : 'bad');
      fb.textContent = r.ok ? `Correct: ${r.answer}` : `Not quite: ${r.verb} → ${r.answer}. The fish puffs up! Try this one:`;
    } else if (meP && meP.out && !meP.gone) {
      fb.className = 'feedback'; fb.textContent = 'You are out, so sit back and watch the party!';
    } else { fb.className = 'feedback'; fb.textContent = ''; }

    // Players
    const canPass = mine && s.awaitingPass;
    setHTML('#plist', s.players.map((p) => {
      const isTarget = canPass && p.id !== me.id && !p.out && !p.gone;
      const cls = [p.id === s.holder ? 'holder' : '', p.out ? 'out' : '', p.gone ? 'gone' : '', isTarget ? 'target' : ''].join(' ');
      const hearts = p.out ? 'out' : '❤️'.repeat(p.lives);
      return `<li class="${cls}" data-id="${esc(p.id)}"><span>${p.id === s.holder ? '🐡 ' : ''}${esc(p.name)}${p.id === me.id ? ' (you)' : ''}</span><span class="meta">${hearts} · ${p.score}</span></li>`;
    }).join(''));
    setHTML('#feed', s.feed.map((f) => `<li>${esc(f)}</li>`).join(''));

    // Pop overlay
    const ov = $('#popOverlay');
    if (s.phase === 'pop') {
      const p = s.players.find((x) => x.id === s.popped);
      $('#popName').textContent = p ? (p.id === me.id ? 'You got puffed!' : `${p.name} got puffed!`) : '';
      ov.classList.add('show');
    } else ov.classList.remove('show');
  }

  function renderOver(s) {
    show('over');
    $('#popOverlay').classList.remove('show');
    const w = s.players.find((p) => p.id === s.winner);
    $('#winnerName').textContent = w ? (w.id === me.id ? 'You win!' : `${w.name} wins!`) : 'Game over';
    const ranked = s.players.slice().sort((a, b) => (a.id === s.winner ? -1 : b.id === s.winner ? 1 : (b.lives - a.lives) || (b.score - a.score)));
    $('#standings').innerHTML = ranked.map((p) => `<li>${esc(p.name)}: ${p.score} pts</li>`).join('');
    $('#againBtn').style.display = me.host ? '' : 'none';
    $('#againWait').style.display = me.host ? 'none' : '';
  }

  // ---------- Pufferfish drawing ----------
  const SPIKES = 24;
  function buildPuffer() {
    let spikes = '';
    for (let i = 0; i < SPIKES; i++) spikes += `<g transform="rotate(${(360 / SPIKES) * i} 100 100)"><polygon class="spk" points="95,52 105,52 100,50"/></g>`;
    $('#pufferWrap').innerHTML = `
      <svg viewBox="0 0 200 200" aria-label="Pufferfish">
        <g id="spikes" fill="#c9861a">${spikes}</g>
        <polygon points="40,100 14,78 18,100 14,122" fill="#f0a73a" stroke="#a96a12" stroke-width="3" stroke-linejoin="round"/>
        <circle id="pbody" cx="100" cy="100" r="50" fill="#ffd166" stroke="#a96a12" stroke-width="3"/>
        <ellipse cx="104" cy="122" rx="34" ry="22" fill="#fff4d6"/>
        <circle cx="70" cy="96" r="5" fill="#a96a12" opacity=".35"/><circle cx="84" cy="74" r="4" fill="#a96a12" opacity=".35"/><circle cx="66" cy="120" r="4" fill="#a96a12" opacity=".35"/>
        <ellipse cx="96" cy="112" rx="12" ry="7" fill="#f0a73a" stroke="#a96a12" stroke-width="2" transform="rotate(-20 96 112)"/>
        <circle cx="122" cy="86" r="13" fill="#fff" stroke="#12304a" stroke-width="2"/>
        <circle id="pupil" cx="126" cy="86" r="6" fill="#12304a"/>
        <ellipse id="mouth" cx="148" cy="106" rx="5" ry="4" fill="#c2453c"/>
      </svg>`;
  }

  function animate() {
    const wrap = $('#pufferWrap');
    if (S && (S.phase === 'play' || S.phase === 'pop') && wrap.firstElementChild) {
      const total = S.fuseTotal || 1;
      const left = S.phase === 'pop' ? 0 : Math.max(0, localFuseEnd - Date.now());
      const inf = Math.min(1, Math.max(0, 1 - left / total));
      const svg = wrap.firstElementChild;
      svg.style.transform = `scale(${0.75 + inf * 0.7})`;
      const L = 2 + inf * 22;
      document.querySelectorAll('#spikes .spk').forEach((el) => el.setAttribute('points', `95,52 105,52 100,${52 - L}`));
      const hue = 45 - inf * 38;
      $('#pbody').setAttribute('fill', `hsl(${hue} 100% ${70 - inf * 10}%)`);
      $('#mouth').setAttribute('ry', String(4 - inf * 2.5));
      wrap.classList.toggle('danger', inf > 0.75);
    }
    requestAnimationFrame(animate);
  }

  // ---------- UI wiring ----------
  let toastTimer;
  function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function readName() {
    const n = $('#nameIn').value.trim().slice(0, 16);
    if (!n) { toast('Enter your name first.'); $('#nameIn').focus(); return null; }
    try { localStorage.setItem('kl-name', n); } catch (e) {}
    return n;
  }

  function makeCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  }

  function setRoomInUrl() {
    try { history.replaceState(null, '', `${location.pathname}?room=${code}`); } catch (e) {}
  }

  $('#createBtn').onclick = () => {
    const n = readName(); if (!n) return;
    me.name = n; me.host = true; code = makeCode();
    setRoomInUrl();
    Host.init();
    render(S);
    connect(code);
  };

  $('#joinBtn').onclick = () => {
    const n = readName(); if (!n) return;
    const c = $('#codeIn').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return toast('Room codes are 4 letters.');
    me.name = n; me.host = false; code = c;
    setRoomInUrl();
    $('#joinBtn').disabled = true; $('#joinBtn').textContent = 'Joining…';
    connect(code);
    joinTimer = setTimeout(() => {
      toast(`No room found with code ${code}. Check the code with your host.`, 6000);
      $('#joinBtn').disabled = false; $('#joinBtn').textContent = 'Join';
    }, 8000);
  };
  $('#codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });

  $('#copyLink').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${code}`;
    try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch (e) { toast(url, 8000); }
  };

  $('#setSel').onchange = $('#livesSel').onchange = () => Host.configure($('#setSel').value, Number($('#livesSel').value));
  $('#startBtn').onclick = () => Host.start();
  $('#againBtn').onclick = () => Host.backToLobby();

  $('#answerForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#answerIn').value.trim();
    if (!v) return;
    act({ t: 'answer', text: v });
    $('#answerIn').value = '';
  };

  $('#plist').onclick = (e) => {
    const li = e.target.closest('li.target');
    if (li) act({ t: 'pass', to: li.dataset.id });
  };

  // Init
  try { $('#nameIn').value = localStorage.getItem('kl-name') || ''; } catch (e) {}
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) $('#codeIn').value = roomParam.toUpperCase().slice(0, 4);
  $('#modeNote').innerHTML = ONLINE
    ? '🌐 Online multiplayer is on (Supabase).'
    : '🧪 <b>Local test mode</b>: Supabase isn’t set up in <code>config.js</code> yet, so rooms only work between tabs in this browser.';

  const bubbles = document.querySelector('.bubbles');
  for (let i = 0; i < 18; i++) {
    const b = document.createElement('i');
    const size = rand(6, 22);
    Object.assign(b.style, { left: rand(0, 100) + '%', width: size + 'px', height: size + 'px', animationDuration: rand(8, 18) + 's', animationDelay: -rand(0, 18) + 's' });
    bubbles.appendChild(b);
  }

  buildPuffer();
  requestAnimationFrame(animate);
})();
