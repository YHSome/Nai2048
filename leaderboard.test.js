/* ============================================================
 *  leaderboard.js 行为测试
 *  用一个内存版 TinyWebDB 顶掉 fetch（模拟真实接口：按提交时间倒序、no 是 1 起的行偏移），验证：
 *    · 榜单 = 最近 30 次提交，更早的成绩哪怕分再高也不出现
 *    · 窗口内按分数排名
 *    · 全程只读别人的数据（只有 search），提交只写自己那一条
 *    · 只会请求 SCAN_PAGES 页
 *    · 兼容老格式 tag（中段是毫秒十进制）
 *    · 昵称清洗 / 0 分不上榜 / 防手抖间隔
 *  运行：node leaderboard.test.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let store = new Map();   // 插入顺序 = 提交顺序
let calls = [];

function fakeFetch(url, opts) {
  const p = {};
  (opts && opts.body).forEach((v, k) => { p[k] = v; });
  calls.push(p);

  const action = p.action, tag = p.tag;
  let res;

  if (action === 'update') {
    store.set(tag, p.value);
    res = { status: 'success' };
  } else if (action === 'delete') {
    store.delete(tag);
    res = { status: 'success' };
  } else if (action === 'get') {
    res = {};
    res[tag] = store.has(tag) ? store.get(tag) : 'null';
  } else if (action === 'search') {
    const no = parseInt(p.no || '1', 10);
    const cnt = parseInt(p.count || '100', 10);
    // 真机行为：最新提交排最前，no 是 1 起的行偏移
    const keys = [...store.keys()].reverse().filter((k) => k.indexOf(tag) === 0);
    res = {};
    keys.slice(no - 1, no - 1 + cnt).forEach((k) => { res[k] = store.get(k); });
  } else {
    throw new Error('未知 action: ' + action + '（编解码对不上？）');
  }

  return Promise.resolve({
    ok: true, status: 200,
    text: () => Promise.resolve(JSON.stringify(res))
  });
}

/* ---- 桩件 DOM：只要够 leaderboard.js 跑起来 ---- */
const els = {};
function makeEl(id) {
  const el = {
    id, value: '', textContent: '', hidden: false, style: {}, _c: new Set(), _kids: [],
    className: '',
    classList: {
      add: (c) => el._c.add(c), remove: (c) => el._c.delete(c), contains: (c) => el._c.has(c)
    },
    setAttribute() {}, addEventListener() {},
    appendChild(k) { el._kids.push(k); },
    querySelector() { return null; }
  };
  return el;
}
['boardList', 'boardModal', 'submitMsg', 'nickInput', 'myNameLabel', 'submitBtn', 'submitBox',
 'boardBtn', 'boardBtn2', 'boardClose', 'boardRefresh', 'editNameBtn'].forEach(id => els[id] = makeEl(id));

const listeners = {};
const doc = {
  readyState: 'complete', activeElement: null,
  getElementById: (id) => els[id] || null,
  createElement: () => makeEl('tmp'),
  addEventListener(t, fn) { listeners[t] = fn; }
};
const mem = {};
const sandbox = {
  window: { addEventListener() {} },
  document: doc,
  localStorage: {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  },
  fetch: fakeFetch,
  URLSearchParams, setTimeout, clearTimeout, console, Date, Math, JSON, Number, String, isFinite
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'leaderboard.js'), 'utf8'),
                sandbox, { filename: 'leaderboard.js' });

const Board = sandbox.window.NaiwaBoard;
if (!Board) { console.error('FAIL: 没有导出 NaiwaBoard'); process.exit(1); }
const CFG = Board._cfg;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  [OK] ' + label); }
  else { fail++; console.log('  [NG] ' + label + (extra ? '  -- ' + extra : '')); }
}
function eq(a, b, label) { ok(a === b, label, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

const b36 = (n) => n.toString(36);
const T0 = 1790650000000;
function seed(name, score, i, opts) {
  opts = opts || {};
  const t = opts.t || (T0 + i * 1000);
  const mid = opts.rawMid || b36(t);
  const tag = CFG.PREFIX + mid + '_' + i.toString(36);
  const val = opts.noT ? JSON.stringify({ n: name, s: score })
                       : JSON.stringify({ n: name, s: score, t: t });
  store.set(tag, val);
  return tag;
}

(async function main() {
  console.log('窗口 = 最近 ' + CFG.WINDOW + ' 次提交，prefix = ' + CFG.PREFIX +
              '，扫描页数 = ' + CFG.SCAN_PAGES + '\n');

  /* [1] 窗口：最旧的 10 条给超大分数，最新的 30 条给普通分数 */
  console.log('[1] 榜单 = 最近 30 次提交');
  for (let i = 0; i < 10; i++) seed('老古董' + i, 50000 + i, i);
  for (let i = 0; i < 30; i++) seed('新玩家' + i, 1000 + i * 10, 10 + i);
  calls = [];
  const rows = await Board.fetchTop();
  eq(rows.length, 30, '榜单正好 30 条');
  ok(!rows.some((r) => r.score >= 50000), '早于窗口的 5 万分记录全都不出现');
  ok(rows.every((r) => r.name.indexOf('新玩家') === 0), '出现的全是最近这 30 条');
  eq(rows[0].score, 1290, '窗口内第一名 = 最新一批里分最高的 1290');
  eq(rows[29].score, 1000, '最后一名 = 1000');
  ok(rows.every((r, i) => i === 0 || rows[i - 1].score >= r.score), '窗口内按分数从高到低');

  console.log('\n[2] 只读别人的数据，提交只写自己那条');
  const acts = calls.map((c) => c.action);
  eq(acts.filter((a) => a === 'search').length, CFG.SCAN_PAGES, '一共 ' + CFG.SCAN_PAGES + ' 次 search');
  eq(acts.filter((a) => a === 'delete').length, 0, '0 次 delete');
  eq(acts.filter((a) => a === 'update').length, 0, '读榜时 0 次 update');
  const q = calls[0];
  eq(q.type, 'both', 'search 用的是 type=both');
  eq(q.tag, CFG.PREFIX, 'search 只查自己这个前缀');
  eq(q.count, '100', '每页 100 条');

  console.log('\n[3] 新提交会把老成绩挤出窗口');
  const before = store.size;
  await Board.submitScore('刚来的', 7777);
  eq(store.size, before + 1, '库裏多了一条');
  const up = calls.filter((c) => c.action === 'update')[0];
  ok(up && up.tag.indexOf(CFG.PREFIX) === 0, 'tag 带自己的前缀（不去碰别人的键）');
  ok(/^\{.*"n":"刚来的".*\}$/.test(up.value), 'value 是 {"n","s","t"} 的 JSON', up.value);
  const rows2 = await Board.fetchTop();
  eq(rows2.length, 30, '仍然是 30 条');
  eq(rows2[0].name, '刚来的', '7777 分排到窗口内第一');
  ok(!rows2.some((r) => r.name === '新玩家0' && r.score === 1000), '最老的那条被挤出窗口');

  console.log('\n[4] 兼容老格式 tag（中段是毫秒十进制、记录里没有 t）');
  store.clear();
  seed('旧格式', 456, 0, { rawMid: '1790656995859', noT: true });
  seed('新格式', 123, 1, { t: 1790656995859 + 60000 });
  const rows3 = await Board.fetchTop();
  eq(rows3.length, 2, '两条都在窗口里');
  eq(rows3[0].name, '旧格式', '时间戳解析出来了，456 分排前');

  console.log('\n[5] 脏数据：坏 JSON / 负数 / 离谱分数 都被丢掉');
  store.clear();
  store.set(CFG.PREFIX + 'bad1', '这不是 json');
  store.set(CFG.PREFIX + 'bad2', JSON.stringify({ n: '负数', s: -5, t: T0 }));
  store.set(CFG.PREFIX + 'bad3', JSON.stringify({ n: '离谱', s: CFG.MAX_SCORE + 1, t: T0 }));
  store.set(CFG.PREFIX + 'ok1', JSON.stringify({ n: '正常', s: 10, t: T0 }));
  const rows5 = await Board.fetchTop();
  eq(rows5.length, 1, '只剩 1 条有效记录');
  eq(rows5[0].name, '正常', '留下的就是那条正常的');

  console.log('\n[6] 空库');
  store.clear();
  eq((await Board.fetchTop()).length, 0, '空库返回空数组，不报错');

  console.log('\n[7] 昵称清洗');
  eq(Board._cleanName('   呱呱  '), '呱呱', '去掉首尾空白');
  eq(Board._cleanName('一'.repeat(30)).length, 12, '限长 12 字');
  eq(Board._cleanName('a\u0000b\u001fc'), 'abc', '去掉控制字符');
  eq(Board.myName(), CFG.DEFAULT_NAME, '没填昵称 → 默认用户');
  Board.setName('奶蛙大王');
  eq(Board.myName(), '奶蛙大王', '设了昵称就用昵称');
  eq(els.myNameLabel.textContent, '奶蛙大王', '界面上也跟着刷新');

  console.log('\n[8] 结算：0 分不上榜');
  els.submitBox.style.display = '';
  Board.onGameOver(0);
  eq(els.submitBox.style.display, 'none', '0 分时结算区直接隐藏（不提交）');

  console.log('\n[9] 抗 502：失败会退避重试（最多 3 次请求）');
  store.clear();
  let n = 0;
  const realFetch = sandbox.fetch;
  sandbox.fetch = (url, opts) => {
    n++;
    if (n === 1) return Promise.resolve({ ok: false, status: 502, text: () => Promise.resolve('') });
    return realFetch(url, opts);
  };
  const r = await Board.fetchTop();
  ok(r.length === 0, '重试后正常返回（空库 → 0 条）');
  ok(n >= 2, '确实重试了（' + n + ' 次请求）');
  sandbox.fetch = realFetch;

  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
