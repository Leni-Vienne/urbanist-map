<template>
  <AccordionHeader>
    <div class="flex items-center justify-between w-full gap-2">
      <span class="font-semibold truncate">{{ name }}</span>
      <div class="flex items-center gap-1.5 shrink-0 mr-2">
        <!-- Role badge (created / contributed) -->
        <Tag
          v-if="role"
          :value="$t(`contribute.role.${role}`)"
          severity="secondary"
          class="capitalize text-[0.6875rem]"
          rounded
        />
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
  name: string;
  status: string | null;
  hideStatusBadges?: boolean;
  role?: "created" | "contributed" | null;
}

const props = defineProps<Props>();

import { getStatusSeverity } from "@/utils/statusHelpers";
</script>
