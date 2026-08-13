<template>
  <component
    :is="plain ? 'div' : AccordionHeader"
    :class="plain ? 'project-header-plain' : undefined"
  >
    <div class="flex items-center justify-between w-full gap-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <!-- Wikidata logo (e.g. metro line badge) shown when available -->
        <img
          v-if="wikidataEntity?.logoUrl"
          :src="wikidataEntity.logoUrl"
          class="w-5 h-5 object-contain shrink-0"
          referrerpolicy="no-referrer"
          loading="lazy"
        />
        <span class="font-semibold truncate" :class="name ? '' : 'text-muted-color italic'">{{
          name || (isOsmImport ? $t("project.osmName") : $t("project.unnamed"))
        }}</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 mr-2">
        <!-- Pending change requests badge -->
        <Badge v-if="(pendingChangeCount ?? 0) > 0" :value="pendingChangeCount" severity="warn" />
        <!-- OSM-imported projects show their source instead of a moderation status -->
        <Tag
          v-if="isOsmImport"
          v-tooltip.bottom="$t('project.importedTooltip')"
          :value="$t('project.osmSource')"
          severity="info"
          rounded
        />
        <!-- Moderation status badge with tooltip clarifying it is not a timeline status -->
        <Tag
          v-else
          v-tooltip.bottom="$t('approvalStatus.tooltipLabel')"
          :value="$t(`approvalStatus.${status ?? 'draft'}`)"
          :severity="getStatusSeverity(status)"
          class="capitalize"
          rounded
        />
      </div>
    </div>
  </component>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { AccordionHeader } from "primevue";
import { getStatusSeverity } from "@/utils/statusHelpers";
import { useWikidataEntity } from "@/composables/project/useWikidataEntity";
import type { JsonObject } from "@shared/json";

interface Props {
  name: string | null;
  status: string | null;
  pendingChangeCount?: number;
  importSourceType?: string | null;
  externalProperties?: JsonObject | null;
  // Render as a plain card header (a <div>) instead of an AccordionHeader, for use outside an Accordion.
  plain?: boolean;
}

const props = defineProps<Props>();

const isOsmImport = computed(() => props.importSourceType === "osm");

const { entity: wikidataEntity } = useWikidataEntity(
  computed(() => props.externalProperties ?? null),
);
</script>

<style scoped>
/* Mirror the AccordionHeader padding so the plain-card header lines up with accordion cards. */
.project-header-plain {
  display: block;
  padding: var(--p-accordion-header-padding, 1.125rem);
}
</style>
