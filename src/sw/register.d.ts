/** 安全拦截记录 */
export interface SecurityLogEntry {
    url: string;
    dest: string;
    action: string;
    reason: string;
    rule?: string;
    ts: number;
}
/** 安全策略统计 */
export interface SecurityStats {
    mode: string;
    domains: number;
    prefixes: number;
    paths: number;
    blocked: number;
}
/** 运行时可覆盖的多语言路由配置 */
export interface RoutingPatch {
    enabled?: boolean;
    preferLangVersion?: boolean;
    useClientLang?: boolean;
    langFallback?: string[] | null;
    hijackAction?: 'serve' | 'redirect' | 'off';
    redirectStatus?: number;
    normalize?: {
        enabled?: boolean;
        canonical?: 'slash' | 'no-slash' | 'index-html';
        canonicalTemplate?: string | null;
        status?: number;
        onlyForManifest?: boolean;
        skipIfLangPath?: boolean;
        skipRoot?: boolean;
    };
}
/** 运行时可覆盖的安全配置片段 */
export interface SecurityPatch {
    mode?: 'off' | 'allowlist' | 'denylist';
    destinations?: string[];
    includeIframes?: boolean;
    includeNavigations?: boolean;
    allowSameOrigin?: boolean;
    domains?: string[];
    urlPrefixes?: string[];
    pathPatterns?: string[];
    action?: 'block' | 'drop' | 'allow';
    blockResponse?: {
        status?: number;
        statusText?: string;
        body?: string;
        contentType?: string;
        headers?: Record<string, string>;
    };
    broadcast?: boolean;
    log?: boolean;
    paranoid?: {
        blockOpaqueExecutable?: boolean;
    };
}
export interface RefreshResult {
    url: string;
    ok: boolean;
    status: number;
    opaque: boolean;
    cached: boolean;
    inManifest: boolean;
    reason?: string;
}
export interface RegisterOptions {
    /** sw.js 的 URL，默认 '/sw.js' */
    url?: string;
    /** 注册 scope，默认 '/' */
    scope?: string;
    /** 定时检测更新间隔（ms），默认 60000；0 表示不自动轮询 */
    syncIntervalMs?: number;
    /** 初始语言；不传则等外部调用 setLanguage() */
    language?: string;
    /** 是否上报页面可见性（用于 SW 的前台优先调度），默认 true */
    reportVisibility?: boolean;
    /** 是否上报网络状态，默认 true */
    reportNetwork?: boolean;
    /** 注册成功后是否立即触发一次更新检查，默认 true */
    syncOnRegister?: boolean;
}
/** 可订阅的事件名 */
export type SwEventType = 'update' | 'refreshed' | 'filled' | 'warmed' | 'perf' | 'status' | 'lang' | 'headers' | 'net' | 'precache-progress' | 'precache-done' | 'ready' | 'error' | 'security' | 'routing';
export interface SwEventMap {
    update: {
        updated: string[];
        removed: string[];
        hasEntryUpdate: boolean;
    };
    refreshed: {
        results: RefreshResult[];
    };
    filled: {
        filled: string[];
    };
    warmed: {
        warmed: number;
    };
    perf: Record<string, unknown>;
    status: Record<string, unknown>;
    lang: {
        lang: string;
    };
    headers: Record<string, unknown>;
    net: {
        online: boolean;
    };
    'precache-progress': {
        done: number;
        total: number;
        mode?: string;
    };
    'precache-done': {
        total: number;
        mode?: string;
    };
    ready: {
        registration: ServiceWorkerRegistration;
    };
    error: {
        message: string;
        error?: unknown;
    };
    security: SecurityStats & {
        log: SecurityLogEntry[];
    };
    routing: Record<string, unknown>;
}
type Handler<T> = (payload: T) => void;
/** 订阅 SW 推送的事件，返回取消订阅函数 */
export declare function on<K extends SwEventType>(type: K, handler: Handler<SwEventMap[K]>): () => void;
/** 一次性订阅 */
export declare function once<K extends SwEventType>(type: K, handler: Handler<SwEventMap[K]>): () => void;
/**
 * 注册 Service Worker。
 * 不读 storage、不写 storage，语言完全由外部 setLanguage() 驱动。
 */
export declare function registerSW(options?: RegisterOptions): Promise<ServiceWorkerRegistration | null>;
/** 注销 SW 并清理本模块安装的监听 */
export declare function unregisterSW(): Promise<boolean>;
/** 当前注册对象 */
export declare function getRegistration(): ServiceWorkerRegistration | null;
/**
 * 设置语言。由外部在切换语言时调用（本模块不碰 localStorage）。
 * 例：setLanguage(localStorage.getItem('language') ?? 'en') —— storage 读写由业务侧负责。
 */
export declare function setLanguage(lang: string): void;
/** 读取当前语言（内存态，非 storage） */
export declare function getLanguage(): string;
/** 立即触发一次更新检查 */
export declare function syncNow(mode?: 'background' | 'install'): void;
/**
 * 强制刷新任意 URL（常用于清单外资源）。
 * 缓存 key 恒为原始 URL，opaque 响应原样存储。
 */
export declare function refresh(urls: string | string[], options?: {
    priority?: string;
    destination?: string;
    mode?: string;
    credentials?: string;
}): Promise<RefreshResult[]>;
/** 补全清单里有但缓存缺失的文件 */
export declare function fillMissing(): void;
/** 预取某语言（默认当前语言）的错误页 */
export declare function prefetchErrorPages(lang?: string): void;
/** 重新加载 _headers 规则 */
export declare function reloadHeaders(): void;
/** 预热内存缓存；不传 urls 则按清单入口文件预热 */
export declare function warm(urls?: string[]): void;
/** 取性能与状态快照 */
export declare function getPerf(reset?: boolean): void;
/** 取缓存与清单状态 */
export declare function getStatus(): void;
/** 让等待中的新 SW 立即接管（刷新动作由业务侧决定） */
export declare function applyUpdate(): void;
/** 清空缓存并重装（慎用） */
export declare function clearAll(): void;
/**
 * 运行时覆盖安全策略（改完立即生效，无需重新部署 SW）。
 * 例：迁移期先观察，只记录不拦截 → setSecurity({ mode: 'off' })
 *     收紧 → setSecurity({ mode: 'allowlist', domains: ['cdn.mine.com'] })
 */
export declare function setRouting(patch: RoutingPatch): void;
export declare function setSecurity(patch: SecurityPatch): void;
/** 查询安全策略统计与拦截记录（通过 on('security') 接收） */
export declare function getSecurity(reset?: boolean): void;
/**
 * 重置可达状态（用户点「重试」时调用）。
 * 不传 origin 则重置本源；网站恢复后跨源资源不受影响，无需调用。
 */
export declare function retryOrigin(origin?: string): void;
/** 全量预缓存 */
export declare function precache(): void;
export {};
