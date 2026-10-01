/* ============================================================
 *  奶蛙2048 · 自检（无浏览器：用桩件模拟 DOM / Canvas）
 *  运行：node naiwa.test.js
 *
 *  覆盖：
 *   1. 开局漂浮：不受重力影响，不会自己掉下来
 *   2. 四个方向的滑动：重力方向正确，奶蛙全部堆到那一侧
 *   3. 合成链与计分（2→4→8…→2048）
 *   4. 两只 2048 → 一起消失 + 奖励分
 *   5. 判负规则：停在危险带里才计时，飞过去的不算
 *   6. 四个方向各跑 8 秒：不穿墙、不 NaN、新奶蛙照常冒出来
 *   7. 输入：滑动触发阈值 / 冷却 / 方向键 / R 重开
 *   8. 每次滑动冒出一只新奶蛙
 *   9. 贴图与兜底：奶蛙贴图走 drawImage；少一张也不会白屏
 * ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = __dirname;

/* 记录每个画布 drawImage 了哪张图 */
const drawnImages = [];

function makeCtx(id) {
  const g = { addColorStop() {} };
  return {
    _id: id,
    setTransform() {}, save() {}, restore() {}, scale() {}, rotate() {}, translate() {},
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, quadraticCurveTo() {}, ellipse() {},
    clip() {}, stroke() {}, fill() {}, setLineDash() {},
    stroke() {}, fill() {}, setLineDash() {},
    drawImage(img) { drawnImages.push({ ctx: this._id, src: (img && img.__src) || null }); },
    createLinearGradient: () => g, createRadialGradient: () => g,
    measureText: () => ({ width: 12 }), fillText() {}, strokeText() {},
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', lineCap: ''
  };
}

const listeners = new Map();
function makeEl(id) {
  const el = {
    id, style: {}, textContent: '', hidden: false, width: 700, height: 140, _c: new Set(),
    classList: { add: c => el._c.add(c), remove: c => el._c.delete(c), contains: c => el._c.has(c) },
    getContext: () => el._ctx || (el._ctx = makeCtx(id)),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 700 }),
    addEventListener(t, fn) { if (!listeners.has(el)) listeners.set(el, {}); listeners.get(el)[t] = fn; },
    querySelector(sel) {
      if (!el._q) el._q = {};
      if (!el._q[sel]) el._q[sel] = { textContent: '', style: {}, classList: { add() {}, remove() {} } };
      return el._q[sel];
    },
    setAttribute() {}, offsetWidth: 100
  };
  return el;
}

function fire(el, type, ev) {
  const set = listeners.get(el);
  if (set && set[type]) set[type](ev || {});
}

const els = {};
['game', 'stage', 'overlay', 'score', 'best', 'finalScore', 'finalBest', 'next', 'chain',
 'soundBtn', 'resetBtn', 'restartBtn', 'hint', 'medal', 'gravStatus', 'jamFill',
 'jamPct', 'gUp', 'gDown', 'gLeft', 'gRight', 'overTitle'].forEach(id => els[id] = makeEl(id));

const rafQueue = [];
const winListeners = {};
const sandbox = {
  console, Math, Date, JSON, Object, Array, Number, String, Boolean, Error, isNaN,
  performance: { now: () => Date.now() },
  requestAnimationFrame(fn) { rafQueue.push(fn); return 1; },
  setTimeout: fn => setTimeout(fn, 0), clearTimeout,
  document: {
    readyState: 'complete', getElementById: id => els[id] || null,
    addEventListener() {}, createElement: () => makeEl('tmp')
  },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  addEventListener(t, fn) { winListeners[t] = fn; },
  navigator: {},
  /* 桩件图片：设了 src 就立刻“加载完成” */
  Image: class {
    constructor() { this.width = 512; this.height = 512; this.naturalWidth = 512; this.onload = null; this.onerror = null; }
    set src(v) { this._src = v; this.__src = v; if (this.onload) this.onload(); }
    get src() { return this._src; }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'assets', 'frogs', 'parts.js'), 'utf8'),
                sandbox, { filename: 'parts.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'game.js'), 'utf8'), sandbox, { filename: 'game.js' });

const N = sandbox.__NW__;
const S = N.state;
const step = N.stepPhysics;
const update = N.update;
const DT = 1 / 180;
const W = N.W, H = N.H, WALL = N.WALL;
const IN_X0 = WALL, IN_X1 = W - WALL, IN_Y0 = WALL, IN_Y1 = H - WALL;

function run(n) { for (let i = 0; i < n; i++) step(DT); }
function frames(n, dt) { for (let i = 0; i < n; i++) update(dt === undefined ? 1 / 60 : dt); }
function clear() { S.balls.length = 0; }
function ball(x, y, tier) { const b = N.makeBall(x, y, tier); b.popAt = 0; return b; }

function bounds(b) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (let k = 0; k < b.parts.length; k++) {
    const x = b.wx[k], y = b.wy[k], r = b.ws[k];
    if (x - r < minx) minx = x - r;
    if (x + r > maxx) maxx = x + r;
    if (y - r < miny) miny = y - r;
    if (y + r > maxy) maxy = y + r;
  }
  return { minx, maxx, miny, maxy };
}
function badBall(b) {
  if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.vx) || !isFinite(b.vy)) return 'NaN';
  const e = bounds(b);
  if (e.maxy > IN_Y1 + 1.5) return 'floor maxy=' + e.maxy.toFixed(1);
  if (e.miny < IN_Y0 - 1.5) return 'ceil miny=' + e.miny.toFixed(1);
  if (e.minx < IN_X0 - 1.5) return 'left minx=' + e.minx.toFixed(1);
  if (e.maxx > IN_X1 + 1.5) return 'right maxx=' + e.maxx.toFixed(1);
  return '';
}

let pass = true;
function check(name, ok, detail) {
  console.log((ok ? '  [OK] ' : '  [NG] ') + name + (detail ? '  -- ' + detail : ''));
  if (!ok) pass = false;
}

/* ---- 0. 合成链 ---- */
console.log('[0] 合成链 / 贴图加载');
check('11 级合成链', N.FROGS.length === 11);
let chainOk = true, rOk = true;
for (let i = 0; i < N.FROGS.length; i++) {
  if (N.FROGS[i].v !== Math.pow(2, i + 1)) chainOk = false;
  if (i && N.FROGS[i].r <= N.FROGS[i - 1].r) rOk = false;
}
check('等级是 2 → 2048', chainOk, N.FROGS.map(f => f.v).join(','));
check('半径严格递增', rOk, N.FROGS.map(f => f.r).join(','));
check('11 张贴图全部加载', N.FROGS.every(f => !!f.img));

/* ---- 1. 开局漂浮：不受重力 ---- */
console.log('[1] 开局：一群奶蛙漂着，不受重力影响');
N.reset();
const n0 = S.balls.length;
const y0 = S.balls.map(b => b.y);
const avg0 = y0.reduce((a, b) => a + b, 0) / y0.length;
const spread0 = Math.max.apply(null, y0) - Math.min.apply(null, y0);
check('开局场上有 ' + n0 + ' 只奶蛙', n0 === N.INIT_FROGS, '实际 ' + n0);
check('开局没有重力', S.gx === 0 && S.gy === 0 && S.dir === null);
check('开局是纵向铺开的（不是全挤在一处）', spread0 > 200, '纵向跨度 = ' + spread0.toFixed(0) + 'px');
run(3 * 180);                                  // 3 秒
const ys = S.balls.map(b => b.y);
const avg1 = ys.reduce((a, b) => a + b, 0) / ys.length;
const spread1 = Math.max.apply(null, ys) - Math.min.apply(null, ys);
/* 用「整体重心 + 纵向跨度」判，而不是按索引逐只比 —— 万一开局自己合成了，
   数组下标会错位，逐只比会得出假的大位移 */
check('3 秒后依然漂在原处（重心没往下掉）', Math.abs(avg1 - avg0) < 50,
      '重心位移 = ' + (avg1 - avg0).toFixed(1) + 'px');
check('3 秒后还是纵向铺开的（没有被“吸”到底部）', spread1 > spread0 * 0.6,
      '跨度 ' + spread0.toFixed(0) + ' → ' + spread1.toFixed(0) + 'px');
const nearFloor = S.balls.filter(b => H - WALL - (b.y + b.rb) < 40).length;
check('没有集体沉底', nearFloor < 3, '贴底 ' + nearFloor + '/' + n0 + ' 只');
check('漂浮时不会判负', (N.checkJam(1 / 60), S.over === false));

/* ---- 2. 四个方向 ---- */
console.log('[2] 上下左右滑动 → 重力改向');
const DIRTEST = [
  { dir: 'down',  probe: b => bounds(b).maxy, target: IN_Y1, name: '向下：全堆在地板上' },
  { dir: 'up',    probe: b => bounds(b).miny, target: IN_Y0, name: '向上：全粘在天花板上' },
  { dir: 'left',  probe: b => bounds(b).minx, target: IN_X0, name: '向左：全挤在左墙上' },
  { dir: 'right', probe: b => bounds(b).maxx, target: IN_X1, name: '向右：全挤在右墙上' }
];
for (const t of DIRTEST) {
  /* (a) 单只：必须严丝合缝贴在那一侧的墙上 */
  N.reset();
  clear();
  S.balls.push(ball(210, 350, 2));
  N.applySwipe(t.dir);
  const vec = N.DIRS[t.dir];
  const vecOk = (vec.x === 0 || Math.sign(S.gx) === vec.x) && (vec.y === 0 || Math.sign(S.gy) === vec.y);
  run(3 * 180);
  const err = Math.abs(t.probe(S.balls[0]) - t.target);
  check(t.name + '（单只贴墙）', vecOk && err < 2.5,
        '贴墙误差 = ' + err.toFixed(2) + 'px，g=(' + Math.round(S.gx) + ',' + Math.round(S.gy) + ')');

  /* (b) 三只：整堆最外沿必须顶到那一侧的墙（堆里靠里的那几只可能叠在别的奶蛙身上） */
  N.reset();
  clear();
  S.balls.push(ball(150, 320, 0), ball(230, 350, 1), ball(300, 380, 2));
  N.applySwipe(t.dir);
  run(5 * 180);
  let nearest = 1e9, deepest = 0;
  for (const b of S.balls) {
    const d = Math.abs(t.probe(b) - t.target);
    if (d < nearest) nearest = d;
    if (d > deepest) deepest = d;
  }
  check(t.name + '（整堆靠过去）', nearest < 2.5,
        '最外沿离墙 = ' + nearest.toFixed(2) + 'px，最里面那只 = ' + deepest.toFixed(1) + 'px');
}

/* ---- 3. 合成 & 计分 ---- */
console.log('[3] 同级贴到一起就合成');
function mergeCase(tierA, tierB, expect, label) {
  N.reset();
  clear();
  S.score = 0;
  const r = N.FROGS[tierA].r;
  S.balls.push(ball(210 - r * 0.35, 350, tierA), ball(210 + r * 0.35, 350, tierB));
  run(6);
  const alive = S.balls.filter(b => !b.dead);
  check(label, alive.length === 1 && alive[0].tier === expect,
        '场上 ' + alive.length + ' 只，等级 ' + (alive[0] ? N.FROGS[alive[0].tier].v : '-'));
  return alive[0];
}
const m1 = mergeCase(0, 0, 1, '两只 2 → 4');
check('合成得 4 分（就加在新等级上）', S.score === 4, 'score = ' + S.score);
mergeCase(5, 5, 6, '两只 64 → 128');

/* 不同级只是挨着，不合成 */
N.reset();
clear();
S.score = 0;
S.balls.push(ball(200, 350, 0), ball(226, 350, 1));
run(60);
check('不同级不相爱（2 与 4 不合成）',
      S.balls.filter(b => !b.dead).length === 2 && S.score === 0,
      '场上 ' + S.balls.length + ' 只，score = ' + S.score);

/* ---- 4. 合出 2048 / 两只 2048 ---- */
console.log('[4] 2048');
N.reset();
clear();
S.score = 0;
S.won = false;
els.medal.hidden = true;
const r1024 = N.FROGS[9].r;
S.balls.push(ball(210 - r1024 * 0.35, 350, 9), ball(210 + r1024 * 0.35, 350, 9));
run(6);
const top = S.balls.filter(b => !b.dead)[0];
check('两只 1024 → 2048', !!top && top.tier === 10, top ? N.FROGS[top.tier].v + '' : '无');
check('触发了通关标记', S.won === true && els.medal.hidden === false);
check('得分 +2048', S.score === 2048, 'score = ' + S.score);

N.reset();
clear();
S.score = 0;
const rMax = N.FROGS[10].r;
S.balls.push(ball(210 - rMax * 0.35, 350, 10), ball(210 + rMax * 0.35, 350, 10));
run(6);
check('两只 2048 → 一起消失 + 奖励分 ' + 4096,
      S.balls.filter(b => !b.dead).length === 0 && S.score === 4096, 'score = ' + S.score);

/* ---- 5. 判负规则 ---- */
console.log('[5] 判负：停在危险带里才算');
N.reset();
clear();
N.applySwipe('down');
S.balls.push(ball(210, 120, 0));            // 危险带里停住（down 的危险带在池子上方）
S.balls[0].vx = 0; S.balls[0].vy = 0;
let over = false;
for (let i = 0; i < 120; i++) {
  if (i % 3 === 0) { S.balls[0].x = 210; S.balls[0].y = 120; S.balls[0].vx = 0; S.balls[0].vy = 0; }
  N.checkJam(1 / 60);
  if (S.over) { over = true; break; }
}
check('停在危险带 1.5 秒 → 判负', over === true);

N.reset();
clear();
N.applySwipe('down');
S.balls.push(ball(210, 120, 0));
let fastOver = false;
for (let i = 0; i < 180; i++) {
  S.balls[0].x = 210; S.balls[0].y = 120; S.balls[0].vx = 0; S.balls[0].vy = 900;  // 正在飞
  N.checkJam(1 / 60);
  if (S.over) { fastOver = true; break; }
}
check('从危险带里飞过去不算 → 不判负', fastOver === false);

N.reset();
clear();
S.balls.push(ball(210, IN_Y1 - 24, 0));     // 贴地待着
for (let i = 0; i < 240; i++) N.checkJam(1 / 60);
check('贴着地面待着不判负', S.over === false);

/* 新冒出来的那只一定漂在“上风侧”的空中 —— 而那一侧正好是危险带。
   它不能算“卡住”，否则每出一只就自己判负了 */
N.reset();
clear();
N.applySwipe('down');
const hover = ball(210, 100, 0);
hover.float = 1;
hover.vx = 0; hover.vy = 0;
S.balls.push(hover);
for (let i = 0; i < 300; i++) N.checkJam(1 / 60);       // 5 秒
check('漂在危险带里的新奶蛙不算“卡住”，不会自己判负', S.over === false,
      '拥挤度 = ' + (N.coverageAll('down') * 100).toFixed(0) + '%');
/* 但滑动之后它开始掉、卡在上面不动时，照样会判负 */
hover.float = 0;
for (let i = 0; i < 300; i++) N.checkJam(1 / 60);
check('它开始掉之后卡在危险带里会判负', S.over === true);

/* ---- 6. 四个方向各跑 8 秒 ---- */
console.log('[6] 四个方向各跑 8 秒（边滑边冒新奶蛙）');
for (const t of DIRTEST) {
  N.reset();
  N.applySwipe(t.dir);
  let bad = '', maxN = 0;
  for (let f = 0; f < 8 * 60; f++) {
    update(1 / 60);
    /* 每 3 秒滑一次：留出“整池静止 → 出下一只”的结算时间 */
    if (f % 180 === 0) N.applySwipe(t.dir);
    for (const b of S.balls) { const e = badBall(b); if (e) { bad = e; break; } }
    if (bad) break;
    maxN = Math.max(maxN, S.balls.length);
  }
  check('重力 ' + N.DIRS[t.dir].label + '：8 秒不穿墙 / 不 NaN', bad === '', bad || ('最多 ' + maxN + ' 只同场'));
  check('重力 ' + N.DIRS[t.dir].label + '：滑动会冒出新的奶蛙', S.spawnCount > 0,
        '共冒出 ' + S.spawnCount + ' 只，场上剩 ' + S.balls.length + ' 只，score = ' + S.score);
}

/* ---- 7. 出下一批的时机：整池静止之后，一次三只 ---- */
console.log('[7] 滑动 → 等整池静止 → 才冒下一批（一次 ' + N.SPAWN_PER_TURN + ' 只，而且漂着不受重力）');

/* 7a. 场上有一只已经躺平的奶蛙：滑一下，很快就该结算 */
N.reset();
clear();
const rest0 = ball(210, IN_Y1 - N.FROGS[3].r, 3);
S.balls.push(rest0);
S.spawnCount = 0;
N.applySwipe('down');
let t7 = 0;
while (S.spawnCount === 0 && t7 < 12 * 60) { update(1 / 60); t7++; }
check('整池静止后冒出下一批', S.spawnCount === N.SPAWN_PER_TURN,
      '耗时 ' + (t7 / 60).toFixed(2) + 's，冒出 ' + S.spawnCount + ' 只');
check('结算那一刻场上确实是静止的', N.allSettled());
check('场上一下多了 ' + N.SPAWN_PER_TURN + ' 只', S.balls.length === 1 + N.SPAWN_PER_TURN,
      '场上 ' + S.balls.length + ' 只');

const fresh = S.balls.filter(b => b.float === 1);
check('这一批全都是「漂着」的（不受重力）', fresh.length === N.SPAWN_PER_TURN,
      fresh.length + '/' + N.SPAWN_PER_TURN + ' 只 float=1');
check('这一批彼此没有叠在一起', (function () {
  for (let i = 0; i < fresh.length; i++) {
    for (let j = i + 1; j < fresh.length; j++) {
      if (Math.hypot(fresh[i].x - fresh[j].x, fresh[i].y - fresh[j].y) < fresh[i].rb + fresh[j].rb) return false;
    }
  }
  return true;
})());

/* 7b. 漂着的那几只不会自己往下掉 */
const f0 = fresh[0];
if (f0) {
  const fy = f0.y;
  frames(120);                                   // 2 秒，重力一直朝下
  check('漂着的那只 2 秒内没有自己掉下去', Math.abs(f0.y - fy) < 8,
        'y ' + fy.toFixed(1) + ' → ' + f0.y.toFixed(1));
  check('它还是一直漂着（没有被别的奶蛙撞到）', f0.float === 1);

  /* 7c. 再滑一下，它才受重力开始掉 */
  N.applySwipe('down');
  check('滑动后漂浮状态解除', f0.float === 0);
  frames(45);                                    // 0.75 秒
  check('滑动后它开始往下掉', f0.y > fy + 40, 'y ' + fy.toFixed(1) + ' → ' + f0.y.toFixed(1));
}

/* 7d. 还在飞的时候不能冒出新的（必须等静止） */
N.reset();
clear();
const mover = ball(210, 180, 4);
mover.vx = 950;
mover.vy = -700;
S.balls.push(mover);
S.spawnCount = 0;
N.applySwipe('down');
frames(20);                                      // 还在飞
check('奶蛙还在飞的时候不会冒出新的', S.spawnCount === 0,
      '20 帧后 speed = ' + Math.hypot(mover.vx, mover.vy).toFixed(0) + 'px/s');
let t7d = 0;
while (S.spawnCount === 0 && t7d < 12 * 60) { update(1 / 60); t7d++; }
check('等它停下来之后才冒出', S.spawnCount === N.SPAWN_PER_TURN,
      '总计 ' + (t7d / 60).toFixed(2) + 's，冒出 ' + S.spawnCount + ' 只');

/* 7e. 连按：每一下都算一个回合（按下时先把整池快进到静止 + 结算，再执行输入），
   所以再快也不会「丢输入」，欠账依然封顶，池子也不会被灌爆（有 MAX_FROGS 保险丝）。 */
N.reset();
clear();
S.balls.push(ball(210, IN_Y1 - N.FROGS[3].r, 3));
S.spawnCount = 0;
const PRESS = 5;
for (let k = 0; k < PRESS; k++) N.applySwipe('down');      // 连按 5 下，中间不等
check('连按的每一下都被接受（不再丢输入）', S.moves === PRESS, 'moves = ' + S.moves);
check('每一下都先把整池快进到静止再执行', S.ffSteps > 0 && S.rest === false,
      '最后一下快进了 ' + S.ffSteps + ' 步；滑完之后又要重新等静止（rest=' + S.rest + '）');
check('欠账仍然封顶', S.owed <= N.MAX_OWED, 'owed = ' + S.owed);
frames(600);                                               // 10 秒
check('连按 ' + PRESS + ' 下 = 结算了 ' + PRESS + ' 批（每回合 3 只）',
      S.spawnCount === PRESS * N.SPAWN_PER_TURN,
      '冒出 ' + S.spawnCount + ' 只（期望 ' + (PRESS * N.SPAWN_PER_TURN) + '）');
check('池子没被灌爆（MAX_FROGS 保险丝还在）', S.balls.length <= N.MAX_FROGS,
      '场上 ' + S.balls.length + ' 只（上限 ' + N.MAX_FROGS + '）');

/* 7e2. 一直狂甩（比静止判定还快）也必须照常出新奶蛙 ——
   之前滑动会把结算计时清零，狂甩的玩家永远等不到新的奶蛙 */
N.reset();
clear();
S.balls.push(ball(210, IN_Y1 - N.FROGS[3].r, 3), ball(80, 200, 1));
S.spawnCount = 0;
let tSpam = 0;
while (S.spawnCount === 0 && tSpam < 20 * 60) {
  if (tSpam % 6 === 0) N.applySwipe(['up', 'down', 'left', 'right'][(tSpam / 6) % 4 | 0]);
  update(1 / 60);
  tSpam++;
}
check('狂甩（每秒 10 次）也能收到新奶蛙', S.spawnCount > 0,
      '第一次出奶蛙在第 ' + (tSpam / 60).toFixed(2) + 's，共 ' + S.spawnCount + ' 只');
check('狂甩时没有拖太久', tSpam / 60 <= N.SPAWN_TIMEOUT + 2,
      (tSpam / 60).toFixed(2) + 's（SPAWN_TIMEOUT = ' + N.SPAWN_TIMEOUT + 's）');

/* ---- 7h. 连按不再被拒：按下方向键先把整池快进到静止（顺手结算欠的那批），再执行输入 ---- */
console.log('[7h] 连按不再被拒：按下时先快进到整池静止，再执行输入');
N.reset();
clear();
const movingBall = ball(210, 100, 3);
movingBall.vy = 900;                                  // 正在飞
S.balls.push(movingBall);
S.moves = 0;
update(1 / 60);                                       // 先让 update 算出 locked
check('前提：奶蛙还在飞，按老逻辑这一下会被丢掉', S.locked === true && !N.allSettled());

const spawnBeforePress = S.spawnCount;
check('还在飞的时候按下方向键 → 被接受（不再丢输入）',
      N.applySwipe('left') === true && S.moves === 1 && S.dir === 'left',
      'moves=' + S.moves + '，dir=' + S.dir);
check('接受之前确实快进到了完全静止（没有欠账时不会凭空冒奶蛙）',
      S.ffSteps > 0 && S.ffSettled === true && S.spawnCount === spawnBeforePress,
      '快进 ' + S.ffSteps + ' 步，ffSettled=' + S.ffSettled + '，新出 ' + (S.spawnCount - spawnBeforePress) + ' 只');
check('没有走「拒绝」那条路（不抖、不提示）', S.denyFlash === 0 && S.denyText === '');
check('这一次输入照常生效：方向变了、次数 +1、又进入下一轮',
      S.dir === 'left' && S.moves === 1 && S.locked === true && S.owed === 1);

/* 连按：第二下也立刻接受，并且把上一回合欠的那批先结算掉 */
const ballsBefore2 = S.balls.length;
check('立刻再按一下也接受（第二回合）', N.applySwipe('up') === true && S.moves === 2 && S.dir === 'up',
      'moves=' + S.moves + '，dir=' + S.dir);
check('第二下之前把上一批结算出来了（每回合一批）',
      S.balls.length === ballsBefore2 + N.SPAWN_PER_TURN,
      '场上 ' + S.balls.length + ' 只（之前 ' + ballsBefore2 + ' 只）');

/* 一轮走完之后（新奶蛙也出来了）状态照样能回到“静止” */
let tWait2 = 0;
while (S.locked && tWait2 < 15 * 60) { update(1 / 60); tWait2++; }
check('停下来之后照常解锁（状态机和以前一样）', S.locked === false,
      '等了 ' + (tWait2 / 60).toFixed(2) + 's');

/* 软锁保险：池子卡住、快进到上限都静不下来时，照样放行 / 只在那时才会拒 */
N.reset();
clear();
const jitter = ball(210, 300, 2);
jitter.vx = 200; jitter.vy = 200;                      // 永远“在动”
S.balls.push(jitter);
let tLock = 0;
N.applySwipe('right');                                 // 先正常滑一下，进入一轮
while (S.locked && tLock < 30 * 60) {
  jitter.vx = 200; jitter.vy = 200;                    // 强行让它一直动
  update(1 / 60);
  tLock++;
}
check('一直静不下来也会超时放行，不会软锁', S.locked === false && tLock < 30 * 60,
      '锁了 ' + (tLock / 60).toFixed(2) + 's（SPAWN_TIMEOUT = ' + N.SPAWN_TIMEOUT + 's）');
check('快进有上限，不会无限算下去', S.ffSteps <= Math.ceil(N.FASTFWD_MAX_SEC * 60),
      '最多快进 ' + S.ffSteps + ' 步（上限 ' + Math.ceil(N.FASTFWD_MAX_SEC * 60) + '）');

/* 7i. 结算那一刻，场上必须真的全停了
   （曾经有个 bug：滑动后 rest 还残留着 true，下一帧就把新一批冒出来了，
     实测结算时平均有 8.9 只还在动） */
console.log('[7i] 新一批必须等“真的全停下”才出现');
N.reset();
clear();
for (let i = 0; i < 6; i++) {
  const b = ball(120 + i * 60, 150, i % 4);
  b.vy = 200;
  S.balls.push(b);
}
S.spawnCount = 0;
N.applySwipe('down');
frames(3);                                            // 刚滑完头几帧
check('滑动后不会立刻冒出（rest 被立刻抹掉）', S.spawnCount === 0,
      '3 帧后 spawnCount=' + S.spawnCount + '，locked=' + S.locked);

let tSettle = 0, movingAtSpawn = -1, maxSpeedAtSpawn = 0;
while (S.spawnCount === 0 && tSettle < 15 * 60) {
  update(1 / 60);
  tSettle++;
}
for (const b of S.balls) {
  if (b.dead || b.float) continue;                    // 刚冒出来的那几只本来就是 0 速度
  maxSpeedAtSpawn = Math.max(maxSpeedAtSpawn, Math.hypot(b.vx, b.vy));
}
movingAtSpawn = S.balls.filter(b => !b.dead && !b.float &&
  (b.vx * b.vx + b.vy * b.vy) > N.SETTLE_SPEED * N.SETTLE_SPEED).length;
check('新一批出现时，场上没有一只还在动', movingAtSpawn === 0,
      '还在动的 = ' + movingAtSpawn + ' 只，最快 = ' + maxSpeedAtSpawn.toFixed(1) + 'px/s');
check('等待时间合理（不是靠 8 秒保险硬放行）',
      tSettle / 60 < N.SPAWN_TIMEOUT, (tSettle / 60).toFixed(2) + 's');
console.log('[7f] 阻尼：漂着的奶蛙很快被刹住');
N.reset();
clear();
const drift = ball(210, 350, 2);
drift.float = 1;                                 // 不受重力
drift.vx = 600;
drift.vy = -400;
S.balls.push(drift);
run(90);                                         // 0.5 秒
check('0.5 秒内速度被阻尼吃掉', Math.hypot(drift.vx, drift.vy) < 40,
      '600/-400 → ' + Math.hypot(drift.vx, drift.vy).toFixed(1) + 'px/s');

/* ---- 7g. 侧墙不该拖住奶蛙 ---- */
console.log('[7g] 贴着侧墙的奶蛙不该被墙拖住（重力朝上/下时）');

/* 形状在水平方向的半宽（贴墙时拿它来摆位置，别把奶蛙塞进墙里） */
function halfExtent(tier) {
  const sh = N.shapeOf(tier), r = N.FROGS[tier].r;
  let m = 0;
  for (let i = 0; i < sh.parts.length; i++) {
    const p = sh.parts[i];
    m = Math.max(m, Math.abs(p[0]) * r + p[2] * r);
  }
  return m;
}

/* 重力向下：一只贴着左墙往下掉，另一只悬空往下掉 —— 两只应该几乎同步 */
N.reset();
clear();
N.applySwipe('down');
const hugger = ball(IN_X0 + halfExtent(2) + 0.3, 100, 2);   // 刚好贴着左墙
const freefall = ball(240, 100, 3);                          // 悬空（不同级，不会合成）
hugger.vx = -40;                                             // 轻轻压着墙
S.balls.push(hugger, freefall);
run(30);                                                     // 0.17 秒：先让它贴稳
check('测试前提：它确实贴着左墙', hugger.cL === 1 || Math.abs(bounds(hugger).minx - IN_X0) < 1.5,
      'cL=' + hugger.cL + '，离墙 ' + (bounds(hugger).minx - IN_X0).toFixed(2) + 'px');
const hx0 = hugger.y, fx0 = freefall.y;
run(90);                                                     // 0.5 秒
const dHug = hugger.y - hx0, dFree = freefall.y - fx0;
check('重力向下时：贴墙下滑的速度没有被墙吃掉', Math.abs(dHug - dFree) < 30,
      '贴墙掉了 ' + dHug.toFixed(1) + 'px，悬空掉了 ' + dFree.toFixed(1) + 'px');
check('贴墙那只确实一直在掉（没有被拖停）', dHug > 100, '掉了 ' + dHug.toFixed(1) + 'px');

/* 重力向上：贴着墙往上飘，同样不该被拖住 */
N.reset();
clear();
N.applySwipe('up');
const y2 = IN_Y1 - 110;                                      // 靠近地板、留出上升空间
const hug2 = ball(IN_X0 + halfExtent(2) + 0.3, y2, 2);
const free2 = ball(260, y2, 3);
hug2.vx = -40;
S.balls.push(hug2, free2);
run(30);
const h2y0 = hug2.y, f2y0 = free2.y;
run(90);
check('重力向上时：贴墙上升的速度也没有被吃掉',
      Math.abs((hug2.y - h2y0) - (free2.y - f2y0)) < 30,
      '贴墙 ' + (hug2.y - h2y0).toFixed(1) + 'px，悬空 ' + (free2.y - f2y0).toFixed(1) + 'px');

/* 但“地面”上的摩擦仍在：重力向下时踩地板照样刹得住（见 [10]） */
N.reset();
clear();
N.applySwipe('down');
const floorSlid = ball(200, IN_Y1 - N.FROGS[2].r, 2);
floorSlid.vx = 320;
S.balls.push(floorSlid);
run(2 * 180);
check('但踩在地板上的横向滑动照样会被刹住', Math.abs(floorSlid.vx) < 30,
      'vx = ' + floorSlid.vx.toFixed(1));

/* ---- 8. 输入 ---- */
console.log('[8] 滑动 / 键盘');
const stage = els.stage;

/* 等整池停下来（解锁）才能做下一轮选择 */
function waitUnlock(maxSec) {
  let n = 0;
  while (S.locked && n < 60 * (maxSec || 15)) { update(1 / 60); n++; }
  return n / 60;
}

N.reset();
fire(stage, 'pointerdown', { clientX: 200, clientY: 400, pointerId: 1 });
fire(stage, 'pointermove', { clientX: 208, clientY: 404 });      // 位移太小
check('小幅拖动不触发滑动', S.dir === null);
fire(stage, 'pointermove', { clientX: 200, clientY: 300 });      // 向上滑 100px
check('向上滑 → 重力向上', S.dir === 'up', 'dir = ' + S.dir);
fire(stage, 'pointerup', {});

fire(stage, 'pointerdown', { clientX: 200, clientY: 400, pointerId: 2 });
fire(stage, 'pointermove', { clientX: 320, clientY: 400 });      // 冷却中：同一次手势别重复触发
check('两次滑动之间有冷却（不会一抖两下）', S.dir === 'up', 'dir = ' + S.dir);
fire(stage, 'pointerup', {});
frames(20);                                                      // 冷却结束
check('冷却结束后立刻接着滑 → 接受，并且先把整池快进到静止',
      (fire(stage, 'pointerdown', { clientX: 200, clientY: 400, pointerId: 3 }),
       fire(stage, 'pointermove', { clientX: 320, clientY: 400 }),
       fire(stage, 'pointerup', {}), S.dir === 'right'),
      'dir = ' + S.dir);

const w8 = waitUnlock(15);                                       // 等这一轮走完
check('整池停下后解锁', S.locked === false, '等了 ' + w8.toFixed(2) + 's');
fire(stage, 'pointerdown', { clientX: 200, clientY: 400, pointerId: 4 });
fire(stage, 'pointermove', { clientX: 200, clientY: 300 });
check('再来一次 → 重力向上', S.dir === 'up', 'dir = ' + S.dir);
fire(stage, 'pointerup', {});

N.reset();
winListeners.keydown({ code: 'ArrowUp', target: { tagName: 'BODY' }, preventDefault() {} });
check('方向键 ↑ → 重力向上', S.dir === 'up');
winListeners.keydown({ code: 'ArrowLeft', target: { tagName: 'BODY' }, preventDefault() {} });
check('方向键连按也立刻生效（快进到静止再执行）', S.dir === 'left' && S.moves === 2,
      'dir = ' + S.dir + '，moves = ' + S.moves);
waitUnlock(15);
winListeners.keydown({ code: 'ArrowUp', target: { tagName: 'INPUT' }, preventDefault() {} });
check('焦点在输入框里不抢按键', S.dir === 'left');
winListeners.keydown({ code: 'KeyR', target: { tagName: 'BODY' }, preventDefault() {} });
check('R 重开：分数归零、重新漂浮', S.score === 0 && S.dir === null && S.balls.length === N.INIT_FROGS,
      'score=' + S.score + ' dir=' + S.dir + ' n=' + S.balls.length);
check('重开之后马上就能滑（开局是静着的）', S.locked === false && N.applySwipe('down') === true);

/* ---- 9. 贴图与兜底 ---- */
console.log('[9] 绘制');
drawnImages.length = 0;
N.reset();
N.render(1 / 60);
const drew = drawnImages.filter(d => d.ctx === 'game' && d.src).map(d => d.src);
check('奶蛙贴图真的走 drawImage', drew.length >= N.INIT_FROGS, '本帧画了 ' + drew.length + ' 张贴图');
check('画的是 assets/frogs/ 下的 11 张奶蛙', drew.every(s => s.indexOf('assets/frogs/') === 0));

/* 快进特效（按下方向键那一下会画）别把渲染搞崩 */
S.warp = 1;
let warpThrew = false;
try { for (let f = 0; f < 20; f++) { N.render(1 / 60); update(1 / 60); } } catch (e) { warpThrew = true; }
check('快进特效从亮到灭都不报错', warpThrew === false && S.warp === 0,
      '20 帧后 warp = ' + S.warp);

/* 贴图缺失（加载失败/被删）时必须自动回退成程序化奶蛙，而不是白屏 */
const savedImg = N.FROGS[0].img;
delete N.FROGS[0].img;
drawnImages.length = 0;
let threw = false;
try { N.render(1 / 60); } catch (e) { threw = true; }
const drew2 = drawnImages.filter(d => d.ctx === 'game' && d.src).map(d => d.src);
check('少一张贴图时不会报错', threw === false);
check('缺的那级回退成程序化绘制（帧照常画完）',
      drew2.every(s => s.indexOf('01.png') < 0) && drew2.length > 0,
      '本帧仍画了 ' + drew2.length + ' 张贴图');
N.FROGS[0].img = savedImg;

/* ---- 10. 切向摩擦：重力朝左右时，压着墙的奶蛙要停得住 ---- */
console.log('[10] 切向摩擦（重力朝左右）');

/* 重力向左 → 奶蛙压在「左墙」上。它有竖直方向的初速度，
   切向摩擦必须作用在 vy 上，否则它会顺着墙一直往下滑、堆不稳 */
N.reset();
clear();
N.applySwipe('left');
S.balls.push(ball(60, 200, 2));         // r=31，靠近左墙
S.balls[0].vx = -400;                   // 被甩向左墙
S.balls[0].vy = 420;                    // 顺便顺着墙往下滑
run(2 * 180);                           // 2 秒
const wallFrog = S.balls[0];
check('压着左墙时竖直方向被摩擦刹住',
      Math.abs(wallFrog.vy) < 30, 'vy = ' + wallFrog.vy.toFixed(1) + '（修复前会一直是 ~420）');
check('最终贴着左墙停下',
      Math.abs(wallFrog.vx) < 30 && Math.abs(bounds(wallFrog).minx - IN_X0) < 2,
      'vx = ' + wallFrog.vx.toFixed(1) + '，离墙 = ' + (bounds(wallFrog).minx - IN_X0).toFixed(2) + 'px');

/* 反向：重力向右 → 压右墙，竖直方向同样要刹住 */
N.reset();
clear();
N.applySwipe('right');
S.balls.push(ball(360, 200, 2));
S.balls[0].vx = 400;
S.balls[0].vy = -420;
run(2 * 180);
check('压着右墙时竖直方向被摩擦刹住',
      Math.abs(S.balls[0].vy) < 30, 'vy = ' + S.balls[0].vy.toFixed(1));

/* 回归：重力向下时，地板上的横向滑动也要停 */
N.reset();
clear();
N.applySwipe('down');
S.balls.push(ball(200, 0, 2));
S.balls[0].x = 200; S.balls[0].y = IN_Y1 - N.FROGS[2].r; S.balls[0].px = 200; S.balls[0].py = S.balls[0].y;
S.balls[0].vx = 320;
run(2 * 180);
check('踩着地板横向滑动会被摩擦刹住',
      Math.abs(S.balls[0].vx) < 30, 'vx = ' + S.balls[0].vx.toFixed(1));

/* 天花板同理 */
N.reset();
clear();
N.applySwipe('up');
S.balls.push(ball(200, 100, 2));
S.balls[0].vx = -320;
run(2 * 180);
check('贴着天花板横向滑动会被摩擦刹住',
      Math.abs(S.balls[0].vx) < 30, 'vx = ' + S.balls[0].vx.toFixed(1));

/* 整堆稳定性：重力朝左时甩一池子奶蛙过去，最后必须“静下来”
   （修复前压在左墙上的奶蛙会顺着墙一直滑，1 秒能滑出几十像素） */
N.reset();
clear();
N.applySwipe('left');
for (let i = 0; i < 16; i++) {
  /* 4×4 摊开摆：奶蛙放大之后按原来的密格子摆会深度重叠，一上来就被弹飞，
     那不是这条用例要测的东西 */
  const b = ball(75 + (i % 4) * 130, 75 + Math.floor(i / 4) * 130, i % 6);
  b.vx = 300 + i * 12;                      // 全向左墙甩
  b.vy = (i % 2 ? 1 : -1) * (260 + i * 9);  // 竖直方向乱飞，专门制造“沿墙滑”
  S.balls.push(b);
}
run(9 * 180);                               // 9 秒：足够贴墙、堆好、静下来
const before = S.balls.map(b => ({ x: b.x, y: b.y }));
run(1 * 180);                               // 再跑 1 秒，看还有没有在动的
let maxMove = 0, maxSpeed = 0;
for (let i = 0; i < S.balls.length; i++) {
  const b = S.balls[i];
  maxMove = Math.max(maxMove, Math.hypot(b.x - before[i].x, b.y - before[i].y));
  maxSpeed = Math.max(maxSpeed, Math.hypot(b.vx, b.vy));
}
check('16 只甩向左墙后整堆静下来（没有沿墙滑）', maxMove < 3,
      '1 秒内最大位移 = ' + maxMove.toFixed(2) + 'px，最大速度 = ' + maxSpeed.toFixed(1) + 'px/s');
let oob = '';
for (const b of S.balls) { const e = badBall(b); if (e) { oob = e; break; } }
check('这堆奶蛙都还在池子里', oob === '', oob);

/* ---- 汇总 ---- */
console.log('');
console.log(pass ? '全部通过 ✅' : '有失败项 ❌');
process.exit(pass ? 0 : 1);
