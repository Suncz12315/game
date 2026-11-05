/*
 * 松鼠大作战 · Squirrel Quest
 * 核心引擎（纯逻辑，无 DOM / Canvas 依赖）
 *
 * 由 Python 版 game_engine.py 移植，保留原有的物理手感与关卡数据。
 * 该文件同时兼容浏览器全局变量与 CommonJS，便于跑单元测试。
 */
(function (root) {
  'use strict';

  // ─── 常量 ───────────────────────────────────────────────
  const TILE = 40;               // 地图网格大小
  const FPS = 60;

  const GRAVITY = 0.75;
  const MAX_FALL = 14;
  const PLAYER_SPEED = 5;
  const PLAYER_JUMP = -15;
  const ENEMY_SPEED = 2;

  const GameState = Object.freeze({
    MENU: 'menu',
    PLAYING: 'playing',
    PAUSED: 'paused',
    LEVEL_CLEAR: 'level_clear',
    GAME_OVER: 'game_over',
    VICTORY: 'victory',
  });

  // ─── 矩形 ───────────────────────────────────────────────
  // 与 pygame.Rect 的碰撞语义一致：边缘相接不算碰撞。
  class Rect {
    constructor(x, y, w, h) {
      this.x = x;
      this.y = y;
      this.w = w;
      this.h = h;
    }
    get left() { return this.x; }
    get right() { return this.x + this.w; }
    get top() { return this.y; }
    get bottom() { return this.y + this.h; }

    colliderect(o) {
      return this.x < o.x + o.w && o.x < this.x + this.w &&
             this.y < o.y + o.h && o.y < this.y + this.h;
    }
    inflate(dx, dy) {
      return new Rect(this.x - dx / 2, this.y - dy / 2, this.w + dx, this.h + dy);
    }
    move(dx, dy) {
      return new Rect(this.x + dx, this.y + dy, this.w, this.h);
    }
  }

  // ─── 地图系统 ───────────────────────────────────────────
  // 字符映射:
  //   '#' = 砖块   '@' = 泥土平台   '=' = 草地顶面
  //   '~' = 易碎平台（站上去会塌）   'L' = 藤蔓门（需要钥匙）
  //   'A' = 橡果   '*' = 金橡果（奖励分，不要求收集）
  //   'K' = 钥匙   'W' = 上升气流
  //   'V' = 横向锯轮   'v' = 纵向锯轮
  //   'E' = 敌人出生点   'D' = 恶魔出生点   'P' = 玩家出生点
  //   'S' = 弹簧   '^' = 尖刺   'C' = 检查点   ' ' = 空
  class TileMap {
    constructor(rows) {
      this.h = rows.length;
      this.w = Math.max(...rows.map((r) => r.length));
      // 关卡各行长度并不一致，补齐后再按 w 遍历，避免越界。
      this.rows = rows.map((r) => r.padEnd(this.w, ' '));
      this.pixelW = this.w * TILE;
      this.pixelH = this.h * TILE;
      this.acorns = [];
      this.goldenAcorns = [];
      this.enemySpawns = [];
      this.springs = [];
      this.hazards = [];
      this.checkpoints = [];
      this.crumbles = [];
      this.crumbleMap = new Map();
      this.keys = [];
      this.gates = [];
      this.winds = [];
      this.saws = [];
      this.gateOpen = false;
      this.playerSpawn = { x: TILE * 3, y: TILE * (this.h - 3) };
      this._parse();
    }

    _parse() {
      for (let y = 0; y < this.h; y++) {
        const row = this.rows[y];
        for (let x = 0; x < this.w; x++) {
          const ch = row[x];
          const px = x * TILE;
          const py = y * TILE;
          if (ch === 'A') this.acorns.push(new Acorn(px, py));
          else if (ch === '*') this.goldenAcorns.push(new Acorn(px, py, true));
          else if (ch === 'E') this.enemySpawns.push({ x: px, y: py, type: 'walker' });
          else if (ch === 'D') this.enemySpawns.push({ x: px, y: py, type: 'demon' });
          else if (ch === 'P') this.playerSpawn = { x: px, y: py };
          else if (ch === 'S') this.springs.push(new Spring(px, py));
          else if (ch === '^') this.hazards.push({ x: px, y: py });
          else if (ch === 'C') this.checkpoints.push({ x: px, y: py, active: false });
          else if (ch === '~') {
            const crumble = { tx: x, ty: y, state: 'idle', timer: 0 };
            this.crumbles.push(crumble);
            this.crumbleMap.set(`${x},${y}`, crumble);
          } else if (ch === 'K') this.keys.push({ x: px, y: py, collected: false });
          else if (ch === 'L') this.gates.push({ tx: x, ty: y });
          else if (ch === 'W') this.winds.push({ tx: x, ty: y });
          else if (ch === 'V' || ch === 'v') {
            this.saws.push({
              x: px, y: py,
              baseX: px, baseY: py,
              curX: px, curY: py,
              axis: ch === 'V' ? 'x' : 'y',
              range: TILE * 2.2,
              speed: 0.032,
              t: x * 0.43 + y * 0.29,
            });
          }
        }
      }
    }

    isSolid(tx, ty) {
      if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return true;
      const ch = this.rows[ty][tx];
      if (ch === 'L') return !this.gateOpen;
      if (ch === '~') {
        const c = this.crumbleMap.get(`${tx},${ty}`);
        return !c || c.state !== 'gone';
      }
      return ch === '#' || ch === '@' || ch === '=';
    }

    tileType(tx, ty) {
      if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return ' ';
      return this.rows[ty][tx];
    }

    crumbStateAt(tx, ty) {
      const c = this.crumbleMap.get(`${tx},${ty}`);
      return c ? c.state : '';
    }

    // 玩家站上易碎平台后开始晃动，随后消失一段时间再恢复。
    updateCrumbles(player) {
      const feet = player.rect.bottom;
      const left = player.rect.left;
      const right = player.rect.right;
      for (const c of this.crumbles) {
        if (c.state === 'idle') {
          if (player.onGround &&
              Math.abs(feet - c.ty * TILE) <= 2 &&
              right > c.tx * TILE + 2 && left < (c.tx + 1) * TILE - 2) {
            c.state = 'shaking';
            c.timer = 34;
          }
        } else if (c.state === 'shaking') {
          c.timer -= 1;
          if (c.timer <= 0) {
            c.state = 'gone';
            c.timer = 130;
          }
        } else if (c.state === 'gone') {
          c.timer -= 1;
          if (c.timer <= 0) {
            c.state = 'idle';
            c.timer = 0;
          }
        }
      }
    }

    hasWind(rect) {
      const c0 = Math.max(0, Math.floor(rect.left / TILE));
      const c1 = Math.min(this.w - 1, Math.floor((rect.right - 1) / TILE));
      const r0 = Math.max(0, Math.floor(rect.top / TILE));
      const r1 = Math.min(this.h - 1, Math.floor((rect.bottom - 1) / TILE));
      for (let ty = r0; ty <= r1; ty++) {
        for (let tx = c0; tx <= c1; tx++) {
          if (this.rows[ty][tx] === 'W') return true;
        }
      }
      return false;
    }
  }

  // ─── 实体基类 ───────────────────────────────────────────
  class Entity {
    constructor(x, y, w, h) {
      this.x = x;
      this.y = y;
      this.w = w;
      this.h = h;
      this.vx = 0;
      this.vy = 0;
      this.onGround = false;
      this.dead = false;
    }

    get rect() {
      // 与 pygame.Rect(int(x), int(y), w, h) 一致，截断小数。
      return new Rect(Math.trunc(this.x), Math.trunc(this.y), this.w, this.h);
    }

    _rangeX(tm) {
      const lx = Math.max(0, Math.floor(this.x / TILE));
      const rx = Math.min(tm.w - 1, Math.floor((this.x + this.w - 1) / TILE));
      return [lx, rx];
    }

    _rangeY(tm) {
      const ly = Math.max(0, Math.floor(this.y / TILE));
      const ry = Math.min(tm.h - 1, Math.floor((this.y + this.h - 1) / TILE));
      return [ly, ry];
    }

    moveAndCollide(tm) {
      // ── Y 轴 ──
      // 先处理垂直方向：实体出生/落地时可能嵌进地面几个像素，
      // 若先做水平移动，这种垂直重叠会被误判成撞墙。
      this.onGround = false;
      this.y += this.vy;

      let [lx, rx] = this._rangeX(tm);
      let [ly, ry] = this._rangeY(tm);
      for (let tx = lx; tx <= rx; tx++) {
        for (let ty = ly; ty <= ry; ty++) {
          if (!tm.isSolid(tx, ty)) continue;
          const r = new Rect(tx * TILE, ty * TILE, TILE, TILE);
          if (this.rect.colliderect(r)) {
            if (this.vy > 0) {
              this.y = r.top - this.h;
              this.onGround = true;
            } else if (this.vy < 0) {
              this.y = r.bottom;
            }
            this.vy = 0;
            break;
          }
        }
      }

      // ── X 轴 ──
      const oldRect = this.rect;
      this.x += this.vx;
      [lx, rx] = this._rangeX(tm);
      [ly, ry] = this._rangeY(tm);
      for (let tx = lx; tx <= rx; tx++) {
        for (let ty = ly; ty <= ry; ty++) {
          if (!tm.isSolid(tx, ty)) continue;
          const r = new Rect(tx * TILE, ty * TILE, TILE, TILE);
          if (this.rect.colliderect(r)) {
            // 移动前就已经和该格重叠时，不当作水平碰撞处理
            if (oldRect.colliderect(r)) continue;
            if (this.vx > 0) this.x = r.left - this.w;
            else if (this.vx < 0) this.x = r.right;
            this.vx = 0;
            break;
          }
        }
      }

      // 站立检测：贴地时矩形与地面刚好接触，colliderect 不算重叠。
      // 若只看本帧碰撞，onGround 会逐帧闪烁，导致点按跳跃偶尔失灵。
      if (!this.onGround && this.vy >= 0 &&
          this._rectHitsSolid(this.rect.move(0, 1), tm)) {
        this.onGround = true;
      }
    }

    _rectHitsSolid(rect, tm) {
      const lx = Math.max(0, Math.floor(rect.left / TILE));
      const rx = Math.min(tm.w - 1, Math.floor((rect.right - 1) / TILE));
      const ly = Math.max(0, Math.floor(rect.top / TILE));
      const ry = Math.min(tm.h - 1, Math.floor((rect.bottom - 1) / TILE));
      if (lx > rx || ly > ry) return false;
      for (let tx = lx; tx <= rx; tx++) {
        for (let ty = ly; ty <= ry; ty++) {
          if (!tm.isSolid(tx, ty)) continue;
          const r = new Rect(tx * TILE, ty * TILE, TILE, TILE);
          if (rect.colliderect(r)) return true;
        }
      }
      return false;
    }

    applyGravity() {
      this.vy = Math.min(this.vy + GRAVITY, MAX_FALL);
    }
  }

  // ─── 玩家：松鼠 🐿️ ────────────────────────────────────────
  class Player extends Entity {
    constructor(x, y) {
      super(x, y, 34, 38);
      this.facing = 1;              // 1 = 右，-1 = 左
      this.lives = 3;
      this.invincible = 0;
      this.animTimer = 0;
      this.runFrame = 0;
      this.holdingItem = null;
      this.throwCooldown = 0;
      this.didJump = false;
      this.moving = false;
      this.jumpHeld = false;        // 上一帧跳跃键状态（边沿检测用）
      this.jumpBuffer = 0;          // 预输入缓冲：落地前按键也能起跳
      this.coyote = 0;              // 土狼时间：走下平台后短暂可跳
    }

    update(input, tm) {
      input = input || {};
      this.didJump = false;

      // 水平移动
      if (input.left) {
        this.vx = -PLAYER_SPEED;
        this.facing = -1;
        this.moving = true;
      } else if (input.right) {
        this.vx = PLAYER_SPEED;
        this.facing = 1;
        this.moving = true;
      } else {
        this.vx *= 0.6;
        if (Math.abs(this.vx) < 0.2) this.vx = 0;
        this.moving = false;
      }

      // 跳跃：边沿触发，按一次跳一次。
      // 原来是按住就连跳（input.jump && onGround），一旦输入层因浏览器
      // 手势/焦点异常丢了抬起事件，跳跃状态卡住就会落地自动起跳、永远
      // 停不下来。边沿触发后即使状态卡住也最多多跳一次。
      const jumpDown = !!input.jump;
      const jumpPressed = jumpDown && !this.jumpHeld;
      this.jumpHeld = jumpDown;
      if (jumpPressed) this.jumpBuffer = 8;                 // 8 帧预输入窗口
      else if (this.jumpBuffer > 0) this.jumpBuffer -= 1;
      if (this.onGround) this.coyote = 6;                   // 6 帧土狼时间
      else if (this.coyote > 0) this.coyote -= 1;
      if (this.jumpBuffer > 0 && (this.onGround || this.coyote > 0)) {
        this.vy = PLAYER_JUMP;
        this.onGround = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.didJump = true;
      }

      if (this.throwCooldown > 0) this.throwCooldown -= 1;

      this.applyGravity();
      // 上升气流：持续把松鼠往上托，离开气流后恢复普通重力。
      if (tm.hasWind(this.rect)) this.vy = Math.min(this.vy, -4.6);
      this.moveAndCollide(tm);

      if (this.invincible > 0) this.invincible -= 1;

      // 跑步动画
      if (this.moving && this.onGround) {
        this.animTimer += 1;
        if (this.animTimer >= 6) {
          this.animTimer = 0;
          this.runFrame = (this.runFrame + 1) % 4;
        }
      } else {
        this.runFrame = 0;
        this.animTimer = 0;
      }
    }

    die() {
      if (this.invincible > 0) return false;
      this.lives -= 1;
      this.invincible = 90;
      this.vy = PLAYER_JUMP * 0.7;
      if (this.lives < 0) this.dead = true;
      return true;
    }

    pickupZone() {
      // 原版 pygame.Rect.inflate(50, 30)
      return this.rect.inflate(50, 30);
    }

    findPickupTarget(enemies) {
      if (this.holdingItem) return null;
      const zone = this.pickupZone();
      for (const e of enemies) {
        if (e.rect.colliderect(zone)) return e;
      }
      return null;
    }

    pickUp(enemies) {
      const e = this.findPickupTarget(enemies);
      if (!e) return null;
      e.vx = 0;
      e.vy = 0;
      e.thrown = false;
      this.holdingItem = e;
      const i = enemies.indexOf(e);
      if (i >= 0) enemies.splice(i, 1);
      return e;
    }

    throwHeld(enemies) {
      if (!this.holdingItem || this.throwCooldown > 0) return null;
      const item = this.holdingItem;
      item.vx = 8 * this.facing;
      item.vy = -5;
      item.thrown = true;
      enemies.push(item);
      this.holdingItem = null;
      this.throwCooldown = 20;
      return item;
    }
  }

  // ─── 橡果 🌰 ─────────────────────────────────────────────
  class Acorn {
    constructor(x, y, golden) {
      this.x = x;
      this.y = y;
      this.golden = !!golden;
      this.value = this.golden ? 150 : 50;
      this.collected = false;
      this.bob = Math.random() * Math.PI * 2;
      this.rot = Math.random() * 2 - 1;
    }
    get rect() {
      return new Rect(this.x, this.y, TILE, TILE);
    }
  }

  // ─── 弹簧 🔴 ─────────────────────────────────────────────
  class Spring {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      // 弹簧立于所在格子的下半部分，视觉与判定一致。
      this.rect = new Rect(x, y + TILE / 2, TILE, TILE / 2);
      this.anim = 0;
    }
    activate() {
      this.anim = 8;
    }
    update() {
      if (this.anim > 0) this.anim -= 1;
    }
  }

  // ─── 敌人 ───────────────────────────────────────────────
  class Enemy extends Entity {
    constructor(x, y, etype) {
      super(x, y, 32, 34);
      this.etype = etype || 'walker';
      this.speed = this.etype === 'demon' ? ENEMY_SPEED * 1.5 : ENEMY_SPEED;
      this.vx = Math.random() < 0.5 ? this.speed : -this.speed;
      this.patrolStart = x;
      this.patrolRange = 200;
      this.thrown = false;
      this.animT = Math.random() * 6;
      this.hopT = 50 + Math.floor(Math.random() * 80);
    }

    update(tm) {
      if (this.thrown) {
        this.applyGravity();
        this.moveAndCollide(tm);
        if (this.onGround) {
          this.thrown = false;
          this.vx = this.vx > 0 ? this.speed : -this.speed;
        }
        return;
      }

      // 记住朝向：moveAndCollide 撞墙时会把 vx 归零
      const direction = this.vx >= 0 ? 1 : -1;
      this.vx = this.speed * direction;
      this.applyGravity();

      // 恶魔会不时蹦跳，逼玩家看准落点再踩
      if (this.etype === 'demon' && this.onGround) {
        this.hopT -= 1;
        if (this.hopT <= 0) {
          this.vy = -9.5;
          this.onGround = false;
          this.hopT = 70 + Math.floor(Math.random() * 60);
        }
      }

      this.moveAndCollide(tm);

      // 撞墙或超出巡逻范围时掉头
      if (this.vx === 0 || Math.abs(this.x - this.patrolStart) > this.patrolRange) {
        this.vx = -this.speed * direction;
      }

      this.animT += 0.1;
    }
  }

  // ─── 关卡生成器 ──────────────────────────────────────────
  // 80 个关卡全部由带种子的生成器产出：同一关号永远得到同一张地图。
  //
  // 去雷同靠三层保证：
  //   1. 七种关卡原型（平原/台阶/高塔/断桥/回廊/风井/浮岛）按世界轮换；
  //   2. 地图宽高、地形细节全部随种子变化；
  //   3. 生成后与已有关卡比对行模式指纹，过于相似就换种子重新生成。
  //
  // 可达性靠构造保证：每个原型输出一条「主路径」（落脚点序列），相邻
  // 落脚点的水平间距与落差始终满足跳跃约束（与 test.html 的 BFS 一致）：
  //   平地/下落：水平 ≤ 5 格；升 1 格：≤ 5 格；升 2 格：≤ 4 格；
  //   升 3 格：≤ 2 格；弹簧可升 8 格（水平 ≤ 3 格）；气流柱内自由爬升。
  // 橡果、钥匙、检查点全部挂在主路径节点上。
  const LEVEL_COUNT = 80;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 主路径跳跃约束（见顶部注释）；rise 为上升格数，gap 为水平间距
  function hopGapOK(rise, gap) {
    if (rise <= 1) return gap <= 5;
    if (rise === 2) return gap <= 4;
    if (rise === 3) return gap <= 2;
    return false;
  }

  const SOLID_TILES = ['#', '@', '=', '~', 'L'];
  // 弹簧正上方 rows 格内不能有实心地形，否则弹起来直接撞头。
  // （弹簧升限约 8 格，用户报障：L8/L9 弹簧被头顶地形堵死跳不上去）
  function shaftClear(g, x, y, rows) {
    for (let d = 1; d <= rows; d++) {
      if (SOLID_TILES.includes(g.get(x, y - d))) return false;
    }
    return true;
  }

  class LevelGrid {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.cells = Array.from({ length: h }, () => new Array(w).fill(' '));
    }
    get(x, y) {
      if (x < 0 || x >= this.w || y < 0 || y >= this.h) return '#';
      return this.cells[y][x];
    }
    set(x, y, ch) {
      if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
      this.cells[y][x] = ch;
    }
    fillRow(y, x0, x1, ch) { for (let x = x0; x <= x1; x++) this.set(x, y, ch); }
    fillCol(x, y0, y1, ch) { for (let y = y0; y <= y1; y++) this.set(x, y, ch); }
    // 一列实心地面：顶面草皮（或泥土），向下填砖
    ground(x, topY, topCh) {
      if (this.get(x, topY) === ' ') this.set(x, topY, topCh || '=');
      for (let y = topY + 1; y < this.h; y++) {
        if (this.get(x, y) === ' ') this.set(x, y, '#');
      }
    }
    // 一排浮空平台（只写空格，不覆盖已有内容）
    platform(x, y, len, ch) {
      for (let i = 0; i < len; i++) {
        if (this.get(x + i, y) === ' ') this.set(x + i, y, ch || '=');
      }
    }
    // 某列最上方可站立的行（第一个实心格上方），没有实心格返回 -1
    surfaceRow(x) {
      for (let y = 0; y < this.h; y++) {
        const c = this.get(x, y);
        if (c === '#' || c === '@' || c === '=' || c === '~') return y - 1;
      }
      return -1;
    }
    rows() { return this.cells.map((r) => r.join('')); }
  }

  // 生成上下文：原型往这里写地形、登记主路径节点
  class LevelContext {
    constructor(level, world, mech, params, g, rng) {
      this.level = level;
      this.world = world;
      this.mech = mech;
      this.params = params;
      this.g = g;
      this.rng = rng;
      this.nodes = [];           // 主路径落脚点 {x, y, wide, high}
      this.reserved = new Set(); // 已被机关占用的格子（'x,y'）
      this.springCells = [];     // 已放置弹簧的格子（垂直通道保护用）
      this.spikeSpots = [];      // 可以放尖刺的地面格
      this.features = { spring: 0, crumble: 0, keys: 0, wind: 0, saws: 0, spikes: 0 };
    }
    addNode(x, y, flags) {
      this.nodes.push(Object.assign({ x, y, wide: false, high: false }, flags));
    }
    reserve(x, y) { this.reserved.add(x + ',' + y); }
    isReserved(x, y) { return this.reserved.has(x + ',' + y); }
    // 铺一块平台（standY 为站立行，平台铺在站立行下方一格）
    addPlatform(x, standY, len, ch, flags) {
      this.g.platform(x, standY + 1, len, ch);
      for (let i = 0; i < len; i++) this.addNode(x + i, standY, flags);
      if (ch === '~') this.features.crumble++;
      return { x0: x, x1: x + len - 1, sy: standY };
    }
  }

  // 两个平台的最近水平间距（x 区间重叠时为 0）
  function platGap(a, b) {
    if (b.x0 > a.x1) return b.x0 - a.x1;
    if (a.x0 > b.x1) return a.x0 - b.x1;
    return 0;
  }

  // ── 难度参数：橡果与敌人逐关不减（test.html 有此断言）──
  function levelParams(level) {
    return {
      acorns: 6 + Math.floor((level - 1) / 3),               // 6 → 32
      enemies: 1 + Math.floor((level - 1) / 5),              // 1 → 16
      demonRatio: level < 12 ? 0 : Math.min(0.5, (level - 8) / 80),
      golden: level < 6 ? 0 : (level % 5 === 0 || level > 60 ? 2 : 1),
    };
  }

  // 机制解锁节奏：弹簧 L2、尖刺 L4、易碎 L5、钥匙门 L7、气流世界 4、锯轮 L33
  function mechanicsFor(level) {
    const world = Math.floor((level - 1) / 10) + 1;
    return {
      spring: level >= 2,
      spikes: level >= 4,
      crumble: level >= 5,
      keys: level >= 7,
      wind: world >= 4,
      saws: level >= 33,
    };
  }

  // ── 原型一：平原起伏 ── 地面高度连续变化，散布浮台
  function buildMeadowRun(ctx) {
    const { g, rng } = ctx;
    const gy = g.h - 3;
    let x = 0;
    let top = gy;
    while (x < g.w) {
      const segLen = Math.min(g.w - x, 4 + Math.floor(rng() * 6));
      const end = x + segLen;
      for (let i = x; i < end; i++) {
        g.ground(i, top);
        if (i % 3 === 0) ctx.addNode(i, top - 1, { wide: true });
        else ctx.spikeSpots.push({ x: i, y: top - 1 });
      }
      // 段内浮台（升 2~3 格，站在正下方即可跳上）
      if (rng() < 0.65 && segLen >= 5) {
        const plen = 2 + Math.floor(rng() * 3);
        const px = x + 1 + Math.floor(rng() * (segLen - plen - 1));
        const rise = 2 + Math.floor(rng() * 2);
        ctx.addPlatform(px, top - 1 - rise, plen, '=', { high: rise >= 3 });
      }
      x = end;
      const d = Math.floor(rng() * 5) - 2;                  // 相邻段落差 ≤ 2
      top = Math.max(gy - 2, Math.min(gy, top + d));
    }
  }

  // ── 原型二：台阶攀爬 ── 单向台阶链，到顶/到底后折返
  function buildTerraceClimb(ctx) {
    const { g, rng } = ctx;
    const gy = g.h - 3;
    let x = 0;
    let top = gy;
    let dir = rng() < 0.5 ? -1 : 1;                         // 1 = 上行，-1 = 下行
    while (x < g.w) {
      const segLen = Math.min(g.w - x, 3 + Math.floor(rng() * 5));
      const end = x + segLen;
      for (let i = x; i < end; i++) {
        g.ground(i, top);
        if (i > x && i < end - 1) ctx.spikeSpots.push({ x: i, y: top - 1 });
      }
      ctx.addNode(x, top - 1, { wide: segLen >= 4 });
      if (segLen >= 5) ctx.addNode(end - 1, top - 1, { wide: true, high: top < gy - 5 });
      x = end;
      if (x >= g.w) break;
      const d = 1 + Math.floor(rng() * 3);                  // 台阶落差 1~3
      let next = top - d * dir;
      if (next < gy - 9) { dir = -1; next = top + d; }      // 太高就折返向下
      if (next > gy) { dir = 1; next = top - d; }           // 落地就转向上
      top = next;
    }
  }

  // ── 原型三：垂直高塔 ── 底部地面，平台盘旋而上
  function buildTowerAscent(ctx) {
    const { g, rng } = ctx;
    const gy = g.h - 3;
    for (let i = 0; i < g.w; i++) g.ground(i, gy);
    for (let i = 0; i < g.w; i += 3) ctx.addNode(i, gy - 1, { wide: true });
    let prev = { x0: 1, x1: 4, sy: gy - 1 };
    let dir = 1;
    while (prev.sy > 5) {
      const cx = Math.round((prev.x0 + prev.x1) / 2);
      // 先确认弹簧放得下且上方 8 格净空，再按弹簧规则拔高（放不下就退回普通跳）
      let useSpring = ctx.mech.spring && rng() < 0.3 && prev.sy > 10;
      // 弹簧放朝向新平台一侧的边缘，保证从弹簧格起跳水平间距 ≤ 3
      const springX = dir > 0 ? prev.x1 : prev.x0;
      if (useSpring && (g.get(springX, prev.sy) !== ' ' || !shaftClear(g, springX, prev.sy, 8))) {
        useSpring = false;
      }
      const rise = useSpring ? 4 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 2);
      const len = 2 + Math.floor(rng() * 3);
      const sy = prev.sy - rise;
      if (sy < 3) break;
      // 弹簧跳的目标平台必须水平错开（gap 1~3）：盖住弹簧正上方会撞头
      let x0 = useSpring
        ? (dir > 0 ? prev.x1 + 1 + Math.floor(rng() * 2) : prev.x0 - len - Math.floor(rng() * 2))
        : cx + dir * (2 + Math.floor(rng() * 3)) - Math.floor(len / 2);
      x0 = Math.max(0, Math.min(g.w - len, x0));
      let next = { x0, x1: x0 + len - 1, sy };
      // 新平台也不能盖住任何已放置弹簧的垂直通道
      const blocksSpring = (p) => ctx.springCells.some(
        (sc) => sc.x >= p.x0 && sc.x <= p.x1 && sc.y - (p.sy + 1) >= 1 && sc.y - (p.sy + 1) <= 8);
      // 保证可达：超出跳跃约束就一格一格往回拉
      const reachable = (p) =>
        (useSpring ? (() => { const gap = platGap(prev, p); return rise <= 8 && gap >= 1 && gap <= 3; })()
                   : hopGapOK(rise, platGap(prev, p))) && !blocksSpring(p);
      let guard = 0;
      while (!reachable(next) && guard++ < g.w) {
        next.x0 += next.x0 > prev.x0 ? -1 : 1;
        next.x0 = Math.max(0, Math.min(g.w - len, next.x0));
        next.x1 = next.x0 + len - 1;
      }
      if (!reachable(next)) break;                          // 实在放不下就封顶
      if (useSpring) {
        g.set(springX, prev.sy, 'S');
        ctx.reserve(springX, prev.sy);
        ctx.springCells.push({ x: springX, y: prev.sy });
        ctx.features.spring++;
      }
      const ch = ctx.mech.crumble && rng() < 0.2 ? '~' : '=';
      prev = ctx.addPlatform(next.x0, sy, len, ch, { high: true });
      if (prev.x0 <= 1 || prev.x1 >= g.w - 2 || rng() < 0.25) dir = -dir;
    }
  }

  // ── 原型四：断桥峡谷 ── 地面缺口 + 易碎桥/浮桥
  function buildGapCrossing(ctx) {
    const { g, rng } = ctx;
    const gy = g.h - 3;
    let x = 0;
    while (x < g.w) {
      const segLen = Math.min(g.w - x, 6 + Math.floor(rng() * 8));
      const end = x + segLen;
      for (let i = x; i < end; i++) {
        g.ground(i, gy);
        if (i % 3 === 0) ctx.addNode(i, gy - 1, { wide: true });
        else ctx.spikeSpots.push({ x: i, y: gy - 1 });
      }
      ctx.addNode(end - 1, gy - 1, { wide: true });         // 缺口边缘必有落脚点
      x = end;
      if (x >= g.w) break;
      const gap = 3 + Math.floor(rng() * 2);                // 缺口 3~4 格
      if (x + gap >= g.w - 3) break;
      const kind = rng();
      if (ctx.mech.crumble && kind < 0.5) {
        ctx.addPlatform(x, gy - 1, gap, '~');               // 易碎桥：与站立面齐平
      } else if (kind < 0.8) {
        const rise = 1 + Math.floor(rng() * 2);             // 浮桥：缺口上方 1~2 格
        const blen = Math.max(2, gap - 1);
        const bx = x + Math.floor((gap - blen + 1) / 2);
        ctx.addPlatform(bx, gy - 1 - rise, blen, '=');
      }
      // else：纯跳跃缺口，3~4 格裸跳可过
      x += gap;
    }
  }

  // ── 原型五：双层回廊 ── 中层楼板 + 竖井楼梯；洞窟风格加厚楼板、加天花板
  function buildCorridorMaze(ctx) {
    const { g, rng } = ctx;
    const gy = g.h - 3;
    const cave = ctx.world === 6 || (ctx.world === 8 && rng() < 0.5);
    const topCh = cave ? '@' : '=';
    const wallCh = cave ? '@' : '#';
    for (let i = 0; i < g.w; i++) g.ground(i, gy, topCh);
    for (let i = 0; i < g.w; i += 3) ctx.addNode(i, gy - 1, { wide: true });
    if (cave) {
      g.fillRow(0, 0, g.w - 1, wallCh);
      g.fillRow(1, 0, g.w - 1, wallCh);
    }
    // 中层楼板：距地面 5~7 格
    const fy = gy - 5 - Math.floor(rng() * 3);
    // 上楼竖井 2~3 个，均匀分布
    const shaftCount = 2 + Math.floor(rng() * 2);
    const shafts = [];
    for (let s = 0; s < shaftCount; s++) {
      shafts.push(6 + Math.floor(((g.w - 12) * (s + 0.5)) / shaftCount + rng() * 4 - 2));
    }
    shafts.sort((a, b) => a - b);
    // 楼板在竖井处断开
    let segStart = 1;
    const spans = [];
    for (const sx of shafts) { spans.push([segStart, sx - 2]); segStart = sx + 2; }
    spans.push([segStart, g.w - 2]);
    for (const [a, b] of spans) {
      if (b < a) continue;
      for (let i = a; i <= b; i++) {
        if (g.get(i, fy) === ' ') g.set(i, fy, topCh);
        if (cave && g.get(i, fy + 1) === ' ') g.set(i, fy + 1, wallCh);
      }
      if (b - a >= 2) ctx.addNode(a + 1, fy - 1, { wide: b - a >= 4, high: true });
      if (b - a >= 5) ctx.addNode(b - 1, fy - 1, { wide: true, high: true });
    }
    // 竖井内的交错小平台，从地面爬到楼板
    for (const sx of shafts) {
      let sy = gy - 3;
      let side = rng() < 0.5 ? -1 : 1;
      while (sy > fy) {
        const px = Math.max(1, Math.min(g.w - 3, sx + side * 2 - 1));
        ctx.addPlatform(px, sy, 2, ctx.mech.crumble && rng() < 0.25 ? '~' : '=');
        sy -= 2;
        side = -side;
      }
    }
  }

  // ── 原型六：风井攀爬 ── 气流柱 + 柱顶探出平台
  function buildWindShaft(ctx) {
    const { g, rng } = ctx;
    const gy = g.h - 3;
    for (let i = 0; i < g.w; i++) g.ground(i, gy);
    for (let i = 0; i < g.w; i += 3) ctx.addNode(i, gy - 1, { wide: true });
    const count = 2 + Math.floor(rng() * 2) + (ctx.level > 60 ? 1 : 0);
    let x = 6 + Math.floor(rng() * 4);
    for (let s = 0; s < count && x < g.w - 6; s++) {
      const topW = 3 + Math.floor(rng() * Math.max(1, gy - 9)); // 柱顶行
      g.fillCol(x, topW, gy - 1, 'W');
      ctx.features.wind++;
      for (let y = topW; y <= gy - 1; y++) ctx.reserve(x, y);
      // 柱顶平台：紧贴柱顶左右探出 1~2 格（气流顶平移 1~2 格可落）
      const dir = rng() < 0.5 ? -1 : 1;
      const px = dir > 0 ? x + 1 : x - 2;
      const psy = topW + Math.floor(rng() * 2);
      ctx.addPlatform(Math.max(1, Math.min(g.w - 3, px)), psy, 2, '=', { high: true });
      // 偶尔在柱半腰再挂一块歇脚台
      if (rng() < 0.4 && gy - topW > 6) {
        const my = topW + 3 + Math.floor(rng() * (gy - topW - 5));
        const mx = Math.max(1, Math.min(g.w - 3, x + (dir > 0 ? -2 : 1)));
        ctx.addPlatform(mx, my, 2, ctx.mech.crumble && rng() < 0.4 ? '~' : '=');
      }
      x += 8 + Math.floor(rng() * 8);
    }
  }

  // ── 原型七：浮岛跳跃 ── 无通铺地面，岛链前进
  function buildIslandHop(ctx) {
    const { g, rng } = ctx;
    const gy = g.h - 3;
    // 起点先留一小块地面（终点地面等岛链铺完再接，保证最后一跳可达）
    for (let i = 0; i < 6; i++) g.ground(i, gy);
    ctx.addNode(2, gy - 1, { wide: true });
    let prev = { x0: 1, x1: 4, sy: gy - 1 };
    while (prev.x1 < g.w - 9) {
      // 先确认弹簧放得下，再决定按弹簧规则拔高（放不下就退回普通跳）；
      // 弹簧钉在岛链前进方向的边缘格，保证从弹簧格起跳水平间距 ≤ 3
      let springX = -1;
      if (ctx.mech.spring && rng() < 0.18 && rng() < 0.6) {
        if (g.get(prev.x1, prev.sy) === ' ' && shaftClear(g, prev.x1, prev.sy, 8)) {
          springX = prev.x1;
        }
      }
      const useSpring = springX >= 0;
      let rise;
      let sy;
      if (useSpring) {                                      // 弹簧岛：拔高 4~8
        rise = 4 + Math.floor(rng() * 5);
        sy = prev.sy - rise;
      } else {
        rise = Math.floor(rng() * 7) - 3;                   // 期望落差 -3~+3
        sy = prev.sy - rise;
      }
      sy = Math.max(3, Math.min(gy - 1, sy));
      rise = prev.sy - sy;                                  // 收编回实际落差
      // 水平间距按可达性收紧
      let maxGap = 5;
      if (useSpring) maxGap = 3;
      else while (maxGap > 2 && !hopGapOK(Math.max(0, rise), maxGap)) maxGap--;
      if (!useSpring && !hopGapOK(Math.max(0, rise), maxGap)) { sy = prev.sy; rise = 0; }
      const gap = 2 + Math.floor(rng() * Math.max(1, maxGap - 1));
      const len = 2 + Math.floor(rng() * 4);
      const x0 = prev.x1 + gap;
      if (x0 + len > g.w - 6) break;
      if (useSpring) {
        g.set(springX, prev.sy, 'S');
        ctx.reserve(springX, prev.sy);
        ctx.springCells.push({ x: springX, y: prev.sy });
        ctx.features.spring++;
      }
      const ch = ctx.mech.crumble && rng() < 0.3 ? '~' : '=';
      prev = ctx.addPlatform(x0, sy, len, ch, { wide: len >= 4, high: sy < gy - 6 });
    }
    // 终点地面贴着链尾铺（最远留 2 格间距），避免最后一跳够不着
    const endX = Math.min(g.w - 6, prev.x1 + 2);
    for (let i = endX; i < g.w; i++) g.ground(i, gy);
    ctx.addNode(endX + 2, gy - 1, { wide: true });
  }

  // 带藤蔓门的隔墙：门锁两格 + 上方两格砖，跳跃（最高 3 格）翻不过去；
  // 钥匙放在门左边的主路径节点上，保证先拿钥匙后到门。
  function addGateWalls(ctx) {
    const { g, rng } = ctx;
    const count = ctx.level > 40 && rng() < 0.5 ? 2 : 1;
    let minX = 10;
    for (let k = 0; k < count; k++) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const gx = minX + Math.floor(rng() * Math.max(1, g.w - minX - 8));
        const sy = g.surfaceRow(gx);
        if (sy < 5) continue;
        // 两侧地势要平，防止从侧面高地跳过墙顶
        if (g.surfaceRow(gx - 1) !== sy || g.surfaceRow(gx + 1) !== sy) continue;
        if (g.get(gx, sy) !== ' ' || g.get(gx, sy - 1) !== ' ') continue;
        const keyNodes = ctx.nodes.filter(
          (n) => n.x > minX - 8 && n.x < gx - 2 && n.y >= sy - 1 &&
                 g.get(n.x, n.y) === ' ' && !ctx.isReserved(n.x, n.y));
        if (!keyNodes.length) continue;
        const kn = keyNodes[Math.floor(rng() * keyNodes.length)];
        g.set(kn.x, kn.y, 'K');
        ctx.reserve(kn.x, kn.y);
        g.set(gx, sy, 'L');
        g.set(gx, sy - 1, 'L');
        g.set(gx, sy - 2, '#');
        g.set(gx, sy - 3, '#');
        for (let y = sy - 3; y <= sy; y++) ctx.reserve(gx, y);
        ctx.features.keys++;
        minX = gx + 10;
        break;
      }
    }
  }

  const ARCHETYPES = {
    meadowRun: buildMeadowRun,
    terraceClimb: buildTerraceClimb,
    towerAscent: buildTowerAscent,
    gapCrossing: buildGapCrossing,
    corridorMaze: buildCorridorMaze,
    windShaft: buildWindShaft,
    islandHop: buildIslandHop,
  };

  // 每个世界可选的原型池：前几个出现概率更高（重复项即权重）
  const WORLD_ARCHETYPES = [
    ['meadowRun', 'terraceClimb', 'meadowRun', 'gapCrossing'],              // 1-10 林间
    ['towerAscent', 'meadowRun', 'terraceClimb', 'towerAscent'],            // 11-20 弹簧高塔
    ['corridorMaze', 'gapCrossing', 'terraceClimb', 'corridorMaze'],        // 21-30 藤蔓迷径
    ['windShaft', 'gapCrossing', 'towerAscent', 'corridorMaze'],            // 31-40 风之峡谷
    ['corridorMaze', 'windShaft', 'towerAscent', 'gapCrossing', 'meadowRun'], // 41-50 黄金终局
    ['corridorMaze', 'towerAscent', 'gapCrossing', 'corridorMaze'],         // 51-60 暮色洞窟
    ['islandHop', 'windShaft', 'gapCrossing', 'islandHop'],                 // 61-70 云海之巅
    ['islandHop', 'corridorMaze', 'towerAscent', 'windShaft', 'gapCrossing'], // 71-80 星夜王庭
  ];

  // 地图尺寸：原型基准 + 随关卡缓慢增大
  function levelSize(level, arch, rng) {
    const grow = Math.min(20, Math.floor(level / 4));
    let w, h;
    switch (arch) {
      case 'towerAscent':  w = 40 + Math.floor(rng() * 10); h = 20 + Math.floor(rng() * 7); break;
      case 'windShaft':    w = 44 + grow + Math.floor(rng() * 8); h = 20 + Math.floor(rng() * 6); break;
      case 'corridorMaze': w = 52 + grow + Math.floor(rng() * 10); h = 18 + Math.floor(rng() * 5); break;
      case 'islandHop':    w = 60 + grow + Math.floor(rng() * 12); h = 18 + Math.floor(rng() * 6); break;
      case 'gapCrossing':  w = 56 + grow + Math.floor(rng() * 10); h = 17; break;
      case 'terraceClimb': w = 48 + grow + Math.floor(rng() * 10); h = 18 + Math.floor(rng() * 4); break;
      default:             w = 48 + grow + Math.floor(rng() * 10); h = 17 + (rng() < 0.3 ? 1 : 0); break;
    }
    return { w: Math.min(96, w), h: Math.min(26, h) };
  }

  // ── 实体填充：把橡果/敌人/检查点/机关铺到主路径上 ──
  function populate(ctx) {
    const { g, rng, params, nodes, level, mech } = ctx;
    const nodeCells = new Set(nodes.map((n) => n.x + ',' + n.y));
    const used = new Set(ctx.reserved);
    const cellKey = (x, y) => x + ',' + y;
    const freeCell = (x, y) => g.get(x, y) === ' ' && !used.has(cellKey(x, y));

    // 出生点：主路径最左端
    let start = nodes[0];
    for (const n of nodes) if (n.x < start.x) start = n;
    const px = g.surfaceRow(2) === start.y && freeCell(2, start.y) ? 2 : start.x;
    g.set(px, start.y, 'P');
    used.add(cellKey(px, start.y));

    // 弹簧彩蛋：弹簧 + 侧上方奖励平台（地面型关卡从中学会用弹簧）。
    // 弹簧正上方 8 格必须净空、奖励平台必须与弹簧列水平错开——
    // 否则弹起来直接撞平台底/地形，永远跳不上去（L8/L9 报障的 bug）。
    const bonusSprings = () => {
      if (!mech.spring || ctx.features.spring > 0) return;
      const spots = nodes.filter((n) => n.wide && n.x > 8 && n.x < g.w - 6 && n.y >= 9);
      const count = 1 + (rng() < 0.4 ? 1 : 0);
      for (let s = 0; s < count && spots.length; s++) {
        const n = spots.splice(Math.floor(rng() * spots.length), 1)[0];
        if (!freeCell(n.x, n.y) || !shaftClear(g, n.x, n.y, 8)) continue;
        const plen = 2 + Math.floor(rng() * 2);
        const dir = rng() < 0.5 ? -1 : 1;
        const rise = 6 + Math.floor(rng() * 2);             // 站立行抬升 6~7 格
        const standY = n.y - rise;
        if (standY < 2) continue;
        // 平台水平错开 2~3 格：直弹过顶后侧移即可落上去
        let bx = dir > 0 ? n.x + 2 : n.x - 2 - plen + 1;
        bx = Math.max(0, Math.min(g.w - plen, bx));
        if (bx <= n.x && n.x <= bx + plen - 1) continue;    // 不能盖住弹簧列
        let bad = false;
        for (let i = 0; i < plen; i++) {
          if (g.get(bx + i, standY + 1) !== ' ') bad = true;        // 平台行被占
          if (g.get(bx + i, standY) !== ' ') bad = true;            // 站立行被占
        }
        // 也不能盖住之前已放置弹簧的垂直通道
        for (const sc of ctx.springCells) {
          if (sc.x >= bx && sc.x <= bx + plen - 1 &&
              sc.y - (standY + 1) >= 1 && sc.y - (standY + 1) <= 8) bad = true;
        }
        if (bad) continue;
        g.set(n.x, n.y, 'S');
        used.add(cellKey(n.x, n.y));
        ctx.springCells.push({ x: n.x, y: n.y });
        ctx.features.spring++;
        ctx.addPlatform(bx, standY, plen, '=', { high: true });
      }
    };
    bonusSprings();

    // 检查点：沿主路径均匀分布（目标格被占就向后找最近的空节点）
    const cps = Math.min(4, Math.floor(nodes.length / 12));
    for (let i = 1; i <= cps; i++) {
      const idx = Math.floor((nodes.length * i) / (cps + 1));
      for (let step = 0; step < nodes.length; step++) {
        const n = nodes[(idx + step) % nodes.length];
        if (n && freeCell(n.x, n.y)) {
          g.set(n.x, n.y, 'C');
          used.add(cellKey(n.x, n.y));
          break;
        }
      }
    }

    // 敌人：放宽平台，避开出生区（先于橡果放置——敌人只能站节点格，
    // 橡果还能放头顶一格，后放不容易饿死数量）
    let e = 0;
    let guard = 0;
    const enemyPools = [
      nodes.filter((n) => n.wide && n.x > 8),
      nodes.filter((n) => n.x > 8),
    ];
    while (e < params.enemies && guard++ < 500) {
      const pool = enemyPools[e < enemyPools[0].length ? 0 : 1];
      if (!pool.length) break;
      const n = pool[Math.floor(rng() * pool.length)];
      if (!freeCell(n.x, n.y)) continue;
      g.set(n.x, n.y, rng() < params.demonRatio ? 'D' : 'E');
      used.add(cellKey(n.x, n.y));
      e++;
    }
    for (const n of nodes) {                                // 兜底一：放宽到出生区边缘
      if (e >= params.enemies) break;
      if (n.x <= 5 || !freeCell(n.x, n.y)) continue;
      g.set(n.x, n.y, rng() < params.demonRatio ? 'D' : 'E');
      used.add(cellKey(n.x, n.y));
      e++;
    }
    for (const n of nodes) {                                // 兜底二：节点头顶格（会落到平台上）
      if (e >= params.enemies) break;
      if (n.x <= 5 || !freeCell(n.x, n.y - 1)) continue;
      g.set(n.x, n.y - 1, rng() < params.demonRatio ? 'D' : 'E');
      used.add(cellKey(n.x, n.y - 1));
      e++;
    }

    // 橡果：沿主路径均布（节点格被占时放头顶一格，跳过即可吃到）
    let placed = 0;
    const putAcorn = (n, ch) => {
      for (const [ax, ay] of [[n.x, n.y], [n.x, n.y - 1]]) {
        if (freeCell(ax, ay)) {
          g.set(ax, ay, ch);
          used.add(cellKey(ax, ay));
          return true;
        }
      }
      return false;
    };
    const stride = Math.max(1, (nodes.length - 1) / params.acorns);
    for (let k = 0; k < params.acorns; k++) {
      const idx = Math.min(nodes.length - 1, Math.max(1, Math.round((k + 0.5) * stride + rng() * 2 - 1)));
      if (putAcorn(nodes[idx], 'A')) placed++;
    }
    for (const n of nodes) {                                // 兜底一：扫全部节点
      if (placed >= params.acorns) break;
      if (putAcorn(n, 'A')) placed++;
    }
    for (let y = 1; y < g.h - 1 && placed < params.acorns; y++) {   // 兜底二：任意可站立空格
      for (let x = 1; x < g.w - 1 && placed < params.acorns; x++) {
        if (freeCell(x, y) && g.surfaceRow(x) === y) {
          g.set(x, y, 'A');
          used.add(cellKey(x, y));
          placed++;
        }
      }
    }

    // 金橡果：只放高处平台，属于额外奖励
    const highs = nodes.filter((n) => n.high);
    for (let k = 0; k < params.golden && highs.length; k++) {
      putAcorn(highs[Math.floor(rng() * highs.length)], '*');
    }

    // 尖刺：只落在非主路径的地面格，跳一下就能跨过去。
    // 左右两格内必须都是同高的可站立地面——贴着缺口边缘的尖刺会把
    // 落点吃掉，等效加宽缺口导致跳不过去（BFS 测试就是这么抓到 L51 的）
    if (mech.spikes) {
      const want = 4 + Math.floor(level / 6);
      const clearAround = (sx2, sy2) => {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx !== 0 && g.surfaceRow(sx2 + dx) !== sy2) return false;
        }
        return true;
      };
      let s = 0;
      for (const spot of ctx.spikeSpots) {
        if (s >= want) break;
        if (rng() < 0.5) continue;
        if (!clearAround(spot.x, spot.y)) continue;
        if (nodeCells.has(cellKey(spot.x, spot.y)) || !freeCell(spot.x, spot.y)) continue;
        g.set(spot.x, spot.y, '^');
        used.add(cellKey(spot.x, spot.y));
        s++;
      }
      ctx.features.spikes = s;
    }

    // 锯轮：平地巡逻，避开出生点与检查点
    if (mech.saws) {
      const want = 1 + Math.floor(level / 25);
      let s = 0;
      let tries = 0;
      while (s < want && tries++ < 80) {
        const x = 10 + Math.floor(rng() * (g.w - 20));
        const sy = g.surfaceRow(x);
        if (sy < 3) continue;
        if (g.surfaceRow(x - 2) !== sy || g.surfaceRow(x + 2) !== sy) continue;
        if (!freeCell(x, sy)) continue;
        let nearSafe = true;                                // 巡逻半径内不能有 P/C
        for (let dx = -3; dx <= 3; dx++) {
          const c = g.get(x + dx, sy);
          if (c === 'P' || c === 'C') { nearSafe = false; break; }
        }
        if (!nearSafe) continue;
        g.set(x, sy, 'V');
        used.add(cellKey(x, sy));
        s++;
      }
      ctx.features.saws = s;
    }

    // 标志性机制兜底：第 4 关起每关至少有一种机关（test.html 有此断言）
    const f = ctx.features;
    if (level > 3 && !f.spring && !f.crumble && !f.keys && !f.wind && !f.saws && f.spikes < 4) {
      bonusSprings();
      if (!ctx.features.spring) {                           // 连弹簧都放不下就铺一排易碎平台
        const n = nodes[Math.floor(nodes.length / 2)];
        if (n && n.y >= 5) ctx.addPlatform(n.x, n.y - 4, 3, '~');
      }
    }
  }

  let lastArchetype = '';

  function generateLevel(level, seed) {
    const rng = mulberry32(seed);
    const world = Math.floor((level - 1) / 10) + 1;
    const mech = mechanicsFor(level);
    const params = levelParams(level);
    const pool = WORLD_ARCHETYPES[world - 1];
    let arch = level === 1 ? 'meadowRun' : pool[Math.floor(rng() * pool.length)];
    if (arch === lastArchetype) arch = pool[(pool.indexOf(arch) + 1) % pool.length];
    lastArchetype = arch;
    const size = level === 1 ? { w: 44, h: 17 } : levelSize(level, arch, rng);
    const g = new LevelGrid(size.w, size.h);
    const ctx = new LevelContext(level, world, mech, params, g, rng);
    ARCHETYPES[arch](ctx);
    if (mech.keys && arch !== 'towerAscent' && arch !== 'windShaft' && rng() < 0.6) {
      addGateWalls(ctx);
    }
    populate(ctx);
    return g.rows();
  }

  // ── 关卡缓存与防雷同 ──
  // 缓存的是字符行，loadLevel 每次返回全新的 TileMap：
  // 地图内部状态（易碎平台、门、橡果）不能被上一局污染。
  const rowCache = new Map();
  const fingerprints = [];

  // 行模式指纹：去掉行尾空格与整行同色的地面/砖行（它们天然相似）
  function rowFingerprint(rows) {
    const counts = new Map();
    for (const raw of rows) {
      const r = raw.replace(/\s+$/g, '');
      if (!r || /^(.)\1*$/.test(r)) continue;
      counts.set(r, (counts.get(r) || 0) + 1);
    }
    return counts;
  }

  function jaccardSim(a, b) {
    let inter = 0;
    let union = 0;
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(k) || 0;
      const y = b.get(k) || 0;
      inter += Math.min(x, y);
      union += Math.max(x, y);
    }
    return union === 0 ? 0 : inter / union;
  }

  function ensureRows(n) {
    if (rowCache.has(n)) return;
    if (n > 1) ensureRows(n - 1);
    let rows = null;
    let fp = null;
    // 与已有关卡两两比对，相似度超标就换种子重来（确定性搜索）
    for (let attempt = 0; attempt < 20; attempt++) {
      const seed = (Math.imul(n, 2654435761) + attempt * 97) >>> 0;
      rows = generateLevel(n, seed);
      fp = rowFingerprint(rows);
      let tooSimilar = false;
      for (const prev of fingerprints) {
        if (jaccardSim(fp, prev) > 0.45) { tooSimilar = true; break; }
      }
      if (!tooSimilar) break;
    }
    fingerprints.push(fp);
    rowCache.set(n, rows);
  }

  function loadLevel(levelNum) {
    const n = Math.max(1, Math.min(LEVEL_COUNT, (levelNum | 0) || 1));
    ensureRows(n);
    return new TileMap(rowCache.get(n).slice());
  }

  // 80 个关卡名，每 10 关一个世界主题，全部唯一
  const LEVEL_NAMES = [
    // 1-10 林间
    '林间启程', '晨露草地', '苔藓小径', '微风山坡', '松鼠跳台',
    '断木桥', '落花浅谷', '荆棘篱口', '青苔石滩', '古树入口',
    // 11-20 弹簧高塔
    '弹簧乐园', '双塔练习场', '云端阶梯', '弹跳回廊', '高塔阴影',
    '空中花园', '弹性断层', '风铃塔', '弹簧迷宫', '云端高塔',
    // 21-30 藤蔓迷径
    '森林深处', '藤蔓迷径', '钥匙与锁', '双生藤门', '树冠回廊',
    '荆棘长廊', '苔壁迷宫', '缠绕之径', '古藤高墙', '密林之门',
    // 31-40 风之峡谷
    '风口初见', '风之竖井', '落日风道', '高空索道', '风眼',
    '尖刺峡谷', '断崖气流', '月影峡谷', '风暴边缘', '峡谷尽头',
    // 41-50 黄金终局
    '黄金树冠', '金叶之路', '树冠迷宫', '流光回廊', '黄金试炼',
    '王冠阶梯', '日冕高塔', '群星树梢', '最后的钥匙', '松鼠之王',
    // 51-60 暮色洞窟
    '洞口微光', '滴水石厅', '暗影回廊', '塌方栈道', '晶簇洞窟',
    '地下暗河', '石窟迷阵', '深岩断桥', '萤光洞穴', '地心之门',
    // 61-70 云海之巅
    '云上初岛', '浮岛链', '云端裂隙', '风暴浮桥', '失重花园',
    '云海阶梯', '孤岛回环', '气流群岛', '天穹断桥', '云巅平台',
    // 71-80 星夜王庭
    '星门前哨', '夜幕回廊', '流星峡谷', '王庭外环', '暗影试炼',
    '星辉高塔', '午夜迷宫', '王座阶梯', '群星之巅', '松鼠传说',
  ];

  // ─── 游戏会话 ───────────────────────────────────────────
  // 负责规则、计分、关卡流程，不关心如何渲染。
  // 所有表现层事件通过 events 队列交给渲染器。
  class GameSession {
    constructor() {
      this.maxLevel = LEVEL_COUNT;
      this.state = GameState.MENU;
      this.level = 1;
      this.score = 0;
      this.events = [];
      this.combo = 0;
      this.comboT = 0;
      this._buildLevel();
    }

    get levelName() {
      return LEVEL_NAMES[this.level - 1] || '';
    }

    _buildLevel() {
      this.tilemap = loadLevel(this.level);
      const spawn = this.tilemap.playerSpawn;
      this.player = new Player(spawn.x, spawn.y);
      this.enemies = this.tilemap.enemySpawns.map((s) => new Enemy(s.x, s.y, s.type));
      this.acorns = this.tilemap.acorns.slice();
      this.goldenAcorns = this.tilemap.goldenAcorns.slice();
      this.springs = this.tilemap.springs;
      this.hazards = this.tilemap.hazards;
      this.keys = this.tilemap.keys.map((k) => ({ x: k.x, y: k.y, collected: false }));
      this.saws = this.tilemap.saws;
      this.checkpoints = this.tilemap.checkpoints.map((c) => ({ x: c.x, y: c.y, active: false }));
      this.respawnPoint = { x: spawn.x, y: spawn.y };
      this.combo = 0;
      this.comboT = 0;
      this.cleared = false;
      this.frameCount = 0;
    }

    // ── 事件 ──
    emit(evt) { this.events.push(evt); }
    takeEvents() {
      const out = this.events;
      this.events = [];
      return out;
    }
    sound(name) { this.emit({ type: 'sound', name }); }
    burst(x, y, color, count) { this.emit({ type: 'burst', x, y, color, count }); }
    floatText(x, y, text, color) { this.emit({ type: 'text', x, y, text, color }); }
    shake(amount) { this.emit({ type: 'shake', amount }); }

    _setState(state) {
      if (this.state === state) return;
      this.state = state;
      this.emit({ type: 'state', state });
    }

    // ── 流程控制 ──
    start(level) {
      const startLevel = Math.max(1, Math.min(this.maxLevel, level || 1));
      this.level = startLevel;
      this.score = 0;
      this._buildLevel();
      this._setState(GameState.PLAYING);
      this.emit({ type: 'level_start', level: this.level });
    }

    restart() {
      this.start(this.level);
    }

    toMenu() {
      this.level = 1;
      this.score = 0;
      this._buildLevel();
      this._setState(GameState.MENU);
    }

    pause() {
      if (this.state === GameState.PLAYING) this._setState(GameState.PAUSED);
    }

    resume() {
      if (this.state === GameState.PAUSED) this._setState(GameState.PLAYING);
    }

    nextLevel() {
      if (this.state !== GameState.LEVEL_CLEAR) return;
      this.level += 1;
      if (this.level > this.maxLevel) {
        this._setState(GameState.VICTORY);
        return;
      }
      this._buildLevel();
      this._setState(GameState.PLAYING);
      this.emit({ type: 'level_start', level: this.level });
    }

    // 结算页“主按钮”：过关进入下一关，失败/通关则重开
    primaryAction() {
      if (this.state === GameState.LEVEL_CLEAR) this.nextLevel();
      else if (this.state === GameState.GAME_OVER) this.restart();
      else if (this.state === GameState.VICTORY) this.start(1);
    }

    acornsCollected() {
      let n = 0;
      for (const a of this.acorns) if (a.collected) n++;
      return n;
    }

    goldenCollected() {
      let n = 0;
      for (const a of this.goldenAcorns) if (a.collected) n++;
      return n;
    }

    // 连续击败敌人会累积连击倍率（最多 5 倍），120 帧内没有新击杀则清零。
    _registerKill(base, x, y, color) {
      this.combo = Math.min(5, this.combo + 1);
      this.comboT = 120;
      const points = base * this.combo;
      this.score += points;
      const label = this.combo > 1 ? `+${points} ×${this.combo}` : `+${points}`;
      this.floatText(x, y, label, color);
      return points;
    }

    _respawnPlayer() {
      const p = this.player;
      p.x = this.respawnPoint.x;
      p.y = this.respawnPoint.y;
      p.vx = 0;
      p.vy = 0;
      p.onGround = false;
    }

    _hurtByHazard() {
      const p = this.player;
      if (p.invincible > 0) return;
      if (!p.die()) return;
      this.combo = 0;
      this.comboT = 0;
      if (!p.dead) this._respawnPlayer();
    }

    // ── 每帧更新（固定 60Hz 调用）──
    update(input) {
      if (this.state !== GameState.PLAYING) return;
      const p = this.player;
      const tm = this.tilemap;
      const livesBefore = p.lives;
      this.frameCount++;

      p.update(input, tm);
      if (p.didJump) this.sound('jump');
      tm.updateCrumbles(p);

      // 钥匙：集齐后打开所有藤蔓门
      for (const k of (this.keys || [])) {
        if (k.collected) continue;
        if (p.rect.colliderect(new Rect(k.x + 4, k.y + 4, TILE - 8, TILE - 8))) {
          k.collected = true;
          this.burst(k.x + TILE / 2, k.y + TILE / 2, '#ffd76a', 14);
          this.sound('key');
          if (this.keys.every((key) => key.collected)) {
            tm.gateOpen = true;
            this.floatText(k.x, k.y - 8, '大门打开！', '#9ff0c0');
            this.shake(5);
            this.sound('gate');
          } else {
            this.floatText(k.x, k.y - 8, '钥匙 +1', '#ffd76a');
          }
        }
      }

      // 掉出地图：扣命并回到最近的检查点
      if (p.y > tm.h * TILE + 100) {
        const lost = p.die();
        if (lost) {
          this.combo = 0;
          this.comboT = 0;
        }
        if (!p.dead) this._respawnPlayer();
      }

      // 锯轮：沿横/纵方向来回巡逻
      for (const s of (this.saws || [])) {
        s.t += s.speed;
        const off = Math.sin(s.t) * s.range;
        s.curX = s.baseX + (s.axis === 'x' ? off : 0);
        s.curY = s.baseY + (s.axis === 'y' ? off : 0);
        if (p.dead || p.invincible > 0) continue;
        const sr = new Rect(s.curX + 7, s.curY + 7, TILE - 14, TILE - 14);
        if (p.rect.colliderect(sr)) {
          this.burst(s.curX + TILE / 2, s.curY + TILE / 2, '#ff6b5e', 10);
          this._hurtByHazard();
        }
      }

      // 尖刺：碰到就受伤，并从检查点重新出发
      if (!p.dead) {
        for (const h of this.hazards) {
          const hr = new Rect(h.x + 4, h.y + 18, TILE - 8, TILE - 18);
          if (p.rect.colliderect(hr)) {
            this.burst(h.x + TILE / 2, h.y + TILE - 6, '#ff6b5e', 8);
            this._hurtByHazard();
            break;
          }
        }
      }

      // 检查点：触碰后成为新的复活位置
      if (!p.dead) {
        for (const c of this.checkpoints) {
          if (c.active) continue;
          if (p.rect.colliderect(new Rect(c.x, c.y, TILE, TILE))) {
            c.active = true;
            this.respawnPoint = { x: c.x, y: c.y };
            this.burst(c.x + TILE / 2, c.y + 8, '#7ef0b0', 12);
            this.floatText(c.x, c.y - 6, '检查点', '#7ef0b0');
            this.sound('checkpoint');
          }
        }
      }

      if (this.comboT > 0) {
        this.comboT -= 1;
        if (this.comboT === 0) this.combo = 0;
      }

      this._updateHeldItem();

      // 弹簧
      for (const s of this.springs) {
        s.update();
        if (p.rect.colliderect(s.rect) && p.vy >= 0) {
          p.vy = -22;
          s.activate();
          this.burst(s.x + TILE / 2, s.y + TILE - 6, '#ffc832', 6);
          this.sound('spring');
        }
      }

      // 敌人
      const snapshot = this.enemies.slice();
      for (const e of snapshot) {
        if (!this.enemies.includes(e)) continue;
        e.update(tm);

        // 投掷中的敌人撞到其他敌人 → 连锁消灭
        if (e.thrown) {
          for (const other of this.enemies.slice()) {
            if (other === e || !this.enemies.includes(other)) continue;
            if (other.rect.colliderect(e.rect)) {
              this._removeEnemy(other);
              this._registerKill(200, other.x, other.y, '#ff9632');
              this.burst(other.x + 16, other.y + 17, '#ff6432', 12);
              this.sound('stomp');
              this.shake(4);
            }
          }
        }

        // 与玩家碰撞（自己投出的敌人飞行途中不会伤到自己）
        if (!e.thrown && e.rect.colliderect(p.rect)) {
          if (p.vy > 0 && p.rect.bottom - e.rect.top < 20) {
            // 踩敌人
            this._removeEnemy(e);
            p.vy = -12;
            this._registerKill(100, e.x, e.y, '#ffdc50');
            this.burst(e.x + 16, e.y + 17, '#ffc832', 15);
            this.sound('stomp');
            this.shake(3);
          } else {
            p.die();
          }
        }

        // 掉出地图的敌人直接移除
        if (e.y > tm.h * TILE + 240) this._removeEnemy(e);
      }

      // 橡果收集
      for (const acorn of this.acorns) {
        if (!acorn.collected && acorn.rect.colliderect(p.rect)) {
          acorn.collected = true;
          this.score += acorn.value;
          this.burst(acorn.x + 20, acorn.y + 20, '#d4af37', 10);
          this.floatText(acorn.x, acorn.y, `+${acorn.value}`, '#d4af37');
          this.sound('acorn');
          this.shake(1.5);
        }
      }

      // 金橡果：可选奖励，不计入过关条件
      for (const acorn of this.goldenAcorns) {
        if (!acorn.collected && acorn.rect.colliderect(p.rect)) {
          acorn.collected = true;
          this.score += acorn.value;
          this.burst(acorn.x + 20, acorn.y + 20, '#ffe680', 20);
          this.floatText(acorn.x, acorn.y - 4, `金橡果 +${acorn.value}`, '#ffe680');
          this.sound('golden');
          this.shake(3);
        }
      }

      // 检查关卡通关
      if (!this.cleared && this.acorns.every((a) => a.collected)) {
        this.cleared = true;
        const bonus = Math.max(0, p.lives) * 500;
        this.score += bonus;
        if (this.level >= this.maxLevel) {
          this._setState(GameState.VICTORY);
          this.sound('victory');
        } else {
          this._setState(GameState.LEVEL_CLEAR);
          this.sound('clear');
        }
        this.emit({ type: 'level_clear', bonus });
      }

      // 检查死亡
      if (p.dead && this.state === GameState.PLAYING) {
        this._setState(GameState.GAME_OVER);
      }

      if (p.lives < livesBefore) {
        this.combo = 0;
        this.comboT = 0;
        this.shake(9);
        this.sound(p.dead ? 'gameover' : 'hurt');
      }
    }

    _removeEnemy(e) {
      const i = this.enemies.indexOf(e);
      if (i >= 0) this.enemies.splice(i, 1);
    }

    _updateHeldItem() {
      const item = this.player.holdingItem;
      if (!item) return;
      item.vx = 0;
      item.vy = 0;
      item.thrown = false;
      item.x = this.player.x + (this.player.w - item.w) / 2;
      item.y = this.player.y - item.h - 2;
    }

    // 举起 / 投掷（触屏按键或键盘 F）
    action() {
      if (this.state !== GameState.PLAYING) return false;
      const p = this.player;

      if (p.holdingItem) {
        const item = p.throwHeld(this.enemies);
        if (item) {
          this.sound('throw');
          this.burst(item.x + 16, item.y + 17, '#ffffff', 5);
          return true;
        }
        return false;
      }

      const item = p.pickUp(this.enemies);
      if (item) {
        this.burst(item.x + 16, item.y + 17, '#c8c8c8', 8);
        this.sound('pickup');
        return true;
      }
      return false;
    }
  }

  const Engine = {
    TILE,
    FPS,
    GRAVITY,
    MAX_FALL,
    PLAYER_SPEED,
    PLAYER_JUMP,
    ENEMY_SPEED,
    GameState,
    Rect,
    TileMap,
    Entity,
    Player,
    Acorn,
    Spring,
    Enemy,
    GameSession,
    loadLevel,
    LEVEL_COUNT,
    LEVEL_NAMES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  root.SquirrelEngine = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
