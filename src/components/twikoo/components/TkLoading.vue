<!--
  tk-loading（参考 Element UI Loading 指令改写：v-loading 遮罩；组合式 API）。
-->
<template>
  <div v-show="visible" class="tk-loading-mask">
    <div class="tk-loading-spinner">
      <TkIcon name="spinner" class="tk-loading-spinner__circle" />
      <p v-if="text" class="tk-loading-text">{{ text }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import TkIcon from "./TkIcon.vue";

withDefaults(
  defineProps<{
    /** 是否显示遮罩 */
    visible?: boolean;
    /** 加载文案 */
    text?: string;
  }>(),
  { visible: false, text: "" },
);
</script>