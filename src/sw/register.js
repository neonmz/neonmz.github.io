const MSG = {
  SYNC: "sw:sync",
  VISIBILITY: "sw:visibility",
  LANG: "sw:lang",
  NET: "sw:net",
  REFRESH: "sw:refresh",
  PRECACHE: "sw:precache",
  FILL_MISSING: "sw:fill-missing",
  PREFETCH_ERROR_PAGES: "sw:prefetch-error-pages",
  HEADERS_RELOAD: "sw:headers-reload",
  WARM: "sw:warm",
  PERF: "sw:perf",
  SKIP_WAITING: "sw:skip-waiting",
  STATUS: "sw:status",
  CLEAR: "sw:clear",
  NET_RESET: "sw:net-reset",
  ROUTING_SET: "sw:routing-set",
  SECURITY: "sw:security",
  SECURITY_SET: "sw:security-set"
};
const DEFAULTS = {
  url: "/sw.js",
  scope: "/",
  syncIntervalMs: 60 * 1e3,
  language: "",
  reportVisibility: true,
  reportNetwork: true,
  syncOnRegister: true
};
let opts = { ...DEFAULTS };
let registration = null;
let currentLang = "";
let listenersInstalled = false;
let timer = null;
let seq = 0;
const handlers = /* @__PURE__ */ new Map();
const pending = /* @__PURE__ */ new Map();
function on(type, handler) {
  let set = handlers.get(type);
  if (!set) handlers.set(type, set = /* @__PURE__ */ new Set());
  set.add(handler);
  return () => {
    const s = handlers.get(type);
    if (s) s.delete(handler);
  };
}
function once(type, handler) {
  const off = on(type, (p) => {
    off();
    handler(p);
  });
  return off;
}
function emit(type, payload) {
  const set = handlers.get(type);
  if (!set) return;
  for (const h of Array.from(set)) {
    try {
      h(payload);
    } catch (err) {
      console.error("[sw-register] listener error", err);
    }
  }
}
function supported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}
async function target() {
  if (!supported()) return null;
  const c = navigator.serviceWorker.controller;
  if (c) return c;
  try {
    const r = await navigator.serviceWorker.ready;
    return r.active || null;
  } catch {
    return null;
  }
}
function post(msg) {
  if (!supported()) return Promise.resolve(false);
  const c = navigator.serviceWorker.controller;
  if (c) {
    c.postMessage(msg);
    return Promise.resolve(true);
  }
  return target().then((t) => {
    if (!t) return false;
    t.postMessage(msg);
    return true;
  });
}
function request(event, msg) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve, event });
    void post(Object.assign({ id }, msg));
  });
}
function dispatch(data) {
  const id = typeof data.id === "number" ? data.id : 0;
  if (id) {
    const p = pending.get(id);
    if (p) {
      pending.delete(id);
      p.resolve(data);
    }
  }
  const type = String(data.type || "");
  if (!type.startsWith("sw:")) return;
  emit(type.slice(3), data);
}
function installListeners() {
  if (listenersInstalled || !supported()) return;
  listenersInstalled = true;
  navigator.serviceWorker.addEventListener("message", (event) => {
    dispatch(event.data || {});
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (currentLang) void post({ type: MSG.LANG, lang: currentLang });
  });
  if (opts.reportVisibility && typeof document !== "undefined") {
    const report = () => {
      void post({
        type: MSG.VISIBILITY,
        visible: document.visibilityState === "visible",
        lang: currentLang || void 0,
        online: typeof navigator === "undefined" ? true : navigator.onLine !== false
      });
    };
    document.addEventListener("visibilitychange", report);
    report();
  }
  if (opts.reportNetwork && typeof window !== "undefined") {
    window.addEventListener("online", () => {
      void post({ type: MSG.NET, online: true });
      void post({ type: MSG.SYNC });
    });
    window.addEventListener("offline", () => {
      void post({ type: MSG.NET, online: false });
    });
  }
  if (opts.syncIntervalMs > 0 && typeof document !== "undefined") {
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void post({ type: MSG.SYNC });
    }, opts.syncIntervalMs);
  }
}
function registerSW(options = {}) {
  opts = Object.assign({}, DEFAULTS, options);
  if (!supported()) {
    emit("error", { message: "serviceWorker not supported" });
    return Promise.resolve(null);
  }
  installListeners();
  return navigator.serviceWorker.register(opts.url, { scope: opts.scope }).then((r) => {
    registration = r;
    if (currentLang) void post({ type: MSG.LANG, lang: currentLang });
    if (opts.syncOnRegister) void post({ type: MSG.SYNC });
    emit("ready", { registration: r });
    return r;
  }).catch((err) => {
    emit("error", { message: "register failed", error: err });
    return null;
  });
}
function unregisterSW() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  listenersInstalled = false;
  handlers.clear();
  pending.clear();
  const r = registration;
  registration = null;
  if (!r) return Promise.resolve(false);
  return r.unregister().catch(() => false);
}
function getRegistration() {
  return registration;
}
function setLanguage(lang) {
  const l = String(lang == null ? "" : lang).trim();
  if (!l) return;
  currentLang = l;
  void post({ type: MSG.LANG, lang: l });
}
function getLanguage() {
  return currentLang;
}
function syncNow(mode = "background") {
  void post({ type: MSG.SYNC, mode });
}
function refresh(urls, options = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  return request("refreshed", {
    type: MSG.REFRESH,
    urls: list,
    options
  }).then((d) => d && Array.isArray(d.results) ? d.results : []);
}
function fillMissing() {
  void post({ type: MSG.FILL_MISSING });
}
function prefetchErrorPages(lang) {
  void post({ type: MSG.PREFETCH_ERROR_PAGES, lang: lang || currentLang || void 0 });
}
function reloadHeaders() {
  void post({ type: MSG.HEADERS_RELOAD });
}
function warm(urls) {
  void post({ type: MSG.WARM, urls });
}
function getPerf(reset = false) {
  void post({ type: MSG.PERF, reset });
}
function getStatus() {
  void post({ type: MSG.STATUS });
}
function applyUpdate() {
  void post({ type: MSG.SKIP_WAITING });
}
function clearAll() {
  void post({ type: MSG.CLEAR });
}
function setRouting(patch) {
  void post({ type: MSG.ROUTING_SET, routing: patch });
}
function setSecurity(patch) {
  void post({ type: MSG.SECURITY_SET, security: patch });
}
function getSecurity(reset = false) {
  void post({ type: MSG.SECURITY, reset });
}
function retryOrigin(origin) {
  void post({ type: MSG.NET_RESET, origin });
}
function precache() {
  void post({ type: MSG.PRECACHE });
}
export {
  applyUpdate,
  clearAll,
  fillMissing,
  getLanguage,
  getPerf,
  getRegistration,
  getSecurity,
  getStatus,
  on,
  once,
  precache,
  prefetchErrorPages,
  refresh,
  registerSW,
  reloadHeaders,
  retryOrigin,
  setLanguage,
  setRouting,
  setSecurity,
  syncNow,
  unregisterSW,
  warm
};
