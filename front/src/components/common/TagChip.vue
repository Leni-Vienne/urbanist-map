<template>
  <span
    class="rounded-full font-semibold"
    :class="size === 'sm' ? 'text-[0.65rem] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'"
    :style="getTagChipStyle(tag)"
  >
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { getTagChipStyle } from "@/constants/projectTags";
import { UNTAGGED_PROJECT_FILTER } from "@/services/core/filters";

const { tag, size = "md" } = defineProps<{
  tag: string;
  size?: "sm" | "md";
}>();

const { t, te } = useI18n();

// Unknown slugs (tags added to the data before the locales catch up) show the raw slug.
const label = computed(() => {
  if (tag === UNTAGGED_PROJECT_FILTER) return t("map.controls.untagged");
  return te(`tags.${tag}`) ? t(`tags.${tag}`) : tag;
});
</script>
