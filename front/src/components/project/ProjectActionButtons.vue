<template>
  <div class="grid grid-cols-2 gap-1.5">
    <!-- Edit button -->
    <button
      v-if="showEdit"
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-primary-200"
      @click.stop="$emit('edit', project)"
      v-tooltip.top="$t('tooltips.editProject')"
    >
      <i class="pi pi-pencil"></i>
    </button>

    <!-- Add image button -->
    <button
      v-if="showAddImage"
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-(--p-text-color-secondary) hover:text-color hover:bg-content-hover-background hover:border-surface"
      @click.stop="$emit('add-image', project)"
      v-tooltip.top="$t('project.addImages')"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M16 5h6" />
        <path d="M19 2v6" />
        <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        <circle cx="9" cy="9" r="2" />
      </svg>
    </button>

    <!-- Draw shapes button -->
    <button
      v-if="showDraw"
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-(--p-text-color-secondary) hover:text-color hover:bg-content-hover-background hover:border-surface"
      @click.stop="$emit('draw', project)"
      v-tooltip.top="$t('shapes.drawShapes')"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="lucide lucide-waypoints"
      >
        <path d="m10.586 5.414-5.172 5.172" />
        <path d="m18.586 13.414-5.172 5.172" />
        <path d="M6 12h12" />
        <circle cx="12" cy="20" r="2" />
        <circle cx="12" cy="4" r="2" />
        <circle cx="20" cy="12" r="2" />
        <circle cx="4" cy="12" r="2" />
      </svg>
    </button>

    <!-- Save/submit button -->
    <button
      v-if="showSave"
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
import { useI18n } from "vue-i18n";
import type { ProjectForModeration } from "@/types/index";

interface Props {
  project: ProjectForModeration;
  showEdit?: boolean;
  showAddImage?: boolean;
  showDraw?: boolean;
  showSave?: boolean;
  showDelete?: boolean;
  isModified?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showEdit: false,
  showAddImage: false,
  showDraw: false,
  showSave: false,
  showDelete: false,
  isModified: false,
});

const { t } = useI18n();
const saveTooltip = computed(() =>
  props.isModified ? t("project.submitChangeRequest") : t("overlay.noChangesToSave"),
);

defineEmits<{
  edit: [project: ProjectForModeration];
  "add-image": [project: ProjectForModeration];
  draw: [project: ProjectForModeration];
  save: [project: ProjectForModeration];
  delete: [project: ProjectForModeration];
}>();
</script>
