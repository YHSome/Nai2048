/* ============================================================
 *  奶蛙2048 · 打赏作者弹窗
 *  结算页点「🌶️ 可以赏作者一包辣条嘛」弹出微信收款码。
 *  纯静态弹窗，不发任何网络请求。
 * （从「合成大奶娃」样例原样搬过来的，只改了文案与全局名）
 * ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function open() {
    const m = $('sponsorModal');
    if (!m) return;
    m.classList.add('show');
    m.setAttribute('aria-hidden', 'false');
  }

  function close() {
    const m = $('sponsorModal');
    if (!m) return;
    m.classList.remove('show');
    m.setAttribute('aria-hidden', 'true');
  }

  function bind() {
    const btn = $('sponsorBtn');
    if (btn) btn.addEventListener('click', open);

    const x = $('sponsorClose');
    if (x) x.addEventListener('click', close);

    const ok = $('sponsorOk');
    if (ok) ok.addEventListener('click', close);

    const m = $('sponsorModal');
    if (m) {
      m.addEventListener('click', (e) => { if (e.target === m) close(); });  // 点卡片外面关掉
    }

    /* 玩家直接重开：把弹窗一起收掉，免得盖在新一局上面 */
    const restart = $('restartBtn');
    if (restart) restart.addEventListener('click', close);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.NaiwaSponsor = { open: open, close: close };
})();
