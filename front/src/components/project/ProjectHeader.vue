<template>
  <AccordionHeader>
    <div class="flex items-center justify-between w-full gap-2">
      <span class="font-semibold truncate" :class="name ? '' : 'text-muted-color italic'">{{
        name || $t("project.unnamed")
      }}</span>
      <div class="flex items-center gap-1.5 shrink-0 mr-2">
        <!-- Pending change requests badge -->
        <Badge v-if="(pendingChangeCount ?? 0) > 0" :value="pendingChangeCount" severity="warn" />
        <!-- Moderation status badge with tooltip clarifying it is not a timeline status -->
        <Tag
          v-if="!hideStatusBadges"
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
import { AccordionHeader, Tag, Badge } from "primevue";

interface Props {
  name: string | null;
  status: string | null;
  hideStatusBadges?: boolean;
  pendingChangeCount?: number;
}

const props = defineProps<Props>();

import { getStatusSeverity } from "@/utils/statusHelpers";
</script>
