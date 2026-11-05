/* 4399 启动适配
 * 1. 标记平台环境，game.js 会据此跳过 Service Worker。
 * 2. 兼容 PWA 缓存与 4399 平台更新机制冲突的问题。
 * 3. 4399 官方 logo 缺失时显示文字兜底，避免审核时出现裂图。
 */
(function () {
  window.__SQ_4399__ = true;

  try {
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error('Service Worker disabled on 4399'));
      };
    }
  } catch (_) {
    /* 某些环境 register 只读，game.js 里还有 __SQ_4399__ 判断兜底 */
  }

  function showFallback() {
    var badge = document.getElementById('platform-badge');
    if (badge) badge.classList.add('is-fallback');
  }

  window.addEventListener('DOMContentLoaded', function () {
    var img = document.getElementById('platform-badge-img');
    if (!img) {
      showFallback();
      return;
    }
    img.addEventListener('error', showFallback);
    if (img.complete && img.naturalWidth === 0) showFallback();
  });
})();
