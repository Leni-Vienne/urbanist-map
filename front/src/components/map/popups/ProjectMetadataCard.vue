<template>
  <div v-if="project" class="mb-3">
    <div class="section-header-row">
      <div class="section-header">{{ $t("project.information") }}</div>
      <div class="project-actions">
        <slot name="actions" :project="project" />
      </div>
    </div>
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">{{ $t("project.name") }}:</span>
        <span class="info-value">{{ project.name ?? "—" }}</span>
      </div>
      <div v-if="showDescription" class="info-row">
        <span class="info-label">{{ $t("common.description") }}:</span>
        <span class="info-value">{{ project.description ?? "—" }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">{{ $t("project.location") }}:</span>
        <span class="info-value">{{ projectLocationDisplay }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">{{ $t("project.period") }}:</span>
        <span class="info-value info-small">
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
      <div v-if="project.sourceUrl" class="info-row">
        <span class="info-label">{{ $t("project.source") }}:</span>
        <a :href="project.sourceUrl" target="_blank" class="app-link">{{
          formatSourceUrl(project.sourceUrl)
        }}</a>
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

<style scoped>
@import "../../../assets/info-card-shared.css";

.project-actions {
  display: flex;
  gap: 0.25rem;
}
</style>
