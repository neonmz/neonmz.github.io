<!--
  TkComment 单条评论（1.x TkComment.vue 的 Vue3 组合式重写）。

  职责：主楼/回复共用同一组件（模板内自引用实现楼中楼递归）；点赞/点踩、
  回复框挂载、内容与回复列表的展开折叠、图片灯箱、UA/归属地信息行、
  站长内联管理按钮（隐藏/置顶/删除）。

  与 1.x 的关键差异（Vue3 约束，非行为差异）：
  - 1.x 直接 `Object.assign(this.comment, set)` 改 props 对象；Vue3 禁改 props，
    改为本地 `localSpam` / `localTop`（经 watch 与 props 同步，视觉结果一致）。
  - 1.x 经 `this.$twikoo.serverConfig` 读全局配置；2.0 走 `utils/state.ts` 的响应式容器。
-->
<template>
  <div
    :id="comment.id"
    ref="tkCommentRef"
    class="tk-comment"
    :class="{ 'tk-master': comment.master }"
  >
    <TkAvatar
      :config="config"
      :nick="comment.nick"
      :avatar="comment.avatar"
      :mail-md5="comment.mailMd5"
      :link="convertedLink"
    />
    <div class="tk-main">
      <div class="tk-row">
        <div class="tk-meta">
          <strong v-if="!convertedLink" class="tk-nick">{{ comment.nick }}</strong>
          <a
            v-if="convertedLink"
            class="tk-nick tk-nick-link"
            :href="convertedLink"
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
          >
            <strong>{{ comment.nick }}</strong>
          </a>
          <span v-if="comment.master" class="tk-tag tk-tag-green">{{
            config.MASTER_TAG || t("COMMENT_MASTER_TAG")
          }}</span>
          <span v-if="localTop" class="tk-tag tk-tag-red">{{ t("COMMENT_TOP_TAG") }}</span>
          <span v-if="localSpam" class="tk-tag tk-tag-yellow">{{
            t("COMMENT_REVIEWING_TAG")
          }}</span>
          <small class="tk-time">
            <time :datetime="jsonTimestamp" :title="localeTime">{{ displayCreated }}</time>
          </small>
          <small v-if="isLogin" class="tk-actions">
            <button v-if="localSpam" @click="handleSpam(false)">
              {{ t("ADMIN_COMMENT_SHOW") }}
            </button>
            <button v-if="!localSpam" @click="handleSpam(true)">
              {{ t("ADMIN_COMMENT_HIDE") }}
            </button>
            <button v-if="!comment.rid && localTop" @click="handleTop(false)">
              {{ t("ADMIN_COMMENT_UNTOP") }}
            </button>
            <button v-if="!comment.rid && !localTop" @click="handleTop(true)">
              {{ t("ADMIN_COMMENT_TOP") }}
            </button>
            <button @click="onDelete(true)">
              {{ t("ADMIN_COMMENT_DELETE") }}
            </button>
          </small>
        </div>
        <TkAction
          :liked="liked"
          :disliked="disliked"
          :like-count="ups"
          :dislike-count="downs"
          :replies-count="comment.replies.length"
          :show-dislike="config.SHOW_DISLIKE !== 'false'"
          :show-delete="comment.isOwner === true"
          @like="onLike"
          @dislike="onDislike"
          @reply="onReply"
          @delete="onDelete(false)"
        />
      </div>
      <div
        ref="tkContentRef"
        class="tk-content"
        :class="{ 'tk-content-expand': isContentExpanded }"
      >
        <span v-if="comment.pid">
          {{ t("COMMENT_REPLIED") }}
          <a class="tk-ruser" href="#" @click.prevent="scrollToPid(comment.pid)">{{
            `@${comment.ruser}`
          }}</a>
          :
        </span>
        <!-- 正文：服务端已 DOMPurify 消毒，客户端再走一次 sanitizeHtml 双保险 -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <span ref="commentRef" @click="onContentClick" v-html="sanitizedComment"></span>
      </div>
      <div v-if="showContentExpand" class="tk-expand-wrap">
        <div class="tk-expand" @click="isContentExpanded = true">{{ t("COMMENT_EXPAND") }}</div>
      </div>
      <div v-if="showContentCollapse" class="tk-collapse-wrap">
        <div class="tk-expand _collapse" @click="isContentExpanded = false">
          {{ t("COMMENT_COLLAPSE") }}
        </div>
      </div>
      <div v-if="comment.ipRegion || comment.os || comment.browser" class="tk-extras">
        <div v-if="comment.ipRegion" class="tk-extra">
          <span class="tk-icon __comment"><TkIcon name="location-arrow" /></span>
          <span class="tk-extra-text">&nbsp;{{ comment.ipRegion }}</span>
        </div>
        <div v-if="comment.os" class="tk-extra">
          <span class="tk-icon __comment"><TkIcon :name="iconOs" /></span>
          <span class="tk-extra-text">&nbsp;{{ comment.os }}</span>
        </div>
        <div v-if="comment.browser" class="tk-extra">
          <span class="tk-icon __comment"><TkIcon :name="iconBrowser" /></span>
          <span class="tk-extra-text">&nbsp;{{ comment.browser }}</span>
        </div>
      </div>
      <!-- 回复框（主楼被回复时挂载；楼中楼由子评论自身挂载） -->
      <TkSubmit
        v-if="replying && !pid"
        :reply-id="replyId ? replyId : comment.id"
        :pid="comment.id"
        :config="config"
        @load="onLoad"
        @cancel="onCancel"
        @error="emit('error', $event)"
      />
      <!-- 回复列表 -->
      <div
        ref="tkRepliesRef"
        class="tk-replies"
        :class="{ 'tk-replies-expand': isExpanded || !showExpand || replying }"
      >
        <TkComment
          v-for="reply in comment.replies"
          :key="reply.id"
          :comment="reply"
          :reply-id="comment.id"
          :replying="replying && pid === reply.id"
          :config="config"
          @expand="isExpanded = true"
          @load="onLoad"
          @reply="onReplyReply"
          @refreshed="onRefreshed"
          @error="emit('error', $event)"
        />
      </div>
      <div v-if="showExpand && !replying" class="tk-expand-wrap">
        <div class="tk-expand" @click="isExpanded = true">{{ t("COMMENT_EXPAND") }}</div>
      </div>
      <div v-if="showCollapse && !replying" class="tk-collapse-wrap">
        <div class="tk-expand _collapse" @click="isExpanded = false">
          {{ t("COMMENT_COLLAPSE") }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import TkAction from "./TkAction.vue";
import TkAvatar from "./TkAvatar.vue";
import TkSubmit from "./TkSubmit.vue";
import TkIcon from "../components/TkIcon.vue";
import {
  call,
  convertLink,
  popupLightbox,
  renderCode,
  renderLinks,
  renderMath,
  sanitizeHtml,
  t,
  timeago,
} from "../utils";
import {
  getAppState,
  getResponse,
  getErrorMessage,
  TwikooResponseError,
  type TwikooError,
} from "../utils/api";
import { getServerConfig } from "../utils/state";
import { EMPTY_CONFIG } from "./defaults";
import type { CommentDto, ServerConfig } from "../types";

/** 组件属性（1.x props 同名保留） */
const props = withDefaults(
  defineProps<{
    /** 评论 DTO */
    comment: CommentDto;
    /** 所属根评论 ID（楼中楼回复用） */
    replyId?: string;
    /** 是否处于「回复本楼」状态 */
    replying?: boolean;
    /** 服务端配置 */
    config?: ServerConfig;
  }>(),
  { replyId: "", replying: false, config: EMPTY_CONFIG },
);

/** 组件事件（1.x `$emit` 同名保留） */
const emit = defineEmits<{
  (e: "reply", id: string): void;
  (e: "load"): void;
  (e: "expand"): void;
  (e: "refreshed"): void;
  (e: "error", error: TwikooError): void;
}>();

/** 操作系统图标表（1.x 同表） */
const osList: Record<string, string> = {
  win: "windows",
  mac: "apple",
  ipad: "apple",
  iphone: "apple",
  ios: "apple",
  android: "android",
  ubuntu: "ubuntu",
  linux: "linux",
};

/** 浏览器图标表（1.x 同表） */
const browserList: Record<string, string> = {
  edge: "edge",
  chrome: "chrome",
  firefox: "firefox-browser",
  safari: "safari",
  explorer: "internet-explorer",
  ie: "internet-explorer",
};

/** 被回复的目标评论 ID（空串表示未处于回复态） */
const pid = ref("");
/** 点赞数（本地乐观更新） */
const ups = ref(props.comment.ups ?? 0);
/** 点踩数 */
const downs = ref(props.comment.downs ?? 0);
/** 当前访问者是否已点赞 */
const liked = ref(props.comment.liked === true);
/** 当前访问者是否已点踩 */
const disliked = ref(props.comment.disliked === true);
/** 点赞请求进行中标记（防连点） */
const likeLoading = ref(false);
/** 回复列表是否展开 */
const isExpanded = ref(false);
/** 回复列表是否需要「展开更多」 */
const hasExpand = ref(false);
/** 正文是否展开 */
const isContentExpanded = ref(false);
/** 正文是否需要「展开更多」 */
const hasContentExpand = ref(false);
/** tcb 通道的异步登录结果（仅 `tcb.auth` 存在时使用） */
const tcbLoggedIn = ref(false);
/**
 * 当前访问者是否为管理员（决定内联管理按钮）。
 *
 * 必须为 `computed`：`initConfig()` 与 `initComments()` 并发执行（`TkComments` 的 `onMounted`），
 * 评论先于配置返回时 `IS_ADMIN` 尚未写入 `serverConfig`，若用 `ref` 一次性读取会得到 `false`，
 * 管理按钮要刷新才出现（#994）。`computed` 会在 `setServerConfig` 写入后自动重算。
 */
const isLogin = computed(() => {
  const { tcb } = getAppState();
  if (tcb?.auth) {
    return tcbLoggedIn.value;
  }
  return getServerConfig().IS_ADMIN === true;
});
/** 是否被标记为垃圾评论（本地态，替代 1.x 改 props） */
const localSpam = ref(props.comment.isSpam === true);
/** 是否置顶（本地态） */
const localTop = ref(props.comment.top === true);
/** 管理操作进行中标记 */
const adminLoading = ref(false);

/** 根节点引用（滚动定位用） */
const tkCommentRef = ref<HTMLElement>();
/** 正文容器引用（高度判定 + 渲染后处理） */
const tkContentRef = ref<HTMLElement>();
/** 正文内容引用（外链/公式/高亮的后处理目标） */
const commentRef = ref<HTMLElement>();
/** 回复列表容器引用 */
const tkRepliesRef = ref<HTMLElement>();

/** 正文 HTML（二次消毒；1.x sanitizedComment 对齐） */
const sanitizedComment = computed(() => sanitizeHtml(props.comment.comment));
/** 相对时间文案 */
const displayCreated = computed(() => timeago(props.comment.created));
/** `<time datetime>` 值 */
const jsonTimestamp = computed(() => new Date(props.comment.created ?? 0).toJSON());
/** `<time title>` 值（本地时间串） */
const localeTime = computed(() => new Date(props.comment.created ?? 0).toLocaleString());
/** 操作系统图标（未知时回退通用窗口图标） */
const iconOs = computed(() => getIconBy(props.comment.os ?? "", osList));
/** 浏览器图标 */
const iconBrowser = computed(() => getIconBy(props.comment.browser ?? "", browserList));
/** 是否显示「展开」按钮 */
const showExpand = computed(() => hasExpand.value && !isExpanded.value);
/** 是否显示「收起」按钮 */
const showCollapse = computed(() => hasExpand.value && isExpanded.value);
/** 是否显示正文「展开」 */
const showContentExpand = computed(() => hasContentExpand.value && !isContentExpanded.value);
/** 是否显示正文「收起」 */
const showContentCollapse = computed(() => hasContentExpand.value && isContentExpanded.value);
/** 个人站点链接（补全协议） */
const convertedLink = computed(() => convertLink(props.comment.link));

/**
 * 按关键字在图标表中匹配图标（1.x getIconBy 对齐：子串命中，未命中回退通用图标）。
 * @param name 待匹配的名称（如 UA 解析出的 "Windows 11"）
 * @param list 图标表
 * @returns 图标名
 */
function getIconBy(name: string, list: Record<string, string>): string {
  const lowerCaseName = name.toLowerCase();
  for (const key of Object.keys(list)) {
    if (lowerCaseName.indexOf(key) !== -1) return list[key];
  }
  return "window-maximize-regular";
}

/** 按实际高度判断回复列表是否需要折叠（1.x：200 为最大高度、36 为按钮高度） */
function showExpandIfNeed(): void {
  const el = tkRepliesRef.value;
  if (props.comment.replies.length > 0 && el) hasExpand.value = el.scrollHeight > 200 + 36;
}

/** 按实际高度判断正文是否需要折叠（1.x：500 为最大高度） */
function showContentExpandIfNeed(): void {
  const el = tkContentRef.value;
  if (!el) return;
  // 已经展开过就不再回收：防止图片 onload 晚于折叠判定导致展开态被取消（1.x 同类防护）
  hasContentExpand.value = hasContentExpand.value || el.scrollHeight > 500;
}

/** 为正文内图片挂 onload，图片撑高后重新判定是否需要折叠 */
function showContentExpandIfNeedAfterImagesLoaded(): void {
  tkContentRef.value?.querySelectorAll("img").forEach((imgEl) => {
    imgEl.onload = showContentExpandIfNeed;
  });
}

/** 若 URL hash 指向本评论则平滑滚动到本楼并展开回复 */
function scrollToComment(): void {
  if (window.location.hash.indexOf(props.comment.id) === -1) return;
  tkCommentRef.value?.scrollIntoView({ behavior: "smooth" });
  emit("expand");
}

/**
 * 滚动到被回复的评论（1.x scrollToPid 对齐）。
 * @param targetPid 目标评论 ID
 */
function scrollToPid(targetPid: string): void {
  document.getElementById(targetPid)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** 点赞（本地乐观更新 + COMMENT_LIKE；1.x onLike 对齐） */
async function onLike(): Promise<void> {
  if (likeLoading.value) return;
  likeLoading.value = true;
  try {
    getResponse(
      await call(getAppState().tcb, "COMMENT_LIKE", { id: props.comment.id, type: "up" }),
    );
    if (liked.value) {
      ups.value--;
    } else {
      ups.value++;
      if (disliked.value) downs.value--;
    }
    liked.value = !liked.value;
    disliked.value = false;
  } catch (e) {
    alert(getErrorMessage(e));
    if (!(e instanceof TwikooResponseError)) emit("load");
  } finally {
    likeLoading.value = false;
  }
}

/** 点踩（本地乐观更新 + COMMENT_LIKE；1.x onDislike 对齐） */
async function onDislike(): Promise<void> {
  if (likeLoading.value) return;
  likeLoading.value = true;
  try {
    getResponse(
      await call(getAppState().tcb, "COMMENT_LIKE", { id: props.comment.id, type: "down" }),
    );
    if (disliked.value) {
      downs.value--;
    } else {
      downs.value++;
      if (liked.value) ups.value--;
    }
    disliked.value = !disliked.value;
    liked.value = false;
  } catch (e) {
    alert(getErrorMessage(e));
    if (!(e instanceof TwikooResponseError)) emit("load");
  } finally {
    likeLoading.value = false;
  }
}

/**
 * 切换回复框到指定子评论（1.x onReply 对齐）。
 * @param id 目标子评论 ID
 */
function onReply(id: string): void {
  pid.value = id;
  emit("reply", props.comment.id);
}

/** 删除评论：按操作入口选择本人或管理员接口，成功后刷新列表。 */
async function onDelete(isAdmin: boolean): Promise<void> {
  if (adminLoading.value) return;
  if (!confirm(t(isAdmin ? "ADMIN_COMMENT_DELETE_CONFIRM" : "COMMENT_DELETE_CONFIRM").value)) return;
  adminLoading.value = true;
  try {
    getResponse(
      await call(
        getAppState().tcb,
        isAdmin ? "COMMENT_DELETE_FOR_ADMIN" : "COMMENT_DELETE_FOR_USER",
        { id: props.comment.id },
      ),
    );
    emit("load");
  } catch (e) {
    alert(getErrorMessage(e));
    // 通信失败并不代表删除未执行，重新读取服务端状态，避免重复提交。
    if (!(e instanceof TwikooResponseError)) emit("load");
  } finally {
    adminLoading.value = false;
  }
}

/**
 * 楼中楼回复事件（子组件向上冒泡；1.x onReplyReply 对齐）。
 * @param id 目标子评论 ID（空串表示取消）
 */
function onReplyReply(id: string): void {
  pid.value = id;
  emit("reply", id ? props.comment.id : "");
}

/** 取消回复（1.x onCancel 对齐） */
function onCancel(): void {
  pid.value = "";
  emit("reply", "");
}

/** 回复成功后：清空回复态、通知父级刷新并展开本楼回复列表（1.x onLoad 对齐） */
function onLoad(): void {
  pid.value = "";
  emit("reply", "");
  emit("load");
  isExpanded.value = true;
}

/** 子组件刷新完成后：向上冒泡并滚动到最新回复（1.x onRefreshed 对齐） */
function onRefreshed(): void {
  emit("refreshed");
  void nextTick(() => {
    const last = tkRepliesRef.value?.lastElementChild;
    if (props.comment.replies.length > 0 && last) {
      last.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

/** 检查当前访问者身份（1.x checkAuth 对齐：仅 tcb 通道需异步判定，非 tcb 路径由 `isLogin` computed 响应式读取） */
async function checkAuth(): Promise<void> {
  try {
    const { tcb } = getAppState();
    if (tcb?.auth) {
      const currentUser = await tcb.auth.getCurrentUser();
      tcbLoggedIn.value = currentUser.loginType === "CUSTOM";
    }
  } catch (e) {
    tcbLoggedIn.value = false;
    alert(getErrorMessage(e));
  }
}

/**
 * 设置垃圾标记（内联管理按钮；1.x handleSpam 对齐）。
 * @param isSpam 目标状态
 */
function handleSpam(isSpam: boolean): void {
  void setComment({ isSpam });
}

/**
 * 设置置顶（内联管理按钮；1.x handleTop 对齐）。
 * @param top 目标状态
 */
function handleTop(top: boolean): void {
  void setComment({ top });
}

/**
 * 图片点击放大（`LIGHTBOX` 开启时；1.x popupLightbox 对齐）。
 * @param event 点击事件
 */
function onContentClick(event: MouseEvent): void {
  if (getServerConfig().LIGHTBOX === "true") {
    popupLightbox(event);
  }
}

/**
 * 调用 COMMENT_SET_FOR_ADMIN 并同步本地状态（1.x setComment 对齐）。
 * @param set 要设置的字段
 */
async function setComment(set: { isSpam?: boolean; top?: boolean }): Promise<void> {
  if (adminLoading.value) return;
  adminLoading.value = true;
  try {
    const res = await call(getAppState().tcb, "COMMENT_SET_FOR_ADMIN", {
      id: props.comment.id,
      set,
    });
    getResponse(res);
    if (set.isSpam !== undefined) localSpam.value = set.isSpam;
    if (set.top !== undefined) localTop.value = set.top;
  } catch (e) {
    alert(getErrorMessage(e));
    if (!(e instanceof TwikooResponseError)) emit("load");
  } finally {
    adminLoading.value = false;
  }
}

/** 正文渲染后处理（外链安全化 + 公式 + 代码高亮；1.x mounted 与 HIGHLIGHT watcher 的合并入口） */
function applyContentRendering(): void {
  const el = commentRef.value;
  if (!el) return;
  renderLinks(el);
  renderMath(el, getAppState().options.katex);
  if (props.config.HIGHLIGHT === "true") {
    renderCode(el, props.config.HIGHLIGHT_THEME, props.config.HIGHLIGHT_PLUGIN);
  }
}

watch(
  () => [props.comment, props.comment.isSpam],
  () => {
    localSpam.value = props.comment.isSpam === true;
  },
);
watch(
  () => [props.comment, props.comment.top],
  () => {
    localTop.value = props.comment.top === true;
  },
);
watch(
  () => [props.comment, props.comment.ups, props.comment.liked],
  () => {
    ups.value = props.comment.ups ?? 0;
    liked.value = props.comment.liked === true;
  },
);
watch(
  () => [props.comment, props.comment.downs, props.comment.disliked],
  () => {
    downs.value = props.comment.downs ?? 0;
    disliked.value = props.comment.disliked === true;
  },
);
watch(
  () => props.config.HIGHLIGHT,
  (highlight) => {
    if (highlight !== "true") return;
    void nextTick(applyContentRendering);
  },
  { immediate: true },
);

onMounted(() => {
  void nextTick(showContentExpandIfNeed);
  void nextTick(showContentExpandIfNeedAfterImagesLoaded);
  void nextTick(showExpandIfNeed);
  void nextTick(scrollToComment);
  void nextTick(applyContentRendering);
  void checkAuth();
});
</script>