<template>
  <!-- AI : Tab navigation -->
  <div :class="tabContainerClass">
    <button
      :class="[tabButtonClass, { active: activeTab === 'latest' }]"
      @click="$emit('update:activeTab', 'latest')"
    >
      {{ $t('navigation.latestContributions') }}
    </button>
    <button
      v-if="authStore.isAuthenticated"
      :class="[tabButtonClass, { active: activeTab === 'uploads' }]"
      @click="$emit('update:activeTab', 'uploads')"
    >
      {{ $t('navigation.myContributions') }}
    </button>
    <button
      v-if="authStore.isModerator"
      :class="[tabButtonClass, { active: activeTab === 'moderation' }]"
      @click="$emit('update:activeTab', 'moderation')"
    >
      {{ $t('navigation.moderation') }}
    </button>
  </div>

  <!-- AI : Panel content -->
  <div :class="contentContainerClass">
    <!-- AI : Show content based on active tab -->
    <LatestContributionsPanel v-if="activeTab === 'latest'" />
    <MyContributionsPanel v-else-if="activeTab === 'uploads' && authStore.isAuthenticated" />
    <ModerationPanel v-else-if="activeTab === 'moderation' && authStore.isModerator" />

    <!-- AI : Show sign-in prompt for authenticated tabs when not signed in -->
    <div
      v-else-if="(!authStore.isAuthenticated && (activeTab === 'uploads' || activeTab === 'moderation')) || (activeTab === 'moderation' && !authStore.isModerator)"
      class="signin-prompt"
    >
      <div class="signin-content">
        <i class="pi pi-user text-4xl text-muted-color mb-4"></i>
        <h3 class="text-lg font-semibold mb-2">
          {{ activeTab === 'moderation' && authStore.isAuthenticated && !authStore.isModerator
            ? $t('auth.moderationAccessRequired')
            : $t('auth.authenticationRequired') }}
        </h3>
        <p class="text-muted-color text-sm mb-4 text-center">
          {{ activeTab === 'moderation' && authStore.isAuthenticated && !authStore.isModerator
            ? $t('auth.moderationMessage')
            : $t('auth.signInMessage') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import LatestContributionsPanel from './LatestContributionsPanel.vue'
import type { PanelTab } from '@composables/layout/usePanelTabs'
import { useAuthStore } from '@stores/authStore'

// AI : Lazy load panels to reduce initial bundle size
const ModerationPanel = defineAsyncComponent(() => import('./ModerationPanel.vue'))
const MyContributionsPanel = defineAsyncComponent(() => import('./MyContributionsPanel.vue'))

const authStore = useAuthStore()

defineProps<{
  activeTab: PanelTab
  tabContainerClass: string
  tabButtonClass: string
  contentContainerClass: string
}>()

defineEmits<{
  'update:activeTab': [tab: PanelTab]
}>()
</script>

<style scoped>
/* AI : Tab navigation base styles */
.tab-navigation,
.drawer-tabs {
  display: flex;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
  flex-shrink: 0;
}

/* AI : Tab button base styles */
.tab-button,
.drawer-tab {
  flex: 1;
  padding: var(--tab-padding-y, 0.5rem) var(--tab-padding-x, 0);
  border: none;
  background: transparent;
  font-weight: 500;
  font-size: var(--tab-font-size, 0.875rem);
  cursor: pointer;
  transition: all 150ms ease-out;
  text-align: center;
  border-bottom: 2px solid transparent;
  color: var(--p-surface-600);
}

.tab-button:hover,
.drawer-tab:hover {
  color: var(--p-surface-700);
  background-color: var(--p-surface-50);
}

.tab-button.active,
.drawer-tab.active {
  font-weight: 600;
  color: var(--p-primary-600);
  border-bottom-color: var(--p-primary-600);
}

/* AI : Mobile drawer specific adjustments */
.drawer-tab {
  --tab-padding-y: 0.75rem;
}

.signin-prompt {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2rem;
}

.signin-content {
  text-align: center;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>
