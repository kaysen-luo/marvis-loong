/* MVS-007 Phaser 3 白模 v0.1.5 · grep: Crawler Rusher Spitter joystick pulse energyPulse setVelocity BOBO_ATTACK_RANGE
 *
 * v0.1.5 (2026-07-16):
 *   · 锁敌范围恢复 500px（敌人必须进射程才开火）+ 保留 v0.1.4 子弹飞行 500px 上限
 *   · 双重保障：不朝屏外瞎打，也不会能量浪费
 *
 * v0.1.4 (2026-07-16):
 *   · 修复摇杆中心偏右上 + 黏笨感：改为动态摇杆（触摸落点即基座中心）
 *   · 子弹添加 spawnX/spawnY 字段，飞行距离 >= 500 就销毁
 * v0.1.3 射程限制(2026-07-16):
 *   · BOBO_ATTACK_RANGE = 500 px 引入（常量化），`nearestEnemy()` 加距离过滤
 *   · 以玩家为圆心绘半透明青蓝虚线射程圈（rgba(100,200,255,0.15)）
 *   · 产品名：Xenobreach → Rift Ranger（K师 2026-07-07 拍板，07-15 英文定 Ranger）
 * v0.1.2 手感优化(2026-07-15): 摇杆即时响应混合式（固定基座 + 落点即偏移 + 动态基座 + 8px 死区），speed 200→240
 * v0.1.1 手感优化(2026-07-03):
 *   P0 · 摇杆每帧 update 采样 pointer 位置(不用 pointermove 事件)、玩家 pushable=false、
 *        子弹速度 400→600、iFrame 500→300ms
 *   P1 · 玩家 8 帧位移拖尾、击杀白光闪、受击 200ms 红 tint、暴击金色大字
 *   P2 · 单关 5min→10min、Rusher 90→180s、Spitter 150→300s、450s Crawler 密度翻倍、
 *        540s Rusher 密度翻倍、XP 曲线放缓 nextLv = 20 + (lv-1)*10
 * 10 卡: 加速射击 穿透弹 爆裂弹 暴击强化 环绕光刃 定时地雷 无人机僚机 强化装甲 急促脚步 吸血涂层
 */
(function () {
'use strict';
const W = 1080, H = 1920;
const TOTAL_SEC = 600;                // v0.1.1: 5min → 10min
const BOBO_ATTACK_RANGE = 500;        // v0.1.3: BOBO/Trooper 自动摄敲射程（px）
const COLORS = {
  player: 0xffffff, bullet: 0x88ddff,
  crawler: 0xff4444, rusher: 0xff9933, spitter: 0xaa66ff,
  hpFull: 0x33ff66, hpMid: 0xffcc33, hpLow: 0xff3333,
  energy: 0x66ff99,
};

// v0.1.1 P2: 到达 level+1 需要的经验增量 = 20 + (level-1)*10
// Lv2=20 Lv3=30 Lv4=40 Lv5=50 Lv6=60 Lv7=70 Lv8=80 Lv9=90 Lv10=100 (累计 20/50/90/140/200/270/350/440/540)
function xpFor(level) { return 20 + (level - 1) * 10; }

function freshState() {
  return {
    hpMax: 100, hp: 100, speed: 240,
    fireRate: 300, bulletDmg: 10, bulletSpeed: 600,     // v0.1.1 P0: 400 → 600
    pierce: 0, explosive: false, critChance: 0, critMult: 3,
    pulseCd: 8000, pulseReady: 0,
    level: 1, xp: 0, xpToNext: xpFor(1), kills: 0, startTime: 0,
    hasOrbit: false, hasMines: false, hasDrone: false,
    lifesteal: 0, cards: [],
    paused: false, ended: false,
    rusherUnlocked: false, spitterUnlocked: false,
    crawlerDense: false, rusherDense: false,             // v0.1.1 P2: 后期密度翻倍
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

    const g = this.add.graphics();
    g.lineStyle(1, 0x0f1a1a, 1);
    for (let x = 0; x < W; x += 80) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = 0; y < H; y += 80) { g.moveTo(0, y); g.lineTo(W, y); }
    g.strokePath();

    // v0.1.1 P1: 拖尾图层(用 graphics 比生 8 个 circle 便宜)
    this.trailGfx = this.add.graphics().setDepth(5);
    this.trail = [];

    // v0.1.3: BOBO 射程圈 UI（玩家为圆心、青蓝半透明虚线、500 px）
    this.rangeRingGfx = this.add.graphics().setDepth(4);

    this.player = this.add.circle(W / 2, H / 2, 15, COLORS.player);
    this.physics.add.existing(this.player);
    this.player.body.setCircle(15);
    this.player.body.setCollideWorldBounds(true);
    // v0.1.1 P0: 玩家不被敌人推动(消除"黏连"感)
    this.player.body.pushable = false;
    this.player.iFrameUntil = 0;

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
  }

  setupTouch() {
    // v0.1.2: 即时响应混合摇杆——基座默认固定在左下角，落点即偏移(首帧就有输入)。
    // 拉太远时基座跟着手指走(动态基座)，避免拉不到屏幕边。
    const BASE_X = 200, BASE_Y = H - 200;
    this.stickBaseHome = { x: BASE_X, y: BASE_Y };
    this.stickMaxR = 90;
    this.stick = { active: false, cx: BASE_X, cy: BASE_Y, dx: 0, dy: 0, pointer: null };
    this.stickBase = this.add.circle(BASE_X, BASE_Y, 90, 0xffffff, 0.08).setDepth(150).setVisible(false);
    this.stickKnob = this.add.circle(BASE_X, BASE_Y, 45, 0xffffff, 0.35).setDepth(151).setVisible(false);

    const btnR = 105;
    const bx = W - 170, by = H - 300;
    this.pulseBtnR = btnR; this.pulseBtnX = bx; this.pulseBtnY = by;
    this.pulseBtn = this.add.circle(bx, by, btnR, 0x66ff99, 0.28)
      .setDepth(150).setStrokeStyle(5, 0x66ff99, 0.9);
    this.pulseLabel = this.add.text(bx, by - 8, '脉冲', {
      fontFamily: 'sans-serif', fontSize: '48px', color: '#eaffea', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(151);
    this.pulseCdLabel = this.add.text(bx, by + 42, '', {
      fontFamily: 'sans-serif', fontSize: '32px', color: '#ffffff'
    }).setOrigin(0.5).setDepth(151);

    this.input.on('pointerdown', (p) => {
      // v0.1.4: 动态摇杆——触摸落点即摇杆基座中心（修 v0.1.3 固定式摇杆的中心偏右上/黏笨感 bug）
      this.stickBaseHome.x = p.x;
      this.stickBaseHome.y = p.y;
      if (state.paused || state.ended) return;
      const dxb = p.x - bx, dyb = p.y - by;
      if (dxb * dxb + dyb * dyb <= btnR * btnR) { this.tryPulse(); return; }
      if (p.x < W / 2) {
        // v0.1.2: 基座保持在固定 home 位置，落点相对基座的偏移直接作为首帧输入
        this.stick.active = true;
        this.stick.pointer = p;
        this.stick.cx = this.stickBaseHome.x;
        this.stick.cy = this.stickBaseHome.y;
        let dx = p.x - this.stick.cx, dy = p.y - this.stick.cy;
        const max = this.stickMaxR;
        const len = Math.hypot(dx, dy);
        // 如果落点离基座过远(>1.5x)，基座跟手指走(动态基座)
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
        this.stickBase.setPosition(this.stick.cx, this.stick.cy).setVisible(true);
        this.stickKnob.setPosition(this.stick.cx + ndx, this.stick.cy + ndy).setVisible(true);
      }
    });
    const endStick = (p) => {
      if (this.stick.pointer && p.id !== this.stick.pointer.id) return;
      this.stick.active = false;
      this.stick.dx = 0; this.stick.dy = 0;
      this.stick.pointer = null;
      this.stickBase.setVisible(false);
      this.stickKnob.setVisible(false);
    };
    this.input.on('pointerup', endStick);
    this.input.on('pointerupoutside', endStick);
    this.input.on('pointercancel', endStick);
  }

  // v0.1.2: 每帧从 pointer 位置采样；加 8px 死区；拉过 1.5x 时基座跟手指走(动态基座)
  sampleStick() {
    if (!this.stick.active || !this.stick.pointer) return;
    const p = this.stick.pointer;
    if (!p.isDown) { this.stick.dx = 0; this.stick.dy = 0; return; }
    const max = this.stickMaxR;
    let dx = p.x - this.stick.cx, dy = p.y - this.stick.cy;
    let len = Math.hypot(dx, dy);
    // 动态基座：拉出 1.5x 时基座跟着手指移动一段，保持
    if (len > max * 1.5) {
      const shift = len - max;
      this.stick.cx += dx / len * shift;
      this.stick.cy += dy / len * shift;
      this.stickBase.setPosition(this.stick.cx, this.stick.cy);
      dx = p.x - this.stick.cx; dy = p.y - this.stick.cy;
      len = Math.hypot(dx, dy);
    }
    // 死区：<8px 当 0，避免微抖
    if (len < 8) { this.stick.dx = 0; this.stick.dy = 0; this.stickKnob.setPosition(this.stick.cx, this.stick.cy); return; }
    let kdx = dx, kdy = dy;
    if (len > max) { kdx = dx * max / len; kdy = dy * max / len; }
    this.stick.dx = kdx / max;
    this.stick.dy = kdy / max;
    this.stickKnob.setPosition(this.stick.cx + kdx, this.stick.cy + kdy);
  }

  buildUI() {
    const topPad = 120;
    // v0.1.1 P2: 10:00 起
    this.timeLabel = this.add.text(W / 2, topPad, '10:00', {
      fontFamily: 'sans-serif', fontSize: '72px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(200);
    this.killLabel = this.add.text(40, topPad + 20, '击杀 0', {
      fontFamily: 'sans-serif', fontSize: '44px', color: '#ffcc66'
    }).setOrigin(0, 0).setDepth(200);
    this.lvLabel = this.add.text(W - 40, topPad + 20, 'Lv 1', {
      fontFamily: 'sans-serif', fontSize: '44px', color: '#88ffcc'
    }).setOrigin(1, 0).setDepth(200);
    this.xpBarBg = this.add.rectangle(W / 2, topPad + 100, W - 80, 12, 0x333333).setOrigin(0.5).setDepth(200);
    this.xpBar   = this.add.rectangle(40, topPad + 100, 0, 12, 0x88ffcc).setOrigin(0, 0.5).setDepth(201);
    // v0.1.1: wave 提示字(马上隔时胎钩事件 fade)
    this.waveLabel = this.add.text(W / 2, H / 2 - 200, '', {
      fontFamily: 'sans-serif', fontSize: '64px', color: '#ffcc66', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(300).setAlpha(0);
    this.hintLabel = this.add.text(W / 2, H - 60,
      '左半屏 触摸 = 摇杆 · 右下 = 脉冲 · 键盘 WASD/方向键',
      { fontFamily: 'sans-serif', fontSize: '26px', color: '#666666' }
    ).setOrigin(0.5).setDepth(200);
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

    // v0.1.1 P0: 每帧从 pointer 位置采样摇杆(替代 pointermove 事件)
    this.sampleStick();

    const elapsed = time - state.startTime;
    // v0.1.1 P2: timeline 拉长，新增 450s/540s 密度翻倍 wave
    if (!state.rusherUnlocked   && elapsed >= 180000) { state.rusherUnlocked  = true; this.showWave('Rusher 加入'); }
    if (!state.spitterUnlocked  && elapsed >= 300000) { state.spitterUnlocked = true; this.showWave('Spitter 加入'); }
    if (!state.crawlerDense     && elapsed >= 450000) { state.crawlerDense    = true; this.showWave('Crawler 密度翻倍！'); }
    if (!state.rusherDense      && elapsed >= 540000) { state.rusherDense     = true; this.showWave('Rusher 密度翻倍！'); }

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown  || this.keys.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) vx += 1;
    if (this.cursors.up.isDown    || this.keys.W.isDown) vy -= 1;
    if (this.cursors.down.isDown  || this.keys.S.isDown) vy += 1;
    if (this.stick.active) { vx = this.stick.dx; vy = this.stick.dy; }
    const mag = Math.hypot(vx, vy);
    if (mag > 1) { vx /= mag; vy /= mag; }
    this.player.body.setVelocity(vx * state.speed, vy * state.speed);

    // v0.1.1 P1: 拖尾(记录 8 帧位移，画淏出中的半透明圆)
    this.trail.push({ x: this.player.x, y: this.player.y });
    if (this.trail.length > 8) this.trail.shift();
    this.trailGfx.clear();
    for (let i = 0; i < this.trail.length; i++) {
      const alpha = (i + 1) / this.trail.length * 0.32;
      const r = 5 + i * 1.1;
      this.trailGfx.fillStyle(0xffffff, alpha);
      this.trailGfx.fillCircle(this.trail[i].x, this.trail[i].y, r);
    }

    // v0.1.3: BOBO 射程圈（玩家为圆心 · 青蓝半透明虚线 · 500 px）
    this.rangeRingGfx.clear();
    this.rangeRingGfx.lineStyle(2, 0x64c8ff, 0.15);
    const rrCx = this.player.x, rrCy = this.player.y, rrR = BOBO_ATTACK_RANGE;
    const dashCount = 48;              // 48 段 ≈ 每 7.5°一段
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
    // v0.1.4: 子弹射程上限 500 px（起点距离 >= BOBO_ATTACK_RANGE 就销毁）
    const rangeSq = BOBO_ATTACK_RANGE * BOBO_ATTACK_RANGE;
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
    const totalMs = TOTAL_SEC * 1000;   // v0.1.1 P2: 10min
    const left = Math.max(0, totalMs - (time - state.startTime));
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    this.timeLabel.setText(`${mm}:${ss.toString().padStart(2, '0')}`);
    this.killLabel.setText(`击杀 ${state.kills}`);
    this.lvLabel.setText(`Lv ${state.level}`);
    this.xpBar.width = (W - 80) * Math.min(1, state.xp / state.xpToNext);

    const cdLeft = state.pulseReady - time;
    if (cdLeft > 0) {
      this.pulseBtn.setFillStyle(0x666666, 0.2);
      this.pulseBtn.setStrokeStyle(5, 0x666666, 0.6);
      this.pulseLabel.setColor('#888888');
      this.pulseCdLabel.setText(Math.ceil(cdLeft / 1000) + 's');
    } else {
      this.pulseBtn.setFillStyle(0x66ff99, 0.28);
      this.pulseBtn.setStrokeStyle(5, 0x66ff99, 0.95);
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
    this.fireBulletFrom(this.player.x, this.player.y, target, state.bulletDmg, state.pierce, state.explosive, this.bullets, state.bulletSpeed);
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
    // v0.1.4: 子弹射程上限——记录发射起点，飞行距离 >= BOBO_ATTACK_RANGE 就销毁
    b.spawnX = x;
    b.spawnY = y;
  }

  nearestEnemy(x, y, maxRange = Infinity) {
    // v0.1.4: 恢复无限锁敌范围——射程限制改由子弹生命周期负责（子弹飞 500 px 就消失）
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
    // v0.1.1 P2: 适应 10min，波次拉长为 120s 一阶，后期密度翻倍
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
    // v0.1.1 P2: 密度翻倍
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
    player.iFrameUntil = t + 300;    // v0.1.1 P0: 500 → 300ms 更灵敏
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
    // v0.1.1 P1: 屏震宝变强，玩家 200ms 红色 tint(原 80ms 过短看不到)
    this.cameras.main.shake(100, 0.01);
    this.player.setFillStyle(0xff3333);
    this.time.delayedCall(200, () => { if (this.player.active) this.player.setFillStyle(COLORS.player); });
    if (state.hp <= 0 && !state.ended) this.endGame('dead');
  }

  damageEnemy(enemy, dmg, isCrit) {
    if (!enemy.active) return;
    enemy.hp -= dmg;
    // 击中反馈
    const oc = enemy.fillColor;
    if (enemy.setFillStyle) {
      enemy.setFillStyle(0xffffff);
      this.time.delayedCall(60, () => { if (enemy.active && enemy.setFillStyle) enemy.setFillStyle(oc); });
    }
    this.spawnDmgNum(enemy.x, enemy.y - 20, Math.round(dmg), isCrit);
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  killEnemy(enemy) {
    // v0.1.1 P1: 白光闪 + 多发粒子 = “敌人确实死了”的反馈
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
    // v0.1.1 P2: 升级曲线放缓(nextLv = 20 + (lv-1)*10)
    while (state.xp >= state.xpToNext) {
      state.xp -= state.xpToNext;
      state.level += 1;
      state.xpToNext = xpFor(state.level);
      this.openLevelUp();
    }
  }

  spawnDmgNum(x, y, val, isCrit) {
    // v0.1.1 P1: 暴击字更大更亮 + 描边，一眼能看到
    const color = isCrit ? '#ffee55' : '#ffffff';
    const size = isCrit ? '48px' : '28px';
    const t = this.add.text(x, y, String(val), {
      fontFamily: 'sans-serif', fontSize: size, color, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: isCrit ? 4 : 2,
    }).setOrigin(0.5).setDepth(80);
    this.tweens.add({
      targets: t, y: y - (isCrit ? 60 : 40), alpha: 0, duration: isCrit ? 650 : 500,
      onComplete: () => t.destroy(),
    });
  }

  spawnBoom(x, y, color) {
    // v0.1.1 P1: 5 → 15 粒，散开更开，看起来“确实炸了”
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
    // 视觉圈
    const c = this.add.circle(x, y, radius, 0xffcc66, 0.35).setDepth(30);
    this.tweens.add({
      targets: c, alpha: 0, scale: 1.6, duration: 260,
      onComplete: () => c.destroy(),
    });
    // 伤害:范围内敌人扣血
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= radius * radius) this.damageEnemy(e, dmg, false);
    });
  }

  // ---- 主动技能:能量脉冲 energyPulse ----
  tryPulse() {
    const t = this.time.now;
    if (t < state.pulseReady) return;
    state.pulseReady = t + state.pulseCd;
    const cx = this.player.x, cy = this.player.y;
    // 白光扩散
    const ring = this.add.circle(cx, cy, 30, 0xffffff, 0.55).setDepth(60);
    this.tweens.add({
      targets: ring, radius: 260, alpha: 0, scale: 8, duration: 320,
      onComplete: () => ring.destroy(),
    });
    this.cameras.main.shake(160, 0.012);
    this.cameras.main.flash(120, 255, 255, 255);
    // 范围伤害
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const dx = e.x - cx, dy = e.y - cy;
      if (dx * dx + dy * dy <= 200 * 200) this.damageEnemy(e, 50, false);
    });
  }

  // ---- 环绕光刃 ----
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
      // 命中检测
      this.enemies.getChildren().forEach(e => {
        if (!e.active) return;
        const dx = e.x - b.obj.x, dy = e.y - b.obj.y;
        if (dx * dx + dy * dy <= 26 * 26) {
          const last = b.lastHit.get(e) || 0;
          if (now - last >= 1000) {   // 1 秒最多命中同一敌人一次(15 伤/秒)
            b.lastHit.set(e, now);
            this.damageEnemy(e, 15, false);
          }
        }
      });
    });
  }

  // ---- 定时地雷 ----
  dropMine() {
    if (state.paused || state.ended || !state.hasMines) return;
    const mx = this.player.x, my = this.player.y;
    const m = this.add.circle(mx, my, 12, 0xffaa33, 0.85).setStrokeStyle(2, 0xff6600, 1).setDepth(20);
    this.physics.add.existing(m);
    this.mines.add(m);
    // 闪烁提示
    this.tweens.add({
      targets: m, alpha: 0.3, duration: 300, yoyo: true, repeat: 4,
    });
    this.time.delayedCall(3000, () => {
      if (!m.active) return;
      this.explosion(m.x, m.y, 80, 30);
      m.destroy();
    });
  }

  // ---- 无人机 ----
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
      // 平滑跟随
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

  // ---- 升级面板 ----
  openLevelUp() {
    if (state.paused || state.ended) return;
    state.paused = true;
    this.physics.world.pause();
    const cards = pick3(state);
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7).setDepth(500);
    const title = this.add.text(W / 2, H / 2 - 500, 'Lv ' + state.level + ' · 选一张升级', {
      fontFamily: 'sans-serif', fontSize: '54px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(501);
    const cardObjs = [];
    const cardW = 900, cardH = 240, gap = 30;
    const totalH = cards.length * cardH + (cards.length - 1) * gap;
    const startY = H / 2 - totalH / 2 + cardH / 2;
    cards.forEach((c, i) => {
      const cy = startY + i * (cardH + gap);
      const bg = this.add.rectangle(W / 2, cy, cardW, cardH, 0x111a22, 0.95).setStrokeStyle(4, 0x66ff99, 0.9).setDepth(501).setInteractive({ useHandCursor: true });
      const name = this.add.text(W / 2, cy - 60, c.name, {
        fontFamily: 'sans-serif', fontSize: '52px', color: '#eaffea', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(502);
      const desc = this.add.text(W / 2, cy + 30, c.desc, {
        fontFamily: 'sans-serif', fontSize: '30px', color: '#cccccc',
        wordWrap: { width: cardW - 60 }, align: 'center',
      }).setOrigin(0.5).setDepth(502);
      bg.on('pointerdown', () => this.pickCard(c, [overlay, title, ...cardObjs]));
      cardObjs.push(bg, name, desc);
    });
  }

  pickCard(card, ui) {
    card.apply(state);
    state.cards.push(card.id);
    ui.forEach(o => o.destroy());
    state.paused = false;
    this.physics.world.resume();
  }

  // ---- 结算 ----
  endGame(reason) {
    if (state.ended) return;
    state.ended = true;
    state.paused = true;
    this.physics.world.pause();

    const elapsed = Math.min(TOTAL_SEC, Math.floor((this.time.now - state.startTime) / 1000));
    const mm = Math.floor(elapsed / 60);
    const ss = elapsed % 60;
    const timeStr = `${mm}:${ss.toString().padStart(2, '0')}`;
    const survived = reason === 'time';

    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.85).setDepth(600);
    const title = this.add.text(W / 2, H / 2 - 500, survived ? '存活到终点!' : '倒下了…', {
      fontFamily: 'sans-serif', fontSize: '78px', color: survived ? '#88ffcc' : '#ff8888', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(601);

    const stats = [
      `击杀: ${state.kills}`,
      `存活: ${survived ? '是' : '否'}`,
      `时长: ${timeStr}`,
      `等级: Lv ${state.level}`,
      `卡池: ${state.cards.length > 0 ? state.cards.map(id => (CARDS.find(c => c.id === id) || {}).name).filter(Boolean).join(' / ') : '(无)'}`,
    ];
    stats.forEach((line, i) => {
      this.add.text(W / 2, H / 2 - 250 + i * 80, line, {
        fontFamily: 'sans-serif', fontSize: '42px', color: '#ffffff',
        wordWrap: { width: W - 120 }, align: 'center',
      }).setOrigin(0.5).setDepth(601);
    });

    const mkBtn = (label, y, color, cb) => {
      const btn = this.add.rectangle(W / 2, y, 500, 140, color, 0.8).setStrokeStyle(4, 0xffffff, 0.9).setDepth(601).setInteractive({ useHandCursor: true });
      const t = this.add.text(W / 2, y, label, {
        fontFamily: 'sans-serif', fontSize: '48px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(602);
      btn.on('pointerdown', cb);
      return [btn, t];
    };
    mkBtn('再来一局', H / 2 + 350, 0x33aa66, () => this.scene.restart());
    mkBtn('返回', H / 2 + 520, 0x555555, () => {
      // 若从其他页跳来,history 可回
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
