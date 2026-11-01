<!--
  TkAvatar 评论头像（1.x TkAvatar.vue 的 Vue3 组合式重写）。

  头像推导逻辑已下沉到 `utils/avatar.ts`（可单测）；本组件只负责渲染与点击跳转。
-->
<template>
  <div
    class="tk-avatar"
    :class="{ 'tk-clickable': !!link, 'tk-has-avatar': !!avatarInner }"
    @click="onClick"
  >
    <div v-if="!avatarInner" class="tk-avatar-img">
      <TkIcon name="user-circle" />
    </div>
    <img v-else class="tk-avatar-img" :src="avatarInner" alt="" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import TkIcon from "../components/TkIcon.vue";
import { convertLink, resolveAvatarUrl } from "../utils";
import { EMPTY_CONFIG } from "./defaults";
import type { ServerConfig } from "../types";

/** 组件属性 */
const props = withDefaults(
  defineProps<{
    /** 头像数据源（服务端下发的昵称/邮箱/头像字段） */
    nick?: string;
    avatar?: string;
    mail?: string;
    mailMd5?: string;
    /** 个人站点（存在则可点击跳转） */
    link?: string;
    /** 服务端配置（`GRAVATAR_CDN` / `DEFAULT_GRAVATAR`） */
    config?: ServerConfig;
  }>(),
  { nick: "", avatar: "", mail: "", mailMd5: "", link: "", config: EMPTY_CONFIG },
);

/** 最终头像地址（1.x computed avatarInner 等价物） */
const avatarInner = computed(() =>
  resolveAvatarUrl(
    { avatar: props.avatar, mailMd5: props.mailMd5, mail: props.mail, nick: props.nick },
    props.config,
  ),
);

/** 点击头像：有个人站点时新窗口打开（1.x 行为：置 opener 为 null） */
function onClick(): void {
  if (!props.link) return;
  window.open(convertLink(props.link), "_blank")?.focus();
}
</script>