<template>
  <div v-if="project" class="mb-3">
    <div class="flex justify-between items-center mb-2">
      <div class="text-sm font-semibold text-[var(--p-text-secondary)] tracking-wide">
        {{ $t("project.information") }}
      </div>
      <div class="flex gap-1">
        <slot name="actions" :project="project" />
      </div>
    </div>
    <div class="bg-gray-50 rounded-lg p-3 border border-gray-200 divide-y divide-gray-100">
      <div :class="cls.row">
        <span :class="cls.label">{{ $t("project.name") }}:</span>
        <span :class="cls.value">{{ project.name ?? "—" }}</span>
      </div>
      <div v-if="showDescription" :class="cls.row">
        <span :class="cls.label">{{ $t("common.description") }}:</span>
        <span :class="cls.value">{{ project.description ?? "—" }}</span>
      </div>
      <div :class="cls.row">
        <span :class="cls.label">{{ $t("project.location") }}:</span>
        <span :class="cls.value">{{ projectLocationDisplay }}</span>
      </div>
      <div :class="cls.row">
        <span :class="cls.label">{{ $t("project.period") }}:</span>
        <span class="flex-1 text-right text-[0.8rem] text-[var(--p-text-muted)] break-words">
          {{
            formatProjectDateRange(
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
      <div v-if="project.sourceUrl" :class="cls.row">
        <span :class="cls.label">{{ $t("project.source") }}:</span>
        <a
          :href="project.sourceUrl"
          target="_blank"
          class="flex-1 text-right text-sm text-[var(--p-primary-600)] no-underline hover:underline break-words"
          >{{ formatSourceUrl(project.sourceUrl) }}</a
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Project } from "@/types/index";
import { formatProjectDateRange } from "@/utils/projectDateFormat";
import { formatSourceUrl } from "@/utils/urlFormat";
import { useI18n } from "vue-i18n";

const { t: $t } = useI18n();

const cls = {
  row: "flex justify-between items-start py-1",
  label: "text-sm font-semibold text-[var(--p-text-secondary)] min-w-[80px] mr-2",
  value: "flex-1 text-right text-sm break-words",
};

interface Props {
  project: Project | null;
  showDescription?: boolean;
  availableCities?: { id: number; name: string; countryCode: string }[];
}

const props = withDefaults(defineProps<Props>(), {
  showDescription: false,
  availableCities: () => [],
});

// AI : Convert to computed property for reactivity to project changes
const projectLocationDisplay = computed(() => {
  if (!props.project) return "—";

  const project = props.project;

  if (project.city.name) {
    return `${project.city.name}, ${project.city.countryCode}`;
  }

  // AI : Use available cities if provided by parent
  if (project.cityId && props.availableCities) {
    const city = props.availableCities.find((c) => c.id === project.cityId);
    if (city) {
      return `${city.name}, ${city.countryCode}`;
    }
  }

  return "—";
});
</script>
