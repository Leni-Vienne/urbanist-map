<template>
  <AccordionHeader>
    <div class="flex items-center justify-between w-full gap-2">
      <span class="font-semibold truncate" :class="name ? '' : 'text-muted-color italic'">{{
        name || $t("project.unnamed")
      }}</span>
      <div class="flex items-center gap-1.5 shrink-0 mr-2">
        <!-- Status badge -->
        <Tag
          v-if="!hideStatusBadges"
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
import { AccordionHeader, Tag } from "primevue";

interface Props {
  name: string | null;
  status: string | null;
  hideStatusBadges?: boolean;
}

const props = defineProps<Props>();

import { getStatusSeverity } from "@/utils/statusHelpers";
</script>
