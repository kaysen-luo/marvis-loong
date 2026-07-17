/* MVS-007 Phaser 3 白模 v0.1.7-landscape-v2 · LANDSCAPE PREVIEW v2
 *
 * 灰度目标（K师 07-17 拍板）：不是坐标翻转，是真正横屏 UX 重做。
 * 竖屏基线：public/mvs-007/game.js v0.1.8 (v0.1.5 线上版逻辑一行不动)
 * 手感/机制/数值：fireRate 260 / bulletSpeed 600 / speed 240 / AUTO_FIRE_RANGE 500 /
 *                 iFrame 300ms / pushable false / sampleStick 动态摇杆 /
 *                 拖尾 / 白光闪 / 15 粒粒子 / 卡池 10 张 —— 全部保留
 *
 * v2 UX 改动（仅 UI 层）：
 *   · Canvas 1080×1920 → 1920×1080
 *   · 摇杆：左下拇指自然区 (200+safeLeft, H-200)，基座半径 200→140，摇杆头 45→30，
 *          默认 alpha 0.5、touch 0.9，动态摇杆响应区限左下 1/3 屏
 *   · HUD 四角布局：
 *       左上：血量条 180×20 + 等级章圆 40 + XP 副条
 *       右上：击杀 36px + 时间 20px
 *       正上中央：Boss 血条 1000×24（本 v2 没 Boss 隐藏、不占位）
 *       右下：脉冲主动按钮 R=90（触感 120×120）+ CD
 *   · 升级面板：卡片横排 3 张，320×460，间距 60，居中在 1920 中间
 *   · 结算面板：左侧数据 40% / 中间 20% 留白 / 右侧按钮 40%
 *   · Safe area：iOS 灵动岛/Home Indicator 兜底 env(safe-area-inset-*) 通过 CSS var 读入
 *   · 首帧动画：摇杆基座脉冲提示 scale 1.0→1.15→1.0 (600ms)
 *
 * 10 卡：加速射击 穿透弹 爆裂弹 暴击强化 环绕光刃 定时地雷 无人机僚机 强化装甲 急促脚步 吸血涂层
 */
(function () {
'use strict';
const W = 1920, H = 1080;
const TOTAL_SEC = 600;
const AUTO_FIRE_RANGE = 500;

// safe-area 读 CSS var（CSS 像素）→ 按 Phaser FIT scale 换算成 game 内部坐标
// Phaser FIT 会等比缩放，CSS 一个 inset px = (W / canvas.clientWidth) 个 Phaser px
function getSafeArea(scene) {
  try {
    const cs = getComputedStyle(document.documentElement);
    const parse = (v) => parseInt(v, 10) || 0;
    let sx = 1, sy = 1;
    if (scene && scene.scale) {
      const dw = scene.scale.displaySize && scene.scale.displaySize.width;
      const dh = scene.scale.displaySize && scene.scale.displaySize.height;
      if (dw > 0) sx = W / dw;
      if (dh > 0) sy = H / dh;
    }
    // FIT 是等比，取较大者更保守（让开更多）
    const s = Math.max(sx, sy);
    return {
      top:    Math.round(parse(cs.getPropertyValue('--sa-top'))    * s),
      right:  Math.round(parse(cs.getPropertyValue('--sa-right'))  * s),
      bottom: Math.round(parse(cs.getPropertyValue('--sa-bottom')) * s),
      left:   Math.round(parse(cs.getPropertyValue('--sa-left'))   * s),
    };
  } catch (e) { return { top: 0, right: 0, bottom: 0, left: 0 }; }
}

const COLORS = {
  player: 0xffffff, bullet: 0x88ddff,
  crawler: 0xff4444, rusher: 0xff9933, spitter: 0xaa66ff,
  hpFull: 0x33ff66, hpMid: 0xffcc33, hpLow: 0xff3333,
  energy: 0x66ff99,
};

function xpFor(level) { return 20 + (level - 1) * 10; }

function freshState() {
  return {
    hpMax: 100, hp: 100, speed: 240,
    fireRate: 260, bulletDmg: 10, bulletSpeed: 600,
    pierce: 0, explosive: false, critChance: 0, critMult: 3,
    pulseCd: 8000, pulseReady: 0,
    level: 1, xp: 0, xpToNext: xpFor(1), kills: 0, startTime: 0,
    hasOrbit: false, hasMines: false, hasDrone: false,
    lifesteal: 0, cards: [],
    paused: false, ended: false,
    rusherUnlocked: false, spitterUnlocked: false,
    crawlerDense: false, rusherDense: false,
  };
}
let state = freshState();

const CARDS = [
  { id: 'fastFire',  name: '加速射击',   desc: '射速 +50%',                              apply: (s)=>{ s.fireRate = Math.max(80, Math.round(s.fireRate * 0.66)); } },
  { id: 'pierce',    name: '穿透弹',     desc: '子弹穿透第 1 个敌人后继续飞',            apply: (s)=>{ s.pierce = Math.max(1, s.pierce + 1); }, once: true },
  { id: 'explosive', name: '爆裂弹',     desc: '子弹击中触发小爆炸(半径 60,伤 8)',       apply: (s)=>{ s.explosive = true; }, once: true },
  { id: 'crit',      name: '暴击强化',   desc: '20% 概率暴击,伤害 3x',                   apply: (s)=>{ s.critChance = Math.min(0.6, s.critChance + 0.2); } },
  { id: 'orbit',     name: '环绕光刃',   desc: '3 把光刃绕玩家旋转,接触 15 伤/秒',       apply: (s)=>{ s.hasOrbit = true; }, once: true },
  { id: 'mines',     name: '定时地雷',   desc: '每 3 秒在脚下放雷,3 秒后爆(半径 80,30 伤)', apply: (s)=>{ s.hasMines = true; }, once: true },
  { id: 'drone',     name: '无人机僚机', desc: '召唤 1 台自动射击的小无人机',            apply: (s)=>{ s.hasDrone = true; }, once: true },
  { id: 'armor',     name: '强化装甲',   desc: '血量上限 +50(同时补满当前血)',           apply: (s)=>{ s.hpMax += 50; s.hp = s.hpMax; } },
  { id: 'boots',     name: '急促脚步',   desc: '移速 +20%',                              apply: (s)=>{ s.speed *= 1.2; } },
  { id: 'lifesteal', name: '吸血涂层',   desc: '击杀敌人回 2 血',                        apply: (s)=>{ s.lifesteal += 2; } },
];

function pick3(s) {
  const pool = CARDS.filter(c => !(c.once && s.cards.includes(c.id)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(3, pool.length));
}

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    state = freshState();
    state.startTime = this.time.now;
    state.pulseReady = this.time.now;

    this.safeArea = getSafeArea(this);
    // 兜底最小 inset（部分老 iOS 或非灵动岛机型 env 值可能为 0 但顶栏还在）
    // 值以 Phaser 内部坐标（1920×1080）为准
    this.safeArea.top    = Math.max(this.safeArea.top,    40);
    this.safeArea.right  = Math.max(this.safeArea.right,  20);
    this.safeArea.bottom = Math.max(this.safeArea.bottom, 20);
    this.safeArea.left   = Math.max(this.safeArea.left,   20);
    // 监听 resize（Safari chrome 收起/展开会触发）
    this.scale.on('resize', () => {
      const sa = getSafeArea(this);
      this.safeArea.top    = Math.max(sa.top,    40);
      this.safeArea.right  = Math.max(sa.right,  20);
      this.safeArea.bottom = Math.max(sa.bottom, 20);
      this.safeArea.left   = Math.max(sa.left,   20);
      if (this.relayoutHud) this.relayoutHud();
    });

    const g = this.add.graphics();
    g.lineStyle(1, 0x0f1a1a, 1);
    for (let x = 0; x < W; x += 80) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = 0; y < H; y += 80) { g.moveTo(0, y); g.lineTo(W, y); }
    g.strokePath();

    this.trailGfx = this.add.graphics().setDepth(5);
    this.trail = [];

    this.rangeRingGfx = this.add.graphics().setDepth(4);

    this.player = this.add.circle(W / 2, H / 2, 15, COLORS.player);
    this.physics.add.existing(this.player);
    this.player.body.setCircle(15);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.pushable = false;
    this.player.iFrameUntil = 0;

    // === Trooper 泽丽化：充能计数 + 视觉光环 ===
    this.trooperBurstCharge = 0;
    this.TROOPER_BURST_THRESHOLD = 3;
    this.trooperChargeRing = this.add.circle(this.player.x, this.player.y, 22, 0x00ffff, 0).setStrokeStyle(2, 0x66ffff, 0).setDepth(6);

    this.hpBarBg = this.add.rectangle(0, 0, 60, 6, 0x333333).setOrigin(0.5).setDepth(50);
    this.hpBar   = this.add.rectangle(0, 0, 60, 6, COLORS.hpFull).setOrigin(0, 0.5).setDepth(51);

    this.bullets      = this.physics.add.group();
    this.enemies      = this.physics.add.group();
    this.eProjs       = this.physics.add.group();
    this.mines        = this.physics.add.group();
    this.orbitBlades  = [];
    this.drones       = this.physics.add.group();
    this.droneBullets = this.physics.add.group();

    this.physics.add.overlap(this.bullets,      this.enemies, this.bulletHit,        null, this);
    this.physics.add.overlap(this.droneBullets, this.enemies, this.bulletHit,        null, this);
    this.physics.add.overlap(this.player,       this.enemies, this.playerTouchEnemy, null, this);
    this.physics.add.overlap(this.player,       this.eProjs,  this.playerHitByProj,  null, this);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D');
    this.setupTouch();

    // 键盘 F 键也可 toggleFullscreen（桂面调试方便）
    // 主入口在 index.html 的 #fs-btn，此处提供键盘快捷兼向 game.js 暴露
    this.input.keyboard.on('keydown-F', () => this.toggleFullscreen());

    this.time.addEvent({ delay: 100,  loop: true, callback: this.tryFire,      callbackScope: this });
    this.time.addEvent({ delay: 1200, loop: true, callback: this.spawnCrawler, callbackScope: this });
    this.time.addEvent({ delay: 5000, loop: true, callback: this.spawnRusher,  callbackScope: this });
    this.time.addEvent({ delay: 7000, loop: true, callback: this.spawnSpitter, callbackScope: this });
    this.time.addEvent({ delay: 1500, loop: true, callback: this.spitterFire,  callbackScope: this });
    this.time.addEvent({ delay: 3000, loop: true, callback: this.dropMine,     callbackScope: this });
    this.time.addEvent({ delay: 500,  loop: true, callback: this.droneFire,    callbackScope: this });

    for (let i = 0; i < 5; i++) this.spawnCrawler();

    this.buildUI();
    this.cameras.main.setBackgroundColor('#000000');
    this.orbitAngle = 0;

    // 首帧摇杆基座脉冲提示（600ms scale 1→1.15→1）
    this.tweens.add({
      targets: this.stickBase,
      scale: { from: 1, to: 1.15 },
      duration: 300, yoyo: true, ease: 'Sine.Out',
    });
  }

  setupTouch() {
    // 横屏 v2：左下角拇指自然区
    // 基座半径 200→140 摇杆头 45→30 默认 alpha 0.5 touch 0.9
    const STICK_BASE_R = 140;
    const STICK_KNOB_R = 30;
    // 摇杆默认位：底部也让开 safe area
    const BASE_X = 200 + this.safeArea.left;
    const BASE_Y = H - 200 - this.safeArea.bottom;
    this.stickBaseHome = { x: BASE_X, y: BASE_Y };
    this.stickMaxR = 90;
    this.stick = { active: false, cx: BASE_X, cy: BASE_Y, dx: 0, dy: 0, pointer: null };
    this.stickBase = this.add.circle(BASE_X, BASE_Y, STICK_BASE_R, 0xffffff, 0.08).setDepth(150).setAlpha(0.5);
    this.stickKnob = this.add.circle(BASE_X, BASE_Y, STICK_KNOB_R, 0xffffff, 0.35).setDepth(151).setAlpha(0.5);

    // 右下脉冲主动按钮 R=90（safe area 让开右侧+底部 Home Indicator）
    const btnR = 90;
    const bx = W - 160 - this.safeArea.right;
    const by = H - 160 - this.safeArea.bottom;
    this.pulseBtnR = btnR; this.pulseBtnX = bx; this.pulseBtnY = by;
    this.pulseBtn = this.add.circle(bx, by, btnR, 0x66ff99, 0.28)
      .setDepth(150).setStrokeStyle(4, 0x66ff99, 0.9);
    this.pulseLabel = this.add.text(bx, by - 6, '脉冲', {
      fontFamily: 'sans-serif', fontSize: '32px', color: '#eaffea', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(151);
    this.pulseCdLabel = this.add.text(bx, by + 28, '', {
      fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff'
    }).setOrigin(0.5).setDepth(151);

    // 摇杆响应区：左下 1/3（x < W/2 && y > H/3）
    const inStickZone = (px, py) => px < W / 2 && py > H / 3;

    this.input.on('pointerdown', (p) => {
      if (state.paused || state.ended) return;
      // 用当前脉冲按钮位置（relayout 后可能已变）
      const pbx = this.pulseBtnX, pby = this.pulseBtnY, pbr = this.pulseBtnR;
      const dxb = p.x - pbx, dyb = p.y - pby;
      if (dxb * dxb + dyb * dyb <= pbr * pbr) { this.tryPulse(); return; }
      if (inStickZone(p.x, p.y)) {
        this.stickBaseHome.x = p.x;
        this.stickBaseHome.y = p.y;
        this.stick.active = true;
        this.stick.pointer = p;
        this.stick.cx = this.stickBaseHome.x;
        this.stick.cy = this.stickBaseHome.y;
        let dx = p.x - this.stick.cx, dy = p.y - this.stick.cy;
        const max = this.stickMaxR;
        const len = Math.hypot(dx, dy);
        if (len > max * 1.5) {
          const shift = len - max;
          this.stick.cx += dx / len * shift;
          this.stick.cy += dy / len * shift;
          dx = p.x - this.stick.cx; dy = p.y - this.stick.cy;
        }
        let ndx = dx, ndy = dy;
        const nlen = Math.hypot(ndx, ndy);
        if (nlen > max) { ndx = ndx * max / nlen; ndy = ndy * max / nlen; }
        this.stick.dx = ndx / max;
        this.stick.dy = ndy / max;
        this.stickBase.setPosition(this.stick.cx, this.stick.cy).setAlpha(0.9);
        this.stickKnob.setPosition(this.stick.cx + ndx, this.stick.cy + ndy).setAlpha(0.9);
      }
    });
    const endStick = (p) => {
      if (this.stick.pointer && p.id !== this.stick.pointer.id) return;
      this.stick.active = false;
      this.stick.dx = 0; this.stick.dy = 0;
      this.stick.pointer = null;
      this.tweens.add({
        targets: [this.stickBase, this.stickKnob], alpha: 0.5, duration: 200,
      });
      this.stickBase.setPosition(this.stickBaseHome.x, this.stickBaseHome.y);
      this.stickKnob.setPosition(this.stickBaseHome.x, this.stickBaseHome.y);
    };
    this.input.on('pointerup', endStick);
    this.input.on('pointerupoutside', endStick);
    this.input.on('pointercancel', endStick);
  }

  sampleStick() {
    if (!this.stick.active || !this.stick.pointer) return;
    const p = this.stick.pointer;
    if (!p.isDown) { this.stick.dx = 0; this.stick.dy = 0; return; }
    const max = this.stickMaxR;
    let dx = p.x - this.stick.cx, dy = p.y - this.stick.cy;
    let len = Math.hypot(dx, dy);
    if (len > max * 1.5) {
      const shift = len - max;
      this.stick.cx += dx / len * shift;
      this.stick.cy += dy / len * shift;
      this.stickBase.setPosition(this.stick.cx, this.stick.cy);
      dx = p.x - this.stick.cx; dy = p.y - this.stick.cy;
      len = Math.hypot(dx, dy);
    }
    if (len < 8) { this.stick.dx = 0; this.stick.dy = 0; this.stickKnob.setPosition(this.stick.cx, this.stick.cy); return; }
    let kdx = dx, kdy = dy;
    if (len > max) { kdx = dx * max / len; kdy = dy * max / len; }
    this.stick.dx = kdx / max;
    this.stick.dy = kdy / max;
    this.stickKnob.setPosition(this.stick.cx + kdx, this.stick.cy + kdy);
  }

  buildUI() {
    // 横屏 v2 HUD 分四角
    const topY = 30 + this.safeArea.top;
    const leftX = 30 + this.safeArea.left;
    const rightX = W - 30 - this.safeArea.right;

    // 左上：血量条 180×20 + 等级章圆 40 + XP 副条
    this.topHpBarBg = this.add.rectangle(leftX + 50, topY + 8, 180, 20, 0x222222, 0.75)
      .setOrigin(0, 0).setStrokeStyle(2, 0x333333, 1).setDepth(200);
    this.topHpBar = this.add.rectangle(leftX + 52, topY + 10, 176, 16, COLORS.hpFull)
      .setOrigin(0, 0).setDepth(201);
    this.topHpText = this.add.text(leftX + 140, topY + 18, '100/100', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(202);
    this.lvBadge = this.add.circle(leftX + 20, topY + 18, 20, 0x114422, 0.85)
      .setStrokeStyle(2, 0x88ffcc, 0.95).setDepth(200);
    this.lvLabel = this.add.text(leftX + 20, topY + 18, '1', {
      fontFamily: 'sans-serif', fontSize: '20px', color: '#88ffcc', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(201);
    this.xpBarBg = this.add.rectangle(leftX + 50, topY + 34, 180, 4, 0x222222, 0.75)
      .setOrigin(0, 0).setDepth(200);
    this.xpBar = this.add.rectangle(leftX + 50, topY + 34, 0, 4, 0x88ffcc)
      .setOrigin(0, 0).setDepth(201);

    // 右上：击杀 + 时间
    this.killLabel = this.add.text(rightX, topY, '0', {
      fontFamily: 'sans-serif', fontSize: '36px', color: '#ffcc66', fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(200);
    this.killTag = this.add.text(rightX - 60, topY + 14, '击杀', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#ffcc66',
    }).setOrigin(1, 0).setDepth(200);
    this.timeLabel = this.add.text(rightX, topY + 44, '10:00', {
      fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff',
    }).setOrigin(1, 0).setDepth(200);

    // 正上中央：Boss 血条占位（本 v2 没 Boss 隐藏）
    this.bossBarBg = this.add.rectangle(W / 2, topY + 12, 1000, 24, 0x330000, 0.8)
      .setStrokeStyle(2, 0xff5555, 0.9).setDepth(200).setVisible(false);
    this.bossBar = this.add.rectangle(W / 2 - 500, topY + 12, 1000, 20, 0xff3333)
      .setOrigin(0, 0.5).setDepth(201).setVisible(false);

    // wave 提示
    this.waveLabel = this.add.text(W / 2, H / 2 - 200, '', {
      fontFamily: 'sans-serif', fontSize: '48px', color: '#ffcc66', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(300).setAlpha(0);
  }

  // 重新排 HUD/摇杆/脉冲按钮（safe-area 变化 / Safari chrome 收起 / 全屏切换时调）
  // 全屏切换（内部包装，兼容 iOS Safari webkitRequestFullscreen 前缀）
  // 与 index.html 的 #fs-btn 共享逻辑：同时尝试标准 requestFullscreen
  // 和 webkit 前缀（iOS Safari canvas 仅对 <video> 真支持,fallback 靠 DOM 层）
  toggleFullscreen() {
    try {
      const el = document.documentElement;
      const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (active) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
      }
      if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* silent */ }
  }

  relayoutHud() {
    const sa = this.safeArea;
    const topY = 30 + sa.top;
    const leftX = 30 + sa.left;
    const rightX = W - 30 - sa.right;
    // 左上
    if (this.topHpBarBg) {
      this.topHpBarBg.setPosition(leftX + 50, topY + 8);
      this.topHpBar.setPosition(leftX + 52, topY + 10);
      this.topHpText.setPosition(leftX + 140, topY + 18);
      this.lvBadge.setPosition(leftX + 20, topY + 18);
      this.lvLabel.setPosition(leftX + 20, topY + 18);
      this.xpBarBg.setPosition(leftX + 50, topY + 34);
      this.xpBar.setPosition(leftX + 50, topY + 34);
    }
    // 右上
    if (this.killLabel) {
      this.killLabel.setPosition(rightX, topY);
      this.killTag.setPosition(rightX - 60, topY + 14);
      this.timeLabel.setPosition(rightX, topY + 44);
    }
    // Boss 坐标
    if (this.bossBarBg) {
      this.bossBarBg.setPosition(W / 2, topY + 12);
      this.bossBar.setPosition(W / 2 - 500, topY + 12);
    }
    // 脉冲按钮
    if (this.pulseBtn) {
      const bx = W - 160 - sa.right;
      const by = H - 160 - sa.bottom;
      this.pulseBtnX = bx; this.pulseBtnY = by;
      this.pulseBtn.setPosition(bx, by);
      this.pulseLabel.setPosition(bx, by - 6);
      this.pulseCdLabel.setPosition(bx, by + 28);
    }
    // 摇杆默认位
    if (this.stickBase && !this.stick.active) {
      const bx2 = 200 + sa.left;
      const by2 = H - 200 - sa.bottom;
      this.stickBaseHome.x = bx2;
      this.stickBaseHome.y = by2;
      this.stick.cx = bx2; this.stick.cy = by2;
      this.stickBase.setPosition(bx2, by2);
      this.stickKnob.setPosition(bx2, by2);
    }
  }

  showWave(text) {
    this.waveLabel.setText(text).setAlpha(0).setScale(0.7);
    this.tweens.add({
      targets: this.waveLabel, alpha: 1, scale: 1, duration: 300, ease: 'Back.Out',
      onComplete: () => {
        this.tweens.add({ targets: this.waveLabel, alpha: 0, duration: 500, delay: 1200 });
      },
    });
  }

  update(time, delta) {
    if (state.paused || state.ended) return;

    this.sampleStick();

    const elapsed = time - state.startTime;
    if (!state.rusherUnlocked   && elapsed >= 180000) { state.rusherUnlocked  = true; this.showWave('Rusher 加入'); }
    if (!state.spitterUnlocked  && elapsed >= 300000) { state.spitterUnlocked = true; this.showWave('Spitter 加入'); }
    if (!state.crawlerDense     && elapsed >= 450000) { state.crawlerDense    = true; this.showWave('Crawler 密度翻倍'); }
    if (!state.rusherDense      && elapsed >= 540000) { state.rusherDense     = true; this.showWave('Rusher 密度翻倍'); }

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown  || this.keys.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) vx += 1;
    if (this.cursors.up.isDown    || this.keys.W.isDown) vy -= 1;
    if (this.cursors.down.isDown  || this.keys.S.isDown) vy += 1;
    if (this.stick.active) { vx = this.stick.dx; vy = this.stick.dy; }
    const mag = Math.hypot(vx, vy);
    if (mag > 1) { vx /= mag; vy /= mag; }
    this.player.body.setVelocity(vx * state.speed, vy * state.speed);

    this.trail.push({ x: this.player.x, y: this.player.y });
    if (this.trail.length > 8) this.trail.shift();
    this.trailGfx.clear();
    for (let i = 0; i < this.trail.length; i++) {
      const alpha = (i + 1) / this.trail.length * 0.32;
      const r = 5 + i * 1.1;
      this.trailGfx.fillStyle(0xffffff, alpha);
      this.trailGfx.fillCircle(this.trail[i].x, this.trail[i].y, r);
    }

    this.rangeRingGfx.clear();
    this.rangeRingGfx.lineStyle(2, 0x64c8ff, 0.15);
    const rrCx = this.player.x, rrCy = this.player.y, rrR = AUTO_FIRE_RANGE;
    const dashCount = 48;
    const dashArc = (Math.PI * 2) / dashCount;
    for (let i = 0; i < dashCount; i += 2) {
      const a0 = i * dashArc;
      const a1 = a0 + dashArc;
      this.rangeRingGfx.beginPath();
      this.rangeRingGfx.arc(rrCx, rrCy, rrR, a0, a1, false);
      this.rangeRingGfx.strokePath();
    }

    this.hpBarBg.setPosition(this.player.x, this.player.y - 32);
    this.hpBar.setPosition(this.player.x - 30, this.player.y - 32);
    // 充能光环跟随玩家，强度按 charge 阶递增（0/1/2/3 → alpha 0 / 0.35 / 0.6 / 0.9，满值时脉冲）
    if (this.trooperChargeRing) {
      this.trooperChargeRing.setPosition(this.player.x, this.player.y);
      const c = this.trooperBurstCharge;
      const baseAlpha = [0, 0.35, 0.6, 0.9][Math.min(c, 3)];
      if (c >= this.TROOPER_BURST_THRESHOLD) {
        const pulse = 0.7 + 0.3 * Math.sin(this.time.now / 90);
        this.trooperChargeRing.setStrokeStyle(3, 0xffffff, baseAlpha * pulse);
        this.trooperChargeRing.setScale(1 + 0.15 * pulse);
      } else {
        this.trooperChargeRing.setStrokeStyle(2, 0x66ffff, baseAlpha);
        this.trooperChargeRing.setScale(1);
      }
    }
    const hpPct = Math.max(0, state.hp / state.hpMax);
    this.hpBar.width = 60 * hpPct;
    this.hpBar.fillColor = hpPct > 0.6 ? COLORS.hpFull : hpPct > 0.3 ? COLORS.hpMid : COLORS.hpLow;

    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const dx = this.player.x - e.x, dy = this.player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.body.setVelocity(dx / d * e.spd, dy / d * e.spd);
    });

    this.eProjs.getChildren().forEach(p => {
      if (p.x < -80 || p.x > W + 80 || p.y < -80 || p.y > H + 80) p.destroy();
    });
    const rangeSq = AUTO_FIRE_RANGE * AUTO_FIRE_RANGE;
    this.bullets.getChildren().forEach(b => {
      if (b.x < -80 || b.x > W + 80 || b.y < -80 || b.y > H + 80) { b.destroy(); return; }
      if (b.spawnX !== undefined) {
        const dx = b.x - b.spawnX, dy = b.y - b.spawnY;
        if (dx * dx + dy * dy >= rangeSq) b.destroy();
      }
    });
    this.droneBullets.getChildren().forEach(b => {
      if (b.x < -80 || b.x > W + 80 || b.y < -80 || b.y > H + 80) { b.destroy(); return; }
      if (b.spawnX !== undefined) {
        const dx = b.x - b.spawnX, dy = b.y - b.spawnY;
        if (dx * dx + dy * dy >= rangeSq) b.destroy();
      }
    });

    if (state.hasOrbit) this.updateOrbits(delta);
    if (state.hasDrone) this.updateDrones(delta);

    this.updateUI(time);
  }

  updateUI(time) {
    const totalMs = TOTAL_SEC * 1000;
    const left = Math.max(0, totalMs - (time - state.startTime));
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    this.timeLabel.setText(mm + ':' + ss.toString().padStart(2, '0'));
    this.killLabel.setText(String(state.kills));
    this.lvLabel.setText(String(state.level));

    const hpPct = Math.max(0, state.hp / state.hpMax);
    this.topHpBar.width = 176 * hpPct;
    this.topHpBar.fillColor = hpPct > 0.6 ? COLORS.hpFull : hpPct > 0.3 ? COLORS.hpMid : COLORS.hpLow;
    this.topHpText.setText(Math.max(0, Math.ceil(state.hp)) + '/' + state.hpMax);
    this.xpBar.width = 180 * Math.min(1, state.xp / state.xpToNext);

    const cdLeft = state.pulseReady - time;
    if (cdLeft > 0) {
      this.pulseBtn.setFillStyle(0x666666, 0.2);
      this.pulseBtn.setStrokeStyle(4, 0x666666, 0.6);
      this.pulseLabel.setColor('#888888');
      this.pulseCdLabel.setText(Math.ceil(cdLeft / 1000) + 's');
    } else {
      this.pulseBtn.setFillStyle(0x66ff99, 0.28);
      this.pulseBtn.setStrokeStyle(4, 0x66ff99, 0.95);
      this.pulseLabel.setColor('#eaffea');
      this.pulseCdLabel.setText('');
    }

    if (left <= 0 && !state.ended) this.endGame('time');
  }

  tryFire() {
    if (state.paused || state.ended) return;
    if (!this._lastFire) this._lastFire = 0;
    const t = this.time.now;
    if (t - this._lastFire < state.fireRate) return;
    const target = this.nearestEnemy(this.player.x, this.player.y);
    if (!target) return;
    this._lastFire = t;

    // === Trooper 泽丽化：3 蓄 5 散 ±15° × 0.6 ===
    if (this.trooperBurstCharge >= this.TROOPER_BURST_THRESHOLD) {
      // 爆发：5 颗散射，±15° 扇形，等角度分布
      const px = this.player.x, py = this.player.y;
      const centerAngle = Math.atan2(target.y - py, target.x - px);
      const spreadAngles = [-15, -7.5, 0, 7.5, 15];
      const burstDmg = state.bulletDmg * 0.6;
      spreadAngles.forEach(deltaDeg => {
        const rad = centerAngle + Phaser.Math.DegToRad(deltaDeg);
        this.fireBulletAtAngle(px, py, rad, burstDmg, state.pierce, state.explosive, this.bullets, state.bulletSpeed, true);
      });
      this.trooperBurstCharge = 0;
      // 爆发 VFX：白光闪 + 小屏震（不晕眩）
      this.cameras.main.shake(100, 0.005);
      const flash = this.add.circle(this.player.x, this.player.y, 40, 0xffffff, 0.85).setDepth(60);
      this.tweens.add({ targets: flash, alpha: 0, scale: 1.8, duration: 180, onComplete: () => flash.destroy() });
    } else {
      // 普攻：1 颗对准目标
      this.fireBulletFrom(this.player.x, this.player.y, target, state.bulletDmg, state.pierce, state.explosive, this.bullets, state.bulletSpeed);
      this.trooperBurstCharge++;
    }
  }

  fireBulletFrom(x, y, target, dmg, pierce, explosive, group, spd) {
    const b = this.add.circle(x, y, 6, COLORS.bullet);
    this.physics.add.existing(b);
    group.add(b);
    const dx = target.x - x, dy = target.y - y;
    const d = Math.hypot(dx, dy) || 1;
    b.body.setVelocity(dx / d * spd, dy / d * spd);
    b.dmg = dmg;
    b.pierce = pierce;
    b.explosive = explosive;
    b.hitSet = new Set();
    b.spawnX = x;
    b.spawnY = y;
  }

  // 按角度发射（爆发弹专用）：更亮的青白色 + 白色描边 + 半径 8
  fireBulletAtAngle(x, y, rad, dmg, pierce, explosive, group, spd, isBurst) {
    const color = isBurst ? 0xccffff : COLORS.bullet;
    const radius = isBurst ? 8 : 6;
    const b = this.add.circle(x, y, radius, color);
    if (isBurst) b.setStrokeStyle(2, 0xffffff, 1);
    this.physics.add.existing(b);
    group.add(b);
    b.body.setVelocity(Math.cos(rad) * spd, Math.sin(rad) * spd);
    b.dmg = dmg;
    b.pierce = pierce;
    b.explosive = explosive;
    b.hitSet = new Set();
    b.spawnX = x;
    b.spawnY = y;
    b.isBurst = !!isBurst;
  }

  nearestEnemy(x, y, maxRange) {
    if (maxRange === undefined) maxRange = Infinity;
    let best = null, bestD = Infinity;
    const maxD2 = maxRange === Infinity ? Infinity : maxRange * maxRange;
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const dx = e.x - x, dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d > maxD2) return;
      if (d < bestD) { bestD = d; best = e; }
    });
    return best;
  }

  randomSpawnPos() {
    const side = Phaser.Math.Between(0, 3);
    const pad = 80;
    if (side === 0) return { x: Phaser.Math.Between(0, W), y: -pad };
    if (side === 1) return { x: W + pad, y: Phaser.Math.Between(0, H) };
    if (side === 2) return { x: Phaser.Math.Between(0, W), y: H + pad };
    return { x: -pad, y: Phaser.Math.Between(0, H) };
  }

  spawnCrawler() {
    if (state.paused || state.ended) return;
    const elapsed = this.time.now - state.startTime;
    let wave = Math.min(4, 1 + Math.floor(elapsed / 120000));
    if (state.crawlerDense) wave *= 2;
    for (let i = 0; i < wave; i++) {
      const p = this.randomSpawnPos();
      const e = this.add.circle(p.x, p.y, 12, COLORS.crawler);
      this.physics.add.existing(e);
      this.enemies.add(e);
      e.type = 'Crawler'; e.hp = 10; e.spd = 80; e.dmg = 5; e.xp = 5;
      e.body.setCircle(12);
    }
  }

  spawnRusher() {
    if (state.paused || state.ended || !state.rusherUnlocked) return;
    const base = Phaser.Math.Between(1, 2);
    const num = state.rusherDense ? base * 2 : base;
    for (let i = 0; i < num; i++) {
      const p = this.randomSpawnPos();
      const tri = this.add.triangle(p.x, p.y, 0, -18, 16, 14, -16, 14, COLORS.rusher);
      this.physics.add.existing(tri);
      tri.body.setSize(32, 32);
      this.enemies.add(tri);
      tri.type = 'Rusher'; tri.hp = 30; tri.spd = 220; tri.dmg = 15; tri.xp = 15;
    }
  }

  spawnSpitter() {
    if (state.paused || state.ended || !state.spitterUnlocked) return;
    const p = this.randomSpawnPos();
    const sq = this.add.rectangle(p.x, p.y, 22, 22, COLORS.spitter);
    this.physics.add.existing(sq);
    sq.body.setSize(22, 22);
    this.enemies.add(sq);
    sq.type = 'Spitter'; sq.hp = 50; sq.spd = 60; sq.dmg = 20; sq.xp = 30;
  }

  spitterFire() {
    if (state.paused || state.ended) return;
    this.enemies.getChildren().forEach(e => {
      if (e.type !== 'Spitter' || !e.active) return;
      const dx = this.player.x - e.x, dy = this.player.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 900 || d < 1) return;
      const proj = this.add.circle(e.x, e.y, 8, COLORS.spitter);
      this.physics.add.existing(proj);
      this.eProjs.add(proj);
      proj.body.setCircle(8);
      proj.body.setVelocity(dx / d * 260, dy / d * 260);
      proj.dmg = 20;
    });
  }

  bulletHit(bullet, enemy) {
    if (!bullet.active || !enemy.active) return;
    if (bullet.hitSet && bullet.hitSet.has(enemy)) return;
    let dmg = bullet.dmg;
    let isCrit = false;
    if (state.critChance > 0 && Math.random() < state.critChance) { dmg *= state.critMult; isCrit = true; }
    this.damageEnemy(enemy, dmg, isCrit);
    if (bullet.explosive) this.explosion(bullet.x, bullet.y, 60, 8);
    if (bullet.pierce && bullet.pierce > 0) {
      bullet.pierce -= 1;
      if (bullet.hitSet) bullet.hitSet.add(enemy);
    } else {
      bullet.destroy();
    }
  }

  playerTouchEnemy(player, enemy) {
    if (!enemy.active || state.ended) return;
    const t = this.time.now;
    if (t < player.iFrameUntil) return;
    player.iFrameUntil = t + 300;
    this.hurtPlayer(enemy.dmg || 5);
    if (enemy.type === 'Rusher') this.damageEnemy(enemy, 999, false);
  }

  playerHitByProj(player, proj) {
    if (!proj.active || state.ended) return;
    this.hurtPlayer(proj.dmg || 10);
    proj.destroy();
  }

  hurtPlayer(dmg) {
    state.hp -= dmg;
    this.cameras.main.shake(100, 0.01);
    this.player.setFillStyle(0xff3333);
    this.time.delayedCall(200, () => { if (this.player.active) this.player.setFillStyle(COLORS.player); });
    if (state.hp <= 0 && !state.ended) this.endGame('dead');
  }

  damageEnemy(enemy, dmg, isCrit) {
    if (!enemy.active) return;
    enemy.hp -= dmg;
    const oc = enemy.fillColor;
    if (enemy.setFillStyle) {
      enemy.setFillStyle(0xffffff);
      this.time.delayedCall(60, () => { if (enemy.active && enemy.setFillStyle) enemy.setFillStyle(oc); });
    }
    this.spawnDmgNum(enemy.x, enemy.y - 20, Math.round(dmg), isCrit);
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  killEnemy(enemy) {
    const flash = this.add.circle(enemy.x, enemy.y, 24, 0xffffff, 0.9).setDepth(70);
    this.tweens.add({
      targets: flash, alpha: 0, scale: 2.4, duration: 120,
      onComplete: () => flash.destroy(),
    });
    this.spawnBoom(enemy.x, enemy.y, 0xffff88);
    state.kills += 1;
    state.xp += enemy.xp || 5;
    if (state.lifesteal > 0) {
      state.hp = Math.min(state.hpMax, state.hp + state.lifesteal);
    }
    enemy.destroy();
    while (state.xp >= state.xpToNext) {
      state.xp -= state.xpToNext;
      state.level += 1;
      state.xpToNext = xpFor(state.level);
      this.openLevelUp();
    }
  }

  spawnDmgNum(x, y, val, isCrit) {
    const color = isCrit ? '#ffee55' : '#ffffff';
    const size = isCrit ? '48px' : '28px';
    const t = this.add.text(x, y, String(val), {
      fontFamily: 'sans-serif', fontSize: size, color: color, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: isCrit ? 4 : 2,
    }).setOrigin(0.5).setDepth(80);
    this.tweens.add({
      targets: t, y: y - (isCrit ? 60 : 40), alpha: 0, duration: isCrit ? 650 : 500,
      onComplete: () => t.destroy(),
    });
  }

  spawnBoom(x, y, color) {
    for (let i = 0; i < 15; i++) {
      const p = this.add.circle(x, y, 3, color);
      const ang = Math.random() * Math.PI * 2;
      const spd = 80 + Math.random() * 100;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * spd,
        y: y + Math.sin(ang) * spd,
        alpha: 0, duration: 350,
        onComplete: () => p.destroy(),
      });
    }
  }

  explosion(x, y, radius, dmg) {
    const c = this.add.circle(x, y, radius, 0xffcc66, 0.35).setDepth(30);
    this.tweens.add({
      targets: c, alpha: 0, scale: 1.6, duration: 260,
      onComplete: () => c.destroy(),
    });
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= radius * radius) this.damageEnemy(e, dmg, false);
    });
  }

  tryPulse() {
    const t = this.time.now;
    if (t < state.pulseReady) return;
    state.pulseReady = t + state.pulseCd;
    const cx = this.player.x, cy = this.player.y;
    const ring = this.add.circle(cx, cy, 30, 0xffffff, 0.55).setDepth(60);
    this.tweens.add({
      targets: ring, radius: 260, alpha: 0, scale: 8, duration: 320,
      onComplete: () => ring.destroy(),
    });
    this.cameras.main.shake(160, 0.012);
    this.cameras.main.flash(120, 255, 255, 255);
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const dx = e.x - cx, dy = e.y - cy;
      if (dx * dx + dy * dy <= 200 * 200) this.damageEnemy(e, 50, false);
    });
  }

  updateOrbits(delta) {
    if (this.orbitBlades.length === 0) {
      for (let i = 0; i < 3; i++) {
        const blade = this.add.rectangle(0, 0, 18, 32, 0x88ffff, 0.9).setDepth(40).setStrokeStyle(2, 0xffffff, 1);
        this.orbitBlades.push({ obj: blade, offset: (i / 3) * Math.PI * 2, lastHit: new Map() });
      }
    }
    this.orbitAngle += delta * 0.004;
    const radius = 100;
    const now = this.time.now;
    this.orbitBlades.forEach(b => {
      const a = this.orbitAngle + b.offset;
      b.obj.setPosition(this.player.x + Math.cos(a) * radius, this.player.y + Math.sin(a) * radius);
      b.obj.setRotation(a + Math.PI / 2);
      this.enemies.getChildren().forEach(e => {
        if (!e.active) return;
        const dx = e.x - b.obj.x, dy = e.y - b.obj.y;
        if (dx * dx + dy * dy <= 26 * 26) {
          const last = b.lastHit.get(e) || 0;
          if (now - last >= 1000) {
            b.lastHit.set(e, now);
            this.damageEnemy(e, 15, false);
          }
        }
      });
    });
  }

  dropMine() {
    if (state.paused || state.ended || !state.hasMines) return;
    const mx = this.player.x, my = this.player.y;
    const m = this.add.circle(mx, my, 12, 0xffaa33, 0.85).setStrokeStyle(2, 0xff6600, 1).setDepth(20);
    this.physics.add.existing(m);
    this.mines.add(m);
    this.tweens.add({
      targets: m, alpha: 0.3, duration: 300, yoyo: true, repeat: 4,
    });
    this.time.delayedCall(3000, () => {
      if (!m.active) return;
      this.explosion(m.x, m.y, 80, 30);
      m.destroy();
    });
  }

  updateDrones(delta) {
    if (this.drones.getChildren().length === 0) {
      const d = this.add.circle(this.player.x + 60, this.player.y, 8, 0x66ddff).setStrokeStyle(2, 0xffffff, 1).setDepth(35);
      this.physics.add.existing(d);
      this.drones.add(d);
      d.orbitAng = 0;
    }
    this.drones.getChildren().forEach(d => {
      d.orbitAng += delta * 0.002;
      const rr = 70;
      const tx = this.player.x + Math.cos(d.orbitAng) * rr;
      const ty = this.player.y + Math.sin(d.orbitAng) * rr;
      d.x += (tx - d.x) * 0.1;
      d.y += (ty - d.y) * 0.1;
    });
  }

  droneFire() {
    if (state.paused || state.ended || !state.hasDrone) return;
    this.drones.getChildren().forEach(d => {
      const target = this.nearestEnemy(d.x, d.y);
      if (!target) return;
      this.fireBulletFrom(d.x, d.y, target, 8, 0, false, this.droneBullets, 380);
    });
  }

  // ---- 升级面板 · 横屏 v2 ----
  // 卡片横排 3 张：320 x 460，间距 60，居中在 1920 中间（左右各 420px 边距）
  // 卡内：图标（96px 圆）+ 名称（32px）+ 描述（20px 4-5 行）
  openLevelUp() {
    if (state.paused || state.ended) return;
    state.paused = true;
    this.physics.world.pause();
    const cards = pick3(state);

    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.75).setDepth(500);
    const title = this.add.text(W / 2, 100, 'Lv ' + state.level + '  ·  选一张升级', {
      fontFamily: 'sans-serif', fontSize: '40px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(501);

    const cardW = 320, cardH = 460, gap = 60;
    const totalW = cards.length * cardW + (cards.length - 1) * gap;
    const startX = (W - totalW) / 2 + cardW / 2;
    const cy = H / 2 + 20;

    const uiObjs = [overlay, title];
    cards.forEach((c, i) => {
      const cx = startX + i * (cardW + gap);
      // 阴影层（视觉浮起，阴影 0 20px 40px rgba(0,212,255,0.15) 的等效）
      const shadow = this.add.rectangle(cx + 3, cy + 14, cardW, cardH, 0x000000, 0.55).setDepth(500);
      const glow   = this.add.rectangle(cx, cy + 4, cardW + 20, cardH + 20, 0x00d4ff, 0.06).setDepth(500);
      // 卡片主体
      const bg = this.add.rectangle(cx, cy, cardW, cardH, 0x0f1a24, 0.98)
        .setStrokeStyle(3, 0x00d4ff, 0.85).setDepth(501)
        .setInteractive({ useHandCursor: true });
      // 图标区（占卡片上部 1/3）
      const iconBg = this.add.circle(cx, cy - cardH / 2 + 100, 48, 0x00d4ff, 0.18)
        .setStrokeStyle(2, 0x00d4ff, 0.75).setDepth(502);
      const icon = this.add.text(cx, cy - cardH / 2 + 100, (c.name || '?').charAt(0), {
        fontFamily: 'sans-serif', fontSize: '48px', color: '#eaffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(503);
      // 名称
      const name = this.add.text(cx, cy - cardH / 2 + 200, c.name, {
        fontFamily: 'sans-serif', fontSize: '32px', color: '#eaffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(502);
      // 分隔线
      const sep = this.add.rectangle(cx, cy - cardH / 2 + 235, cardW - 60, 2, 0x00d4ff, 0.35).setDepth(502);
      // 描述
      const desc = this.add.text(cx, cy - cardH / 2 + 320, c.desc, {
        fontFamily: 'sans-serif', fontSize: '20px', color: '#c8dbe4',
        wordWrap: { width: cardW - 50 }, align: 'center', lineSpacing: 8,
      }).setOrigin(0.5, 0.5).setDepth(502);

      // hover 视觉
      bg.on('pointerover', () => {
        bg.setStrokeStyle(4, 0x88ffff, 1);
        this.tweens.add({ targets: [bg, iconBg, icon, name, sep, desc, glow], scale: 1.03, duration: 120 });
      });
      bg.on('pointerout', () => {
        bg.setStrokeStyle(3, 0x00d4ff, 0.85);
        this.tweens.add({ targets: [bg, iconBg, icon, name, sep, desc, glow], scale: 1.0, duration: 120 });
      });
      bg.on('pointerdown', () => this.pickCard(c, uiObjs));
      uiObjs.push(shadow, glow, bg, iconBg, icon, name, sep, desc);
    });
  }

  pickCard(card, ui) {
    card.apply(state);
    state.cards.push(card.id);
    ui.forEach(o => o.destroy());
    state.paused = false;
    this.physics.world.resume();
  }

  // ---- 结算 · 横屏 v2 左右分栏 ----
  // 全屏暗化背景 / 左 40% 数据 / 中 20% 留白 / 右 40% 按钮
  endGame(reason) {
    if (state.ended) return;
    state.ended = true;
    state.paused = true;
    this.physics.world.pause();

    const elapsed = Math.min(TOTAL_SEC, Math.floor((this.time.now - state.startTime) / 1000));
    const mm = Math.floor(elapsed / 60);
    const ss = elapsed % 60;
    const timeStr = mm + ':' + ss.toString().padStart(2, '0');
    const survived = reason === 'time';

    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.88).setDepth(600);

    // 左栏：数据（40%，center x 约 W*0.25）
    const leftCx = W * 0.25;
    const title = this.add.text(leftCx, H / 2 - 320, survived ? '存活到终点' : '倒下了…', {
      fontFamily: 'sans-serif', fontSize: '54px', color: survived ? '#88ffcc' : '#ff8888', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(601);
    const subTitle = this.add.text(leftCx, H / 2 - 250, survived ? 'MISSION COMPLETE' : 'MISSION FAILED', {
      fontFamily: 'sans-serif', fontSize: '18px', color: '#888888', fontStyle: 'normal'
    }).setOrigin(0.5).setDepth(601);

    // 数据 4 行 label:value
    const dataRows = [
      { label: '时长', value: timeStr },
      { label: '击杀', value: String(state.kills) },
      { label: '等级', value: 'Lv ' + state.level },
      { label: '卡池', value: state.cards.length > 0 ? state.cards.map(id => (CARDS.find(c => c.id === id) || {}).name).filter(Boolean).join(' · ') : '(无)' },
    ];
    dataRows.forEach((row, i) => {
      const rowY = H / 2 - 120 + i * 80;
      this.add.text(leftCx - 200, rowY, row.label, {
        fontFamily: 'sans-serif', fontSize: '24px', color: '#888888'
      }).setOrigin(0, 0.5).setDepth(601);
      // 分隔线
      this.add.rectangle(leftCx, rowY + 20, 400, 1, 0x333333, 0.6).setDepth(601);
      this.add.text(leftCx + 200, rowY, row.value, {
        fontFamily: 'sans-serif', fontSize: i === 3 ? '18px' : '30px',
        color: '#ffffff', fontStyle: 'bold',
        wordWrap: { width: 380 }, align: 'right',
      }).setOrigin(1, 0.5).setDepth(601);
    });

    // 右栏：按钮（40%，center x 约 W*0.75）
    const rightCx = W * 0.75;

    // 再来一局（大按钮）
    const primaryBtn = this.add.rectangle(rightCx, H / 2 - 60, 480, 130, 0x33aa66, 0.9)
      .setStrokeStyle(4, 0x88ffcc, 0.95).setDepth(601).setInteractive({ useHandCursor: true });
    const primaryTxt = this.add.text(rightCx, H / 2 - 60, '再来一局', {
      fontFamily: 'sans-serif', fontSize: '40px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(602);
    primaryBtn.on('pointerover', () => primaryBtn.setFillStyle(0x44cc77, 0.95));
    primaryBtn.on('pointerout',  () => primaryBtn.setFillStyle(0x33aa66, 0.9));
    primaryBtn.on('pointerdown', () => this.scene.restart());

    // 回主菜单（小按钮）
    const secondaryBtn = this.add.rectangle(rightCx, H / 2 + 100, 360, 90, 0x333333, 0.85)
      .setStrokeStyle(2, 0x888888, 0.85).setDepth(601).setInteractive({ useHandCursor: true });
    const secondaryTxt = this.add.text(rightCx, H / 2 + 100, '回主菜单', {
      fontFamily: 'sans-serif', fontSize: '26px', color: '#c8dbe4'
    }).setOrigin(0.5).setDepth(602);
    secondaryBtn.on('pointerover', () => secondaryBtn.setFillStyle(0x555555, 0.9));
    secondaryBtn.on('pointerout',  () => secondaryBtn.setFillStyle(0x333333, 0.85));
    secondaryBtn.on('pointerdown', () => {
      if (window.history.length > 1) window.history.back();
      else location.reload();
    });
  }
}

// ---- Phaser 启动 ----
const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: W,
    height: H,
  },
  physics: { default: 'arcade', arcade: { debug: false, gravity: { x: 0, y: 0 } } },
  scene: [MainScene],
  render: { pixelArt: false, antialias: true },
  input: { activePointers: 3 },
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
  const loading = document.getElementById('loading');
  if (loading) loading.remove();
});

})();
