<!--
  tk-button（参考 Element UI Button 改写，纯 tk- 类名；组合式 API）。

  Props：type（primary / default / info / text）/ size（large / default / small / mini）/
  disabled / loading / nativeType。

  类名映射（1.x `.el-*` → 2.0 `.tk-*`）：`.el-button` → `.tk-button`；
  `.el-button--primary|--info|--text|--mini|...` → `.tk-button--primary|--info|--text|--mini|...`；
  状态类 `is-disabled` / `is-loading` 与 1.x 同名保留（三处高危点之一：复合状态类选择器）。
-->
<template>
  <button
    class="tk-button"
    :class="[
      type !== 'default' ? `tk-button--${type}` : '',
      size ? `tk-button--${size}` : '',
      { 'is-disabled': disabled, 'is-loading': loading },
    ]"
    :disabled="disabled || loading"
    :type="nativeType"
    @click="handleClick"
  >
    <TkIcon v-if="loading" name="spinner" class="tk-button__spinner" />
    <span class="tk-button__label"><slot></slot></span>
  </button>
</template>

<script setup lang="ts">
import TkIcon from "./TkIcon.vue";

/** 按钮视觉类型 */
const props = withDefaults(
  defineProps<{
    /** 视觉类型（`text` 为无边框文字按钮，`info` 为中性色按钮） */
    type?: "primary" | "default" | "info" | "text";
    /** 尺寸（mini 与 small 有可见差异）*/
    size?: "large" | "mini" | "small" | "default" | "";
    disabled?: boolean;
    loading?: boolean;
    /** 原生 type */
    nativeType?: "button" | "submit" | "reset";
  }>(),
  { type: "default", size: "", disabled: false, loading: false, nativeType: "button" },
);

/** 点击事件（禁用/加载中不触发） */
const emit = defineEmits<{ (e: "click", evt: MouseEvent): void }>();

/**
 * 点击转发（禁用/加载中不触发）。
 * @param evt 点击事件
 */
function handleClick(evt: MouseEvent): void {
  if (props.disabled || props.loading) return;
  emit("click", evt);
}
</script>