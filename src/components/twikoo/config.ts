export interface TwikooOptions {
  /** 后端地址（HTTP 形态）或云开发 envId */
  envId?: string;
  /** 云函数名（缺省 twikoo） */
  funcName?: string;
  /** 挂载点选择器（缺省 #twikoo） */
  el?: string;
  /** 页面路径（缺省 location.pathname） */
  path?: string;
  /** 页面完整地址 */
  href?: string;
  /** 语言（缺省自动检测） */
  lang?: string;
  /**
   * 语言分片基址（缺省从主脚本自身 URL 推导）。
   * CDN / 子路径部署自动推导失准时可显式指定，如 `https://cdn.example.com/twikoo`。
   */
  localeBaseUrl?: string;
  /**
   * 评论提交前的回调（可原地修改即将发送的字段）。
   * 抛出异常等同于中止发送；返回 `false` 不会拦截（避免与验证码、草稿状态纠缠）。
   */
  onSubmit?: (payload: Record<string, unknown>) => void | Promise<void>;
  /** 其他前端配置项（管理面板透传） */
  [key: string]: unknown;
}

export const twikooOptions: TwikooOptions = {
  envId: "https://twk.yice.eu.org/", // 腾讯云环境填 envId；Vercel 环境填地址（https://xxx.vercel.app）
  el: "#comments", // 容器元素
  // region: 'ap-guangzhou', // 环境地域，默认为 ap-shanghai，腾讯云环境填 ap-shanghai 或 ap-guangzhou；Vercel 环境不填
  // path: location.pathname, // 用于区分不同文章的自定义 js 路径，如果您的文章路径不是 location.pathname，需传此参数
  // lang: 'zh-CN', // 用于手动设定评论区语言，支持的语言列表 https://github.com/twikoojs/twikoo/blob/main/packages/client/src/i18n/index.ts
};

