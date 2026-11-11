/*
 * 松鼠大作战 · Squirrel Quest
 * 渲染 / 输入 / 音效 / 音频 / 分享
 *
 * 规则与物理在 engine.js 中；这里只负责表现与交互。
 */
(function () {
  'use strict';

  const E = window.SquirrelEngine;
  if (!E) {
    document.getElementById('fatal-message').textContent = 'engine.js 加载失败';
    document.getElementById('fatal').classList.remove('is-hidden');
    return;
  }

  const { GameState, TILE } = E;
  const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';

  // ─── 小工具 ────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const mod = (n, m) => ((n % m) + m) % m;
  const rand = (a, b) => a + Math.random() * (b - a);
  const prefersReducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function hash2(x, y) {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function fillEllipse(g, cx, cy, rx, ry) {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }

  function withAlpha(hex, a) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    if (!Number.isFinite(n)) return `rgba(255,255,255,${a})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ─── DOM ───────────────────────────────────────────────
  const canvas = $('#game');
  const app = $('#app');
  const ctx = canvas.getContext('2d', { alpha: false });
  const ui = {
    hud: $('#hud'),
    score: $('#score'),
    level: $('#level'),
    acornCount: $('#acorn-count'),
    keyChip: $('#key-chip'),
    keyCount: $('#key-count'),
    hearts: $('#hearts'),
    mute: $('#btn-mute'),
    pause: $('#btn-pause'),
    touch: $('#touch-controls'),
    actionBtn: document.querySelector('[data-control="action"]'),
    jumpBtn: document.querySelector('[data-control="jump"]'),
    leftBtn: document.querySelector('[data-control="left"]'),
    rightBtn: document.querySelector('[data-control="right"]'),

    screenMenu: $('#screen-menu'),
    screenPause: $('#screen-pause'),
    screenResult: $('#screen-result'),

    start: $('#btn-start'),
    levelSelect: $('#level-select'),
    levelProgress: $('#level-progress'),
    menuShare: $('#btn-menu-share'),
    menuSound: $('#btn-menu-sound'),
    fullscreen: $('#btn-fullscreen'),
    landscape: $('#btn-landscape'),
    install: $('#btn-install'),
    challengeBanner: $('#challenge-banner'),
    challengeScore: $('#challenge-score'),
    bestScore: $('#best-score'),

    resume: $('#btn-resume'),
    pauseShare: $('#btn-pause-share'),
    pauseRestart: $('#btn-pause-restart'),
    pauseMenu: $('#btn-pause-menu'),

    resultEyebrow: $('#result-eyebrow'),
    resultTitle: $('#result-title'),
    resultScore: $('#result-score'),
    resultDetail: $('#result-detail'),
    resultBest: $('#result-best'),
    challengeResult: $('#challenge-result'),
    resultPrimary: $('#btn-result-primary'),
    resultShare: $('#btn-result-share'),
    resultMenu: $('#btn-result-menu'),

    shareModal: $('#share-modal'),
    shareClose: $('#btn-share-close'),
    shareImage: $('#share-image'),
    shareLoading: $('#share-loading'),
    shareUrl: $('#share-url'),
    shareNative: $('#btn-share-native'),
    shareDownload: $('#btn-share-download'),
    shareCopy: $('#btn-share-copy'),

    tutorial: $('#tutorial'),
    tutorialText: $('#tutorial-text'),
    tutorialProgress: $('#tutorial-progress'),
    tutorialDots: $('#tutorial-dots'),
    tutorialSkip: $('#btn-tutorial-skip'),

    toast: $('#toast'),
    damage: $('#damage-flash'),
    fatal: $('#fatal'),
    fatalMessage: $('#fatal-message'),
    fatalReload: $('#btn-fatal-reload'),
  };

  // ─── 持久化 ────────────────────────────────────────────
  const KEY_BEST = 'squirrelQuest.best.v1';
  const KEY_MUTE = 'squirrelQuest.muted.v1';
  const KEY_PROGRESS = 'squirrelQuest.progress.v1';

  function loadNumber(key, fallback) {
    try {
      const v = Number(localStorage.getItem(key));
      return Number.isFinite(v) && v >= 0 ? v : fallback;
    } catch (_) { return fallback; }
  }
  function saveNumber(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { /* 隐私模式忽略 */ }
  }

  // ─── 音效 ──────────────────────────────────────────────
  class Sfx {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noiseBuffer = null;
      this.muted = loadNumber(KEY_MUTE, 0) === 1;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.4);
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch (_) {
        this.ctx = null;
      }
    }

    setMuted(muted) {
      this.muted = !!muted;
      if (this.master) {
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, now, 0.02);
      }
    }

    tone(freq, opts) {
      if (!this.ctx || this.muted) return;
      const o = opts || {};
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const dur = o.dur || 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain || 0.08), t0 + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    noise(opts) {
      if (!this.ctx || this.muted || !this.noiseBuffer) return;
      const o = opts || {};
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const dur = o.dur || 0.15;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = o.filter || 'bandpass';
      filter.frequency.setValueAtTime(o.freq || 900, t0);
      if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + dur);
      filter.Q.value = o.q == null ? 0.9 : o.q;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain || 0.07), t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    play(name) {
      if (this.muted) return;
      this.init();
      if (!this.ctx) return;
      switch (name) {
        case 'jump':
          this.tone(330, { to: 660, type: 'square', dur: 0.1, gain: 0.055 });
          break;
        case 'acorn':
          this.tone(880, { type: 'sine', dur: 0.07, gain: 0.09 });
          this.tone(1174.7, { type: 'sine', dur: 0.08, gain: 0.08, delay: 0.055 });
          this.tone(1568, { type: 'triangle', dur: 0.09, gain: 0.045, delay: 0.11 });
          break;
        case 'stomp':
          this.tone(150, { to: 55, type: 'square', dur: 0.16, gain: 0.1 });
          this.noise({ dur: 0.09, gain: 0.06, freq: 500, filter: 'lowpass' });
          break;
        case 'golden':
          [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
            this.tone(f, { type: 'triangle', dur: 0.16, gain: 0.07, delay: i * 0.055 });
          });
          this.tone(523.25, { type: 'sine', dur: 0.4, gain: 0.05, delay: 0.02 });
          break;
        case 'checkpoint':
          this.tone(587.33, { type: 'triangle', dur: 0.14, gain: 0.07 });
          this.tone(880, { type: 'triangle', dur: 0.22, gain: 0.07, delay: 0.11 });
          break;
        case 'key':
          this.tone(783.99, { type: 'triangle', dur: 0.1, gain: 0.07 });
          this.tone(1174.7, { type: 'sine', dur: 0.2, gain: 0.065, delay: 0.08 });
          break;
        case 'gate':
          this.tone(329.63, { to: 493.88, type: 'triangle', dur: 0.2, gain: 0.07 });
          this.tone(659.25, { type: 'sine', dur: 0.26, gain: 0.06, delay: 0.16 });
          this.noise({ dur: 0.18, gain: 0.03, freq: 420, filter: 'lowpass' });
          break;
        case 'hurt':
          this.tone(300, { to: 85, type: 'sawtooth', dur: 0.3, gain: 0.085 });
          this.noise({ dur: 0.2, gain: 0.04, freq: 700, filter: 'lowpass' });
          break;
        case 'spring':
          this.tone(240, { to: 880, type: 'triangle', dur: 0.2, gain: 0.09 });
          this.tone(880, { to: 1320, type: 'sine', dur: 0.1, gain: 0.05, delay: 0.12 });
          break;
        case 'pickup':
          this.tone(420, { to: 700, type: 'triangle', dur: 0.1, gain: 0.07 });
          break;
        case 'throw':
          this.noise({ dur: 0.2, gain: 0.075, freq: 1400, to: 260, filter: 'bandpass', q: 0.6 });
          this.tone(220, { to: 420, type: 'triangle', dur: 0.12, gain: 0.04 });
          break;
        case 'clear':
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
            this.tone(f, { type: 'triangle', dur: 0.2, gain: 0.075, delay: i * 0.09 });
          });
          break;
        case 'victory':
          [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
            this.tone(f, { type: 'triangle', dur: 0.34, gain: 0.075, delay: i * 0.12 });
          });
          this.tone(261.6, { type: 'sine', dur: 0.8, gain: 0.05, delay: 0.15 });
          break;
        case 'gameover':
          [392, 329.6, 261.6, 196].forEach((f, i) => {
            this.tone(f, { type: 'sawtooth', dur: 0.24, gain: 0.06, delay: i * 0.16 });
          });
          break;
        case 'start':
          this.tone(523.25, { type: 'triangle', dur: 0.1, gain: 0.06 });
          this.tone(783.99, { type: 'triangle', dur: 0.16, gain: 0.06, delay: 0.08 });
          break;
        default:
          break;
      }
    }
  }
  const sfx = new Sfx();

  // ─── 游戏会话 ──────────────────────────────────────────
  const session = new E.GameSession();

  // ─── 运行时状态 ────────────────────────────────────────
  let isTouch = detectTouch();
  let isPortrait = false;
  let fakeLandscape = false;
  let fakeFromPortrait = false;
  let cssW = 1;
  let cssH = 1;
  let dpr = 1;
  let scale = 1;
  let viewW = 960;
  let viewH = 640;

  let camX = 0;
  let camY = 0;
  let camSnap = true;

  const input = { left: false, right: false, jump: false };
  // 所有触点的统一登记表（pointerId -> 按钮元素）。
  // 旧版每个按钮各自记一个 Set，而 resetInput 只清 input 不清 Set：
  // 手指按住时一旦失焦/切后台，浏览器可能把抬起事件吞掉，Set 里残留的
  // pointerId 会让 release 永远等不到「全部松开」，方向键就此卡死
  // （松鼠一直向前跑，怎么松手都停不下来）。
  const controlPointers = new Map();
  let visualT = 0;
  let levelIntroT = 0;
  let levelIntroName = '';
  let lastTime = performance.now();
  let accumulator = 0;

  const particles = [];
  const floatTexts = [];
  const clouds = [];
  const trees = [];

  let shakeT = 0;
  let shakeDur = 1;
  let shakeMag = 0;
  let damageTimer = 0;
  let toastTimer = 0;

  let best = loadNumber(KEY_BEST, 0);
  let bestAtStart = best;
  let progress = clamp(loadNumber(KEY_PROGRESS, 1), 1, session.maxLevel);
  let challengeScore = readChallengeScore();
  let currentScreen = null;
  let deferredInstall = null;
  let wakeLock = null;
  let shareCtx = null;
  let fatalShown = false;

  const hudCache = { score: -1, level: -1, acorns: -1, total: -1, keys: '', lives: 99, ready: null, holding: null };

  // ─── 第 1 关新手引导 ───────────────────────────────────
  const KEY_TUTORIAL = 'squirrelQuest.tutorial.v1';
  let tutorialDone = loadNumber(KEY_TUTORIAL, 0) === 1;
  const tutorial = {
    active: false,
    step: 0,
    steps: [],
    done: [],
    moved: 0,
    lastX: 0,
  };

  function tutorialSteps() {
    const total = session.acorns.length;
    return [
      { id: 'move', hint: isTouch ? '按住左下角的 ◀ ▶，向右走几步' : '按 ← → 或 A / D，左右走几步' },
      { id: 'jump', hint: isTouch ? '点右下角绿色的「跳」按钮跳起来' : '按空格 / ↑ / W 跳起来' },
      { id: 'acorn', hint: '碰到橡果就能收集，收齐全部橡果才能过关' },
      { id: 'stomp', hint: '从上方落到敌人头上，就能把它踩扁' },
      { id: 'goal', hint: `沿路向右，收齐这 ${total} 颗橡果就能过关` },
    ];
  }

  function startTutorialIfNeeded() {
    if (session.level !== 1 || tutorialDone) { hideTutorial(); return; }
    tutorial.active = true;
    tutorial.step = 0;
    tutorial.moved = 0;
    tutorial.lastX = session.player.x;
    tutorial.steps = tutorialSteps();
    tutorial.done = tutorial.steps.map(() => false);
    renderTutorial();
  }

  function hideTutorial() {
    tutorial.active = false;
    if (!ui.tutorial) return;
    ui.tutorial.classList.add('is-hidden');
    ui.tutorial.setAttribute('aria-hidden', 'true');
    tutorialHint(ui.leftBtn, false);
    tutorialHint(ui.rightBtn, false);
    tutorialHint(ui.jumpBtn, false);
  }

  function tutorialHint(el, on) {
    if (el) el.classList.toggle('is-hint', !!on);
  }

  function finishTutorial() {
    tutorialDone = true;
    saveNumber(KEY_TUTORIAL, 1);
    hideTutorial();
  }

  function tutorialMark(id) {
    if (!tutorial.active) return;
    const i = tutorial.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    tutorial.done[i] = true;
    while (tutorial.step < tutorial.steps.length && tutorial.done[tutorial.step]) {
      tutorial.step += 1;
    }
    if (tutorial.step >= tutorial.steps.length) { finishTutorial(); return; }
    renderTutorial();
  }

  function renderTutorial() {
    if (!tutorial.active || !ui.tutorial) return;
    const steps = tutorial.steps;
    const i = Math.min(tutorial.step, steps.length - 1);
    ui.tutorialText.textContent = steps[i].hint;
    ui.tutorialProgress.textContent = `${i + 1}/${steps.length}`;
    ui.tutorialDots.innerHTML = steps.map((s, k) => {
      const cls = tutorial.done[k] ? ' is-done' : k === tutorial.step ? ' is-active' : '';
      return `<span class="tutorial-dot${cls}"></span>`;
    }).join('');
    ui.tutorial.classList.remove('is-hidden');
    ui.tutorial.setAttribute('aria-hidden', 'false');
    const curId = steps[i].id;
    tutorialHint(ui.leftBtn, curId === 'move');
    tutorialHint(ui.rightBtn, curId === 'move');
    tutorialHint(ui.jumpBtn, curId === 'jump');
  }

  // 移动没有音效事件，按累计位移判断；其余步骤直接监听对应音效。
  function updateTutorial(d) {
    if (!tutorial.active || session.state !== E.GameState.PLAYING) return;
    const p = session.player;
    const cur = tutorial.steps[tutorial.step];
    if (cur && cur.id === 'move') {
      tutorial.moved += Math.abs(p.x - tutorial.lastX);
      if (tutorial.moved >= E.TILE * 2) tutorialMark('move');
    }
    tutorial.lastX = p.x;
  }

  // ─── 初始化 ────────────────────────────────────────────
  function init() {
    parseParams();
    makeDecor();
    bindUI();
    bindInput();
    setupResize();
    setMuted(sfx.muted, false);
    applyLayout();
    resize();
    updateMenuInfo();
    syncScreens();
    syncHUD(true);
    requestAnimationFrame(frame);
    registerSW();
    bindLifecycle();
    exposeDebugApi();
  }

  function detectTouch() {
    try {
      if (new URLSearchParams(location.search).get('touch') === '1') return true;
    } catch (_) { /* ignore */ }
    const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const noHover = !!(window.matchMedia && matchMedia('(hover: none)').matches);
    const points = navigator.maxTouchPoints || 0;
    return coarse || (noHover && points > 0) || (points > 0 && Math.min(innerWidth, innerHeight) < 900);
  }

  function parseParams() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (_) { params = null; }
    if (!params) return;
    if (params.get('touch') === '1') isTouch = true;
    if (params.get('play') === '1') {
      const lv = parseInt(params.get('level'), 10);
      pendingAutoStart = Number.isFinite(lv) ? clamp(lv, 1, session.maxLevel) : 1;
    }
  }
  let pendingAutoStart = 0;

  function readChallengeScore() {
    try {
      const raw = new URLSearchParams(location.search).get('c');
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0 && n < 100000000) return n;
    } catch (_) { /* ignore */ }
    return null;
  }

  // ─── 装饰 ──────────────────────────────────────────────
  function makeDecor() {
    clouds.length = 0;
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: rand(-200, 1200),
        y: rand(0.06, 0.38),
        s: rand(0.65, 1.35),
        speed: rand(0.12, 0.32),
        puffs: Array.from({ length: 4 }, () => ({
          dx: rand(-26, 26),
          dy: rand(-12, 8),
          r: rand(16, 30),
        })),
      });
    }

    trees.length = 0;
    const count = 26;
    for (let i = 0; i < count; i++) {
      trees.push({
        x: (i / count) * 2400 + rand(-40, 40),
        h: rand(78, 158),
        sway: rand(0, Math.PI * 2),
        tone: rand(0, 1),
      });
    }
  }

  // ─── 视口 / 布局 ───────────────────────────────────────
  function applyLayout() {
    // 假横屏期间设备从竖屏真转横（系统没锁方向）：退出旋转容器，交给系统布局。
    // 注意判断「进入假横屏时是竖屏」，否则桌面浏览器（恒为横屏）一开就被自动退出。
    if (fakeLandscape && fakeFromPortrait && innerWidth > innerHeight) {
      fakeLandscape = false;
      fakeFromPortrait = false;
      document.body.classList.remove('fake-landscape');
      updateLandscapeLabel();
    }
    isPortrait = !fakeLandscape && innerHeight > innerWidth * 1.04;
    document.body.classList.toggle('is-touch', isTouch);
    document.body.classList.toggle('is-portrait', isPortrait);
  }

  function setupResize() {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyLayout();
        resize();
      });
    };
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
    if (window.ResizeObserver) {
      try { new ResizeObserver(schedule).observe(canvas); } catch (_) { /* ignore */ }
    }
    if (window.visualViewport) {
      try { visualViewport.addEventListener('resize', schedule, { passive: true }); } catch (_) { /* ignore */ }
    }
  }

  function resize() {
    // 假横屏：容器被旋转 90°，逻辑宽高互换。
    if (fakeLandscape) {
      app.style.width = `${innerHeight}px`;
      app.style.height = `${innerWidth}px`;
    } else {
      app.style.width = '';
      app.style.height = '';
    }
    // 画布尺寸必须用 offsetWidth/offsetHeight（布局尺寸，不受 transform 影响），
    // 而不是 getBoundingClientRect：假横屏旋转 90° 后 bounding rect 返回的是
    // 旋转后的视觉宽高，拿它设画布位图会让画面横竖颠倒、整体拉伸变形。
    const w = Math.max(1, canvas.offsetWidth || canvas.clientWidth || 1);
    const h = Math.max(1, canvas.offsetHeight || canvas.clientHeight || 1);
    cssW = w;
    cssH = h;

    let d = Math.min(window.devicePixelRatio || 1, 2);
    const maxPixels = 2.8e6;
    if (w * h * d * d > maxPixels) d = Math.sqrt(maxPixels / (w * h));
    dpr = Math.max(1, d);

    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;

    if (w >= h) {
      // 横屏：保证一屏约 11~16 格高，手机格子约 35px
      viewH = clamp(h * 0.95, 400, 640);
      scale = h / viewH;
      viewW = w / scale;
    } else {
      // 竖屏：格子保持约 28~33px，同时避免视野窄到只能看到几格
      scale = clamp(w / 500, 0.66, 0.82);
      if (h / scale > 980) scale = h / 980;
      viewW = w / scale;
      viewH = h / scale;
    }

    camSnap = true;
    if (session.state === E.GameState.MENU) {
      // 菜单背景直接对准出生点附近
      const target = computeCamTarget();
      camX = target.x;
      camY = target.y;
    }
  }

  function computeCamTarget() {
    const tm = session.tilemap;
    const p = session.player;
    const tx = p.x + p.w / 2 - viewW / 2;
    const ty = p.y + p.h / 2 - viewH / 2;
    let x;
    let y;
    if (tm.pixelW <= viewW) x = (tm.pixelW - viewW) / 2;
    else x = clamp(tx, 0, tm.pixelW - viewW);
    if (tm.pixelH <= viewH) y = tm.pixelH - viewH;
    else y = clamp(ty, 0, tm.pixelH - viewH);
    return { x, y };
  }

  // ─── 主循环 ────────────────────────────────────────────
  function frame(now) {
    const dtMs = Math.min(Math.max(now - lastTime, 0), 80);
    lastTime = now;
    const d = clamp(dtMs / (1000 / 60), 0, 2.5);

    if (session.state === E.GameState.PLAYING) {
      accumulator += Math.min(dtMs, 50);
      let steps = 0;
      while (accumulator >= 1000 / 60 && steps < 5) {
        session.update(input);
        accumulator -= 1000 / 60;
        steps++;
        if (session.state !== E.GameState.PLAYING) { accumulator = 0; break; }
      }
      if (session.score > best) {
        best = session.score;
        saveNumber(KEY_BEST, best);
      }
    } else {
      accumulator = 0;
    }

    drainEvents();
    updatePresentation(d);
    syncHUD();
    render();
    requestAnimationFrame(frame);
  }

  // 测试/调试用：手动推进若干毫秒，不依赖 requestAnimationFrame。
  function pump(dtMs) {
    const ms = clamp(dtMs == null ? 1000 / 60 : dtMs, 0, 3000);
    const steps = Math.floor(ms / (1000 / 60));
    for (let i = 0; i < steps; i++) {
      if (session.state !== E.GameState.PLAYING) break;
      session.update(input);
      if (session.score > best) {
        best = session.score;
        saveNumber(KEY_BEST, best);
      }
      if (session.state !== E.GameState.PLAYING) break;
    }
    drainEvents();
    updatePresentation(Math.max(1, steps));
    syncHUD();
    render();
  }

  function drainEvents() {
    const events = session.takeEvents();
    for (const ev of events) {
      switch (ev.type) {
        case 'sound':
          sfx.play(ev.name);
          if (ev.name === 'hurt' || ev.name === 'gameover') flashDamage();
          haptic(ev.name);
          if (ev.name === 'jump') tutorialMark('jump');
          else if (ev.name === 'acorn') tutorialMark('acorn');
          else if (ev.name === 'stomp') tutorialMark('stomp');
          break;
        case 'burst':
          spawnBurst(ev.x, ev.y, ev.color, ev.count);
          break;
        case 'text':
          spawnFloatText(ev.x, ev.y, ev.text, ev.color);
          break;
        case 'shake':
          addShake(ev.amount);
          break;
        case 'state':
          onState(ev.state);
          break;
        case 'level_start':
          resetLevelPresentation();
          levelIntroName = session.levelName;
          levelIntroT = 160;
          startTutorialIfNeeded();
          break;
        case 'level_clear':
          tutorialMark('goal');
          spawnConfetti();
          break;
        default:
          break;
      }
    }
  }

  function onState(state) {
    if (state !== E.GameState.PLAYING) resetInput();
    if (state === E.GameState.PLAYING) requestWakeLock();
    else releaseWakeLock();
    if (state === E.GameState.LEVEL_CLEAR) unlockLevel(session.level + 1);
    else if (state === E.GameState.VICTORY) unlockLevel(session.maxLevel);
    if (state === E.GameState.MENU) {
      updateMenuInfo();
    }
    syncScreens();
  }

  function updatePresentation(d) {
    visualT += d;
    if (levelIntroT > 0) levelIntroT = Math.max(0, levelIntroT - d);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.update(d);
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floatTexts.length - 1; i >= 0; i--) {
      const t = floatTexts[i];
      t.update(d);
      if (t.life <= 0) floatTexts.splice(i, 1);
    }
    for (const c of clouds) {
      c.x += c.speed * d;
      if (c.x > viewW + 200) {
        c.x = -220 - rand(0, 100);
        c.y = rand(0.06, 0.38);
        c.s = rand(0.65, 1.35);
      }
    }
    if (shakeT > 0) shakeT = Math.max(0, shakeT - d);

    updateTutorial(d);
    updateCamera(d);
  }

  function updateCamera(d) {
    const target = computeCamTarget();
    if (camSnap) {
      camX = target.x;
      camY = target.y;
      camSnap = false;
    } else {
      const k = 1 - Math.pow(0.87, d);
      camX += (target.x - camX) * k;
      camY += (target.y - camY) * k;
      // 防止插值越界
      const tm = session.tilemap;
      if (tm.pixelW <= viewW) camX = (tm.pixelW - viewW) / 2;
      else camX = clamp(camX, 0, tm.pixelW - viewW);
      if (tm.pixelH <= viewH) camY = tm.pixelH - viewH;
      else camY = clamp(camY, 0, tm.pixelH - viewH);
    }
  }

  // ─── 渲染 ──────────────────────────────────────────────
  function render() {
    if (cssW < 2 || cssH < 2) return;
    const base = dpr * scale;
    ctx.setTransform(base, 0, 0, base, 0, 0);

    drawSky();
    drawClouds();
    drawHills();
    drawTrees();

    let sx = 0;
    let sy = 0;
    if (shakeT > 0) {
      const k = (shakeT / Math.max(1, shakeDur)) * shakeMag;
      sx = (Math.random() * 2 - 1) * k;
      sy = (Math.random() * 2 - 1) * k;
    }

    ctx.save();
    ctx.translate(-camX + sx, -camY + sy);
    drawWind();
    drawTiles();
    drawCheckpoints();
    drawSprings();
    drawAcorns();
    drawGoldenAcorns();
    drawKeys();
    drawEnemies();
    drawSaws();
    drawHeldItem();
    drawPlayer();
    drawParticles();
    drawFloatTexts();
    ctx.restore();

    // 关卡氛围：夜景压暗四周、黄金树冠加一层暖光。
    const th = levelTheme();
    if (th.night) {
      const v = ctx.createRadialGradient(
        viewW * 0.5, viewH * 0.45, Math.min(viewW, viewH) * 0.2,
        viewW * 0.5, viewH * 0.45, Math.max(viewW, viewH) * 0.8);
      v.addColorStop(0, 'rgba(4,10,24,0)');
      v.addColorStop(1, 'rgba(4,10,24,0.55)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, viewW, viewH);
    } else if (th.golden) {
      const gl = ctx.createLinearGradient(0, 0, 0, viewH * 0.7);
      gl.addColorStop(0, 'rgba(255,214,120,0.16)');
      gl.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    if (levelIntroT > 0 && !tutorial.active &&
        (session.state === E.GameState.PLAYING || session.state === E.GameState.PAUSED)) {
      drawLevelIntro();
    }
  }

  function drawLevelIntro() {
    const label = `第 ${session.level} 关 · ${levelIntroName}`;
    const alpha = Math.min(1, levelIntroT / 30);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 22px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 40;
    const h = 44;
    const x = (viewW - w) / 2;
    // HUD 叠在画面顶部，提示条需要让出位置。
    const y = 76;
    ctx.fillStyle = 'rgba(12, 28, 48, 0.64)';
    roundRect(ctx, x, y, w, h, 22);
    ctx.fill();
    ctx.fillStyle = '#fff5cf';
    ctx.fillText(label, viewW / 2, y + h / 2 + 1);
    ctx.restore();
  }

  // 每个世界一套天空/远山/树木配色；80 关从中按关取用，避免看起来像同一张图。
  const LEVEL_THEMES = {
    1: { sky: ['#4a86d6', '#84b9ea', '#c3e2f7', '#eaf6fc'],
         hills: ['rgba(126,183,166,0.55)', 'rgba(86,152,112,0.62)'] },
    2: { sky: ['#3f8fe0', '#8fc9f2', '#ffe9c9', '#fff6e6'],
         hills: ['rgba(133,199,170,0.55)', 'rgba(88,168,120,0.62)'],
         cloud: 'rgba(255,250,238,0.95)' },
    3: { sky: ['#1f5f4a', '#3d8a63', '#79b17a', '#cfe0a8'],
         hills: ['rgba(44,104,76,0.62)', 'rgba(28,76,54,0.72)'],
         cloud: 'rgba(226,244,214,0.55)',
         trees: [['#1d5334', '#2b7045', '#3f8b57'],
                 ['#194a2e', '#25643d', '#377c4d'],
                 ['#215a38', '#2f7549', '#468f5c']] },
    4: { sky: ['#7a4f8f', '#c77a86', '#f2a86b', '#ffd9a8'],
         hills: ['rgba(150,99,92,0.6)', 'rgba(112,72,74,0.72)'],
         cloud: 'rgba(255,224,200,0.7)',
         trees: [['#6d4030', '#8a5438', '#a86d42'],
                 ['#5c362b', '#774634', '#945c3c'],
                 ['#744634', '#92573c', '#b07248']] },
    5: { sky: ['#6f8fe8', '#a9c8f5', '#f4d9ea', '#fff3f8'],
         hills: ['rgba(157,171,214,0.55)', 'rgba(120,139,190,0.62)'],
         cloud: 'rgba(255,255,255,0.95)' },
    6: { sky: ['#2d5fa8', '#5f9bd6', '#b7d8f0', '#eef8ff'],
         hills: ['rgba(140,176,206,0.5)', 'rgba(104,142,178,0.58)'],
         cloud: 'rgba(255,255,255,0.98)' },
    7: { sky: ['#4a2a63', '#8d4a75', '#d9776f', '#f6b98a'],
         hills: ['rgba(96,70,104,0.65)', 'rgba(66,46,78,0.75)'],
         cloud: 'rgba(230,198,214,0.5)',
         trees: [['#3e2d46', '#553a58', '#6d4a66'],
                 ['#352738', '#4a324a', '#614057'],
                 ['#46304b', '#5e3f57', '#785067']] },
    8: { sky: ['#081428', '#122a4d', '#264d73', '#40688c'],
         night: true, cloud: 'rgba(190,210,235,0.18)',
         hills: ['rgba(30,58,86,0.72)', 'rgba(18,38,60,0.85)'],
         trees: [['#0f2a33', '#173a42', '#20505a'],
                 ['#0c232c', '#133039', '#1c454e'],
                 ['#122c35', '#1a3d47', '#255660']] },
    9: { sky: ['#8a5a1e', '#d9972f', '#f7cc63', '#fff1b8'],
         golden: true,
         hills: ['rgba(168,124,52,0.6)', 'rgba(128,88,36,0.72)'],
         cloud: 'rgba(255,244,206,0.8)',
         trees: [['#6a5a1e', '#8a732a', '#b29538'],
                 ['#5a4c1a', '#786326', '#a08734'],
                 ['#726120', '#937c2e', '#bd9f3e']] },
    10: { sky: ['#0f3b33', '#1f5f4b', '#3c8a64', '#b9d99a'],
          hills: ['rgba(38,104,80,0.66)', 'rgba(22,72,56,0.78)'],
          cloud: 'rgba(210,240,220,0.32)',
          trees: [['#0f3d2c', '#1c5940', '#2d7a57'],
                  ['#0c3325', '#174a35', '#26694a'],
                  ['#124534', '#206349', '#348b62']] },
    11: { sky: ['#7a4a2a', '#b87a45', '#e0a46a', '#f8dba4'],
          hills: ['rgba(150,110,70,0.6)', 'rgba(110,78,50,0.72)'],
          cloud: 'rgba(255,236,206,0.62)',
          trees: [['#7a4a1e', '#a86a2a', '#c98c38'],
                  ['#6a3f1a', '#965c24', '#b97c32'],
                  ['#84521f', '#b1742d', '#d1953e']] },
    // 12 暮色洞窟：暗蓝紫岩洞
    12: { sky: ['#1c1f3a', '#2c3157', '#4a4a7a', '#6a5f8f'],
          hills: ['rgba(70,72,110,0.6)', 'rgba(48,50,84,0.72)'],
          cloud: 'rgba(150,150,200,0.25)',
          trees: [['#23263f', '#31355a', '#454a75'],
                  ['#1d2036', '#2a2e4e', '#3d4168'],
                  ['#262a45', '#353a61', '#4d5280']] },
    // 13 云海之巅：高空亮白蓝
    13: { sky: ['#5f9fd6', '#8fc2ea', '#cfe6f7', '#ffffff'],
          hills: ['rgba(190,212,235,0.55)', 'rgba(150,180,215,0.62)'],
          cloud: 'rgba(255,255,255,0.98)' },
    // 14 星夜王庭：紫金夜空
    14: { sky: ['#12082e', '#2c1450', '#5a2a72', '#b87a4a'],
          night: true,
          hills: ['rgba(90,60,120,0.6)', 'rgba(60,38,88,0.75)'],
          cloud: 'rgba(200,160,220,0.2)',
          trees: [['#2a1a45', '#3c2658', '#54386e'],
                  ['#221538', '#33204c', '#4a3062'],
                  ['#2e1e4e', '#412a66', '#5c3d80']] },
  };

  // 80 关分成 8 个世界，每关从世界主色调里选一套，既有区分又保持世界感。
  const LEVEL_THEME_BY_LEVEL = [
    1, 1, 2, 1, 11, 1, 2, 1, 11, 2,      // 1-10  林间
    2, 2, 5, 6, 2, 5, 6, 2, 5, 6,        // 11-20 弹簧高塔
    3, 3, 10, 3, 3, 10, 3, 3, 10, 3,     // 21-30 藤蔓迷径
    4, 4, 4, 7, 4, 8, 4, 8, 4, 7,        // 31-40 风之峡谷
    9, 9, 11, 9, 9, 9, 11, 8, 9, 9,      // 41-50 黄金终局
    12, 12, 8, 12, 12, 8, 12, 12, 8, 12, // 51-60 暮色洞窟
    13, 13, 5, 13, 6, 13, 13, 5, 6, 13,  // 61-70 云海之巅
    14, 8, 14, 14, 7, 14, 8, 14, 14, 9,  // 71-80 星夜王庭
  ];
  const DEFAULT_HILLS = ['rgba(126,183,166,0.55)', 'rgba(86,152,112,0.62)'];
  const DEFAULT_TREES = [['#3d8c51', '#4fa563', '#66bc77'],
                         ['#2f7a49', '#3f9459', '#5bb06d'],
                         ['#4b9057', '#5da969', '#79c383']];
  function levelTheme() {
    const id = LEVEL_THEME_BY_LEVEL[session.level - 1];
    return LEVEL_THEMES[id] || LEVEL_THEMES[1];
  }

  function drawSky() {
    const th = levelTheme();
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.42, th.sky[1]);
    g.addColorStop(0.76, th.sky[2]);
    g.addColorStop(1, th.sky[3]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);

    const orbX = viewW * 0.82;
    const orbY = viewH * 0.17;
    if (th.night) {
      // 星点位置固定，不随镜头闪烁成噪点。
      ctx.fillStyle = 'rgba(230,240,255,0.85)';
      for (let i = 0; i < 46; i++) {
        const sx = mod(i * 197.3, viewW + 40) - 20;
        const sy = mod(i * 113.7, viewH * 0.62);
        const r = i % 5 === 0 ? 1.7 : 1;
        ctx.globalAlpha = 0.35 + (i % 7) * 0.08;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const glow = ctx.createRadialGradient(orbX, orbY, 1, orbX, orbY, Math.min(viewW, viewH) * 0.26);
      glow.addColorStop(0, 'rgba(220,235,255,0.55)');
      glow.addColorStop(0.3, 'rgba(190,215,255,0.16)');
      glow.addColorStop(1, 'rgba(170,200,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(orbX, orbY, Math.min(viewW, viewH) * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eef4ff';
      ctx.beginPath();
      ctx.arc(orbX, orbY, Math.min(viewW, viewH) * 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = th.sky[1];
      ctx.beginPath();
      ctx.arc(orbX + 7, orbY - 5, Math.min(viewW, viewH) * 0.04, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const sunR = Math.min(viewW, viewH) * 0.3;
    const sg = ctx.createRadialGradient(orbX, orbY, 1, orbX, orbY, sunR);
    sg.addColorStop(0, 'rgba(255,252,220,0.92)');
    sg.addColorStop(0.16, 'rgba(255,245,185,0.5)');
    sg.addColorStop(0.5, 'rgba(255,240,170,0.12)');
    sg.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(orbX, orbY, sunR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,252,228,0.9)';
    ctx.beginPath();
    ctx.arc(orbX, orbY, Math.min(viewW, viewH) * 0.052, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHills() {
    const hills = levelTheme().hills || DEFAULT_HILLS;
    hillLayer(viewH * 0.73, viewH * 0.075, hills[0], 0.045, 0);
    hillLayer(viewH * 0.81, viewH * 0.055, hills[1], 0.09, 2.2);
  }

  function hillLayer(yBase, amp, color, parallax, phase) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, viewH);
    const step = Math.max(10, viewW / 90);
    for (let x = 0; x <= viewW + step; x += step) {
      const wx = x + camX * parallax + phase * 300;
      const y = yBase
        - Math.sin(wx * 0.0022) * amp
        - Math.sin(wx * 0.00075 + 1.7) * amp * 0.6;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(viewW + step, viewH);
    ctx.closePath();
    ctx.fill();
  }

  function drawClouds() {
    ctx.save();
    ctx.fillStyle = levelTheme().cloud || 'rgba(255,255,255,0.88)';
    for (const c of clouds) {
      const x = c.x;
      const y = c.y * viewH;
      const s = c.s;
      if (x < -160 || x > viewW + 160) continue;
      ctx.save();
      ctx.translate(x, y);
      for (const puff of c.puffs) {
        ctx.beginPath();
        ctx.arc(puff.dx * s, puff.dy * s, puff.r * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTrees() {
    // 背景树林贴住画面下沿：无论镜头怎么抬升，都不会出现“树浮在空中”。
    const groundY = viewH - 6;
    const offset = camX * 0.3;
    for (const tr of trees) {
      let x = mod(tr.x - offset, 2400);
      if (x > viewW + 100) continue;
      if (x < -100) continue;
      const h = tr.h;
      const baseY = groundY;
      if (baseY - h > viewH || baseY < -40) continue;

      const sway = Math.sin(visualT * 0.012 + tr.sway) * 2;
      // 树干
      ctx.fillStyle = '#8c5c33';
      ctx.fillRect(x - 4, baseY - h * 0.62, 8, h * 0.62);
      // 树冠
      const palette = levelTheme().trees || DEFAULT_TREES;
      const greens = tr.tone < 0.4
        ? palette[0]
        : tr.tone < 0.75
          ? palette[1]
          : palette[2];
      const cy = baseY - h * 0.66;
      const r = h * 0.27;
      ctx.fillStyle = greens[0];
      ctx.beginPath();
      ctx.arc(x + sway, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = greens[1];
      ctx.beginPath();
      ctx.arc(x - r * 0.62 + sway, cy + r * 0.32, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + r * 0.66 + sway, cy + r * 0.3, r * 0.76, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = greens[2];
      ctx.beginPath();
      ctx.arc(x - r * 0.2 + sway, cy - r * 0.32, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTiles() {
    const tm = session.tilemap;
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const c1 = Math.min(tm.w, Math.ceil((camX + viewW) / TILE) + 1);
    const r0 = Math.max(0, Math.floor(camY / TILE) - 1);
    const r1 = Math.min(tm.h, Math.ceil((camY + viewH) / TILE) + 1);
    for (let ty = r0; ty < r1; ty++) {
      const row = tm.rows[ty];
      for (let tx = c0; tx < c1; tx++) {
        const ch = row[tx];
        if (ch === '#' || ch === '@' || ch === '=') drawTile(ch, tx * TILE, ty * TILE, tx, ty);
        else if (ch === '^') drawSpikes(tx * TILE, ty * TILE);
        else if (ch === '~') drawCrumble(tx * TILE, ty * TILE, tx, ty);
        else if (ch === 'L') drawGate(tx * TILE, ty * TILE, tx, ty);
      }
    }
  }

  function drawTile(ch, x, y, tx, ty) {
    const n = hash2(tx, ty);
    if (ch === '#') {
      ctx.fillStyle = n > 0.5 ? '#8b5a2b' : '#855425';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255, 219, 166, 0.14)';
      ctx.fillRect(x, y, TILE, 3);
      ctx.fillStyle = 'rgba(52, 28, 8, 0.18)';
      ctx.fillRect(x, y + TILE - 3, TILE, 3);
      ctx.strokeStyle = 'rgba(64, 35, 10, 0.38)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + 20);
      ctx.lineTo(x + TILE, y + 20);
      ctx.moveTo(x + 20, y);
      ctx.lineTo(x + 20, y + 20);
      ctx.moveTo(x + (tx % 2 === 0 ? 10 : 30), y + 20);
      ctx.lineTo(x + (tx % 2 === 0 ? 10 : 30), y + TILE);
      ctx.stroke();
      drawTileSpecks(x, y, tx, ty, 'rgba(255,214,160,0.18)');
    } else if (ch === '@') {
      ctx.fillStyle = n > 0.5 ? '#a5713f' : '#9b6837';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255, 226, 180, 0.13)';
      ctx.fillRect(x, y, TILE, 3);
      ctx.strokeStyle = 'rgba(78, 44, 16, 0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
      drawTileSpecks(x, y, tx, ty, 'rgba(60,32,8,0.22)');
    } else if (ch === '=') {
      // 泥土
      ctx.fillStyle = n > 0.5 ? '#9a6636' : '#925e2f';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(56, 30, 8, 0.2)';
      ctx.fillRect(x, y + 22, TILE, TILE - 22);
      drawTileSpecks(x, y + 12, tx, ty, 'rgba(224,178,128,0.22)');
      // 草皮
      ctx.fillStyle = '#4faa45';
      ctx.fillRect(x, y, TILE, 10);
      ctx.fillStyle = '#6fce5c';
      ctx.fillRect(x, y, TILE, 4);
      // 草叶
      ctx.fillStyle = '#63c653';
      const blades = 3 + Math.floor(n * 2);
      for (let i = 0; i < blades; i++) {
        const bx = x + 4 + i * ((TILE - 8) / Math.max(1, blades - 1));
        const bh = 5 + hash2(tx * 7 + i, ty * 13) * 7;
        ctx.beginPath();
        ctx.moveTo(bx - 4, y + 2);
        ctx.lineTo(bx, y - bh);
        ctx.lineTo(bx + 4, y + 2);
        ctx.closePath();
        ctx.fill();
      }
      // 底部收边
      ctx.fillStyle = 'rgba(40, 22, 6, 0.18)';
      ctx.fillRect(x, y + TILE - 2, TILE, 2);
    }
  }

  function drawTileSpecks(x, y, tx, ty, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      const sx = x + 5 + hash2(tx * 31 + i, ty * 17) * (TILE - 10);
      const sy = y + 6 + hash2(tx * 11, ty * 29 + i) * (TILE - 12);
      const r = 0.8 + hash2(tx + i, ty + i * 3) * 1.4;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSpikes(x, y) {
    const baseY = y + TILE - 4;
    // 底座
    ctx.fillStyle = '#4a2c2a';
    roundRect(ctx, x + 2, baseY - 6, TILE - 4, 8, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 120, 100, 0.35)';
    ctx.fillRect(x + 5, baseY - 5, TILE - 10, 2);

    // 三根尖刺
    for (let i = 0; i < 3; i++) {
      const bx = x + 8 + i * 11;
      const tipY = y + 13 + (i % 2) * 2;
      const grad = ctx.createLinearGradient(bx, tipY, bx, baseY - 4);
      grad.addColorStop(0, '#ffe9d6');
      grad.addColorStop(0.45, '#c9d2dc');
      grad.addColorStop(1, '#7c8794');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(bx - 6, baseY - 4);
      ctx.lineTo(bx, tipY);
      ctx.lineTo(bx + 6, baseY - 4);
      ctx.closePath();
      ctx.fill();
    }

    // 尖端警示光
    ctx.fillStyle = 'rgba(255, 90, 70, 0.55)';
    ctx.beginPath();
    ctx.arc(x + 13, y + 17, 2, 0, Math.PI * 2);
    ctx.arc(x + 26, y + 19, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCrumble(x, y, tx, ty) {
    const tm = session.tilemap;
    const state = tm.crumbStateAt(tx, ty);
    if (state === 'gone') {
      // 消失期间留下虚线轮廓，提示这里会恢复。
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 220, 160, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.restore();
      return;
    }
    const wobble = state === 'shaking'
      ? Math.sin(visualT * 1.4 + tx * 2) * 2.4
      : 0;
    const dx = x + wobble;
    ctx.save();
    // 石台主体
    const grad = ctx.createLinearGradient(dx, y, dx, y + TILE);
    grad.addColorStop(0, '#b59a74');
    grad.addColorStop(0.35, '#97805f');
    grad.addColorStop(1, '#6f5a41');
    ctx.fillStyle = grad;
    roundRect(ctx, dx + 1, y + 2, TILE - 2, TILE - 6, 4);
    ctx.fill();
    // 苔藓边
    ctx.fillStyle = state === 'shaking' ? '#d9a94f' : '#7fb35a';
    ctx.fillRect(dx + 3, y + 2, TILE - 6, 5);
    // 裂纹
    ctx.strokeStyle = 'rgba(50, 34, 20, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(dx + 8, y + 8);
    ctx.lineTo(dx + 14, y + 18);
    ctx.lineTo(dx + 10, y + 26);
    ctx.moveTo(dx + 24, y + 7);
    ctx.lineTo(dx + 20, y + 16);
    ctx.lineTo(dx + 28, y + 24);
    ctx.stroke();
    // 晃动时的高亮警示
    if (state === 'shaking') {
      ctx.strokeStyle = `rgba(255, 190, 80, ${0.35 + Math.sin(visualT * 0.8) * 0.25})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(dx + 1, y + 2, TILE - 2, TILE - 6);
    }
    ctx.restore();
  }

  function drawGate(x, y, tx, ty) {
    if (session.tilemap.gateOpen) {
      // 打开的门只留两侧门框
      ctx.fillStyle = 'rgba(64, 44, 26, 0.55)';
      ctx.fillRect(x + 1, y, 4, TILE);
      ctx.fillRect(x + TILE - 5, y, 4, TILE);
      ctx.fillStyle = 'rgba(120, 230, 160, 0.12)';
      ctx.fillRect(x + 5, y, TILE - 10, TILE);
      return;
    }
    // 木门
    const grad = ctx.createLinearGradient(x, y, x + TILE, y);
    grad.addColorStop(0, '#7a4f2b');
    grad.addColorStop(0.5, '#9a6a3c');
    grad.addColorStop(1, '#6c4527');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 2, y, TILE - 4, TILE);
    ctx.strokeStyle = 'rgba(52, 32, 16, 0.55)';
    ctx.lineWidth = 1.4;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 2 + i * (TILE - 4) / 3, y);
      ctx.lineTo(x + 2 + i * (TILE - 4) / 3, y + TILE);
      ctx.stroke();
    }
    // 藤蔓
    ctx.strokeStyle = '#5f9a4a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 5, y);
    ctx.bezierCurveTo(x + 18, y + 10, x + 8, y + 24, x + 20, y + TILE);
    ctx.stroke();
    // 金属锁
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.arc(x + TILE / 2, y + TILE / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a5418';
    ctx.fillRect(x + TILE / 2 - 1.5, y + TILE / 2, 3, 6);
  }

  function drawWind() {
    if (!session.tilemap.winds || !session.tilemap.winds.length) return;
    for (const w of session.tilemap.winds) {
      const x = w.tx * TILE;
      const y = w.ty * TILE;
      if (x + TILE < camX - 40 || x > camX + viewW + 40) continue;
      if (y + TILE < camY - 40 || y > camY + viewH + 40) continue;
      const g = ctx.createLinearGradient(0, y, 0, y + TILE);
      g.addColorStop(0, 'rgba(150, 235, 255, 0.16)');
      g.addColorStop(0.5, 'rgba(120, 210, 255, 0.09)');
      g.addColorStop(1, 'rgba(150, 235, 255, 0.16)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, TILE, TILE);
      // 上升的气流线
      for (let i = 0; i < 2; i++) {
        const phase = (visualT * 2.2 + w.ty * 37 + w.tx * 53 + i * 20) % TILE;
        const ly = y + TILE - phase;
        ctx.strokeStyle = `rgba(220, 250, 255, ${0.18 + (phase / TILE) * 0.22})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 9 + i * 15, ly + 6);
        ctx.lineTo(x + 9 + i * 15, ly);
        ctx.moveTo(x + 6 + i * 15, ly + 3);
        ctx.lineTo(x + 9 + i * 15, ly);
        ctx.lineTo(x + 12 + i * 15, ly + 3);
        ctx.stroke();
      }
    }
  }

  function drawKeys() {
    if (!session.keys) return;
    for (const k of session.keys) {
      if (k.collected) continue;
      if (k.x + TILE < camX - 40 || k.x > camX + viewW + 40) continue;
      if (k.y + TILE < camY - 40 || k.y > camY + viewH + 40) continue;
      const cx = k.x + TILE / 2;
      const cy = k.y + TILE / 2 + Math.sin(visualT * 0.07 + k.x) * 3;
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
      glow.addColorStop(0, 'rgba(255, 226, 120, 0.5)');
      glow.addColorStop(1, 'rgba(255, 226, 120, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(visualT * 0.04) * 0.35);
      ctx.strokeStyle = '#ffe9a0';
      ctx.fillStyle = '#ffd24a';
      ctx.lineWidth = 3;
      // 钥匙环
      ctx.beginPath();
      ctx.arc(-7, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
      // 钥匙杆与齿
      ctx.beginPath();
      ctx.moveTo(-1, 0);
      ctx.lineTo(12, 0);
      ctx.lineTo(12, 5);
      ctx.moveTo(7, 0);
      ctx.lineTo(7, 4);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSaws() {
    for (const s of (session.saws || [])) {
      const x = s.curX;
      const y = s.curY;
      if (x + 80 < camX - 40 || x - 80 > camX + viewW + 40) continue;
      if (y + 80 < camY - 40 || y - 80 > camY + viewH + 40) continue;
      // 巡逻轨道
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 210, 150, 0.18)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      if (s.axis === 'x') {
        ctx.moveTo(s.baseX + TILE / 2 - s.range, s.baseY + TILE / 2);
        ctx.lineTo(s.baseX + TILE / 2 + s.range, s.baseY + TILE / 2);
      } else {
        ctx.moveTo(s.baseX + TILE / 2, s.baseY + TILE / 2 - s.range);
        ctx.lineTo(s.baseX + TILE / 2, s.baseY + TILE / 2 + s.range);
      }
      ctx.stroke();
      ctx.restore();

      const cx = x + TILE / 2;
      const cy = y + TILE / 2;
      const angle = visualT * 0.22;
      // 危险红光
      const glow = ctx.createRadialGradient(cx, cy, 3, cx, cy, 26);
      glow.addColorStop(0, 'rgba(255, 90, 70, 0.28)');
      glow.addColorStop(1, 'rgba(255, 90, 70, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      // 锯齿
      ctx.fillStyle = '#c8d3df';
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * Math.PI * 2;
        const a1 = ((i + 0.5) / 12) * Math.PI * 2;
        const r0 = 13;
        const r1 = 19;
        ctx.lineTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
        ctx.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
      }
      ctx.closePath();
      ctx.fill();
      // 盘面
      const blade = ctx.createRadialGradient(-4, -4, 2, 0, 0, 14);
      blade.addColorStop(0, '#f2f6fa');
      blade.addColorStop(0.6, '#9aa8b6');
      blade.addColorStop(1, '#5d6b79');
      ctx.fillStyle = blade;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3c4650';
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCheckpoints() {
    if (!session.checkpoints) return;
    for (const c of session.checkpoints) {
      if (c.x + TILE < camX - 40 || c.x > camX + viewW + 40) continue;
      if (c.y + TILE < camY - 40 || c.y > camY + viewH + 40) continue;
      const x = c.x;
      const y = c.y;
      const glow = c.active ? 'rgba(70, 235, 150, 0.3)' : 'rgba(255, 255, 255, 0.12)';

      const rg = ctx.createRadialGradient(x + 20, y + 20, 2, x + 20, y + 20, 26);
      rg.addColorStop(0, glow);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x + 20, y + 20, 26, 0, Math.PI * 2);
      ctx.fill();

      // 底座
      ctx.fillStyle = c.active ? '#2a7a52' : '#5d6670';
      roundRect(ctx, x + 8, y + TILE - 8, 24, 7, 3);
      ctx.fill();
      // 旗杆
      ctx.strokeStyle = c.active ? '#2f8f61' : '#77818c';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 13, y + TILE - 6);
      ctx.lineTo(x + 13, y + 6);
      ctx.stroke();
      // 旗面
      ctx.fillStyle = c.active ? '#35d38b' : 'rgba(240, 245, 250, 0.65)';
      ctx.beginPath();
      ctx.moveTo(x + 14, y + 7);
      ctx.lineTo(x + 33, y + 13);
      ctx.lineTo(x + 14, y + 20);
      ctx.closePath();
      ctx.fill();
      if (c.active) {
        ctx.fillStyle = '#eafff3';
        ctx.beginPath();
        ctx.arc(x + 21, y + 13, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawGoldenAcorns() {
    if (!session.goldenAcorns) return;
    for (const a of session.goldenAcorns) {
      if (a.collected) continue;
      if (a.x + TILE < camX - 40 || a.x > camX + viewW + 40) continue;
      if (a.y + TILE < camY - 40 || a.y > camY + viewH + 40) continue;
      drawGoldenAcorn(a.x + 20, a.y + 20 + Math.sin(visualT * 0.06 + a.bob) * 4);
    }
  }

  function drawGoldenAcorn(cx, cy) {
    const pulse = 1 + Math.sin(visualT * 0.1) * 0.06;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34);
    glow.addColorStop(0, 'rgba(255, 236, 140, 0.6)');
    glow.addColorStop(0.5, 'rgba(255, 210, 70, 0.22)');
    glow.addColorStop(1, 'rgba(255, 210, 70, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fill();

    // 旋转星光
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(visualT * 0.03);
    ctx.strokeStyle = 'rgba(255, 248, 200, 0.85)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const r0 = 20;
      const r1 = 25 + Math.sin(visualT * 0.12 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    // 果身
    const body = ctx.createLinearGradient(0, -12, 0, 16);
    body.addColorStop(0, '#fff3a8');
    body.addColorStop(0.45, '#ffd94f');
    body.addColorStop(1, '#b98610');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 5, 11.5, 12.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 帽
    ctx.fillStyle = '#8a5a12';
    ctx.beginPath();
    ctx.ellipse(0, -6, 13, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c08a1e';
    ctx.beginPath();
    ctx.ellipse(0, -7.4, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 帽尖
    ctx.strokeStyle = '#6b430c';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(1, -12);
    ctx.lineTo(4, -17);
    ctx.stroke();
    // 高光
    ctx.fillStyle = 'rgba(255, 255, 235, 0.9)';
    ctx.beginPath();
    ctx.ellipse(-3.5, 2, 3, 4.6, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSprings() {
    for (const s of session.springs) {
      if (s.x + TILE < camX - 40 || s.x > camX + viewW + 40) continue;
      const baseX = s.x;
      const bottom = s.y + TILE - 2;
      const h = 10 + s.anim * 2.6;
      const cx = baseX + TILE / 2;

      // 底座
      ctx.fillStyle = '#7d2f2f';
      roundRect(ctx, cx - 17, bottom - 5, 34, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#c94848';
      roundRect(ctx, cx - 16, bottom - 7, 32, 4, 2);
      ctx.fill();

      // 弹簧圈
      ctx.strokeStyle = '#ef5b5b';
      ctx.lineWidth = 3.2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const coils = 4;
      for (let i = 0; i <= coils; i++) {
        const yy = bottom - 8 - (h * i) / coils;
        const xx = cx + (i % 2 === 0 ? -9 : 9);
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();

      // 顶板
      ctx.fillStyle = '#f6c93c';
      roundRect(ctx, cx - 16, bottom - 10 - h, 32, 7, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      roundRect(ctx, cx - 13, bottom - 9 - h, 26, 2.5, 1.5);
      ctx.fill();

      if (s.anim > 4) {
        ctx.strokeStyle = 'rgba(255, 236, 140, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, bottom - 8 - h, 20 + (8 - s.anim) * 2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
    }
  }

  function drawAcorns() {
    for (const a of session.acorns) {
      if (a.collected) continue;
      if (a.x + TILE < camX - 40 || a.x > camX + viewW + 40) continue;
      if (a.y + TILE < camY - 40 || a.y > camY + viewH + 40) continue;
      drawAcorn(a.x + 20, a.y + 20 + Math.sin(visualT * 0.06 + a.bob) * 3);
    }
  }

  function drawAcorn(cx, cy) {
    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 24);
    glow.addColorStop(0, 'rgba(255, 214, 90, 0.35)');
    glow.addColorStop(0.55, 'rgba(255, 214, 90, 0.1)');
    glow.addColorStop(1, 'rgba(255, 214, 90, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fill();

    // 果身
    const body = ctx.createLinearGradient(cx, cy - 5, cx, cy + 14);
    body.addColorStop(0, '#f0d26a');
    body.addColorStop(0.5, '#d4af37');
    body.addColorStop(1, '#a77f19');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, 9.5, 10.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 帽
    ctx.fillStyle = '#6f421a';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 5, 11, 6.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a5628';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 6.4, 9.4, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 帽尖
    ctx.strokeStyle = '#56320f';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy - 10);
    ctx.lineTo(cx + 3.5, cy - 14.5);
    ctx.stroke();
    // 高光
    ctx.fillStyle = 'rgba(255, 248, 200, 0.65)';
    ctx.beginPath();
    ctx.ellipse(cx - 3, cy + 1, 2.6, 4, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEnemies() {
    for (const e of session.enemies) {
      if (e.x + e.w < camX - 60 || e.x > camX + viewW + 60) continue;
      if (e.y + e.h < camY - 80 || e.y > camY + viewH + 80) continue;
      drawEnemy(e);
    }
  }

  function drawEnemy(e) {
    const walker = e.etype !== 'demon';
    const bob = Math.sin(visualT * 0.075 + e.x * 0.07) * 1.6;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2 + bob;

    ctx.save();
    if (e.thrown) {
      ctx.translate(cx, cy);
      ctx.rotate(e.x * 0.07);
      ctx.translate(-cx, -cy);
    }

    // 影子
    if (e.onGround) {
      ctx.fillStyle = 'rgba(20, 40, 25, 0.16)';
      ctx.beginPath();
      ctx.ellipse(cx, e.y + e.h - 1, 13, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const squash = 1 + Math.sin(visualT * 0.08 + e.x * 0.1) * 0.035;
    const rx = 14.5 * squash;
    const ry = 12.5 / squash;

    // 身体
    const grad = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
    if (walker) {
      grad.addColorStop(0, '#7fb2ff');
      grad.addColorStop(0.55, '#4b86e4');
      grad.addColorStop(1, '#2d5fae');
    } else {
      grad.addColorStop(0, '#ff8b7c');
      grad.addColorStop(0.55, '#df4b4b');
      grad.addColorStop(1, '#a52a33');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // 头顶高光
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy - ry * 0.5, rx * 0.48, ry * 0.3, -0.2, 0, Math.PI * 2);
    ctx.fill();

    if (!walker) {
      // 犄角
      ctx.fillStyle = '#b02f2f';
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - ry + 2);
      ctx.lineTo(cx - 14, cy - ry - 8);
      ctx.lineTo(cx - 4, cy - ry + 1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 10, cy - ry + 2);
      ctx.lineTo(cx + 14, cy - ry - 8);
      ctx.lineTo(cx + 4, cy - ry + 1);
      ctx.closePath();
      ctx.fill();
    }

    // 眼睛
    const look = e.vx >= 0 ? 1 : -1;
    const eyeY = cy - 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx - 5.5, eyeY, 4, 4.6, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 5.5, eyeY, 4, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2030';
    ctx.beginPath();
    ctx.arc(cx - 5.5 + look * 1.2, eyeY + 0.8, 2, 0, Math.PI * 2);
    ctx.arc(cx + 5.5 + look * 1.2, eyeY + 0.8, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx - 6.3 + look * 1.2, eyeY - 0.2, 0.8, 0, Math.PI * 2);
    ctx.arc(cx + 4.7 + look * 1.2, eyeY - 0.2, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // 嘴
    ctx.strokeStyle = walker ? 'rgba(20, 50, 110, 0.7)' : 'rgba(90, 10, 20, 0.75)';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (walker) {
      ctx.arc(cx, cy + 6, 4.5, 0.2, Math.PI - 0.2);
    } else {
      ctx.moveTo(cx - 4, cy + 6);
      ctx.lineTo(cx + 4, cy + 6);
    }
    ctx.stroke();

    // 腮红
    if (walker) {
      ctx.fillStyle = 'rgba(255, 160, 180, 0.4)';
      ctx.beginPath();
      ctx.ellipse(cx - 9, cy + 4, 2.6, 1.7, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 9, cy + 4, 2.6, 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawHeldItem() {
    const item = session.player.holdingItem;
    if (item) drawEnemy(item);
  }

  function drawPlayer() {
    const p = session.player;
    if (p.invincible > 0 && Math.floor(p.invincible / 4) % 2 === 1) return;
    if (p.x + p.w < camX - 60 || p.x > camX + viewW + 60) return;
    if (p.y + p.h < camY - 80 || p.y > camY + viewH + 80) return;

    if (p.onGround) {
      ctx.fillStyle = 'rgba(40, 30, 10, 0.15)';
      ctx.beginPath();
      ctx.ellipse(p.x + p.w / 2, p.y + p.h - 1.5, 16, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawSquirrel(ctx, p.x, p.y, p.facing, {
      time: visualT,
      runFrame: p.runFrame,
      moving: p.moving,
      onGround: p.onGround,
      holding: !!p.holdingItem,
    });
  }

  // 正面朝向右侧的松鼠（局部坐标 34 × 38）。facing = -1 时水平镜像。
  function drawSquirrel(g, x, y, facing, o) {
    o = o || {};
    const w = 34;
    const h = 38;
    const moving = !!o.moving && o.onGround !== false;
    const run = o.runFrame || 0;
    const bob = moving ? [0, 1, 0, -1][run] : 0;
    const t = o.time || 0;
    const air = o.onGround === false;

    g.save();
    g.translate(x + w / 2, y + h / 2 + bob);
    g.scale(facing < 0 ? -1 : 1, 1);
    g.translate(-w / 2, -h / 2);

    const fur = '#d99a52';
    const furDark = '#b97c3a';
    const furLight = '#eab573';
    const belly = '#f8dcae';

    // 尾巴（身后，带一点摆动）
    const sway = Math.sin(t * 0.07) * 0.8 + (moving ? Math.sin(t * 0.35) * 1.4 : 0);
    g.fillStyle = furDark;
    g.beginPath();
    g.moveTo(11, 32);
    g.bezierCurveTo(-8 + sway, 36, -11 + sway, 19, -1 + sway, 8);
    g.bezierCurveTo(6 + sway, 1, 15 + sway, 7, 12 + sway, 14.5);
    g.bezierCurveTo(10 + sway, 19.5, 8 + sway, 25, 14, 29);
    g.closePath();
    g.fill();
    g.fillStyle = furLight;
    g.beginPath();
    g.moveTo(10, 29);
    g.bezierCurveTo(-1 + sway * 0.6, 31, -2 + sway * 0.6, 20, 4 + sway * 0.6, 12);
    g.bezierCurveTo(7 + sway * 0.6, 8.5, 11 + sway * 0.6, 11, 10 + sway * 0.6, 15);
    g.bezierCurveTo(9 + sway * 0.6, 20, 8 + sway * 0.6, 25, 12, 27);
    g.closePath();
    g.fill();

    // 脚
    g.fillStyle = furDark;
    const footOff = moving ? (run % 2 ? 1.6 : -1.6) : 0;
    const footY = air ? 33.5 : 35.5;
    fillEllipse(g, 10 + footOff, footY, 5.8, 2.8);
    fillEllipse(g, 21 - footOff, footY, 5.8, 2.8);

    // 身体
    g.fillStyle = fur;
    fillEllipse(g, 17, 26, 11.5, 10.5);
    g.fillStyle = belly;
    fillEllipse(g, 20, 27.5, 7.6, 7);

    // 手臂
    g.fillStyle = fur;
    if (o.holding) {
      fillEllipse(g, 12, 18, 3.4, 4.8);
      fillEllipse(g, 26, 18, 3.4, 4.8);
    } else if (!air) {
      fillEllipse(g, 25.5, 24, 4, 3);
    } else {
      fillEllipse(g, 27, 21, 3.2, 4.4);
    }

    // 头
    g.fillStyle = fur;
    fillEllipse(g, 22, 12, 12, 10.5);

    // 耳朵
    fillEllipse(g, 13, 3, 4.4, 6);
    fillEllipse(g, 28.5, 2.6, 4.4, 6);
    g.fillStyle = '#f1bfae';
    fillEllipse(g, 13.5, 3.6, 2.1, 3.6);
    fillEllipse(g, 28.2, 3.2, 2.1, 3.6);

    // 口鼻
    g.fillStyle = belly;
    fillEllipse(g, 28, 16.2, 7, 5.4);
    // 腮红
    g.fillStyle = 'rgba(242, 166, 143, 0.35)';
    fillEllipse(g, 18.5, 17, 3.4, 2.4);
    // 眼睛
    g.fillStyle = '#2b1a0e';
    g.beginPath();
    g.arc(28.5, 10.8, 2.35, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(29.3, 10.1, 0.85, 0, Math.PI * 2);
    g.fill();
    // 鼻子
    g.fillStyle = '#b34a3c';
    fillEllipse(g, 33.2, 14.2, 1.9, 1.45);
    // 嘴
    g.strokeStyle = 'rgba(138, 90, 43, 0.9)';
    g.lineWidth = 0.9;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(30.4, 18.2, 2.6, 0.15, Math.PI - 0.35);
    g.stroke();

    g.restore();
  }

  function drawParticles() {
    for (const p of particles) p.draw(ctx);
  }

  function drawFloatTexts() {
    for (const t of floatTexts) {
      const alpha = clamp(t.life / 18, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `800 17px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(24, 14, 4, 0.55)';
      ctx.strokeText(t.text, t.x + 17, t.y + 20);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x + 17, t.y + 20);
      ctx.restore();
    }
  }

  // ─── 粒子 / 飘字 / 震动 ────────────────────────────────
  class Particle {
    constructor(x, y, color, opts) {
      const o = opts || {};
      this.x = x;
      this.y = y;
      this.color = color;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * (o.speed == null ? 3.4 : o.speed) + 0.5;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed - (o.lift == null ? 1.6 : o.lift);
      this.life = o.life == null ? 24 + Math.random() * 20 : o.life;
      this.maxLife = this.life;
      this.size = o.size == null ? 2 + Math.random() * 3.4 : o.size;
      this.gravity = o.gravity == null ? 0.16 : o.gravity;
      this.shape = o.shape || (Math.random() < 0.26 ? 'rect' : 'circle');
      this.rot = Math.random() * Math.PI * 2;
      this.spin = (Math.random() - 0.5) * 0.28;
    }

    update(d) {
      this.x += this.vx * d;
      this.y += this.vy * d;
      this.vy += this.gravity * d;
      this.life -= d;
      this.rot += this.spin * d;
    }

    draw(g) {
      const a = clamp(this.life / this.maxLife, 0, 1);
      const size = Math.max(0.5, this.size * (0.45 + a * 0.55));
      g.save();
      g.globalAlpha = a;
      g.fillStyle = this.color;
      if (this.shape === 'rect') {
        g.translate(this.x, this.y);
        g.rotate(this.rot);
        g.fillRect(-size / 2, -size / 2, size, size * 0.7);
      } else {
        g.beginPath();
        g.arc(this.x, this.y, size, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  class FloatText {
    constructor(x, y, text, color) {
      this.x = x;
      this.y = y;
      this.text = text;
      this.color = color || '#ffe27a';
      this.life = 52;
      this.maxLife = 52;
    }
    update(d) {
      this.y -= 1.1 * d;
      this.life -= d;
    }
  }

  function spawnBurst(x, y, color, count) {
    if (prefersReducedMotion) count = Math.min(count, 4);
    const n = Math.max(1, Math.min(40, count || 8));
    for (let i = 0; i < n; i++) {
      particles.push(new Particle(x, y, color || '#ffd45e'));
    }
    if (particles.length > 260) particles.splice(0, particles.length - 260);
  }

  function spawnFloatText(x, y, text, color) {
    floatTexts.push(new FloatText(x, y, text, color));
    if (floatTexts.length > 30) floatTexts.shift();
  }

  function spawnConfetti() {
    const colors = ['#ffd45e', '#61d47a', '#ffffff', '#ff9c4a', '#7fc3ff'];
    const n = prefersReducedMotion ? 16 : 60;
    for (let i = 0; i < n; i++) {
      particles.push(new Particle(
        camX + Math.random() * viewW,
        camY - 20 + Math.random() * viewH * 0.35,
        colors[Math.floor(Math.random() * colors.length)],
        { speed: 2.2, lift: -1.5, gravity: 0.07, life: 70 + Math.random() * 50, size: 3 + Math.random() * 5, shape: 'rect' }
      ));
    }
  }

  function addShake(amount) {
    shakeMag = Math.max(shakeMag * 0.4, Math.min(14, amount));
    shakeT = 10;
    shakeDur = 10;
  }

  function haptic(name) {
    if (sfx.muted || !navigator.vibrate) return;
    try {
      if (name === 'hurt') navigator.vibrate(55);
      else if (name === 'gameover') navigator.vibrate([40, 60, 60]);
      else if (name === 'stomp' || name === 'spring') navigator.vibrate(14);
      else if (name === 'acorn') navigator.vibrate(7);
      else if (name === 'golden') navigator.vibrate([12, 30, 12]);
      else if (name === 'checkpoint') navigator.vibrate([8, 24, 8]);
      else if (name === 'key') navigator.vibrate([10, 20, 10]);
      else if (name === 'gate') navigator.vibrate([18, 40, 18]);
      else if (name === 'pickup' || name === 'throw') navigator.vibrate(10);
      else if (name === 'clear' || name === 'victory') navigator.vibrate([20, 40, 20, 40, 20]);
    } catch (_) { /* ignore */ }
  }

  function flashDamage() {
    ui.damage.classList.add('is-on');
    clearTimeout(damageTimer);
    damageTimer = setTimeout(() => ui.damage.classList.remove('is-on'), 130);
  }

  function resetLevelPresentation() {
    particles.length = 0;
    floatTexts.length = 0;
    shakeT = 0;
    shakeMag = 0;
    camSnap = true;
  }

  // ─── HUD ───────────────────────────────────────────────
  function syncHUD(force) {
    const s = session;
    if (force || hudCache.score !== s.score) {
      hudCache.score = s.score;
      ui.score.textContent = String(s.score);
    }
    if (force || hudCache.level !== s.level) {
      hudCache.level = s.level;
      ui.level.textContent = `第 ${s.level}/${s.maxLevel} 关`;
    }
    const collected = s.acornsCollected();
    if (force || hudCache.acorns !== collected || hudCache.total !== s.acorns.length) {
      hudCache.acorns = collected;
      hudCache.total = s.acorns.length;
      ui.acornCount.textContent = `${collected}/${s.acorns.length}`;
    }
    const keys = s.keys || [];
    const keysGot = keys.filter((k) => k.collected).length;
    const keyState = `${keysGot}/${keys.length}`;
    if (hudCache.keys !== keyState) {
      hudCache.keys = keyState;
      ui.keyChip.classList.toggle('is-hidden', keys.length === 0);
      ui.keyCount.textContent = keyState;
    }
    const lives = Math.max(0, s.player.lives);
    if (force || hudCache.lives !== lives) {
      hudCache.lives = lives;
      renderHearts(lives);
    }

    if (s.state === E.GameState.PLAYING) {
      const holding = !!s.player.holdingItem;
      const near = !holding && !!s.player.findPickupTarget(s.enemies);
      if (hudCache.holding !== holding) {
        hudCache.holding = holding;
        ui.actionBtn.textContent = holding ? '投' : '抓';
        ui.actionBtn.setAttribute('aria-label', holding ? '投掷敌人' : '举起敌人');
      }
      if (hudCache.ready !== near) {
        hudCache.ready = near;
        ui.actionBtn.classList.toggle('is-ready', near);
      }
    } else if (hudCache.ready !== false) {
      hudCache.ready = false;
      ui.actionBtn.classList.remove('is-ready');
    }
  }

  function renderHearts(lives) {
    const html = [];
    for (let i = 0; i < 3; i++) {
      html.push(`<span class="heart${i < lives ? '' : ' is-lost'}">♥</span>`);
    }
    ui.hearts.innerHTML = html.join('');
    ui.hearts.setAttribute('aria-label', `生命值 ${lives}`);
  }

  // ─── 屏幕 / 菜单 ───────────────────────────────────────
  function syncScreens() {
    const state = session.state;
    let target = null;
    if (state === E.GameState.MENU) target = 'menu';
    else if (state === E.GameState.PAUSED) target = 'pause';
    else if (state === E.GameState.LEVEL_CLEAR ||
             state === E.GameState.GAME_OVER ||
             state === E.GameState.VICTORY) target = 'result';

    if (target !== currentScreen) {
      currentScreen = target;
      ui.screenMenu.classList.toggle('is-active', target === 'menu');
      ui.screenPause.classList.toggle('is-active', target === 'pause');
      ui.screenResult.classList.toggle('is-active', target === 'result');
      ui.screenMenu.setAttribute('aria-hidden', String(target !== 'menu'));
      ui.screenPause.setAttribute('aria-hidden', String(target !== 'pause'));
      ui.screenResult.setAttribute('aria-hidden', String(target !== 'result'));
      if (target === 'result') populateResult();
      if (target === 'menu') updateMenuInfo();
    }

    const hudVisible = state === E.GameState.PLAYING || state === E.GameState.PAUSED;
    ui.hud.classList.toggle('is-hidden', !hudVisible);
    ui.hud.setAttribute('aria-hidden', String(!hudVisible));

    const controlsVisible = state === E.GameState.PLAYING && isTouch;
    ui.touch.classList.toggle('is-hidden', !controlsVisible);
    ui.touch.setAttribute('aria-hidden', String(!controlsVisible));

    if (ui.tutorial) {
      const tutorialVisible = tutorial.active &&
        (state === E.GameState.PLAYING || state === E.GameState.PAUSED);
      ui.tutorial.classList.toggle('is-hidden', !tutorialVisible);
      ui.tutorial.setAttribute('aria-hidden', String(!tutorialVisible));
    }
  }

  function updateMenuInfo() {
    ui.bestScore.textContent = String(best);
    if (challengeScore != null) {
      ui.challengeBanner.classList.remove('is-hidden');
      ui.challengeScore.textContent = String(challengeScore);
    } else {
      ui.challengeBanner.classList.add('is-hidden');
    }
    renderLevelSelect();
    updateMuteUI();
  }

  function unlockLevel(n) {
    const next = clamp(n | 0, 1, session.maxLevel);
    if (next <= progress) return;
    progress = next;
    saveNumber(KEY_PROGRESS, progress);
    renderLevelSelect();
  }

  const WORLD_NAMES = ['林间', '弹簧高塔', '藤蔓迷径', '风之峡谷', '黄金终局',
                       '暮色洞窟', '云海之巅', '星夜王庭'];
  function worldOfLevel(lv) {
    return Math.min(WORLD_NAMES.length - 1, Math.floor((lv - 1) / 10));
  }

  function renderLevelSelect() {
    if (!ui.levelSelect) return;
    const total = session.maxLevel;
    if (ui.levelSelect.children.length !== total) {
      const frag = document.createDocumentFragment();
      for (let lv = 1; lv <= total; lv++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'level-chip';
        b.dataset.level = String(lv);
        b.dataset.world = String(worldOfLevel(lv) + 1);
        frag.appendChild(b);
      }
      ui.levelSelect.innerHTML = '';
      ui.levelSelect.appendChild(frag);
    }
    const chips = ui.levelSelect.children;
    for (let i = 0; i < chips.length; i++) {
      const lv = i + 1;
      const unlocked = lv <= progress;
      const chip = chips[i];
      const world = WORLD_NAMES[worldOfLevel(lv)];
      chip.classList.toggle('is-unlocked', unlocked);
      chip.classList.toggle('is-locked', !unlocked);
      chip.classList.toggle('is-current', unlocked && lv === progress);
      chip.disabled = !unlocked;
      chip.innerHTML = unlocked
        ? String(lv)
        : `<span class="chip-lock" aria-hidden="true">🔒</span>`;
      chip.setAttribute('aria-label',
        `第 ${lv} 关 · 世界 ${worldOfLevel(lv) + 1} ${world}${unlocked ? '' : '（未解锁）'}`);
      chip.setAttribute('aria-current', unlocked && lv === progress ? 'true' : 'false');
    }
    if (ui.levelProgress) ui.levelProgress.textContent = `已解锁 ${progress}/${total}`;
  }

  function populateResult() {
    const state = session.state;
    const score = session.score;
    const lives = Math.max(0, session.player.lives);
    const isFinal = state !== E.GameState.LEVEL_CLEAR;
    const record = score > bestAtStart;

    ui.screenResult.setAttribute('aria-hidden', 'false');
    ui.resultEyebrow.textContent = state === E.GameState.LEVEL_CLEAR
      ? `LEVEL ${session.level} CLEAR`
      : state === E.GameState.VICTORY ? 'ALL CLEAR' : 'GAME OVER';
    ui.resultTitle.textContent = state === E.GameState.LEVEL_CLEAR
      ? '关卡完成！'
      : state === E.GameState.VICTORY ? '全部通关！' : '游戏结束';
    ui.resultScore.textContent = String(score);
    ui.resultBest.textContent = String(Math.max(best, score));

    let detail = '';
    let primary = '再来一次';
    if (state === E.GameState.LEVEL_CLEAR) {
      const bonus = lives * 500;
      detail = `生命奖励 +${bonus} 分 · 还剩 ${lives} 条命`;
      primary = '进入下一关';
    } else if (state === E.GameState.GAME_OVER) {
      detail = record ? '刷新了最高分，但还是差一点！' : '再试一次，橡果就在前方！';
      primary = '再来一局';
    } else {
      detail = `全部 ${session.maxLevel} 关通关！还剩 ${lives} 条命`;
      primary = '再玩一次';
    }
    if (record && !detail.includes('最高分')) detail += ' · 新纪录！';
    ui.resultDetail.textContent = detail;
    ui.resultPrimary.textContent = primary;

    if (isFinal && challengeScore != null) {
      const diff = score - challengeScore;
      ui.challengeResult.classList.remove('is-hidden');
      ui.challengeResult.classList.toggle('is-hit', diff >= 0);
      ui.challengeResult.innerHTML = diff > 0
        ? `<span class="challenge-icon">🏆</span> 挑战成功！超过了好友的 ${challengeScore} 分`
        : diff === 0
          ? `<span class="challenge-icon">🏆</span> 挑战成功！追平了好友的 ${challengeScore} 分`
          : `<span class="challenge-icon">🎯</span> 好友挑战 ${challengeScore} 分 · 还差 ${-diff} 分`;
    } else {
      ui.challengeResult.classList.add('is-hidden');
    }
  }

  // ─── 流程控制 ──────────────────────────────────────────
  function startGame(level, allowFullscreen) {
    bestAtStart = best;
    session.start(level || 1);
    unlockLevel(session.level);
    resetInput();
    resetLevelPresentation();
    syncScreens();
    syncHUD(true);
    sfx.init();
    sfx.play('start');
    if (allowFullscreen !== false) maybeAutoFullscreen();
    requestWakeLock();
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function exitFullscreenIfNeeded() {
    if (!isFullscreen()) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) {
      try {
        const p = exit.call(document);
        if (p && p.catch) p.catch(() => {});
      } catch (_) { /* ignore */ }
    }
  }

  function unlockOrientation() {
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (_) { /* ignore */ }
  }

  // Promise 限时等待：兑现/拒绝/超时统一收敛为布尔值
  function withTimeout(p, ms) {
    return Promise.race([
      Promise.resolve(p).then(() => true, () => false),
      new Promise((resolve) => setTimeout(() => resolve(false), ms)),
    ]);
  }

  // 真·横屏：全屏 + 锁定屏幕方向（安卓 Chrome 支持）。返回是否成功。
  async function lockLandscape() {
    const el = document.documentElement;
    const reqFs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!reqFs) return false;
    if (!isFullscreen()) {
      try {
        // 个别环境（受限 WebView / 无头浏览器）请求会永远挂起，加超时兜底
        await withTimeout(reqFs.call(el, { navigationUI: 'hide' }), 1200);
      } catch (_) { /* ignore */ }
      if (!isFullscreen()) return false;
    }
    if (screen.orientation && screen.orientation.lock) {
      try {
        if (await withTimeout(screen.orientation.lock('landscape'), 1200)) return true;
      } catch (_) { /* ignore */ }
    }
    return false;
  }

  function maybeAutoFullscreen() {
    if (!isTouch) return;
    lockLandscape().then(() => updateLandscapeLabel());
  }

  // 切换横屏：优先全屏锁定方向；不支持锁向时（iOS Safari、微信等
  // 内置浏览器常锁竖屏）退化为「假横屏」——整页旋转 90°，横握手机即可。
  async function toggleLandscape() {
    if (fakeLandscape) {
      setFakeLandscape(false);
      return;
    }
    if (isFullscreen()) {
      unlockOrientation();
      exitFullscreenIfNeeded();
      updateLandscapeLabel();
      return;
    }
    if (await lockLandscape()) {
      updateLandscapeLabel();
      return;
    }
    setFakeLandscape(true);
    toast('已切换为横屏显示，把手机横过来玩吧');
  }

  function setFakeLandscape(on) {
    fakeLandscape = !!on;
    fakeFromPortrait = fakeLandscape && innerHeight >= innerWidth;
    document.body.classList.toggle('fake-landscape', fakeLandscape);
    updateLandscapeLabel();
    applyLayout();
    resize();
  }

  function updateLandscapeLabel() {
    if (!ui.landscape) return;
    ui.landscape.textContent = (fakeLandscape || isFullscreen()) ? '退出横屏' : '横屏模式';
  }

  function toggleFullscreen() {
    const el = document.documentElement;
    if (isFullscreen()) {
      unlockOrientation();
      exitFullscreenIfNeeded();
      return;
    }
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) {
      toast('当前浏览器不支持全屏');
      return;
    }
    try {
      const p = fn.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => toast('当前浏览器不支持全屏'));
    } catch (_) {
      toast('当前浏览器不支持全屏');
    }
  }

  function updateFullscreenLabel() {
    ui.fullscreen.textContent = isFullscreen() ? '退出全屏' : '全屏';
    updateLandscapeLabel();
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (_) { /* ignore */ }
    wakeLock = null;
  }

  function resetInput() {
    input.left = false;
    input.right = false;
    input.jump = false;
    controlPointers.clear();
    document.querySelectorAll('.ctrl-btn').forEach((b) => b.classList.remove('is-pressed'));
  }

  // ─── 输入 ──────────────────────────────────────────────
  function bindInput() {
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
    window.addEventListener('blur', () => {
      resetInput();
      if (session.state === E.GameState.PLAYING) {
        session.pause();
        syncScreens();
      }
    });
    // 切后台/锁屏时也可能丢抬起事件，隐藏即清空输入状态
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetInput();
    });

    const pressControl = (btn, pointerId) => {
      const key = btn.dataset.control;
      controlPointers.set(pointerId, btn);
      btn.classList.add('is-pressed');
      if (session.state !== E.GameState.PLAYING) return;
      if (key === 'action') {
        session.action();
        setTimeout(() => {
          // 动作键是点按不跟手；仍有其他手指按着时保留按下态
          for (const other of controlPointers.values()) if (other === btn) return;
          btn.classList.remove('is-pressed');
        }, 130);
      } else {
        input[key] = true;
      }
    };
    const releaseControl = (btn, pointerId) => {
      if (!controlPointers.has(pointerId)) return;
      controlPointers.delete(pointerId);
      // 同一按钮上还有其他手指按着，就不算松开
      for (const other of controlPointers.values()) if (other === btn) return;
      btn.classList.remove('is-pressed');
      const key = btn.dataset.control;
      if (key !== 'action') input[key] = false;
    };

    document.querySelectorAll('[data-control]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sfx.init();
        if (e.pointerId != null) {
          try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
          pressControl(btn, e.pointerId);
        }
      });
      btn.addEventListener('pointerup', (e) => releaseControl(btn, e.pointerId));
      btn.addEventListener('pointercancel', (e) => releaseControl(btn, e.pointerId));
      btn.addEventListener('lostpointercapture', (e) => releaseControl(btn, e.pointerId));
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // 兜底：指针捕获失败（个别浏览器）导致抬起事件没送达按钮时，
    // 在 window 上统一释放，防止方向状态卡死。
    const releaseAnywhere = (e) => {
      if (e.pointerId == null) return;
      const btn = controlPointers.get(e.pointerId);
      if (btn) releaseControl(btn, e.pointerId);
    };
    window.addEventListener('pointerup', releaseAnywhere);
    window.addEventListener('pointercancel', releaseAnywhere);

    // 任何触屏操作都说明是触屏设备（部分浏览器 pointer 判断不准）
    window.addEventListener('touchstart', () => {
      if (isTouch) return;
      isTouch = true;
      applyLayout();
      resize();
      syncScreens();
    }, { passive: true });

    // 阻止双击缩放 / 长按菜单
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('#touch-controls, #game')) e.preventDefault();
    });
    document.addEventListener('dblclick', (e) => {
      if (e.target.closest('#touch-controls')) e.preventDefault();
    });
  }

  function onKeyDown(e) {
    if (e.defaultPrevented) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (ui.shareModal.classList.contains('is-open')) {
      if (e.code === 'Escape') {
        e.preventDefault();
        closeShare();
      }
      return;
    }

    const code = e.code;
    const gameKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyF', 'Escape', 'KeyP', 'Enter'];
    if (gameKeys.includes(code)) e.preventDefault();
    sfx.init();

    if (code === 'Escape' || code === 'KeyP') {
      if (session.state === E.GameState.PLAYING) {
        session.pause();
        syncScreens();
      } else if (session.state === E.GameState.PAUSED) {
        session.resume();
        syncScreens();
      }
      return;
    }

    if (session.state === E.GameState.PLAYING) {
      if (code === 'ArrowLeft' || code === 'KeyA') input.left = true;
      if (code === 'ArrowRight' || code === 'KeyD') input.right = true;
      if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') input.jump = true;
      if (code === 'KeyF' && !e.repeat) session.action();
      return;
    }

    if (code === 'Enter' || code === 'Space') {
      if (session.state === E.GameState.MENU) {
        startGame(1);
      } else if (session.state === E.GameState.PAUSED) {
        session.resume();
        syncScreens();
      } else if (session.state === E.GameState.LEVEL_CLEAR ||
                 session.state === E.GameState.GAME_OVER ||
                 session.state === E.GameState.VICTORY) {
        session.primaryAction();
        syncScreens();
      }
    }
  }

  function onKeyUp(e) {
    const code = e.code;
    if (code === 'ArrowLeft' || code === 'KeyA') input.left = false;
    if (code === 'ArrowRight' || code === 'KeyD') input.right = false;
    if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') input.jump = false;
  }

  function blurActive() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  // ─── 按钮绑定 ──────────────────────────────────────────
  function bindUI() {
    const click = (el, fn) => {
      if (!el) return;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        blurActive();
        fn();
      });
    };

    click(ui.start, () => startGame(progress));
    click(ui.tutorialSkip, () => finishTutorial());
    if (ui.levelSelect) {
      ui.levelSelect.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-level]');
        if (!btn || btn.disabled) return;
        e.preventDefault();
        blurActive();
        startGame(Number(btn.dataset.level));
      });
    }
    click(ui.menuShare, () => openShare(best > 0 ? best : 0, best > 0 ? '最高分' : '邀请'));
    click(ui.menuSound, () => toggleMute());
    click(ui.fullscreen, toggleFullscreen);
    click(ui.landscape, toggleLandscape);
    click(ui.pause, () => {
      if (session.state === E.GameState.PLAYING) {
        session.pause();
        syncScreens();
      }
    });
    click(ui.mute, toggleMute);
    click(ui.resume, () => { session.resume(); syncScreens(); });
    click(ui.pauseShare, () => openShare(session.score, '本局得分'));
    click(ui.pauseRestart, () => startGame(session.level, false));
    click(ui.pauseMenu, () => { session.toMenu(); syncScreens(); });

    click(ui.resultPrimary, () => { session.primaryAction(); syncScreens(); });
    click(ui.resultShare, () => openShare(session.score, '本局得分'));
    click(ui.resultMenu, () => { session.toMenu(); syncScreens(); });

    click(ui.shareClose, closeShare);
    click(ui.shareNative, () => shareNative());
    click(ui.shareDownload, () => downloadShareImage());
    click(ui.shareCopy, () => copyShareLink());
    ui.shareModal.addEventListener('click', (e) => {
      if (e.target === ui.shareModal) closeShare();
    });

    click(ui.install, async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch (_) { /* ignore */ }
      deferredInstall = null;
      ui.install.classList.add('is-hidden');
    });

    click(ui.fatalReload, () => location.reload());

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      ui.install.classList.remove('is-hidden');
    });
    window.addEventListener('appinstalled', () => {
      deferredInstall = null;
      ui.install.classList.add('is-hidden');
    });

    document.addEventListener('fullscreenchange', () => {
      updateFullscreenLabel();
      applyLayout();
      resize();
    });
    document.addEventListener('webkitfullscreenchange', () => {
      updateFullscreenLabel();
      applyLayout();
      resize();
    });
  }

  function toggleMute() {
    sfx.init();
    setMuted(!sfx.muted, true);
  }

  function setMuted(muted, persist) {
    sfx.setMuted(muted);
    updateMuteUI();
    if (persist) saveNumber(KEY_MUTE, muted ? 1 : 0);
  }

  function updateMuteUI() {
    ui.mute.classList.toggle('is-muted', sfx.muted);
    ui.mute.setAttribute('aria-pressed', String(sfx.muted));
    if (ui.menuSound) ui.menuSound.textContent = sfx.muted ? '音效：关' : '音效：开';
    if (ui.menuSound) ui.menuSound.setAttribute('aria-pressed', String(sfx.muted));
  }

  // ─── 生命周期 / SW ─────────────────────────────────────
  function bindLifecycle() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (session.state === E.GameState.PLAYING) {
          session.pause();
          syncScreens();
        }
        releaseWakeLock();
      } else if (session.state === E.GameState.PLAYING) {
        requestWakeLock();
      }
    });

    if (pendingAutoStart) {
      const level = pendingAutoStart;
      pendingAutoStart = 0;
      // 等首帧布局完成再开始
      requestAnimationFrame(() => startGame(level, false));
    }
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // ─── 分享 ──────────────────────────────────────────────
  function buildShareUrl(score) {
    let base;
    try {
      const u = new URL(location.href);
      u.search = '';
      u.hash = '';
      base = u.toString();
    } catch (_) {
      base = location.href.split('#')[0].split('?')[0];
    }
    if (!score) return base;
    return `${base}${base.includes('?') ? '&' : '?'}c=${encodeURIComponent(score)}`;
  }

  function openShare(score, label) {
    score = Math.max(0, Math.floor(score || 0));
    label = label || '本局得分';
    closeSharePreview();

    const url = buildShareUrl(score);
    ui.shareUrl.textContent = url;
    ui.shareLoading.hidden = false;
    ui.shareLoading.textContent = '正在生成成绩卡…';
    ui.shareImage.hidden = true;
    ui.shareImage.removeAttribute('src');
    ui.shareNative.textContent = navigator.share ? '分享' : '复制链接';
    ui.shareNative.disabled = true;
    ui.shareDownload.disabled = true;
    ui.shareModal.classList.add('is-open');
    ui.shareModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => ui.shareClose.focus({ preventScroll: true }), 30);

    const card = createShareCard(score, label, Math.max(best, score));
    canvasToBlob(card).then((blob) => {
      if (!ui.shareModal.classList.contains('is-open')) return;
      if (!blob) {
        ui.shareLoading.textContent = '成绩卡生成失败，请重试';
        ui.shareNative.disabled = false;
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      let file = null;
      try {
        file = new File([blob], `squirrel-quest-${score}.png`, { type: 'image/png' });
      } catch (_) { file = null; }
      shareCtx = { score, label, blob, file, objectUrl, url };
      ui.shareImage.src = objectUrl;
      ui.shareImage.hidden = false;
      ui.shareLoading.hidden = true;
      ui.shareNative.disabled = false;
      ui.shareDownload.disabled = false;
    });
  }

  function closeSharePreview() {
    if (shareCtx && shareCtx.objectUrl) {
      setTimeout(() => URL.revokeObjectURL(shareCtx.objectUrl), 500);
    }
    shareCtx = null;
    ui.shareImage.removeAttribute('src');
  }

  function closeShare() {
    ui.shareModal.classList.remove('is-open');
    ui.shareModal.setAttribute('aria-hidden', 'true');
    closeSharePreview();
  }

  async function shareNative() {
    if (!shareCtx) return;
    const { score, label, file, url } = shareCtx;
    const text = score > 0
      ? (label === '最高分'
        ? `我在《松鼠大作战》里最高分是 ${score} 分，你能超过我吗？`
        : `我在《松鼠大作战》里拿了 ${score} 分，你能超过我吗？`)
      : '来玩《松鼠大作战》！收集橡果、踩扁史莱姆、投掷连击～';

    if (navigator.share) {
      const data = { title: '松鼠大作战', text, url };
      let canFiles = false;
      if (file && navigator.canShare) {
        try { canFiles = navigator.canShare({ files: [file] }); } catch (_) { canFiles = false; }
      }
      if (canFiles) {
        data.files = [file];
        data.text = `${text}\n${url}`;
      }
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
      }
    }

    const copied = await copyText(url);
    downloadShareImage();
    toast(copied ? '链接已复制，成绩卡已保存' : '成绩卡已保存，请手动复制链接');
  }

  async function copyShareLink() {
    const url = shareCtx ? shareCtx.url : ui.shareUrl.textContent;
    if (!url) return;
    const ok = await copyText(url);
    if (ok) {
      toast(location.protocol === 'file:' ? '已复制（本地文件链接，部署后好友才能访问）' : '挑战链接已复制');
    } else {
      toast('复制失败，请长按链接手动复制');
    }
  }

  function downloadShareImage() {
    if (!shareCtx || !shareCtx.objectUrl) {
      toast('图片还在生成中，请稍候');
      return;
    }
    const a = document.createElement('a');
    a.href = shareCtx.objectUrl;
    a.download = `squirrel-quest-${shareCtx.score}.png`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('成绩卡已保存');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function canvasToBlob(canvasEl) {
    return new Promise((resolve) => {
      if (canvasEl.toBlob) {
        try {
          canvasEl.toBlob((blob) => resolve(blob || null), 'image/png');
          return;
        } catch (_) { /* fall through */ }
      }
      try {
        const dataUrl = canvasEl.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve(new Blob([bytes], { type: 'image/png' }));
      } catch (_) {
        resolve(null);
      }
    });
  }

  function createShareCard(score, label, bestScore) {
    const W = 1080;
    const H = 1350;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');

    // 天空
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#4f8bd8');
    sky.addColorStop(0.4, '#8abae8');
    sky.addColorStop(0.72, '#cfe6f8');
    sky.addColorStop(1, '#eaf7fd');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // 太阳
    const sun = g.createRadialGradient(870, 190, 10, 870, 190, 260);
    sun.addColorStop(0, 'rgba(255,252,220,0.95)');
    sun.addColorStop(0.3, 'rgba(255,240,170,0.35)');
    sun.addColorStop(1, 'rgba(255,240,170,0)');
    g.fillStyle = sun;
    g.beginPath();
    g.arc(870, 190, 260, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,252,228,0.9)';
    g.beginPath();
    g.arc(870, 190, 68, 0, Math.PI * 2);
    g.fill();

    // 云
    drawCardCloud(g, 190, 250, 1.2);
    drawCardCloud(g, 790, 390, 0.9);
    drawCardCloud(g, 500, 150, 0.7);

    // 远山
    drawCardHills(g, 0, H * 0.62, '#8fc6b8', 90);
    drawCardHills(g, 120, H * 0.7, '#5fa97c', 70);

    // 草地
    const ground = g.createLinearGradient(0, H - 330, 0, H);
    ground.addColorStop(0, '#5fbf5a');
    ground.addColorStop(0.16, '#3f9c4e');
    ground.addColorStop(1, '#1e5b35');
    g.fillStyle = ground;
    g.fillRect(0, H - 330, W, 330);
    g.fillStyle = '#73d066';
    g.fillRect(0, H - 330, W, 16);
    for (let i = 0; i < 34; i++) {
      const bx = (i / 34) * W + ((i * 37) % 17);
      const bh = 16 + ((i * 53) % 34);
      g.fillStyle = i % 2 ? '#4caf50' : '#5ecb5c';
      g.beginPath();
      g.moveTo(bx - 9, H - 324);
      g.lineTo(bx, H - 324 - bh);
      g.lineTo(bx + 9, H - 324);
      g.closePath();
      g.fill();
    }

    // 标题
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 92px ${FONT_STACK}`;
    g.lineWidth = 16;
    g.strokeStyle = 'rgba(84, 47, 6, 0.9)';
    g.strokeText('松鼠大作战', W / 2, 150);
    const titleGrad = g.createLinearGradient(0, 100, 0, 200);
    titleGrad.addColorStop(0, '#fff8d6');
    titleGrad.addColorStop(0.55, '#ffda68');
    titleGrad.addColorStop(1, '#f3a91d');
    g.fillStyle = titleGrad;
    g.fillText('松鼠大作战', W / 2, 150);

    g.font = `800 30px ${FONT_STACK}`;
    g.fillStyle = 'rgba(30, 72, 120, 0.8)';
    g.fillText('S  Q  U  I  R  R  E  L     Q  U  E  S  T', W / 2, 228);
    g.restore();

    // 松鼠
    g.save();
    g.beginPath();
    g.ellipse(W / 2, 636, 190, 30, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(16, 48, 28, 0.24)';
    g.fill();
    g.restore();
    g.save();
    g.translate(W / 2, 425);
    g.scale(5.4, 5.4);
    drawSquirrel(g, -17, 0, 1, { time: 1.2, onGround: true, moving: false });
    g.restore();

    // 两侧橡果
    drawCardAcorn(g, 175, 560, 2.6);
    drawCardAcorn(g, 905, 610, 2.1);
    drawCardAcorn(g, 250, 800, 1.7);
    drawCardAcorn(g, 830, 460, 1.4);

    // 分数卡
    const panelX = 100;
    const panelY = 770;
    const panelW = W - 200;
    const panelH = 310;
    g.save();
    g.shadowColor = 'rgba(16, 40, 70, 0.35)';
    g.shadowBlur = 40;
    g.shadowOffsetY = 18;
    roundRect(g, panelX, panelY, panelW, panelH, 44);
    g.fillStyle = 'rgba(12, 28, 50, 0.9)';
    g.fill();
    g.restore();
    roundRect(g, panelX, panelY, panelW, panelH, 44);
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255, 214, 94, 0.7)';
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 30px ${FONT_STACK}`;
    g.fillStyle = 'rgba(214, 233, 255, 0.72)';
    g.fillText(label === '最高分' ? '我的最高分' : label === '邀请' ? '等你来挑战' : '本局得分', W / 2, panelY + 60);

    const scoreGrad = g.createLinearGradient(0, panelY + 100, 0, panelY + 250);
    scoreGrad.addColorStop(0, '#fff6cc');
    scoreGrad.addColorStop(0.5, '#ffd45e');
    scoreGrad.addColorStop(1, '#f3a712');
    g.font = `900 150px ${FONT_STACK}`;
    g.fillStyle = scoreGrad;
    g.shadowColor = 'rgba(255, 190, 40, 0.4)';
    g.shadowBlur = 30;
    g.fillText(String(score), W / 2, panelY + 170);
    g.shadowBlur = 0;

    g.font = `700 34px ${FONT_STACK}`;
    g.fillStyle = 'rgba(255, 236, 170, 0.88)';
    g.fillText(`最高分 ${Math.max(bestScore, score)}`, W / 2, panelY + 266);

    // 行动号召
    g.font = `900 46px ${FONT_STACK}`;
    g.fillStyle = '#1d4b2f';
    g.fillText('打开链接，来挑战我吧！', W / 2, 1150);

    // 链接
    let display = '';
    try {
      display = location.protocol === 'file:'
        ? '本地预览 · 部署后即可分享链接'
        : `${location.host}${location.pathname}`;
    } catch (_) {
      display = '';
    }
    if (display.length > 54) display = display.slice(0, 52) + '…';
    g.font = `600 26px ui-monospace, Menlo, monospace`;
    g.fillStyle = 'rgba(18, 54, 36, 0.62)';
    g.fillText(display, W / 2, 1225);

    g.font = `600 24px ${FONT_STACK}`;
    g.fillStyle = 'rgba(18, 54, 36, 0.45)';
    g.fillText('收集橡果 · 踩扁史莱姆 · 投掷连击', W / 2, 1290);

    return c;
  }

  function drawCardCloud(g, x, y, s) {
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [dx, dy, r] of [[-60, 10, 42], [-18, -14, 54], [34, 4, 46], [72, 16, 32]]) {
      g.beginPath();
      g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawCardHills(g, phase, baseY, color, amp) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 1350);
    for (let x = 0; x <= 1080; x += 12) {
      const y = baseY
        - Math.sin((x + phase) * 0.004) * amp
        - Math.sin((x + phase) * 0.0017 + 2) * amp * 0.6;
      g.lineTo(x, y);
    }
    g.lineTo(1080, 1350);
    g.closePath();
    g.fill();
  }

  function drawCardAcorn(g, x, y, s) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    const glow = g.createRadialGradient(0, 0, 1, 0, 0, 30);
    glow.addColorStop(0, 'rgba(255, 214, 90, 0.35)');
    glow.addColorStop(1, 'rgba(255, 214, 90, 0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, 30, 0, Math.PI * 2);
    g.fill();
    const body = g.createLinearGradient(0, -8, 0, 18);
    body.addColorStop(0, '#f0d26a');
    body.addColorStop(1, '#a77f19');
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, 5, 11, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#6f421a';
    g.beginPath();
    g.ellipse(0, -7, 13, 7.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8a5628';
    g.beginPath();
    g.ellipse(0, -8.6, 11, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#56320f';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(1, -13);
    g.lineTo(4, -18);
    g.stroke();
    g.fillStyle = 'rgba(255,248,200,0.65)';
    g.beginPath();
    g.ellipse(-3.6, 2, 3, 4.6, -0.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // ─── Toast / 错误 ──────────────────────────────────────
  function toast(message, ms) {
    ui.toast.textContent = message;
    ui.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), ms || 2300);
  }

  function showFatal(message) {
    if (fatalShown) return;
    fatalShown = true;
    ui.fatalMessage.textContent = String(message || '未知错误');
    ui.fatal.classList.remove('is-hidden');
  }

  window.addEventListener('error', (e) => {
    if (e && e.message) showFatal(e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason;
    if (reason) showFatal(reason.message || reason);
  });

  // ─── 调试接口（便于自动化测试）─────────────────────────
  function exposeDebugApi() {
    window.__squirrelGame = {
      session,
      get best() { return best; },
      get view() { return { w: viewW, h: viewH, scale, cssW, cssH, camX, camY }; },
      start: (level) => startGame(level || 1, false),
      pause: () => { if (session.state === E.GameState.PLAYING) { session.pause(); syncScreens(); } },
      resume: () => { if (session.state === E.GameState.PAUSED) { session.resume(); syncScreens(); } },
      openShare: () => openShare(session.state === E.GameState.MENU ? best : session.score, '本局得分'),
      pump,
      toast,
      get tutorial() {
        return {
          active: tutorial.active,
          step: tutorial.step,
          hint: tutorial.steps[Math.min(tutorial.step, tutorial.steps.length - 1)]?.hint || '',
          done: tutorial.done.slice(),
          completed: tutorialDone,
        };
      },
      GameState: E.GameState,
    };
  }

  init();
})();
