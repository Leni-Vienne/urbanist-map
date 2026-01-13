<template>
  <AccordionHeader>
    <div class="accordion-header-content">
      <span class="project-name">{{ name }}</span>
      <!-- AI : Show normal status tag (handle null/undefined for unsubmitted projects) -->
      <Tag
        v-if="!hideStatusBadges"
        :value="$t(`status.${status ?? 'draft'}`)"
        :severity="getStatusSeverity(status)"
        class="project-status-tag"
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

// AI : Import shared utility
import { getStatusSeverity } from "@/utils/statusHelpers";
</script>

<style scoped>
/* AI : Style the accordion header content wrapper for proper alignment */
.accordion-header-content {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  width: 100% !important;
  gap: 0.5rem !important;
}

.project-name {
  /* Inherited font styles from AccordionHeader, but ensure weight */
  font-weight: 600;
}

/* AI : Add extra space to the right of status tags and capitalize first letter */
.project-status-tag {
  margin-right: 0.5rem;
  text-transform: capitalize;
}
</style>
