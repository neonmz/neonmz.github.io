<!--
  Twikoo 根组件（1.x App.vue 的 Vue3 组合式 API 重写）。

  布局：评论区（TkComments）+ 页脚（TkFooter）+ 管理面板（TkAdmin，默认收起）。
  样式作用域挂 `.twikoo` 根选择器（禁 `<style scoped>`，类名 `tk-` 前缀）。

  1.x 的 element-ui 覆盖段（`.el-input__inner` / `.el-button` / `.el-loading-mask` /
  `.el-textarea .el-input__count`）已下沉为各组件的 `.tk-*` 基础样式——2.0 不再依赖
  theme-chalk，因此「覆盖」变成「定义」，视觉取值与 1.x 覆盖段保持一致。
-->
<template>
  <div id="twikoo" class="twikoo">
    <TkComments :show-admin-entry="showAdminEntry" @admin="showAdmin = true" />
    <TkFooter />
    <TkAdmin :show="showAdmin" @close="showAdmin = false" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import TkComments from "./components/TkComments.vue";
import TkFooter from "./components/TkFooter.vue";
import TkAdmin from "./components/TkAdmin.vue";
import { EVENT_SHOW_ADMIN_ENTRY, off as busOff, on as busOn } from "./utils/bus";
import { twikooOptions } from "./config.ts";
import { resetLazyLoadStatus } from "./utils/http.ts";

/** 管理面板是否展开 */
const showAdmin = ref(false);
/** 是否显示管理入口（由 `HIDE_ADMIN_CRYPT` 暗号命中决定） */
const showAdminEntry = ref(false);

/**
 * 处理管理入口显隐事件（1.x `App.onShowAdminEntry` 的等价物）。
 * @param show 是否显示
 */
function onShowAdminEntry(show: unknown): void {
  showAdminEntry.value = show === true;
}

onMounted(() => {
  resetLazyLoadStatus(location.pathname);
  busOn(EVENT_SHOW_ADMIN_ENTRY, onShowAdminEntry);
});

onUnmounted(() => {
  busOff(EVENT_SHOW_ADMIN_ENTRY, onShowAdminEntry);
});
</script>