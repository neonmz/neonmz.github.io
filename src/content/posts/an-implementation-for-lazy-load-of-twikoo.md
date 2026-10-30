---
title: Twikoo评论区懒加载的一种实现
published: 2026-10-29
description: ''
image: ''
tags: [HTML,Typescript]
category: 'Web'
draft: false 
lang: 'zh-CN'
---
# 引言
neon用vercel部署了twikoo，但是Hobby版有次数限制，所以neon想“帮用户缓解流量压力”~~（帮neon减少不必要的request）~~

# 懒加载（Lazy Load）是什么
> **懒加载**（延迟加载）是一种将资源标识为非阻塞（非关键）资源并仅在需要时加载它们的策略。这是一种缩短关键渲染路径长度的方法，可以缩短页面加载时间。
>
> 延迟加载可以在应用程序的不同时刻发生，但通常会在某些用户交互（例如滚动和导航）上发生。
>
> 详情自行查看[MDN](https://developer.mozilla.org/zh-CN/docs/Web/Performance/Guides/Lazy_loading)

浏览器原生支持了img和iframe的懒加载，可以通过设置属性`loading="lazy"`实现。

例如：

```html
<img src="image.jpg" alt="..." loading="lazy" />
<iframe src="video-player.html" title="..." loading="lazy"></iframe>
```

还有一个Javascript API：**Intersection Observer API**，可用于检测当前某个元素是否可见，下面实现评论的lazy load就使用这个API。

# Twikoo Client的情况
> 本文基于[twikoo@2.0.17](https://github.com/twikoojs/twikoo/tree/2.0.17)

默认情况下，Twikoo通过script引入：

```html
<div id="tcomment"></div>
<script src="https://cdn.jsdelivr.net/npm/twikoo@2.0.17/dist/twikoo.min.js"></script>
<script>
  twikoo.init({
    envId: "您的环境 id", // 腾讯云环境填 envId；Vercel 环境填地址（https://xxx.vercel.app）
    el: "#tcomment", // 容器元素
    // region: 'ap-guangzhou', // 环境地域，默认为 ap-shanghai，腾讯云环境填 ap-shanghai 或 ap-guangzhou；Vercel 环境不填
    // path: location.pathname, // 用于区分不同文章的自定义 js 路径，如果您的文章路径不是 location.pathname，需传此参数
    // lang: 'zh-CN', // 用于手动设定评论区语言，支持的语言列表 https://github.com/twikoojs/twikoo/blob/main/packages/client/src/i18n/index.ts
  });
</script>
```
而作为一个script，`loading="lazy"`显然不可用。

Twikoo会在执行init后立即向后端发送request收集信息，而直接这样书写会导致网页一加载就执行初始化 ~~马上后端的请求次数就被消耗了...~~

当然可以通过Observer让`<div id="tcomment"></div>`进入可见区域后再初始化。（但是neon没有这样实现）

# 为 Twikoo Client加载评论实现懒加载
查看client的源码，注意到client发request均使用`utils/http.ts`的一个工具函数`fetchText()`：

```ts
/** 请求因超过时限被主动中止，与网络失败或跨域拦截区分。 */
export class TwikooFetchTimeoutError extends Error {}

/** 拉取响应及文本，30 秒时限覆盖等待响应头和读取响应体的全过程。 */
export async function fetchText(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (e) {
    if (controller.signal.aborted) throw new TwikooFetchTimeoutError("请求超时");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
```

所以neon就考虑把这个函数封装一层，实现等 评论区visible才真正执行`fetch()`。

```ts
let fetchTextEntry = fetchTextWait;

const cond = new AsyncCondition();
async function fetchTextWait(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string }>
{
  await cond.wait();
  fetchTextEntry = fetchTextOri;
  return await fetchTextOri(url, options);
}

export async function fetchText(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string }> {
  return await fetchTextEntry(url, options);
}
```
通过让条件（评论区可见）不满足的时候，`cond.wait()`直接阻塞，不执行`fetch()`;

当条件满足后，`cond.wait()`返回，继续执行`fetch()`，此时网络请求才真正触发。

编写Observer的代码：

```ts
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      cond.notify();
      observer.unobserve(entry.target);
    }
  });
}, {
  rootMargin: '100px 0px'
});
const opt: TwikooOptions = { el: "#tcomment"};
function observe_el() {
  const el = document.querySelector((opt.el as string) || "#twikoo");
  
  if (!el) {
    cond.reject(new Error(`Twikoo container not found: ${opt.el}`));
  } else
  {
    observer.observe(el);
  }
}
```

当条件满足（`entry.isIntersecting === true`）后，通知阻塞的网络请求继续执行`cond.notify()`。

整体代码：

```ts
// utils/wait.ts
export class AsyncCondition {
  private _promise: Promise<void> | null = null;
  private _resolves: Array<() => void> = [];
  private _rejects: Array<(reason: Error) => void> = [];
  private _flag = false;
  private _error: Error | null = null;

  wait(): Promise<void> {
    if (this._flag) {
      return Promise.resolve();
    }
    if (this._error) {
      return Promise.reject(this._error);
    }

    return new Promise<void>((resolve, reject) => {
      this._resolves.push(resolve);
      this._rejects.push(reject);
    });
  }

  notify(): void {
    this._flag = true;
    this._resolves.forEach(r => r());
    this._resolves = [];
    this._rejects = [];
    this._promise = null;
  }

  reject(reason: Error): void {
    this._error = reason;
    this._rejects.forEach(r => r(reason));
    this._rejects = [];
    this._resolves = [];
    this._promise = null;
  }

  reset(): void {
    this._flag = false;
    this._error = null;
    this._resolves = [];
    this._rejects = [];
    this._promise = null;
  }
}

// utils/http.ts
import { AsyncCondition } from "./wait";
import { getAppState } from "./api";
import { TwikooOptions } from "../main";

/** 请求因超过时限被主动中止，与网络失败或跨域拦截区分。 */
export class TwikooFetchTimeoutError extends Error {}

/** 拉取响应及文本，30 秒时限覆盖等待响应头和读取响应体的全过程。 */
export async function fetchTextOri(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (e) {
    if (controller.signal.aborted) throw new TwikooFetchTimeoutError("请求超时");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}


let fetchTextEntry = fetchTextWait;

const cond = new AsyncCondition();
async function fetchTextWait(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string }>
{
  await cond.wait();
  fetchTextEntry = fetchTextOri;
  return await fetchTextOri(url, options);
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      cond.notify();
      observer.unobserve(entry.target);
    }
  });
}, {
  rootMargin: '100px 0px'
});
// const opt: TwikooOptions = getAppState().options; // 前端测试结果：getAppState()返回无效，无法读取options （可能是执行时，init()还没执行？），故改为硬编码id
const opt: TwikooOptions = { el: "#tcomment"};
function observe_el() {
  const el = document.querySelector((opt.el as string) || "#twikoo");
  
  if (!el) {
    cond.reject(new Error(`Twikoo container not found: ${opt.el}`));
  } else
  {
    observer.observe(el);
  }
}

export async function fetchText(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string }> {
  return await fetchTextEntry(url, options);
}
```

到此，Twikoo 评论区的懒加载已经完成实现。

# 附：为Swup实现支持
因为条件触发后，函数已经恢复为原值，不会再次阻塞了，导致swup切换网页后懒加载失效。

一种可行的解决方案： 当触发切换时，再次将`fetchTextEntry`设置为`fetchTextWait`，并恢复cond的状态，重新等待条件满足。

在`utils/http.ts`下新建函数：

```ts
export function resetLazyLoadStatus() {
  cond.reset();
  fetchTextEntry = fetchTextWait;
  observe_el();
}
```

当网页切换时，调用此函数重置状态。

在`main.ts`下添加swup相关代码：

```ts
export const twikooOptions: TwikooOptions = {
  envId: "您的环境 id", // 腾讯云环境填 envId；Vercel 环境填地址（https://xxx.vercel.app）
  el: "#tcomment", // 容器元素
  // region: 'ap-guangzhou', // 环境地域，默认为 ap-shanghai，腾讯云环境填 ap-shanghai 或 ap-guangzhou；Vercel 环境不填
  // path: location.pathname, // 用于区分不同文章的自定义 js 路径，如果您的文章路径不是 location.pathname，需传此参数
  // lang: 'zh-CN', // 用于手动设定评论区语言，支持的语言列表 https://github.com/twikoojs/twikoo/blob/main/packages/client/src/i18n/index.ts
}

export function reInit() {
  init(twikooOptions);
  resetLazyLoadStatus();
}

// Run on initial load 

if (document.readyState === 'loading') { 
  document.addEventListener('DOMContentLoaded', reInit); 
} else { 
  reInit(); 
} 

// Swup integration
function setupSwup() {
  if (window.swup && window.swup.hooks) {
    // Register hook for content replacement
    window.swup.hooks.on('content:replace', reInit);
  }
}

if (window.swup) {
  setupSwup();
} else {
  document.addEventListener('swup:enable', setupSwup);
}

// Legacy Swup support
document.addEventListener('swup:contentReplaced', reInit);
```

> neon把初始化调用直接写到了twikoo里，故不用从外部调用`init()`了。
>
> neon还把twikooOptions导出了，以便外部可以修改options（如切换语言等）