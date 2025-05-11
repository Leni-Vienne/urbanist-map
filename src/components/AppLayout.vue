<template>
  <Dialog 
    v-model:visible="dialogVisible" 
    :header="pageTitle"
    :modal="true"
    :closable="true"
    :dismissableMask="true"
    :style="{ width: '900px', maxWidth: '95vw' }"
    :closeOnEscape="true"
    :draggable="false"
    :resizable="false"
    @hide="onDialogHide"
    :appendTo="bodyElement" 
    :transitionOptions="{disabled:true}"
  >
    <div class="router-content">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </div>
    
    <template #header>
      <div class="flex justify-between items-center w-full">
        <div class="flex items-center">
          <Button
            v-if="showBackButton"
            icon="pi pi-arrow-left"
            class="p-button-text mr-2"
            @click="handleBack"
            v-tooltip.right="'Return to previous page'"
          />
          <h1 class="text-xl font-bold">{{ pageTitle }}</h1>
        </div>
        <div class="flex items-center gap-2">
          <slot name="header-actions"></slot>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useRouterNavigation } from '@composables/useRouterNavigation';

// AI : Define document.body as a variable to avoid TypeScript errors
const bodyElement = document.body;

const props = defineProps({
  title: {
    type: String,
    default: ''
  }
});

const router = useRouter();
const route = useRoute();
const dialogVisible = ref(true);
const { goBack } = useRouterNavigation(router);

// AI : Track whether the back button was clicked
const buttonClicked = ref(false);

// AI : Computed property for the page title
const pageTitle = computed(() => {
  return props.title || (route.meta.title as string) || 'City Map Overlay';
});

// AI : Determine if we should show the back button based on route
const showBackButton = computed(() => {
  return router.options.history.state.back || route.path !== '/projects';
});

// AI : Watch for route changes to ensure dialog stays visible
watch(
  () => route.path,
  (newPath) => {
    // AI : Only show dialog for project routes
    console.log("dans watch, newPath", newPath);
    console.log("dans watch, dialogVisible", newPath.startsWith('/projects'));
    dialogVisible.value = newPath.startsWith('/projects');
  },
  { immediate: true }
);

// AI : Handle back button click
function handleBack() {
  console.log("dans handleBack, buttonClicked", buttonClicked.value);
  buttonClicked.value = true;
  goBack(dialogVisible);
}

// AI : Handle dialog hide event (only triggered when clicking outside or pressing Escape)
function onDialogHide() {
  console.log("dans onDialogHide, buttonClicked", buttonClicked.value);
  if (!buttonClicked.value) {
    router.push('/');
  }
  buttonClicked.value = false;
}

// AI : Make sure dialog is shown when component is mounted if on project route
onMounted(() => {
  dialogVisible.value = route.path.startsWith('/projects');
});
</script>

<style scoped>
.router-content {
  padding: 0;
  overflow-y: auto;
  max-height: calc(100vh - 130px);
}

:deep(.p-dialog-header) {
  padding: 1rem 1.5rem;
}

:deep(.p-dialog-content) {
  padding: 0 1.5rem 1.5rem 1.5rem;
}

/* AI : Additional styles to prevent animation conflicts */
:deep(.p-dialog) {
  transition: none !important;
}
</style>