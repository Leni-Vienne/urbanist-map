<template>
  <AccordionHeader>
    <div class="flex items-center justify-between w-full gap-2">
      <span class="font-semibold">{{ name }}</span>
      <!-- Show normal status tag (handle null/undefined for unsubmitted projects) -->
      <Tag
        v-if="!hideStatusBadges"
        :value="$t(`approvalStatus.${status ?? 'draft'}`)"
        :severity="getStatusSeverity(status)"
        class="mr-2 capitalize shrink-0"
        rounded
      />
    </div>
  </AccordionHeader>
</template>

<script setup lang="ts">
import { AccordionHeader, Tag } from "primevue";

interface Props {
  name: string;
  status: string | null;
  hideStatusBadges?: boolean;
}

const props = defineProps<Props>();

// Import shared utility
import { getStatusSeverity } from "@/utils/statusHelpers";
</script>
