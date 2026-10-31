import { AsyncCondition } from "./wait";
import { twikooOptions } from "../config";


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


// let fetchTextEntry = fetchTextWait;

const cond = new AsyncCondition();
cond.setResetCallback(observe_el);

async function fetchTextWait(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string }>
{
  await cond.wait(location.pathname);
  return await fetchTextOri(url, options);
}

let el : HTMLDivElement | null;

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      cond.notify();
      observer.unobserve(entry.target);
      el = null;
    }
  });
}, {
  rootMargin: '100px 0px'
});
const opt = twikooOptions;

function observe_el() {
  if (el) observer.unobserve(el);
  el = document.querySelector((opt.el as string) || "#twikoo");
  
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
  return await fetchTextWait(url, options);
}

export function resetLazyLoadStatus(path : string) {
  cond.reset(path);
  observe_el();
}