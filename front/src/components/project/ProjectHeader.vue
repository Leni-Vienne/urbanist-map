<template>
  <AccordionHeader>
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
          name || $t("project.unnamed")
        }}</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 mr-2">
        <!-- Pending change requests badge -->
        <Badge v-if="(pendingChangeCount ?? 0) > 0" :value="pendingChangeCount" severity="warn" />
        <!-- OSM-imported projects show their source instead of a moderation status -->
        <Tag
          v-if="!hideStatusBadges && isOsmImport"
          v-tooltip.bottom="$t('project.importedTooltip')"
          :value="$t('project.osmSource')"
          severity="info"
          rounded
        />
        <!-- Moderation status badge with tooltip clarifying it is not a timeline status -->
        <Tag
          v-else-if="!hideStatusBadges"
          v-tooltip.bottom="$t('approvalStatus.tooltipLabel')"
          :value="$t(`approvalStatus.${status ?? 'draft'}`)"
          :severity="getStatusSeverity(status)"
          class="capitalize"
          rounded
        />
      </div>
    </div>
  </AccordionHeader>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { AccordionHeader, Tag, Badge } from "primevue";
import { getStatusSeverity } from "@/utils/statusHelpers";
import { useWikidataEntity } from "@/composables/project/useWikidataEntity";

interface Props {
  name: string | null;
  status: string | null;
  hideStatusBadges?: boolean;
  pendingChangeCount?: number;
  importSourceType?: string | null;
  externalProperties?: unknown;
}

const props = defineProps<Props>();

const isOsmImport = computed(() => props.importSourceType === "osm");

const wikidataId = computed(() => {
  const p = props.externalProperties;
  if (!p || typeof p !== "object") return null;
  const id = (p as Record<string, unknown>)["wikidata"];
  return typeof id === "string" ? id : null;
});
const { entity: wikidataEntity } = useWikidataEntity(wikidataId);
</script>
