<template>
  <span
    class="absolute -right-1 translate-y-[-33%] text-xs px-3 py-1.5 rounded-full font-semibold z-50"
    :class="top"
    style="
      background-color: var(--p-primary-color);
      color: var(--p-primary-contrast-color);
      box-shadow: var(--p-button-shadow);
    "
    :title="title"
  >
    {{ t("auth.lastUsed") }}
  </span>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

interface Props {
  // Tooltip naming the sign-in method this badge marks.
  title: string;
  // Vertical offset class, tuned per anchor: buttons sit at the container top, inputs below a label.
  top?: string;
}

const { title, top = "top-0" } = defineProps<Props>();

const { t } = useI18n();
</script>
