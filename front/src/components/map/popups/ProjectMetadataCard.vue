<template>
  <div v-if="project" class="flex flex-col gap-3">
    <div v-if="showName" :class="cls.row">
      <span :class="cls.label">{{ $t("project.name") }}</span>
      <span :class="cls.value">{{ project.name ?? "—" }}</span>
    </div>

    <!-- Description: hidden when null and not editable -->
    <div
      v-if="showDescription && (project.description || (editMode && !project.importSourceId))"
      :class="cls.row"
    >
      <span :class="cls.label">{{ $t("common.description") }}</span>
      <span v-if="project.description" :class="cls.value">{{ project.description }}</span>
      <button v-else :class="cls.addBtn" @click="emit('field-click')">
        + {{ $t("common.addField") }}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-x-6 gap-y-3">
      <!-- Timeline Status -->
      <div :class="cls.row">
        <span :class="cls.label">{{ $t("project.timelineStatus") }}</span>
        <div class="flex items-center gap-1.5">
          <span :class="cls.value">{{
            $te(`timelineStatus.${project.timelineStatus}`)
              ? $t(`timelineStatus.${project.timelineStatus}`)
              : project.timelineStatus
          }}</span>
        </div>
      </div>

      <!-- Last Modified -->
      <div v-if="project.importSourceId" :class="cls.row">
        <span :class="cls.label">{{ $t("project.lastModified") }}</span>
        <span :class="cls.value">{{
          formatDate(project.externalLastModified ?? project.updatedAt)
        }}</span>
      </div>

      <!-- Location: hidden when null and not editable -->
      <div
        v-if="projectLocationDisplay !== '—' || (editMode && !project.importSourceId)"
        :class="cls.row"
      >
        <span :class="cls.label">{{ $t("project.location") }}</span>
        <span v-if="projectLocationDisplay !== '—'" :class="cls.value">{{
          projectLocationDisplay
        }}</span>
        <button v-else :class="cls.addBtn" @click="emit('field-click')">
          + {{ $t("common.addField") }}
        </button>
      </div>

      <!-- Period: hidden when empty -->
      <div v-if="periodParts" :class="cls.row">
        <span :class="cls.label">{{ periodParts.label }}</span>
        <span :class="cls.value">{{ periodParts.value }}</span>
      </div>
    </div>

    <!-- Tags -->
    <div v-if="project.tags && project.tags.length > 0" :class="cls.row">
      <span :class="cls.label">{{ $t("project.tags") }}</span>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="tag in project.tags"
          :key="tag"
          class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
          :style="getTagStyle(tag)"
        >
          {{ $te(`tags.${tag}`) ? $t(`tags.${tag}`) : tag }}
        </span>
      </div>
    </div>

    <!-- Source URL (user-provided reference: article, city hall page, etc.) -->
    <div v-if="project.sourceUrl" :class="cls.row">
      <span :class="cls.label">{{ $t("project.source") }}</span>
      <a
        :href="project.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[13px] text-indigo-600! dark:text-indigo-300! no-underline hover:underline wrap-break-word"
        >{{ formatSourceUrl(project.sourceUrl) }}</a
      >
    </div>
    <div v-else-if="editMode && !project.importSourceId" :class="cls.row">
      <span :class="cls.label">{{ $t("project.source") }}</span>
      <button :class="cls.addBtn" @click="emit('field-click')">
        + {{ $t("common.addField") }}
      </button>
    </div>

    <!-- Modify on source link (imported projects only, edit mode) -->
    <div v-if="osmEditUrl" :class="cls.row">
      <span :class="cls.label">{{
        $t("project.modifyOn", { name: project.importSource?.name ?? "OpenStreetMap" })
      }}</span>
      <a
        :href="osmEditUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[13px] text-indigo-600! dark:text-indigo-300! no-underline hover:underline"
        >{{ project.externalId }}</a
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Project } from "@/types/index";
import { formatProjectDateRangeParts } from "@/utils/projectDateFormat";
import { formatSourceUrl } from "@/utils/urlFormat";
import { useI18n } from "vue-i18n";
import { PROJECT_TAG_MAP } from "@/config/projectTags";

const { t: $t } = useI18n();

const emit = defineEmits<{ "field-click": [] }>();

const cls = {
  row: "flex flex-col gap-0.5",
  label: "text-[10px] font-medium uppercase tracking-[0.07em] text-muted-color",
  value: "text-[13px] text-color wrap-break-word",
  addBtn:
    "text-xs italic text-primary-400 hover:text-primary-700 dark:hover:text-primary-200 cursor-pointer bg-transparent border-none p-0 outline-none text-left",
};

interface Props {
  project: Project | null;
  showName?: boolean;
  showDescription?: boolean;
  editMode?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showName: true,
  showDescription: false,
  editMode: false,
});

function getTagStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: "#64748b", color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(date));
}

const periodParts = computed(() => {
  if (!props.project) return null;
  return formatProjectDateRangeParts(
    props.project.timelineStatus,
    props.project.startDate,
    props.project.endDate,
    props.project.proposalDate,
    props.project.startDatePrecision,
    props.project.endDatePrecision,
    props.project.proposalDatePrecision,
    $t,
  );
});

const osmEditUrl = computed(() => {
  const project = props.project;
  if (!project?.importSource || project.importSource.type !== "osm" || !project.externalId) {
    return null;
  }
  const template = project.importSource.urlTemplate;
  if (!template) return null;
  return template.replace("{id}", project.externalId);
});

const projectLocationDisplay = computed(() => {
  if (!props.project) return "—";

  const project = props.project;

  // Check if project has a cityId first (imported projects may not have one)
  if (!project.cityId) {
    return "—";
  }

  if (project.city?.name) {
    return `${project.city.name}, ${project.city.countryCode}`;
  }

  return "—";
});
</script>
