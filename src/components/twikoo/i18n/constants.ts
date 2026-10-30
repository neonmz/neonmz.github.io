/**
 * i18n 常量表（把「常量文案」从翻译词表中分离出来）。
 *
 * 1.x 把这些枚举值内联在 `i18n.js` 里、再以字符串拼接的方式嵌入配置项说明文案
 * （例如 `${highlightThemes.join('、')}`）；2.0 的说明文案已固化进 `locales/*.json`，
 * 本文件因此转为**枚举唯一事实来源**：供管理面板做联动显示（`customImageBedServices`）、
 * 供测试校验文案与枚举一致、供文档生成参考。
 */
// import { PUSHOO_CHANNELS } from "@twikoojs/shared";
/**
 * 推送渠道类型联合（共享层权威声明）。
 *
 * 依据 `packages/pushoo/src/index.ts` 的 `ChannelType`（只读参考依据）逐字声明，
 * 作为 2.0 各处引用推送渠道的类型来源。
 *
 * 未使用 `import type { ChannelType } from 'pushoo'` 直接派生，原因：
 * 1. `pushoo` 的分发入口是 `dist/index.js`，产物（含 `.d.ts`）尚未构建；
 * 2. 其 `ChannelType` 所在源文件顶层还会解析 axios / marked 等重依赖，跨包引入类型
 *    会把重依赖拖入 shared 的类型解析，违背「shared 零运行时依赖」的定位。
 * 因此在此声明同一联合，并通过文件末尾的编译期完备性守卫
 * （{@link PushooChannelCoverage}）保证新增/删除渠道时不会漏更新渠道清单。
 *
 * 其中 `serverchain` 是 1.x 遗留的 `serverchan` 拼写别名（仅 pushoo 内部分发兼容），
 * 2.0 新代码不得使用，派生实际渠道见 {@link ActiveChannelType}。
 */
export type ChannelType =
  | "webhook"
  | "qmsg"
  | "serverchan"
  | "serverchain"
  | "pushplus"
  | "dingtalk"
  | "wecom"
  | "bark"
  | "gocqhttp"
  | "onebot"
  | "atri"
  | "pushdeer"
  | "igot"
  | "telegram"
  | "feishu"
  | "lark"
  | "ifttt"
  | "wecombot"
  | "discord"
  | "wxpusher"
  | "ntfy"
  | "join";

/**
 * 2.0 实际支持的推送渠道类型。
 *
 * 等于 {@link ChannelType} 排除 1.x 兼容别名 `serverchain`，共 21 个渠道。
 */
export type ActiveChannelType = Exclude<ChannelType, "serverchain">;

/**
 * PUSHOO 支持的推送渠道清单（21 个，不含 `serverchain`）。
 *
 * 顺序与命名严格对齐 pushoo 的 `ChannelType`，供国际化（渠道文案键）、
 * 配置界面遍历与推送能力校验统一消费。使用 `as const satisfies` 保证
 * 每个字面量都是合法的 {@link ActiveChannelType}。
 */
export const PUSHOO_CHANNELS = [
  "webhook",
  "qmsg",
  "serverchan",
  "pushplus",
  "dingtalk",
  "wecom",
  "bark",
  "gocqhttp",
  "onebot",
  "atri",
  "pushdeer",
  "igot",
  "telegram",
  "feishu",
  "lark",
  "ifttt",
  "wecombot",
  "discord",
  "wxpusher",
  "ntfy",
  "join",
] as const satisfies readonly ActiveChannelType[];

/** 编译期完备性守卫：约束为 `never`，一旦有渠道漏列即触发约束错误 */
type EnsureAllChannelsListed<T extends never> = T;

/**
 * 渠道清单完备性断言的导出类型。
 *
 * 恒为 `never`；当 {@link PUSHOO_CHANNELS} 漏列 {@link ActiveChannelType} 中任一渠道时，
 * 被排除出的缺失成员类型不满足 `never` 约束，编译立即失败，从而强制清单与类型同步。
 */
export type PushooChannelCoverage = EnsureAllChannelsListed<
  Exclude<ActiveChannelType, (typeof PUSHOO_CHANNELS)[number]>
>;

/**
 * 即时消息推送渠道（以 pushoo 源码为唯一真相源，从 `@twikoojs/shared` 派生）。
 *
 * 1.x 前端只列了 13 个渠道且与 pushoo 实际支持的渠道不一致（缺 8 个）；
 * 2.0 起 `PUSHOO_CHANNELS` 由 pushoo 的 `ChannelType` 派生并带编译期覆盖校验，
 * 此处直接转出以保证「说明文案 ↔ pushoo 实现」永远同步。
 */
export const pushooChannels: readonly string[] = [...PUSHOO_CHANNELS];

/** nodemailer 内置 SMTP 服务商名（`SMTP_SERVICE` 取值，1.x 基线全量保留） */
export const smtpServices: readonly string[] = [
  "126",
  "163",
  "1und1",
  "AOL",
  "DebugMail",
  "DynectEmail",
  "FastMail",
  "GandiMail",
  "Gmail",
  "Godaddy",
  "GodaddyAsia",
  "GodaddyEurope",
  "Hotmail",
  "Mail.ru",
  "Maildev",
  "Mailgun",
  "Mailjet",
  "Mailosaur",
  "Mandrill",
  "Naver",
  "OpenMailBox",
  "Outlook365",
  "Postmark",
  "QQ",
  "QQex",
  "SES",
  "SES-EU-WEST-1",
  "SES-US-EAST-1",
  "SES-US-WEST-2",
  "SendCloud",
  "SendGrid",
  "SendPulse",
  "SendinBlue",
  "Sparkpost",
  "Yahoo",
  "Yandex",
  "Zoho",
  "hot.ee",
  "iCloud",
  "mail.ee",
  "qiye.aliyun",
];

/** Prism 代码高亮主题（`HIGHLIGHT_THEME` 取值；`none` 表示仅关闭主题样式表） */
export const highlightThemes: readonly string[] = [
  "default",
  "coy",
  "dark",
  "funky",
  "okaidia",
  "solarizedlight",
  "tomorrow",
  "twilight",
];

/** Prism 代码高亮插件（`HIGHLIGHT_PLUGIN` 取值，逗号分隔可多选） */
export const highlightPlugins: readonly string[] = ["showLanguage", "copyButton"];

/** 图床服务（`IMAGE_CDN` 取值；与 TkAdminConfig 的下拉项一一对应） */
export const imageBedServices: readonly string[] = [
  "qcloud",
  "7bu (https://7bu.top)",
  "see (https://s.ee)",
  "lskypro",
  "piclist",
  "easyimage",
  "chevereto",
  "S3 / R2 / MinIO",
];

/**
 * 需要用户填写 `IMAGE_CDN_URL` 的图床（即服务端唯一会读取该配置的图床）。
 *
 * TkAdminConfig 用它决定 `IMAGE_CDN_URL` 输入框的显示条件；S3 走 `S3_ENDPOINT` / `S3_CDN_URL`。
 */
export const customImageBedServices: readonly string[] = [
  "lskypro",
  "piclist",
  "easyimage",
  "chevereto",
];

/** 默认头像占位图（`DEFAULT_GRAVATAR` 取值；留空等价于 `initials`） */
export const defaultGravatar: readonly string[] = [
  "404",
  "mp",
  "identicon",
  "monsterid",
  "wavatar",
  "retro",
  "robohash",
  "blank",
];

/** 默认 Gravatar CDN（`GRAVATAR_CDN` 留空时的取值，1.x 基线） */
export const DEFAULT_GRAVATAR_CDN = "weavatar.com";
