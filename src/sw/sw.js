/* ==========================================================================
 * sw.js
 *
 * 1) 前台请求优先：优先级队列 + 全局并发上限，后台预下载永远排在最后
 * 2) Cache First：命中即返回，不占网络并发；无网络时直接查缓存，查不到立即拒绝（不发请求）
 * 3) /_hash 清单驱动：定时拉取做 diff，增量更新 + 清理失效；清单内文件全量预下载
 * 4) 跨源 no-cors 图片（opaque）缓存，默认 TTL 600s，过期 stale-while-revalidate
 * 5) postMessage 强制刷新：网络带 ?_t=xxx 绕过缓存，缓存 key 永远用原始 URL，
 *    opaque 响应原样存储绝不改写
 * 6) 同源异常 HTML（403/404…）→ /http/{status}/{lang}/index.html（lang 由页面上报）
 * 7) 静态路由：内容哈希的不可变产物不走 SW，消除 Safari 唤醒 SW 进程的数百 ms 开销
 *
 * 清单格式（每行一个）：
 *   /index.html 8f2a1c...
 *   /http/404/en/index.html c751abc2
 * ========================================================================== */

const CONFIG = {
  // —— 清单与缓存 ——
  manifestUrl: '/_hash',
  cacheName: 'app-static-v1',
  metaCacheName: 'app-meta-v1',
  manifestKey: '/__hash_manifest__.json',
  ttlPrefix: '/__ttl__/',
  opaqueIndexKey: '/__opaque_index__.json',

  // —— 调度：实时请求与后台预取分账，各走各的额度 ——
  // 关键：后台预取最多占 backgroundLimit 个并发，永远不会把 6 个槽全占满，
  // 实时请求永远有 realtimeLimit 个槽可用 —— 消除队头阻塞
  scheduler: {
    realtimeLimit: 6,   // CRITICAL/HIGH/NORMAL 可用槽位
    backgroundLimit: 2, // LOW/IDLE（预下载、后台更新）可用槽位
  },
  networkTimeoutMs: 10000,
  queueTimeoutMs: 15000,
  coalesce: true,

  // —— 预下载（清单全量） ——
  precache: {
    allOnInstall: true,
    reportProgress: true,
    entryPriority: 'HIGH',  // 入口文件走实时额度，install 会等它完成
    restPriority: 'LOW',    // 其余走后台额度，install 不等它，慢慢下完即可
    fillMissingOnActivate: true,
    warmPaths: null,        // 内存预热只覆盖这些前缀，null = 全部入口文件
  },
  syncIntervalMs: 60 * 1000,

  // —— 按需缓存（清单外同源资源） ——
  cacheOutsideManifest: true,

  // —— 内存二级缓存：命中就不用碰 Cache API 磁盘 IO ——
  // 这是解决「缓存命中却要 1s」的核心手段
  memory: {
    enabled: true,
    maxBytes: 24 * 1024 * 1024, // 总预算
    maxEntryBytes: 512 * 1024,  // 单文件上限，超过的不进内存
    maxEntries: 300,
    destinations: ['document', 'script', 'style', 'font', 'image'],
    warmOnInstall: true,        // install 后把入口文件预热进内存
    warmMaxBytes: 4 * 1024 * 1024,
  },

  // —— 资源识别 + HTML 驱动的预热 ——
  // 场景：Swup 等 SPA 路由用 JS 动态注入 <link>/<script>，这类请求 destination 是 empty，
  // 会被「接口类直通」规则漏掉而裸连网络。这里按 URL 扩展名兜底识别真实类型。
  assets: {
    inferFromExtension: true,
    // 返回 HTML 后，立刻把里面引用的 css/js/字体预热进内存。
    // 这样 Swup 拿到 HTML → 插入 <link> 的那一刻，CSS 已经在内存里 → 1ms 命中
    prefetchFromHtml: true,
    prefetchMax: 12,      // 单次最多预热多少个
    prefetchMissing: true, // 缓存里没有的，后台 IDLE 补下
  },

  // —— 缓存匹配选项 ——
  // ignoreVary:true 消除服务端 Vary 头导致的「假 miss」（缓存里有却匹配不上）
  match: { ignoreVary: true },

  // —— 直通：这类请求从不写缓存，直接跳过一次无谓的 cache 读取（省 IO，降延迟） ——
  passthrough: {
    destinations: ['empty'], // fetch/XHR 接口类
    respectNoStore: false,    // req.cache === 'no-store' 时直连网络
    // Swup / 各种 SPA 路由用 fetch() 拉 HTML，destination 是 empty 但其实是页面请求：
    // true = Accept 含 text/html 时当作 document 走缓存，别直连网络
    htmlFetchAsDocument: true,
  },

  // —— 诊断：给响应加 X-SW-From / X-SW-Time，DevTools 里一眼看出到底是不是命中 ——
  debug: {
    header: false,     // 定位完记得关掉
    logSlowMs: 100,   // >0 时把慢响应打到 console
    keepSlow: 50,     // 保留最近 N 条慢请求用于 sw:perf
  },

  // —— 同源请求缓存 key 策略 ——
  // ignoreSearch=true：同源请求的 search string 不参与缓存 key（/?a=1 与 / 视为同一份）
  // 只对静态资源生效；接口类请求（destination=empty）永远带完整 query，避免串数据
  sameOrigin: {
    ignoreSearch: true,
    // 只对这些 destination 忽略 search；null = 全部（不含接口类）
    applyTo: null,
    // 路径白名单/黑名单前缀，null = 不限制
    includePrefix: null,
    excludePrefix: null,
  },

  // —— 网络状态探测 ——
  // 目的：断网时一个请求都不发，直接查缓存；查不到立即拒绝，别让用户等超时
  net: {
    offlineThreshold: 2,     // 连续失败几次判定为离线
    probeIntervalMs: 15000,  // 离线时的探测间隔（拉清单，成功即恢复）
    useNavigatorOnline: true,// 参考 navigator.onLine
    broadcast: true,
  },

  // —— 跨源 opaque（no-cors 图片） ——
  opaque: {
    enabled: true,
    destinations: ['image'],
    ttlMs: 600 * 1000,            // 默认缓存 600s
    maxEntries: 100,              // opaque 按 ~7MB/条 计配额，务必设上限
    staleWhileRevalidate: true,
    revalidatePriority: 'IDLE',
  },

  // —— 同源异常 HTML 兜底 ——
  errorPage: {
    enabled: true,
    // lang 已由页面上报并转小写；清单中的 key 形如 /http/404/en/index.html
    template: (status, lang) => `/http/${status}/${lang}/index.html`,
    defaultLang: 'zh-cn',
    fallbackToDefaultLang: false, // true：当前 lang 缺失时退回默认语言
    prefetchStatuses: [400, 401, 403, 404, 410, 500, 502, 503, 504],
    prefetchOnLangChange: true,   // 语言变化时后台补下该语言的错误页
    statuses: null,               // null = minStatus~maxStatus 全部
    minStatus: 400,
    maxStatus: 599,
    matchContentType: /text\/html/i,
    keepOriginalStatus: true,     // 错误页 body + 原始状态码（对 SEO / fetch 更友好）
    cacheTemplate: true,
    // 导航请求直接用错误页，不看服务端返回的 content-type。
    // 有些服务端 404 时给 text/plain 甚至空 content-type，
    // 若因此不替换，用户就会看到裸 404 而不是你的友好错误页。
    ignoreContentTypeForNavigation: true,
  },

  // —— 导航回落（SPA 兜底）——
  // ⚠️ 这里曾是「404 返回首页」的元凶：导航请求只要 /index.html 在缓存里就直接命中它，
  // 于是请求根本走不到网络，服务端 404 永远不会被发现，
  // /http/404/{lang}/index.html 也就永远没机会生效。
  navFallback: {
    online: false,           // 在线时是否回落到首页；默认 false —— 让 404 正确返回错误页
    skipIfHasExtension: true,// online=true 时，带扩展名的路径（/x.css）视为静态资源，不回落
    offline: true,           // 离线 / 网络失败时回落首页，总比白屏强
  },

  // —— 其他 ——
  navCandidates: ['/', '/index.html'],
  offlineFallback: '/index.html',
  claimOnActivate: true, // 建议 true：否则 install/activate 期间的页面不被接管，会裸连网络
};

/* ==================== 静态路由（消除 SW 唤醒税） ==================== */
/**
 * 问题：Safari 下 SW 进程会被系统休眠（App Nap），Swup 切换时首个请求要付出
 * 「唤醒 SW 进程 + 跑一遍 JS」的成本 —— W3C 实测 p95 达 350~436ms。
 * 而 /_astro/xxx.hash.css 这种内容哈希、永不变更的资源，根本不需要 SW 参与。
 *
 * 解法分两档：
 *  A) Safari 27+ / Chrome 123+：InstallEvent.addRoutes() 声明式路由。
 *     浏览器直接命中 Cache Storage，连 fetch 事件都不派发 —— SW 冷启动也零成本。
 *  B) 更老的 Safari：这些请求干脆不调 respondWith()，让浏览器走原生 HTTP 缓存
 *     （内容哈希 + max-age=immutable，命中率极高）。离线时才回落到 SW 缓存。
 */
const STATIC_ROUTING = {
  enabled: false,
  cacheName: null,        // null = 用 CONFIG.cacheName
  pathnames: ['/_astro/*'],// 构建产物目录，按需增删
  destinations: null,     // 或 ['style', 'script', 'font']
  // A 档不可用时（老 Safari）是否启用 B 档放行
  passthroughWhenUnsupported: true,
  // 放行前是否要求在线（离线时必须回落到 SW 缓存，否则断网就白屏）
  requireOnline: true,
};

/** addRoutes 是否注册成功；false 时走 B 档 */
let staticRoutesReady = false;

/** '/_astro/*' → 前缀匹配器（只支持尾部通配，够用且零依赖） */
function globMatchers(patterns) {
  return patterns.map((p) => {
    const i = p.indexOf('*');
    return i < 0 ? (u) => u === p : (u) => u.startsWith(p.slice(0, i));
  });
}
const staticMatchers = globMatchers(STATIC_ROUTING.pathnames);
const matchesStaticPath = (pathname) => staticMatchers.some((m) => m(pathname));

function registerStaticRoutes(event) {
  if (!STATIC_ROUTING.enabled) return false;
  if (typeof event.addRoutes !== 'function' || typeof URLPattern === 'undefined') return false;
  const cacheName = STATIC_ROUTING.cacheName || CONFIG.cacheName;
  const rules = [];
  const push = (rule) => {
    try {
      // 提前自检，避免整批规则因单条非法而被整体拒绝
      if (rule.condition.urlPattern) new URLPattern(rule.condition.urlPattern);
      rules.push(rule);
    } catch {
      /* 跳过非法规则 */
    }
  };
  for (const p of STATIC_ROUTING.pathnames) {
    push({ condition: { urlPattern: { pathname: p }, requestMethod: 'get' }, source: { cacheName } });
  }
  for (const d of STATIC_ROUTING.destinations || []) {
    push({ condition: { requestDestination: d, requestMethod: 'get' }, source: { cacheName } });
  }
  if (!rules.length) return false;
  try {
    const r = event.addRoutes(rules); // 内部已延长 install 生命周期
    if (r && typeof r.catch === 'function') r.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

const P = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3, IDLE: 4 };
const P_OF = (name) => (name in P ? P[name] : P.NORMAL);

const SELF_ORIGIN = self.location.origin;
const MANIFEST_PATH = new URL(CONFIG.manifestUrl, self.location).pathname;
const CACHEABLE_DESTINATIONS = new Set([
  'document', 'script', 'style', 'font', 'image', 'audio', 'video', 'manifest', 'worker', 'sharedworker',
]);

const absUrl = (u) => new URL(u, self.location).href;

/* ==================== 缓存对象：复用，避免每个请求 caces.open ==================== */

let _staticCacheP = null;
let _metaCacheP = null;
const getCache = () => (_staticCacheP || (_staticCacheP = caches.open(CONFIG.cacheName)));
const getMeta = () => (_metaCacheP || (_metaCacheP = caches.open(CONFIG.metaCacheName)));

/* ============================ 1. 优先级调度器 ============================ */

const isBackground = (p) => p >= P.LOW;

/**
 * 双预算调度器：
 * - 实时任务（CRITICAL/HIGH/NORMAL）用 realtimeLimit 个槽
 * - 后台任务（LOW/IDLE，预下载/后台更新）用 backgroundLimit 个槽
 * 两类额度互不侵占：后台预取再猛，也堵不死实时请求（消除队头阻塞）
 */
class PriorityScheduler {
  constructor(realtimeLimit, backgroundLimit) {
    this.rtLimit = realtimeLimit;
    this.bgLimit = backgroundLimit;
    this.activeRt = 0;
    this.activeBg = 0;
    this.queue = [];
    this.seq = 0;
  }

  /** priority 越小越先执行；同优先级按入队顺序 FIFO（稳定） */
  add(priority, task, queueTimeoutMs = 0) {
    return new Promise((resolve, reject) => {
      const item = { priority, seq: this.seq++, task, resolve, reject, timer: null };
      if (queueTimeoutMs > 0) {
        item.timer = setTimeout(() => {
          const i = this.queue.indexOf(item);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(new Error('queue timeout'));
          }
        }, queueTimeoutMs);
      }
      this.queue.push(item);
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      this._pump();
    });
  }

  _pump() {
    let started = true;
    while (started) {
      started = false;
      for (let i = 0; i < this.queue.length; i++) {
        const item = this.queue[i];
        const bg = isBackground(item.priority);
        // 额度不够就往后找 —— 队头是实时任务但实时额度满时，后台任务仍能开工
        if (bg ? this.activeBg >= this.bgLimit : this.activeRt >= this.rtLimit) continue;
        this.queue.splice(i, 1);
        if (item.timer) clearTimeout(item.timer);
        started = true;
        this._run(item, bg);
        break;
      }
    }
  }

  _run(item, bg) {
    if (bg) this.activeBg++;
    else this.activeRt++;
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        if (bg) this.activeBg--;
        else this.activeRt--;
        this._pump();
      });
  }
}

const scheduler = new PriorityScheduler(CONFIG.scheduler.realtimeLimit, CONFIG.scheduler.backgroundLimit);

/** 前台（可见）页面集合，由页面 postMessage 上报 */
const visibleClients = new Set();

function priorityOf(event) {
  const req = event.request;
  if (req.mode === 'navigate' || req.destination === 'document') return P.CRITICAL;

  const purpose = req.headers.get('sec-purpose') || req.headers.get('purpose') || '';
  if (/prefetch|prerender/i.test(purpose)) return P.IDLE;

  let level = P.NORMAL;
  if (req.destination === 'script' || req.destination === 'style' || req.destination === 'font') level = P.HIGH;
  if (event.clientId && visibleClients.has(event.clientId)) level -= 1; // 前台页面再提一级
  return Math.max(P.CRITICAL, level);
}

/* ============================== 网络状态 ============================== */

const net = { online: true, failStreak: 0 };

function isOnline() {
  if (CONFIG.net.useNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return net.online;
}

function markNetOk() {
  const changed = !net.online;
  net.failStreak = 0;
  net.online = true;
  if (changed && CONFIG.net.broadcast) broadcast({ type: 'sw:net', online: true });
}

function markNetFail() {
  net.failStreak++;
  if (net.online && net.failStreak >= CONFIG.net.offlineThreshold) {
    net.online = false;
    if (CONFIG.net.broadcast) broadcast({ type: 'sw:net', online: false });
  }
}

function setOnline(v) {
  if (v === net.online) return;
  net.online = v;
  net.failStreak = 0;
  if (CONFIG.net.broadcast) broadcast({ type: 'sw:net', online: v });
}

/* ============================== 网络工具 ============================== */

async function fetchWithTimeout(url, ms, init) {
  const ctrl = new AbortController();
  const timer = ms > 0 ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await fetch(url, Object.assign({ signal: ctrl.signal }, init));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 合并同一 URL 的并发请求；全程只入队一次，避免嵌套排队死锁 */
const inflight = new Map();
function scheduledFetch(url, priority, init, queueTimeoutMs = 0) {
  if (!CONFIG.coalesce) {
    return scheduler.add(priority, () => fetchWithTimeout(url, CONFIG.networkTimeoutMs, init), queueTimeoutMs);
  }
  let p = inflight.get(url);
  if (!p) {
    p = scheduler
      .add(priority, () => fetchWithTimeout(url, CONFIG.networkTimeoutMs, init), queueTimeoutMs)
      .finally(() => setTimeout(() => inflight.delete(url), 0));
    inflight.set(url, p);
  }
  return p.then((res) => res.clone()); // 每个调用方各拿一份 clone
}

/* ==================== 内存二级缓存（LRU） ==================== */
/**
 * 目的：热资源的命中路径完全不走 Cache API 磁盘 IO。
 * Cache API 的 match/put 是磁盘 IO，在大批量 cache.put（预下载）并发时会被拖到几百 ms~秒级，
 * 这正是「明明命中了却要 1s」的来源。内存层把它压到微秒级。
 * 只缓存非 opaque 响应（opaque 的 body 不可读，无法复制）。
 */
const mem = new Map(); // key -> { body:ArrayBuffer, status, statusText, headers, bytes, ts }
let memBytes = 0;
const perf = { requests: 0, memHit: 0, cacheHit: 0, miss: 0, net: 0, slow: [] };

function memEvict() {
  const cfg = CONFIG.memory;
  while (mem.size > cfg.maxEntries || memBytes > cfg.maxBytes) {
    const oldest = mem.keys().next().value; // Map 保持插入顺序，这里按 LRU 重新插入过
    if (oldest === undefined) break;
    const e = mem.get(oldest);
    mem.delete(oldest);
    memBytes -= e.bytes;
  }
}

function memGet(key) {
  const e = mem.get(key);
  if (!e) return undefined;
  mem.delete(key); // LRU：命中后移到队尾
  mem.set(key, e);
  return e;
}

function memSet(key, entry) {
  const old = mem.get(key);
  if (old) memBytes -= old.bytes;
  mem.delete(key);
  mem.set(key, entry);
  memBytes += entry.bytes;
  memEvict();
}

/**
 * 从内存条目还原 Response。
 *
 * 关键：arrayBuffer() 拿到的是【已解码】的字节，但原响应头里还留着
 * content-encoding: gzip 与压缩态的 content-length。
 * 如果原样回放这两个头，浏览器会：
 *   - 尝试对已解压的字节再做一次 gzip 解码 → 失败/回退/额外等待
 *   - 按压缩后的 content-length 判定消息边界 → 截断或等待剩余字节
 * 这正是「明明 x-sw-from: memory 却要几百 ms」的典型来源。
 * 所以这里必须剥掉所有与传输编码相关的头，让浏览器拿到一份
 * 干净的、长度自明的明文响应 —— 顺带还省掉一次解压。
 */
const STRIP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'content-range', 'x-content-encoding'];

function memToResponse(e) {
  // slice(0) 复制一份，避免同一个 ArrayBuffer 被多个 Response 消费时互相干扰
  return new Response(e.body.slice(0), { status: e.status, statusText: e.statusText, headers: e.headers });
}

/** 过滤掉传输编码相关头，得到可直接回放的响应头 */
function safeHeaders(headers) {
  const out = [];
  for (const [k, v] of headers) {
    if (STRIP_HEADERS.includes(k.toLowerCase())) continue;
    out.push([k, v]);
  }
  return out;
}

function memApplies(dest) {
  return CONFIG.memory.enabled && CONFIG.memory.destinations.includes(dest);
}

/** 异步把响应喂进内存缓存，不 await —— 不阻塞命中路径 */
function memFeed(key, res, dest) {
  if (!memApplies(dest)) return;
  (async () => {
    try {
      const len = Number(res.headers.get('content-length'));
      if (len > CONFIG.memory.maxEntryBytes) return;
      const buf = await res.clone().arrayBuffer();
      if (buf.byteLength > CONFIG.memory.maxEntryBytes) return;
      memSet(key, {
        body: buf,
        status: res.status,
        statusText: res.statusText,
        headers: safeHeaders(res.headers),
        bytes: buf.byteLength,
        ts: Date.now(),
      });
    } catch {
      /* 忽略 */
    }
  })();
}

/* ==================== 诊断埋点 ==================== */

function mark(from, ms, url, dest) {
  perf.requests++;
  if (from === 'memory') perf.memHit++;
  else if (from === 'cache') perf.cacheHit++;
  else if (from === 'network') perf.net++;
  else perf.miss++;
  if (CONFIG.debug.logSlowMs > 0 && ms > CONFIG.debug.logSlowMs) {
    const rec = { from, ms, url, dest, ts: Date.now() };
    perf.slow.push(rec);
    if (perf.slow.length > CONFIG.debug.keepSlow) perf.slow.shift();
    console.warn(`[sw] slow ${ms}ms (${from}) ${dest} ${url}`);
  }
}

/** 加诊断响应头（opaque 不可改，直接跳过） */
function withDebug(res, from, ms) {
  if (!CONFIG.debug.header || !res || res.type === 'opaque') return res;
  if (res.headers.has('X-SW-From')) return res; // 已经打过，避免二次包装
  try {
    const headers = new Headers(res.headers);
    headers.set('X-SW-From', from);
    headers.set('X-SW-Time', String(ms));
    const enc = res.headers.get('content-encoding');
    if (enc) headers.set('X-SW-Enc', enc);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch {
    return res;
  }
}

/* ==================== 同源缓存 key（可选忽略 search） ==================== */

function ignoreSearchFor(url, destination) {
  const cfg = CONFIG.sameOrigin;
  if (!cfg.ignoreSearch || url.origin !== SELF_ORIGIN) return false;
  if (destination === 'empty' || destination === '') return false; // 接口类请求绝不忽略 query
  if (cfg.applyTo && !cfg.applyTo.includes(destination)) return false;
  const path = url.pathname;
  if (cfg.includePrefix && !cfg.includePrefix.some((p) => path.startsWith(p))) return false;
  if (cfg.excludePrefix && cfg.excludePrefix.some((p) => path.startsWith(p))) return false;
  return true;
}

/** 缓存 key：忽略 search 时去掉 ? 及其后内容，成为 URL 字符串（match/put 统一用它） */
function cacheKeyOf(url, destination) {
  return ignoreSearchFor(url, destination) ? url.origin + url.pathname : url.href;
}

/* ========================= 缓存读取（尽量少的 await） ========================= */

/**
 * Cache First 的快速路径（返回 { res, from }，from 用于诊断）：
 * 1) 内存 LRU 命中 → 零 IO、零磁盘，微秒级
 * 2) Cache API 命中 → 顺手异步回填内存，下次就是内存命中
 * 3) 导航请求：候选并行查，取第一个命中，不再串行 await
 */
async function cacheMatch(cache, url, req, destOverride, optsIn) {
  const dest = destOverride || req.destination;
  const key = cacheKeyOf(url, dest);
  const ignoreSearch = ignoreSearchFor(url, dest);
  const opts = { ignoreVary: CONFIG.match.ignoreVary, ignoreSearch };

  // ① 内存层
  // 注意：接口类请求（destination=empty）也查内存，但用「静态资源」的身份查。
  // 场景：同一个 CSS 先被 <link> 以 style 身份缓存进内存，之后脚本用 fetch() 以
  // empty 身份再取一次 —— 若不查内存就会绕过缓存直连网络，白白多出一次往返。
  const memProbe = [dest, 'script', 'style', 'font', 'image', 'document'].find(memApplies);
  if (memProbe) {
    const e = memGet(cacheKeyOf(url, memProbe));
    if (e) return { res: memToResponse(e), from: 'memory' };
  }

  if (optsIn && optsIn.memoryOnly) return { res: undefined, from: 'miss' };

  // 是否允许回落到 /index.html —— 由调用方按「在线 / 离线」决定
  const allowNavFallback = req.mode === 'navigate' && optsIn && optsIn.navFallback;

  if (req.mode !== 'navigate' || !allowNavFallback) {
    const hit = await cache.match(key, opts);
    if (hit) {
      memFeed(key, hit, dest); // 不 await
      return { res: hit, from: 'cache' };
    }
    return { res: undefined, from: 'miss' };
  }

  // ② 导航回落：精确 key 优先，命中即返回（不会把别的页面当成首页）
  const [direct, ...others] = await Promise.all([
    cache.match(key, opts),
    ...CONFIG.navCandidates.map((p) => cache.match(absUrl(p), opts)),
  ]);
  const hit = direct || others.find(Boolean);
  if (hit) {
    memFeed(absUrl(direct ? key : CONFIG.navCandidates[others.indexOf(hit)]), hit, 'document');
    return { res: hit, from: direct ? 'cache' : 'nav-fallback' };
  }
  return { res: undefined, from: 'miss' };
}

/** 在线导航是否允许回落首页：默认否，保住 404 语义 */
function navFallbackAllowed(url) {
  const cfg = CONFIG.navFallback;
  if (!cfg.online) return false;
  if (cfg.skipIfHasExtension && /\.[a-z0-9]{1,8}$/i.test(url.pathname)) return false;
  return true;
}

async function offlineResponse(req) {
  if (req.mode === 'navigate' && CONFIG.navFallback.offline) {
    const cache = await getCache();
    for (const path of CONFIG.navCandidates) {
      const hit = await cache.match(absUrl(path));
      if (hit) return hit;
    }
  }
  return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
}

function isHtml(res) {
  return CONFIG.errorPage.matchContentType.test(res.headers.get('content-type') || '');
}

/* ==================== 4. 跨源 opaque 图片：TTL 缓存 ==================== */

async function readTtl(key) {
  const meta = await getMeta();
  const res = await meta.match(CONFIG.ttlPrefix + key);
  if (!res) return 0;
  const n = Number(await res.text().catch(() => '0'));
  return Number.isFinite(n) ? n : 0;
}

async function writeTtl(key, ms) {
  const meta = await getMeta();
  await meta.put(CONFIG.ttlPrefix + key, new Response(String(Date.now() + ms)));
}

async function deleteTtl(key) {
  const meta = await getMeta();
  await meta.delete(CONFIG.ttlPrefix + key).catch(() => {});
}

let opaqueLock = Promise.resolve();
function withOpaqueLock(fn) {
  const run = opaqueLock.then(fn, fn);
  opaqueLock = run.catch(() => {});
  return run;
}

async function readOpaqueIndex() {
  const meta = await getMeta();
  const res = await meta.match(CONFIG.opaqueIndexKey);
  if (!res) return [];
  try {
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeOpaqueIndex(idx) {
  const meta = await getMeta();
  await meta.put(
    CONFIG.opaqueIndexKey,
    new Response(JSON.stringify(idx), { headers: { 'content-type': 'application/json' } }),
  );
}

/** 原样存储 opaque 响应：不碰 headers/body/url，key 用调用方给的原始 URL */
async function putOpaque(cache, key, res) {
  try {
    await cache.put(key, res);
  } catch {
    return false; // 配额不足等，忽略
  }
  await writeTtl(key, CONFIG.opaque.ttlMs);
  await withOpaqueLock(async () => {
    const idx = await readOpaqueIndex();
    const i = idx.findIndex((e) => e.url === key);
    if (i >= 0) idx.splice(i, 1);
    idx.push({ url: key, ts: Date.now() });
    while (idx.length > CONFIG.opaque.maxEntries) {
      const old = idx.shift();
      await cache.delete(old.url).catch(() => {});
      await deleteTtl(old.url);
    }
    await writeOpaqueIndex(idx);
  });
  return true;
}

const OPAQUE_INIT = { mode: 'no-cors', credentials: 'omit', cache: 'default' };

async function revalidateOpaque(key) {
  const cache = await getCache();
  try {
    const res = await scheduledFetch(key, P_OF(CONFIG.opaque.revalidatePriority), OPAQUE_INIT, CONFIG.queueTimeoutMs);
    if (res && (res.ok || res.type === 'opaque')) await putOpaque(cache, key, res);
  } catch {
    /* 后台更新失败无所谓，下次再试 */
  }
}

async function handleOpaque(event, url) {
  const key = url.href;
  const cache = await getCache();

  // 并行：命中判断 + 过期时间，省掉一次串行等待
  const [hit, expires] = await Promise.all([cache.match(key), readTtl(key)]);

  if (hit && expires > Date.now()) return hit; // 新鲜
  if (hit) {                                   // 过期
    if (!isOnline()) return hit;               // 离线：旧图也比裂图好，且不发请求
    if (CONFIG.opaque.staleWhileRevalidate) {
      event.waitUntil(revalidateOpaque(key));
      return hit;
    }
    await cache.delete(key).catch(() => {});
    await deleteTtl(key);
  }

  if (!isOnline()) return new Response('', { status: 504, statusText: 'Gateway Timeout' });

  const priority = priorityOf(event);
  try {
    const res = await scheduledFetch(
      key,
      priority,
      OPAQUE_INIT,
      priority >= P.LOW ? CONFIG.queueTimeoutMs : 0,
    );
    markNetOk();
    if (res && (res.ok || res.type === 'opaque')) event.waitUntil(putOpaque(cache, key, res.clone()));
    return res;
  } catch {
    markNetFail();
    if (hit) return hit;
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

/* ==================== 6. 异常 HTML → /http/{status}/{lang}/ ==================== */

function normalizeLang(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[a-z0-9_-]{1,16}$/.test(s) ? s : normalizeLang(CONFIG.errorPage.defaultLang || 'en');
}

/** 语言代码的规范形式：下划线转连字符、去空格，用于跨写法匹配（zh_cn ≡ zh-CN ≡ zh-cn） */
function canonicalLang(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/[_\s]+/g, '-');
}

let defaultLang = normalizeLang(CONFIG.errorPage.defaultLang);
let lastLang = defaultLang;                 // 兜底：导航请求 clientId 常为空，用最近一次上报的语言
const clientLangs = new Map();              // clientId -> lang

const LANG_KEY = '/__lang__.txt';

/**
 * 语言持久化到 Cache Storage。
 * 关键：SW 进程会被系统回收/重启（Safari 的 App Nap 尤其频繁），
 * 内存里的 lastLang / clientLangs 会全部丢回默认值 en。
 * 页面只在 load / visibilitychange / storage 时上报语言，
 * SW 重启后如果页面没再上报，404 就会错误地落到 en。
 */
let langLoaded = false;
async function loadPersistedLang() {
  if (langLoaded) return lastLang;
  langLoaded = true;
  try {
    const meta = await getMeta();
    const res = await meta.match(LANG_KEY);
    if (res) {
      const v = normalizeLang((await res.text()).trim());
      if (v) lastLang = v;
    }
  } catch {
    /* 忽略 */
  }
  return lastLang;
}

async function persistLang(lang) {
  try {
    const meta = await getMeta();
    await meta.put(LANG_KEY, new Response(lang));
  } catch {
    /* 忽略 */
  }
}

function langFor(clientId) {
  return (clientId && clientLangs.get(clientId)) || lastLang || defaultLang;
}

async function langForAsync(clientId) {
  await loadPersistedLang();
  return langFor(clientId);
}

function setLang(lang, clientId) {
  const l = normalizeLang(lang);
  lastLang = l;
  langLoaded = true;
  if (clientId) clientLangs.set(clientId, l);
  persistLang(l).catch(() => {});
  if (CONFIG.errorPage.prefetchOnLangChange) {
    prefetchErrorPages(l).catch(() => {});
  }
  return l;
}

/* ---------- 按清单实况解析语言，而不是盲拼路径 ---------- */

/** 从清单里抽出每个 status 实际可用的语言集合：{404: Set(['en','zh-cn',...])} */
let langIndexCache = null;
let langIndexFor = null;
async function buildLangIndex() {
  const manifest = await ensureManifest();
  if (langIndexFor === manifest && langIndexCache) return langIndexCache;
  const index = Object.create(null);
  for (const p of Object.keys(manifest || {})) {
    const m = p.match(/^\/http\/(\d{3})\/([^/]+)\/index\.html$/);
    if (!m) continue;
    (index[m[1]] || (index[m[1]] = new Set())).add(m[2]);
  }
  langIndexCache = index;
  langIndexFor = manifest;
  return index;
}

/**
 * 把「页面上报的语言」解析成「清单里真实存在的语言目录」。
 * 优先级：精确 → 规范写法（zh_cn≈zh-cn）→ 同语系（zh→zh-cn）→ 默认语言 → 任取一个
 * 这样 zh_cn / zh-CN / zh_CN 都能正确落到 /http/404/zh-cn/，
 * 不会因为下划线和连字符的差异而误判「文件不存在」退到 en。
 */
async function resolveLang(status, wanted) {
  const cfg = CONFIG.errorPage;
  const index = await buildLangIndex();
  const available = index[String(status)];
  if (!available || !available.size) return { lang: null, path: cfg.template(status, normalizeLang(wanted)) };

  const find = (cands) => cands.find((c) => available.has(c));

  // 1) 原样 & 规范写法
  const raw = String(wanted || '').trim();
  const canon = canonicalLang(raw);
  let hit = find([raw, canon, canon.toLowerCase()]);
  if (hit) return { lang: hit, path: cfg.template(status, hit) };

  // 2) 逐个比对（忽略大小写 / 下划线 / 连字符）
  const norm = (s) => s.toLowerCase().replace(/[_\s]+/g, '-');
  hit = find([...available].filter((a) => norm(a) === canon));
  if (hit) return { lang: hit, path: cfg.template(status, hit) };

  // 3) 同语系：zh → zh-cn / zh-tw（按清单顺序取第一个 zh-*），zh-hk → zh-tw 等
  const base = canon.split('-')[0];
  if (base) {
    const family = [...available].filter((a) => norm(a).split('-')[0] === base);
    if (family.length) {
      // 优先与请求更接近的：完整匹配 region，否则取该语系第一个
      const region = canon.split('-')[1];
      const better = region && family.find((a) => norm(a).split('-')[1] === region);
      hit = better || family[0];
      return { lang: hit, path: cfg.template(status, hit) };
    }
  }

  // 4) 默认语言
  const def = normalizeLang(cfg.defaultLang);
  const defHit = find([def, ...[...available].filter((a) => norm(a) === norm(def))]);
  if (defHit) return { lang: defHit, path: cfg.template(status, defHit), fallback: true };

  // 5) 任取一个，总比什么都不返回强
  const any = [...available][0];
  return { lang: any, path: cfg.template(status, any), fallback: true };
}

/**
 * 确保清单已就位。
 * 场景：SW 刚装上就被用来处理 404，而 sync 还没跑完 → manifest 为空
 * → manifestHas() 恒 false → 错误页被判为「清单里没有」→ 原样返回/回落首页。
 * 这里在线时补拉一次清单（只拉清单，不下载文件，很快）。
 */
let manifestEnsuring = null;
async function ensureManifest() {
  const m = await loadStoredManifest();
  if (m && Object.keys(m).length) return m;
  if (!isOnline()) return m;
  if (manifestEnsuring) return manifestEnsuring;
  manifestEnsuring = (async () => {
    try {
      const remote = await fetchRemoteManifest();
      markNetOk();
      await saveManifest(remote);
      return remote;
    } catch {
      markNetFail();
      return loadStoredManifest();
    } finally {
      manifestEnsuring = null;
    }
  })();
  return manifestEnsuring;
}

async function manifestHas(path) {
  const manifest = await ensureManifest();
  return !!manifest && Object.prototype.hasOwnProperty.call(manifest, path);
}

/** 取错误页内容；清单里没有对应路径则返回 null（调用方原样返回原响应且不缓存） */
async function getErrorPage(status, clientId, isNavigation) {
  const cfg = CONFIG.errorPage;
  if (!cfg.enabled) return null;

  // 先补一次持久化的语言（SW 被系统回收重启后，内存里的语言是默认值）
  const wanted = await langForAsync(clientId);
  const primary = await resolveLang(status, wanted);

  // 非导航请求（脚本/CSS 等 404）保持严格：只对真实存在的语言目录替换，
  // 拿不到就返回原响应且不缓存 —— 否则会把 HTML 错误页塞给 <script> 之类的请求。
  if (!isNavigation && primary.fallback) return null;

  // 导航请求的兜底链：解析结果 → 默认语言 → 清单里任一语言
  const candidates = [{ lang: primary.lang, path: primary.path }];
  if (!primary.fallback) {
    const def = await resolveLang(status, cfg.defaultLang);
    if (def.path !== primary.path) candidates.push({ lang: def.lang, path: def.path });
  }
  if (isNavigation) {
    const index = await buildLangIndex();
    for (const l of index[String(status)] || []) {
      const p = cfg.template(status, l);
      if (!candidates.some((c) => c.path === p)) candidates.push({ lang: l, path: p });
    }
  }

  for (const { lang, path } of candidates) {
    if (!path || !(await manifestHas(path))) continue; // 清单里没有 → 跳过

    const url = absUrl(path);
    const cache = await getCache();
    let res = await cache.match(url);
    if (!res) {
      if (!isOnline()) continue; // 离线不发请求
      try {
        res = await fetchWithTimeout(url, CONFIG.networkTimeoutMs); // 不走调度队列，避免占槽
      } catch {
        continue;
      }
      if (!res || !res.ok) continue;
      if (cfg.cacheTemplate) cache.put(url, res.clone()).catch(() => {});
    }

    const body = await res.clone().arrayBuffer();
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const cc = res.headers.get('cache-control');
    if (cc) headers.set('cache-control', cc);
    if (lang) headers.set('X-SW-Lang', lang); // 诊断：实际用了哪个语言
    return { body, headers, path, lang };
  }
  return null;
}

async function prefetchErrorPages(lang) {
  const cfg = CONFIG.errorPage;
  if (!cfg.enabled || !cfg.prefetchStatuses.length) return { filled: [] };
  const manifest = await ensureManifest();
  if (!manifest) return { filled: [] };
  const cache = await getCache();
  // 用解析后的真实语言目录，避免 zh_cn 拼出清单里不存在的路径而一个都不下
  const resolved = [];
  for (const s of cfg.prefetchStatuses) {
    const r = await resolveLang(s, lang);
    if (r.path) resolved.push(r.path);
  }
  const missing = resolved
    .filter((p) => Object.prototype.hasOwnProperty.call(manifest, p))
    .map(absUrl);
  const keys = await cache.keys();
  const has = new Set(keys.map((r) => r.url));
  const todo = missing.filter((u) => !has.has(u));
  if (!todo.length) return { filled: [] };
  const filled = await downloadIntoCache(cache, todo, P.IDLE);
  return { filled };
}

/* ==================== 2. 同源请求：Cache First ==================== */

async function handleSameOrigin(event, url) {
  const t0 = Date.now();
  const req = event.request;
  const cache = await getCache();

  // Swup / SPA 路由用 fetch() 拉 HTML：destination 是 empty 但本质是页面请求，
  // 必须走缓存，否则每次路由切换都裸连网络（这是这类站点最常见的隐性慢源）
  const acceptHtml =
    CONFIG.passthrough.htmlFetchAsDocument &&
    /text\/html/i.test(req.headers.get('accept') || '');
  const dest = acceptHtml ? 'document' : req.destination;

  // no-store：调用方明确要求别用缓存，直接走网络
  const noStore = CONFIG.passthrough.respectNoStore && req.cache === 'no-store';
  // 接口类（destination=empty）：不写缓存、也不做磁盘读，但仍先查一次内存
  const apiLike = !acceptHtml && CONFIG.passthrough.destinations.includes(req.destination);

  const done = (res, from) => {
    const ms = Date.now() - t0;
    mark(from, ms, req.url, req.destination);
    return withDebug(res, from, ms);
  };

  if (noStore) {
    if (!isOnline()) return done(new Response('offline', { status: 503, statusText: 'Service Unavailable' }), 'passthrough');
    try {
      const res = await scheduledFetch(req.url, priorityOf(event), undefined, queueTimeoutFor(priorityOf(event)));
      markNetOk();
      return done(res, 'network');
    } catch {
      markNetFail();
      return done(new Response('offline', { status: 503, statusText: 'Service Unavailable' }), 'error');
    }
  }

  // 接口类：先白嫖一次内存命中（微秒级，零磁盘 IO）。
  // 这样脚本用 fetch() 重复取已缓存的静态资源时不会再绕过缓存直连网络。
  if (apiLike) {
    const { res: m, from } = await cacheMatch(cache, url, req, req.destination, { memoryOnly: true });
    if (m) return done(m, from);
    if (!isOnline()) return done(new Response('offline', { status: 503, statusText: 'Service Unavailable' }), 'offline-miss');
    try {
      const res = await scheduledFetch(req.url, priorityOf(event), undefined, queueTimeoutFor(priorityOf(event)));
      markNetOk();
      return done(res, 'network');
    } catch {
      markNetFail();
      return done(new Response('offline', { status: 503, statusText: 'Service Unavailable' }), 'error');
    }
  }

  // 离线：一个请求都不发，命中即返；未命中才用首页兜底（此时也允许导航回落）
  if (!isOnline()) {
    const { res, from } = await cacheMatch(cache, url, req, dest, { navFallback: CONFIG.navFallback.offline });
    return done(res || (await offlineResponse(req)), res ? from : 'offline-miss');
  }

  // 在线：导航默认【不】回落到 /index.html。
  // 否则任何不存在的 URL 都会被首页吞掉，服务端 404 永远不会被看见。
  const { res: hit, from } = await cacheMatch(cache, url, req, dest, { navFallback: navFallbackAllowed(url) });
  if (hit) return done(hit, from); // 命中直接返回，不进队列、不占并发、不碰网络

  const priority = acceptHtml ? P.CRITICAL : priorityOf(event);
  const isNavigation = req.mode === 'navigate' || acceptHtml;

  let res;
  try {
    res = await scheduledFetch(req.url, priority, undefined, queueTimeoutFor(priority));
    markNetOk();
  } catch {
    markNetFail();
    return done(await offlineResponse(req), 'error'); // 排队超时 / 断网
  }

  // 异常 HTML：替换为 /http/{status}/{lang}/index.html
  const ep = CONFIG.errorPage;
  if (ep.enabled && res.status >= ep.minStatus && res.status <= ep.maxStatus) {
    const allowed = !ep.statuses || ep.statuses.includes(res.status);
    // 导航请求不看服务端 content-type：有些服务端 404 给的是 text/plain 或压根没有
    const htmlOk = isNavigation && ep.ignoreContentTypeForNavigation ? true : isHtml(res);
    if (allowed && htmlOk) {
      const page = await getErrorPage(res.status, event.clientId, isNavigation);
      if (page) {
        // 原响应不写缓存
        return done(
          new Response(page.body, {
            status: ep.keepOriginalStatus ? res.status : 200,
            statusText: ep.keepOriginalStatus ? res.statusText : 'OK',
            headers: page.headers,
          }),
          'error-page',
        );
      }
      return done(res, 'network'); // 清单里没这个错误页 → 原样返回，不缓存
    }
  }

  // 清单外同源静态资源按需缓存（接口类 destination=empty 不会命中）
  if (CONFIG.cacheOutsideManifest && res.ok && res.type === 'basic' && CACHEABLE_DESTINATIONS.has(dest)) {
    const key = cacheKeyOf(url, dest);
    event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
    memFeed(key, res, dest);
  }
  if (acceptHtml && res.ok && res.type === 'basic') {
    // Swup 拉回来的 HTML 也顺手进内存，路由切换瞬时命中
    memFeed(cacheKeyOf(url, 'document'), res, 'document');
  }

  return done(res, 'network');
}

const queueTimeoutFor = (p) => (isBackground(p) ? CONFIG.queueTimeoutMs : 0);

/* ================= /_hash 清单：解析 / diff / 全量预下载 ================= */

function parseManifest(text) {
  const map = Object.create(null);
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\S+)$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

async function fetchRemoteManifest() {
  const bust = CONFIG.manifestUrl.includes('?') ? '&' : '?';
  const res = await fetch(`${CONFIG.manifestUrl}${bust}_t=${Date.now()}`, {
    cache: 'reload',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  return parseManifest(await res.text());
}

let manifestMemory = null;
async function loadStoredManifest() {
  if (manifestMemory) return manifestMemory;
  const meta = await getMeta();
  const res = await meta.match(CONFIG.manifestKey);
  manifestMemory = res ? await res.json().catch(() => ({})) : {};
  return manifestMemory;
}

async function saveManifest(map) {
  manifestMemory = map;
  const meta = await getMeta();
  await meta.put(
    CONFIG.manifestKey,
    new Response(JSON.stringify(map), { headers: { 'content-type': 'application/json' } }),
  );
}

const isEntry = (url) => url === '/' || url.endsWith('/') || /\.(html?|js|mjs|css)$/i.test(url);

async function cachedKeySet(cache) {
  const keys = await cache.keys();
  return new Set(keys.map((r) => r.url));
}

function broadcast(msg) {
  self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage(msg)))
    .catch(() => {});
}

/** 批量下载并写入缓存，返回成功列表；单个失败不影响整体（下次 sync 重试） */
async function downloadIntoCache(cache, urls, priority, onProgress) {
  const done = [];
  let finished = 0;
  const queueTimeout = priority >= P.LOW ? CONFIG.queueTimeoutMs : 0;
  await Promise.all(
    urls.map((url) =>
      scheduler
        .add(
          priority,
          async () => {
            const res = await fetchWithTimeout(url, CONFIG.networkTimeoutMs);
            if (!res || !res.ok) throw new Error(`bad ${res && res.status}`);
            await cache.put(url, res.clone());
            done.push(url);
          },
          queueTimeout,
        )
        .catch(() => {})
        .finally(() => {
          finished++;
          if (onProgress) onProgress(finished, urls.length);
        }),
    ),
  );
  return done;
}

let syncing = null;
let pendingRest = null; // install 阶段「其余文件」的后台下载，install 不等它

function sync(options = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    if (pendingRest) await pendingRest.catch(() => {}); // 避免与后台补下载重复拉同一批
    return doSync(options);
  })()
    .catch((err) => {
      console.warn('[sw] sync failed', err);
      return null;
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

async function doSync({ mode = 'background' } = {}) {
  const remote = await fetchRemoteManifest();
  markNetOk(); // 清单能拉到 = 有网
  const local = await loadStoredManifest();
  const cache = await getCache();

  // diff：hash 变了、或清单里有但缓存里没有（丢缓存 / 首次安装）都要下
  const cached = await cachedKeySet(cache);
  const changedSet = new Set(
    Object.keys(remote).filter((u) => local[u] !== remote[u] || !cached.has(absUrl(u))),
  );
  const removed = Object.keys(local).filter((u) => !(u in remote));

  for (const url of removed) await cache.delete(absUrl(url)).catch(() => {});

  const next = Object.assign(Object.create(null), local);
  for (const url of removed) delete next[url];

  const changed = Array.from(changedSet);
  if (changed.length) {
    const entries = changed.filter(isEntry);
    const rest = changed.filter((u) => !isEntry(u));

    // 后台更新一律最低优先级，绝不打扰前台
    const entryPriority = mode === 'background' ? P.LOW : P_OF(CONFIG.precache.entryPriority);
    const restPriority = mode === 'background' ? P.IDLE : P_OF(CONFIG.precache.restPriority);

    let finished = 0;
    const total = changed.length;
    const onProgress =
      CONFIG.precache.reportProgress && mode !== 'background'
        ? () => broadcast({ type: 'sw:precache-progress', done: ++finished, total, mode })
        : null;

    const commit = async (urls) => {
      for (const url of urls) {
        const k = toManifestKey(url);
        next[k] = remote[k];
      }
    };

    await commit(await downloadIntoCache(cache, entries.map(absUrl), entryPriority, onProgress));

    // install：只等入口文件（首屏不能被 install 拖住），其余丢后台慢慢下完
    if (mode === 'install' && rest.length) {
      await saveManifest(next);
      const restUrls = rest.map(absUrl);
      pendingRest = (async () => {
        const doneRest = await downloadIntoCache(cache, restUrls, restPriority, onProgress);
        await commit(doneRest);
        const m = await loadStoredManifest();
        for (const url of doneRest) m[toManifestKey(url)] = remote[toManifestKey(url)];
        await saveManifest(m);
        broadcast({ type: 'sw:precache-done', total: entries.length + doneRest.length, mode: 'rest' });
        pendingRest = null;
      })().catch(() => {
        pendingRest = null;
      });
      await warmMemory();
      return { updated: Array.from(changedSet).filter((u) => next[u] === remote[u]), removed };
    }

    await commit(await downloadIntoCache(cache, rest.map(absUrl), restPriority, onProgress));
  }

  await saveManifest(next);
  await prefetchErrorPages(lastLang); // 错误页随清单一起保持最新

  const updated = Array.from(changedSet).filter((u) => next[u] === remote[u]);
  if (updated.length) {
    broadcast({ type: 'sw:update', updated, removed, hasEntryUpdate: updated.some(isEntry) });
  }
  if (CONFIG.precache.reportProgress && mode !== 'background') {
    broadcast({ type: 'sw:precache-done', total: changed.length, mode });
  }
  return { updated, removed };
}

/** 让出事件循环：避免预热这种批量任务长时间占住 SW 线程，把实时 fetch 事件堵在后面 */
const yieldTick = () => new Promise((r) => setTimeout(r, 0));

/** install 后把入口文件预热进内存：首屏脚本/样式首次访问就是内存命中 */
async function warmMemory() {
  if (!CONFIG.memory.enabled || !CONFIG.memory.warmOnInstall) return { warmed: 0, bytes: 0 };
  const manifest = await loadStoredManifest();
  const cache = await getCache();
  let warmed = 0;
  let bytes = 0;
  let sinceYield = 0;
  for (const path of Object.keys(manifest)) {
    if (bytes > CONFIG.memory.warmMaxBytes) break;
    if (!/\.(html?|js|mjs|css)$/i.test(path)) continue;
    if (CONFIG.precache.warmPaths && !CONFIG.precache.warmPaths.some((p) => path.startsWith(p))) continue;
    const key = absUrl(path);
    if (memGet(key)) continue;
    const res = await cache.match(key, { ignoreVary: CONFIG.match.ignoreVary }).catch(() => undefined);
    if (!res) continue;
    const buf = await res.arrayBuffer().catch(() => null);
    if (!buf || buf.byteLength > CONFIG.memory.maxEntryBytes) continue;
    memSet(key, {
      body: buf,
      status: res.status,
      statusText: res.statusText,
      headers: safeHeaders(res.headers),
      bytes: buf.byteLength,
      ts: Date.now(),
    });
    warmed++;
    bytes += buf.byteLength;
    // 每 8 个（或累计 1MB）让出一次，保证 Swup 切换时的实时请求能立刻被处理
    if (++sinceYield >= 8 || bytes > 1024 * 1024) {
      sinceYield = 0;
      await yieldTick();
    }
  }
  return { warmed, bytes };
}

/** 绝对 URL → 清单里的 key（同源路径） */
function toManifestKey(href) {
  const u = new URL(href, self.location);
  return u.origin === SELF_ORIGIN ? u.pathname + u.search : href;
}

/** 只补漏：清单里有但缓存缺失的文件 */
async function fillMissing() {
  if (!isOnline()) return { filled: [] };
  const manifest = await loadStoredManifest();
  const cache = await getCache();
  const cached = await cachedKeySet(cache);
  const missing = Object.keys(manifest).filter((u) => !cached.has(absUrl(u)));
  if (!missing.length) return { filled: [] };
  const filled = await downloadIntoCache(cache, missing.map(absUrl), P.IDLE);
  return { filled };
}

/* ==================== 5. 强制刷新（postMessage） ==================== */

/** 去掉 _t，得到「页面发来的原始 URL」作为缓存 key */
function canonicalKey(input, destination) {
  const u = new URL(input, self.location);
  if (u.searchParams.has('_t')) {
    u.searchParams.delete('_t');
    const q = u.searchParams.toString();
    u.search = q ? `?${q}` : '';
  }
  return u.origin === SELF_ORIGIN ? cacheKeyOf(u, destination) : u.href;
}

/** 加 ?_t= 仅用于网络请求；服务端忽略它，只是绕过各级缓存 */
function bustUrl(href) {
  const u = new URL(href);
  u.searchParams.set('_t', String(Date.now()));
  return u.href;
}

/**
 * 强制刷新任意 URL（常用于清单外资源）：
 * - 网络请求带 _t + cache:'reload'，绕开浏览器/CDN 缓存
 * - 缓存 key 用原始 URL；opaque 响应原样存储，绝不改写
 */
async function forceRefresh(urls, options = {}) {
  const cache = await getCache();
  const priority = P_OF(options.priority || 'NORMAL');
  const queueTimeout = priority >= P.LOW ? CONFIG.queueTimeoutMs : 0;
  const manifest = await loadStoredManifest();
  const results = [];

  await Promise.all(
    urls.map(async (raw) => {
      let u;
      try {
        u = new URL(raw, self.location);
      } catch {
        results.push({ url: raw, ok: false, reason: 'invalid url' });
        return;
      }
      if (!/^https?:$/.test(u.protocol)) {
        results.push({ url: raw, ok: false, reason: 'unsupported protocol' });
        return;
      }
      if (u.origin !== SELF_ORIGIN && !isOnline()) {
        results.push({ url: raw, ok: false, reason: 'offline' });
        return;
      }

      const key = canonicalKey(u.href, options.destination); // ← 缓存 key = 原始 URL
      const cross = u.origin !== SELF_ORIGIN;
      const init = Object.assign(
        { cache: 'reload' },
        cross
          ? { mode: options.mode || 'no-cors', credentials: options.credentials || 'omit' }
          : { mode: options.mode || 'cors', credentials: options.credentials || 'same-origin' },
      );

      try {
        const res = await scheduledFetch(bustUrl(key), priority, init, queueTimeout);
        const opaque = res.type === 'opaque';
        if (res.ok || opaque) {
          if (opaque) await putOpaque(cache, key, res.clone());
          else await cache.put(key, res.clone()).catch(() => {});
        }
        markNetOk();
        results.push({
          url: key,
          ok: res.ok || opaque,
          status: opaque ? 0 : res.status,
          opaque,
          cached: res.ok || opaque,
          inManifest: Object.prototype.hasOwnProperty.call(manifest, toManifestKey(key)),
        });
      } catch (err) {
        markNetFail();
        results.push({ url: key, ok: false, reason: (err && err.message) || 'fetch failed' });
      }
    }),
  );

  return results;
}

/* ================================ 生命周期 ================================ */

let syncTimer = null;
function scheduleSync() {
  if (syncTimer) return;
  const delay = net.online ? CONFIG.syncIntervalMs : CONFIG.net.probeIntervalMs;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    sync({ mode: 'background' }); // 离线时同样会拉一次清单，成功即恢复在线
  }, delay);
}

async function cleanupOldCaches() {
  const keep = new Set([CONFIG.cacheName, CONFIG.metaCacheName]);
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((n) => !keep.has(n) && (n.startsWith('app-static-') || n.startsWith('app-meta-')))
      .map((n) => caches.delete(n)),
  );
}

self.addEventListener('install', (event) => {
  // 必须在 install 处理器里同步调用：规则属于这个 SW 版本，装完就不能改了
  staticRoutesReady = registerStaticRoutes(event);
  event.waitUntil(
    (async () => {
      await getCache();
      // 只等入口文件下载 + 内存预热；其余文件交给后台额度慢慢下
      await sync({ mode: CONFIG.precache.allOnInstall ? 'install' : 'background' });
      if (!CONFIG.precache.allOnInstall) await warmMemory();
      scheduleSync();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await cleanupOldCaches();
      if (CONFIG.claimOnActivate) await self.clients.claim();
      if (pendingRest) await pendingRest.catch(() => {}); // 补完 install 没下完的部分
      await sync({ mode: 'background' });
      if (CONFIG.precache.fillMissingOnActivate) await fillMissing();
      await prefetchErrorPages(lastLang);
      await warmMemory();
      scheduleSync();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (url.pathname === MANIFEST_PATH) return;   // 清单本身不走缓存策略
  if (url.pathname.endsWith('/sw.js')) return;
  if (req.headers.has('range')) return;         // 分片请求（音视频）放行

  scheduleSync();

  // Swup / SPA 用 fetch() 拉 HTML 时 destination 是 empty，这里也要接管
  const acceptHtml = /text\/html/i.test(req.headers.get('accept') || '');
  const dest = acceptHtml ? 'document' : req.destination;

  // B 档：老 Safari（无 addRoutes）——不可变资源完全不接管，交给浏览器原生 HTTP 缓存。
  // 不调 respondWith() 就不会唤醒/等待 SW，Safari 直接从自己的内存缓存返回。
  if (
    STATIC_ROUTING.enabled &&
    !staticRoutesReady &&
    STATIC_ROUTING.passthroughWhenUnsupported &&
    url.origin === SELF_ORIGIN &&
    !acceptHtml &&
    dest !== 'document' &&
    matchesStaticPath(url.pathname) &&
    (!STATIC_ROUTING.requireOnline || isOnline())
  ) {
    mark('bypass', 0, req.url, dest);
    return; // ← 注意：故意不 respondWith
  }

  let p;
  if (url.origin === SELF_ORIGIN) {
    p = handleSameOrigin(event, url);
  } else if (CONFIG.opaque.enabled && CONFIG.opaque.destinations.includes(dest)) {
    p = handleOpaque(event, url);
  } else {
    return; // 其余跨域请求交给浏览器
  }

  event.respondWith(Promise.resolve(p));
});

/* ================================ 消息接口 ================================ */

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const clientId = (event.source && event.source.id) || data.clientId;
  const reply = (msg) => {
    if (event.source) event.source.postMessage(msg);
    else broadcast(msg);
  };

  switch (data.type) {
    // 页面定时触发的更新检查（SW 被回收后靠它唤醒，比内部 setTimeout 可靠）
    case 'sw:sync':
      event.waitUntil(sync({ mode: data.mode || 'background' }));
      scheduleSync();
      break;

    // 上报页面可见性：SW 据此把前台页面的请求提优先级
    case 'sw:visibility':
      if (data.visible) visibleClients.add(clientId);
      else visibleClients.delete(clientId);
      if (data.lang) setLang(data.lang, clientId);
      if (typeof data.online === 'boolean') setOnline(data.online);
      break;

    // 上报语言（localStorage.getItem('language')），转小写后用于 /http/{status}/{lang}/
    case 'sw:lang': {
      const lang = setLang(data.lang, clientId);
      reply({ type: 'sw:lang', lang, clientId });
      break;
    }

    // 页面上报网络状态，配合内部失败计数，尽快进入「不发请求」模式
    case 'sw:net':
      if (typeof data.online === 'boolean') setOnline(data.online);
      break;

    // 强制刷新非清单资源：{ type:'sw:refresh', urls:[...], options:{priority:'HIGH'} }
    case 'sw:refresh': {
      const urls = Array.isArray(data.urls) ? data.urls : data.url ? [data.url] : [];
      event.waitUntil(
        forceRefresh(urls, data.options || {})
          .then((results) => reply({ type: 'sw:refreshed', results }))
          .catch((err) => reply({ type: 'sw:refreshed', results: [], error: String(err) })),
      );
      break;
    }

    // 手动触发清单全量预下载
    case 'sw:precache':
      event.waitUntil(sync({ mode: 'install' }));
      break;

    // 补漏：清单里有、缓存里没有的
    case 'sw:fill-missing':
      event.waitUntil(fillMissing().then((r) => reply({ type: 'sw:filled', ...r })));
      break;

    // 预取某语言的错误页
    case 'sw:prefetch-error-pages':
      event.waitUntil(prefetchErrorPages(normalizeLang(data.lang || lastLang)).then((r) => reply({ type: 'sw:filled', ...r })));
      break;

    // 手动预热内存缓存（把指定 URL 从 Cache Storage 读进内存）
    case 'sw:warm':
      event.waitUntil(
        (async () => {
          const cache = await getCache();
          const urls = Array.isArray(data.urls) ? data.urls : null;
          const paths = urls || Object.keys(await loadStoredManifest()).filter((p) => /\.(html?|js|mjs|css)$/i.test(p));
          let warmed = 0;
          for (const p of paths) {
            const key = absUrl(p);
            if (memGet(key)) continue;
            const res = await cache.match(key, { ignoreVary: CONFIG.match.ignoreVary }).catch(() => undefined);
            if (!res) continue;
            const buf = await res.arrayBuffer().catch(() => null);
            if (!buf || buf.byteLength > CONFIG.memory.maxEntryBytes) continue;
            memSet(key, {
              body: buf,
              status: res.status,
              statusText: res.statusText,
              headers: safeHeaders(res.headers),
              bytes: buf.byteLength,
              ts: Date.now(),
            });
            warmed++;
          }
          reply({ type: 'sw:warmed', warmed });
        })(),
      );
      break;

    // 性能诊断：命中率 / 来源分布 / 最近慢请求
    case 'sw:perf':
      reply({
        type: 'sw:perf',
        perf: Object.assign({}, perf, { memEntries: mem.size, memBytes }),
        scheduler: {
          activeRt: scheduler.activeRt,
          activeBg: scheduler.activeBg,
          queue: scheduler.queue.length,
          rtLimit: scheduler.rtLimit,
          bgLimit: scheduler.bgLimit,
        },
        online: isOnline(),
        staticRoutesReady,
        staticPathnames: STATIC_ROUTING.pathnames,
      });
      if (data.reset) {
        perf.requests = perf.memHit = perf.cacheHit = perf.miss = perf.net = 0;
        perf.slow.length = 0;
      }
      break;

    case 'sw:skip-waiting':
      self.skipWaiting();
      break;

    // 调试：清单 / 缓存 / opaque / 网络 / 语言
    case 'sw:status':
      event.waitUntil(
        (async () => {
          const cache = await getCache();
          const keys = await cache.keys();
          reply({
            type: 'sw:status',
            manifest: await loadStoredManifest(),
            cached: keys.map((r) => r.url),
            opaqueIndex: await readOpaqueIndex(),
            online: isOnline(),
            staticRoutesReady,
            addRoutesSupported: typeof InstallEvent !== 'undefined' && 'addRoutes' in InstallEvent.prototype,
            lang: langFor(clientId),
            defaultLang,
          });
        })(),
      );
      break;

    case 'sw:clear':
      event.waitUntil(
        (async () => {
          await Promise.all([caches.delete(CONFIG.cacheName), caches.delete(CONFIG.metaCacheName)]);
          _staticCacheP = null;
          _metaCacheP = null;
          manifestMemory = null;
          await sync({ mode: 'install' });
        })(),
      );
      break;
  }
});
