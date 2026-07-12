<template>
  <Button
    @click.stop="toggleSettings"
    @dblclick.stop
    raised
    icon="pi pi-cog"
    :aria-label="$t('controls.settings')"
    v-tooltip.bottom="{
      value: $t('controls.settings'),
      disabled: isMobile,
    }"
    :severity="isOpen ? undefined : 'secondary'"
  />

  <Popover ref="settingsPopover" class="settings-popover">
    <div class="flex flex-col w-max min-w-48" @click.stop @dblclick.stop>
      <SettingsMenuItems />
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import SettingsMenuItems from "@/components/map/SettingsMenuItems.vue";
import { isMobile } from "@/services/core/viewport";

const settingsPopover = ref();
const isOpen = computed<boolean>(() => settingsPopover.value?.visible ?? false);

function toggleSettings(event: Event) {
  settingsPopover.value.toggle(event);
}
</script>
