/* ==========================================================================
 * sw-register.js —— 页面侧接入脚本（配合 sw.js）
 * 职责：注册 SW、上报「当前页面是否在前台 / 语言 / 网络状态」、定时触发更新检查、
 *       提供强制刷新 / 预下载的封装
 * 用法：<script src="/sw-register.js" defer></script>
 * ========================================================================== */

// biome-ignore-all lint/complexity/useArrowFunction: AI generated code.
(function () {
  if (!('serviceWorker' in navigator)) return;

  var SW_URL = '/sw.js';
  var SCOPE = '/';
  var SYNC_INTERVAL = 60 * 1000; // 定时检测更新间隔
  var LANG_KEY = 'language';     // 错误页语言读取自 localStorage.getItem('language')
  var DEFAULT_LANG = 'zh-cn';
  var applying = false;

  function controller() {
    return navigator.serviceWorker.controller;
  }
  function post(msg) {
    var c = controller();
    if (c) c.postMessage(msg);
    return !!c;
  }

  function readLang() {
    try {
      var v = localStorage.getItem(LANG_KEY);
      return String(v || '').trim().toLowerCase() || DEFAULT_LANG; // 语言转小写，读取失败兜底 en
    } catch (e) {
      return DEFAULT_LANG;
    }
  }

  // 只有用户确认后才刷新，避免打断操作
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    // 新 SW 接管后语言状态是空的（内存重置），立刻补报，
    // 否则这段时间的 404 会错误地落到默认语言
    post({ type: 'sw:lang', lang: readLang() });
    if (applying) window.location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register(SW_URL, { scope: SCOPE })
      .then(function () {
        // 注册完成后再报一次：首次注册时 controller 还是 null，上面的 post 会被丢弃
        post({ type: 'sw:lang', lang: readLang() });
      })
      .catch(function (err) {
        console.warn('[sw] register failed', err);
      });

    // 先注册 visibility 监听，再立即上报一次
    var report = function () {
      post({
        type: 'sw:visibility',
        visible: document.visibilityState === 'visible',
        lang: readLang(),
        online: navigator.onLine !== false,
      });
    };
    document.addEventListener('visibilitychange', report);
    report();

    // 单独上报语言（首次接管 / 语言切换时）
    post({ type: 'sw:lang', lang: readLang() });

    // SW 被系统回收后重新接管时再报一次（Safari 会频繁回收 SW 进程）
    navigator.serviceWorker.ready.then(function (reg) {
      post({ type: 'sw:lang', lang: readLang() });
      if (reg.active) {
        reg.active.addEventListener('statechange', function () {
          if (reg.active && reg.active.state === 'activated') {
            post({ type: 'sw:lang', lang: readLang() });
          }
        });
      }
    });

    // 多标签页之间语言同步
    window.addEventListener('storage', function (e) {
      if (e.key === LANG_KEY) post({ type: 'sw:lang', lang: readLang() });
    });

    // 网络状态上报：让 SW 在断网时直接查缓存、不发请求
    window.addEventListener('online', function () {
      post({ type: 'sw:net', online: true });
      post({ type: 'sw:sync' });
    });
    window.addEventListener('offline', function () {
      post({ type: 'sw:net', online: false });
    });

    // 定时检测更新：只在页面可见时触发，后台标签页不打扰
    setInterval(function () {
      if (document.visibilityState === 'visible') post({ type: 'sw:sync' });
    }, SYNC_INTERVAL);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') post({ type: 'sw:sync' });
    });

    navigator.serviceWorker.addEventListener('message', function (event) {
      var data = event.data || {};
      // 统一以 DOM 事件抛给业务层监听
      window.dispatchEvent(new CustomEvent(data.type, { detail: data }));

      if (data.type === 'sw:update' && data.hasEntryUpdate) {
        // 有新版本：接你自己的 UI，例如「有新版本，点击刷新」→ window.swApplyUpdate()
        console.info('[sw] 有新版本可用：', data.updated);
      }
      if (data.type === 'sw:precache-done') {
        console.info('[sw] 预下载完成：', data.total, '个文件');
      }
    });
  });

  /** 应用新版本：让等待中的 SW 立即接管并刷新页面 */
  window.swApplyUpdate = function swApplyUpdate() {
    if (!controller()) {
      window.location.reload();
      return;
    }
    applying = true;
    controller().postMessage({ type: 'sw:skip-waiting' });
  };

  /**
   * 强制刷新（清单外资源常用）：SW 会带 ?_t=xxx 走网络绕开各级缓存，
   * 但缓存 key 仍是原始 URL，opaque 跨源资源原样存储不改写。
   * @param {string|string[]} urls
   * @param {{priority?:'CRITICAL'|'HIGH'|'NORMAL'|'LOW'|'IDLE', destination?:string, reload?:boolean}} options
   * @returns {Promise<Array>} results
   */
  window.swForceRefresh = function swForceRefresh(urls, options) {
    var list = Array.isArray(urls) ? urls : [urls];
    return new Promise(function (resolve) {
      if (!controller()) return resolve([]);
      var onMsg = function (event) {
        if (event.data && event.data.type === 'sw:refreshed') {
          navigator.serviceWorker.removeEventListener('message', onMsg);
          resolve(event.data.results || []);
          if (options && options.reload) window.location.reload();
        }
      };
      navigator.serviceWorker.addEventListener('message', onMsg);
      controller().postMessage({ type: 'sw:refresh', urls: list, options: options || {} });
      setTimeout(function () {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve([]);
      }, 15000);
    });
  };

  /** 手动上报语言（业务层切换语言后调用） */
  // window.swSetLang = function swSetLang(lang) {
  //   try {
  //     if (lang) localStorage.setItem(LANG_KEY, String(lang).toLowerCase());
  //   } catch (e) {}
  //   return post({ type: 'sw:lang', lang: readLang() });
  // };
  window.swSetLang = function swSetLang(lang) {
    return post({ type: 'sw:lang', lang: lang.toLowerCase() })
  }

  /** 手动触发清单全量预下载 */
  window.swPrecache = function swPrecache() {
    return post({ type: 'sw:precache' });
  };

  /** 预取当前语言的错误页 */
  window.swPrefetchErrorPages = function swPrefetchErrorPages(lang) {
    return post({ type: 'sw:prefetch-error-pages', lang: (lang || readLang()).toLowerCase() });
  };

  /**
   * 性能诊断：命中率、来源分布、调度器水位、最近慢请求
   * 用法：swPerf().then(p => console.table(p.perf.slow))
   */
  window.swPerf = function swPerf(reset) {
    return new Promise(function (resolve) {
      var onMsg = function (event) {
        if (event.data && event.data.type === 'sw:perf') {
          navigator.serviceWorker.removeEventListener('message', onMsg);
          resolve(event.data);
        }
      };
      navigator.serviceWorker.addEventListener('message', onMsg);
      if (!post({ type: 'sw:perf', reset: !!reset })) resolve(null);
      setTimeout(function () {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve(null);
      }, 3000);
    });
  };

  /** 把指定资源预热进 SW 内存缓存（不传则用清单里的 html/js/css） */
  window.swWarm = function swWarm(urls) {
    return post({ type: 'sw:warm', urls: urls });
  };

  /** 调试：拿清单 / 缓存 / opaque / 网络 / 语言状态 */
  window.swStatus = function swStatus() {
    return new Promise(function (resolve) {
      var onMsg = function (event) {
        if (event.data && event.data.type === 'sw:status') {
          navigator.serviceWorker.removeEventListener('message', onMsg);
          resolve(event.data);
        }
      };
      navigator.serviceWorker.addEventListener('message', onMsg);
      if (!post({ type: 'sw:status' })) resolve(null);
    });
  };
})();
