<template>
  <Teleport to="#info-popup-teleport-target" v-if="showInfoPopup && overlayObject && teleportTargetExists">
    <InfoPopup
      :overlayObject="overlayObject"
      :onProjectSubmit="handleProjectSubmit"
      :viewMode="!isEditMode"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import InfoPopup from './InfoPopup.vue';
import { updateOverlayInfo } from '@composables/overlay/useOverlayActions';
import { useToast } from '@composables/ui/useToast';
import type { ProjectInfo } from '@types';

const overlayStore = useOverlayStore();
const { overlays, showInfoPopup, infoPopupOverlayId, isEditMode } = storeToRefs(overlayStore);
const toast = useToast();

// AI : Track if teleport target exists
const teleportTargetExists = ref(false);

// AI : Check for teleport target existence
function checkTeleportTarget() {
  teleportTargetExists.value = !!document.querySelector('#info-popup-teleport-target');
}

// AI : Set up a watcher for teleport target
let targetObserver: MutationObserver | null = null;

onMounted(() => {
  checkTeleportTarget();
  
  // AI : Watch for DOM changes to detect when teleport target is added/removed
  targetObserver = new MutationObserver(() => {
    checkTeleportTarget();
  });
  
  targetObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
});

onUnmounted(() => {
  if (targetObserver) {
    targetObserver.disconnect();
  }
});

// AI : Get the overlay object for the info popup
const overlayObject = computed(() => {
  if (!infoPopupOverlayId.value || !overlays.value[infoPopupOverlayId.value]) {
    return null;
  }
  return overlays.value[infoPopupOverlayId.value];
});

function handleProjectSubmit(projectInfo: ProjectInfo & { id: string }) {
  if (!projectInfo.id || !overlays.value[projectInfo.id]) {
    console.error('Overlay not found for ID:', projectInfo.id);
    return;
  }

  updateOverlayInfo(projectInfo.id, {});
  toast.add({ severity: 'success', summary: 'Project info updated', life: 3000 });
  
  // AI : Hide the popup after successful update
  overlayStore.hideInfoPopup();
}
</script>

<style scoped>
/* AI : Make the subtoolbar button invisible and non-clickable */
:deep(.leaflet-toolbar-icon.more-info-popup:not(#info-popup-teleport-target)) {
  opacity: 0 !important;
  pointer-events: none !important;
  position: absolute !important;
  z-index: -1 !important;
}
</style>
