<template>
  <div class="flex flex-row flex-wrap gap-1.5">
    <!-- Edit button -->
    <button
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--p-primary-color)_30%,transparent)]"
      @click.stop="$emit('edit', project)"
      v-tooltip.top="editTooltip"
    >
      <i class="pi pi-pencil"></i>
    </button>

    <!-- Add image button -->
    <button
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-(--p-text-color-secondary) hover:text-color hover:bg-content-hover-background hover:border-surface"
      @click.stop="$emit('add-image', project)"
      v-tooltip.top="$t('project.addImages')"
    >
      <ImagePlus :size="16" />
    </button>

    <!-- Draw shapes button -->
    <button
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-(--p-text-color-secondary) hover:text-color hover:bg-content-hover-background hover:border-surface"
      @click.stop="$emit('draw', project)"
      v-tooltip.top="$t('shapes.drawShapes')"
    >
      <Waypoints :size="16" />
    </button>

    <!-- Save/submit button -->
    <button
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center transition-all duration-150 text-sm text-green-500"
      :class="
        isModified
          ? 'cursor-pointer hover:text-green-600 hover:bg-green-50 hover:border-green-200'
          : 'opacity-40 cursor-not-allowed pointer-events-none'
      "
      :disabled="!isModified"
      @click.stop="$emit('save', project)"
      v-tooltip.top="saveTooltip"
    >
      <i class="pi pi-send"></i>
    </button>

    <!-- Delete button -->
    <button
      v-if="
        showDelete &&
        (!project.status || project.status === 'pending' || project.status === 'rejected')
      "
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
      @click.stop="$emit('delete', project)"
      v-tooltip.top="$t('contribute.deleteProject')"
    >
      <i class="pi pi-trash"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ImagePlus, Waypoints } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";

import { useAuthStore } from "@/stores/authStore";
import type { Project } from "@/types/index";

interface Props {
  project: Project;
  showDelete?: boolean;
  isModified?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showDelete: false,
  isModified: false,
});

const { t } = useI18n();
const { user } = storeToRefs(useAuthStore());

const saveTooltip = computed(() =>
  props.isModified ? t("project.submitChangeRequest") : t("overlay.noChangesToSave"),
);

// Owned projects edit directly; others (including imported) go through a change request.
const editTooltip = computed(() =>
  user.value && props.project.ownerId === user.value.id
    ? t("tooltips.editProject")
    : t("tooltips.suggestChanges"),
);

defineEmits<{
  edit: [project: Project];
  "add-image": [project: Project];
  draw: [project: Project];
  save: [project: Project];
  delete: [project: Project];
}>();
</script>
