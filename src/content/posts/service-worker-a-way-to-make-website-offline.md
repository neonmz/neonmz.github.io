---
title: Service Worker：一种让网站可离线访问的解决方案
published: 2026-11-05
description: 'Service Worker 是什么、生命周期如何运作、缓存策略怎么选、边界在哪里，以及它如何让一个静态博客在断网时打开。'
image: ''
tags: [Service Worker]
category: 'Web'
draft: false 
lang: 'zh_CN'
---
> MDN文档:
>
> [https://developer.mozilla.org/zh-CN/docs/Web/API/Service_Worker_API](https://developer.mozilla.org/zh-CN/docs/Web/API/Service_Worker_API)
>
> [https://developer.mozilla.org/zh-CN/docs/Web/API/Service_Worker_API/Using_Service_Workers](https://developer.mozilla.org/zh-CN/docs/Web/API/Service_Worker_API/Using_Service_Workers)

# 前言
因为Github Pages的国内访问速度有限，所以neon就想优化了用户的使用体验... ~~（其实原本neon只是想继续减少API的调用次数，结果到现在也还没实现...不过getloli的snow也有所缓解（虽然不能持续增加次数了））~~

# 关于Service Worker...
## Service Worker是什么？
Service Worker是一个注册到网页后台运行的js脚本，负责网页内的所有网络请求的处理。
> Service worker 本质上充当 Web 应用程序、浏览器与网络（可用时）之间的代理服务器。这个 API 旨在创建有效的离线体验，它会拦截网络请求并根据网络是否可用来采取适当的动作、更新来自服务器的资源。它还提供入口以推送通知和访问后台同步 API。

本质上，ta就是一个特殊的Worker。

## 它怎么工作
页面侧只做一件事：注册。

```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' });
  });
}
```

`scope`决定它能控制哪些请求，默认是脚本所在目录。`/sw.js`放在根目录就能覆盖全站；放在子目录又想扩大范围，需要服务端返回`Service-Worker-Allowed`响应头。（但是静态部署这个很难实现...）

注册之后是标准的生命周期：

```
install ──► installed（等待）──► activate ──► fetch
   │              │                 │
预缓存资源      等旧页面关闭      清旧缓存、接管页面
```

`install`里通常做初始化（如：prefetch），用`event.waitUntil()`延长事件生命周期。这里返回的Promise如果reject，整个安装会失败，SW不会进入下一阶段——所以预缓存列表里出现一个404，就会导致安装不成功。

安装完成后SW停在`waiting`，等所有受控页面关闭才`activate`。这个设计的目的是避免新版本替换旧页面正在使用的资源。`skipWaiting()`可以跳过等待，但新SW会和旧页面共存一段时间，如果资源版本对不上，运行中的页面可能出错。

`activate`适合清理旧版本的缓存；`clients.claim()`让已打开的页面立即被新SW接管，不必等下一次导航。

`fetch`事件里，`respondWith()`必须在事件回调中同步调用，不能先`await`再调用，否则事件已经结束，浏览器会按网络请求处理。

更新是独立于缓存的另一套机制。（更新请求本身不会被sw缓存，但可能被HTTP缓存）浏览器会在导航时检查`sw.js`本身是否有变化（规范要求至少每24小时一次），按字节比较，有变化就安装新版本。`registration.update()`可以手动触发。

## 缓存策略
SW不规定缓存方式，只提供Cache API。实际要决定的是每个请求走哪条路径。

**Cache First**：先查缓存，未命中再回源。适合内容哈希的静态资源、字体、图片，这类文件本来就不会在原URL上变更。

**Network First**：先回源，失败时读缓存。适合更新频繁、但离线时仍希望可用的内容，比如文章列表、部分接口。

**Stale-While-Revalidate**：立即返回缓存副本，同时在后台请求新版本并写回缓存。适合头像、封面这类对时效不敏感、但对延迟敏感的图片。

**Cache Only**和**Network Only**用于两端：前者只读缓存，适合预置的离线页；后者只走网络，适合登录、支付这类不能使用历史数据的请求。

选择依据可以归结为一个判断：这份内容过期后是否可接受。可接受就把缓存放在前面，不可接受就把网络放在前面。

## 除了离线，还能做什么
离线只是它最常被提到的用途。由于它位于请求路径上，能力范围比“缓存”更宽。

推送通知依赖Push API和Notification API，页面未打开也能收到消息；iOS上还要求站点被添加到主屏幕。

后台同步（Background Sync）可以在离线时把请求排队，恢复网络后由浏览器重发，适合表单提交、点赞这类操作。目前主要是Chromium系支持，Safari没有实现。

请求改写也是常见用法：按`Accept`协商替换图片格式、给第三方请求附加参数、在网络较差时返回低分辨率资源。

性能方面，可以用它预取后续页面，或者通过声明式路由让符合条件的静态资源直接命中Cache Storage，避免每次请求都唤醒SW进程。

安全方面，它可以在脚本执行前拦截第三方资源。CSP需要服务端配置，而SW的拦截完全在客户端生效。

## 它做不到什么
它无法优化首次访问 第一次打开时SW尚未下载，这段时间不受它影响。


## 一个最小例子
一个可运行的SW只需要三段逻辑：

```js
// sw.js
const CACHE = 'v1';
const ASSETS = ['/', '/index.html', '/style.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return; // 非 GET 直接放行
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});
```

安装时写入缓存，激活时清理旧版本，请求时先查缓存——Cache First的基本形态。把它放到站点根目录，页面注册后断网刷新即可验证。

这段代码有两个已知局限：`addAll`是原子操作，任意一个资源404都会导致安装失败；缓存列表是硬编码的，构建产物文件名变化后需要手动维护。真实项目一般会用构建期生成的资源清单来解决第二点。

另外，跨源`no-cors`请求返回的是opaque响应，可以写入缓存并原样返回，但读不到状态码和响应体，判断是否命中只能看有没有响应对象。

## 几个坑
**开发时被缓存。** 改完代码刷新没有变化，通常是SW没有更新，而不是代码没生效。DevTools的Application面板可以勾选“Update on reload”，或者在开发环境不注册SW。

**`skipWaiting()`需要配套处理。** 新SW立即接管后，旧页面可能仍在请求旧版本资源。常见做法是提示用户刷新，或者用`clients.claim()`配合版本化的资源路径。

**`cacheName`要版本化。** 修改缓存结构时更换名称，并在`activate`中删除旧缓存，否则旧资源会一直保留。（如果没有写清理代码的话）

**scope与路径要对齐。** SW只能控制scope内的请求，放在子目录时不要预期它能处理全站。

# 附：本站是怎么做的 ~~（其实是让AI实现的...）~~
前面的内容与具体站点无关。neon的博客采用的是一个整站预缓存的方案，可以作为参考。

整体流程是：构建结束后生成一份资源清单，SW安装时拉取清单，把清单内的资源写入Cache Storage，之后所有同源请求优先读缓存。

清单叫`_hash`，由构建脚本生成，格式是每行“路径 + 内容哈希”：

```
/index.html 8f2a1c
/_astro/index.0f3c9a.css 77cd
/avatar.jpg 04d1a77b
```

哈希是判断资源是否变化的唯一依据。SW把新清单与本地保存的清单做diff，只下载哈希变化的条目。因此更新是增量的：修改一篇文章，只有对应的HTML和RSS会重新下载，字体、图片不受影响。整站目前两百多个文件、约十几MB，安装阶段只等待入口文件（HTML、JS、CSS），其余资源在后台按较低优先级下载，避免阻塞首屏。

页面侧只注册一次，并把当前语言传给SW：

```astro
<script>
  import { registerSW } from '@/sw/register';

  const lang = localStorage.getItem('language') ?? 'zh-cn';
  registerSW({ url: '/sw.js', scope: '/', language: lang });
</script>
```

错误页：neon为每个状态码、每种语言写了独立的错误页（），SW在返回404时按当前语言选择对应页面，用户切换语言时也会预取该语言的错误页。

sw.js是预构建产物，放在站点根目录，不参与打包。原因是它必须作为独立文件存在，且URL要位于scope根部，打包器改写路径后会拿不到`/`的控制权。 ~~（这些都是次要的，因为neon的sw项目编译太费时了，会严重增加GitHub Actions的用时）~~
实际效果：首次访问与普通站点一致，只是后台多出一批下载；再次访问时，DevTools中大部分请求的来源显示为Service Worker；断网刷新可以正常打开，未访问过的文章也能读取。

~~不过似乎还有一些bugs，如Safari可能会偶发样式表丢失、二次带缓存冷访问白屏、网站缓存更新不及时等问题，还等着neon去解决...（AI也不行了...完全找不出来问题的原因...）~~

# 结语
Service Worker常被归入PWA，但它本身只是一个位于浏览器与网络之间的可编程代理，离线只是它最典型的用法。

neon的博客用它做了整站预缓存。现在打开站点，多数请求的来源是Service Worker，不再产生网络往返。