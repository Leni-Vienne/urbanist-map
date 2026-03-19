<template>
  <div v-if="project" class="flex flex-col gap-3">
    <div v-if="showName" :class="cls.row">
      <span :class="cls.label">{{ $t("project.name") }}</span>
      <span :class="cls.value">{{ project.name ?? "—" }}</span>
    </div>

    <!-- Timeline Status Row -->
    <div :class="cls.row">
      <span :class="cls.label">{{ $t("project.timelineStatus") }}</span>
      <div class="flex items-center gap-1.5">
        <span
          class="w-2.5 h-2.5 rounded-full inline-block"
          :style="{ backgroundColor: getStatusColor(project.timelineStatus) }"
        ></span>
        <span :class="cls.value">{{
          $te(`status.${project.timelineStatus}`)
            ? $t(`status.${project.timelineStatus}`)
            : project.timelineStatus
        }}</span>
      </div>
    </div>
    <div v-if="showDescription" :class="cls.row">
      <span :class="cls.label">{{ $t("common.description") }}</span>
      <span v-if="project.description" :class="cls.value">{{ project.description }}</span>
      <button v-else-if="editMode" :class="cls.addBtn" @click="emit('field-click')">
        + {{ $t("common.addField") }}
      </button>
      <span v-else :class="cls.value">—</span>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div :class="cls.row">
        <span :class="cls.label">{{ $t("project.location") }}</span>
        <span v-if="projectLocationDisplay !== '—'" :class="cls.value">{{
          projectLocationDisplay
        }}</span>
        <button v-else-if="editMode" :class="cls.addBtn" @click="emit('field-click')">
          + {{ $t("common.addField") }}
        </button>
        <span v-else :class="cls.value">—</span>
      </div>
      <div :class="cls.row">
        <span :class="cls.label">{{ $t("project.period") }}</span>
        <span :class="cls.value">
          {{
            formatProjectDateRange(
              project.timelineStatus,
              project.startDate,
              project.endDate,
              project.proposalDate,
              project.startDatePrecision,
              project.endDatePrecision,
              project.proposalDatePrecision,
              $t,
            ) || $t("metadata.notSpecified")
          }}
        </span>
      </div>
    </div>
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
    <div v-else-if="editMode" :class="cls.row">
      <span :class="cls.label">{{ $t("project.source") }}</span>
      <button :class="cls.addBtn" @click="emit('field-click')">
        + {{ $t("common.addField") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Project } from "@/types/index";
import { formatProjectDateRange } from "@/utils/projectDateFormat";
import { formatSourceUrl } from "@/utils/urlFormat";
import { useI18n } from "vue-i18n";
import { PROJECT_TAG_MAP } from "@/config/projectTags";
import { getTimelineStatusColor } from "@/utils/markerColors";
import type { TimelineStatus } from "../../../../../back/src/db/schema";

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
  availableCities?: { id: number; name: string; countryCode: string }[];
}

const props = withDefaults(defineProps<Props>(), {
  showName: true,
  showDescription: false,
  editMode: false,
  availableCities: () => [],
});

function getTagStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: "#64748b", color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}

function getStatusColor(status: TimelineStatus | null | undefined): string {
  const colorKey = getTimelineStatusColor(status);
  const colorMap: Record<string, string> = {
    yellow: "#eab308", // Tailwind yellow-500
    blue: "#3b82f6", // Tailwind blue-500
    orange: "#f97316", // Tailwind orange-500
    green: "#22c55e", // Tailwind green-500
    grey: "#6b7280", // Tailwind gray-500
    red: "#ef4444", // Tailwind red-500
    purple: "#a855f7", // Tailwind purple-500
  };
  return colorMap[colorKey] ?? colorMap.grey ?? "#6b7280";
}

const projectLocationDisplay = computed(() => {
  if (!props.project) return "—";

  const project = props.project;

  // Check if project has a cityId first (imported projects may not have one)
  if (!project.cityId) {
    return "—";
  }

  if (project.city.name) {
    return `${project.city.name}, ${project.city.countryCode}`;
  }

  if (props.availableCities) {
    const city = props.availableCities.find((c) => c.id === project.cityId);
    if (city) {
      return `${city.name}, ${city.countryCode}`;
    }
  }

  return "—";
});
</script>
