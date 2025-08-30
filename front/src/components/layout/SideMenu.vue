<template>
  <!-- AI : Mobile backdrop overlay -->
  <div
    v-if="isOpen"
    class="mobile-backdrop"
    @click="$emit('close')"
  ></div>

  <div
    class="sidecolumn"
    :class="{ 'sidecolumn--collapsed': !isOpen }"
  >
    <!-- AI : Common header for all panels -->
    <div class="sidecolumn__header">
      <h2 class="site-title">ConstructionMap.org</h2>
      <div class="header-actions">
        <Button
          icon="pi pi-times"
          class="p-button-text p-button-rounded close-button"
          @click="$emit('close')"
          aria-label="Close panel"
        />
      </div>
    </div>


    <!-- AI : Tab navigation - only show authenticated tabs when signed in -->
    <div class="tab-navigation">
      <button
        :class="['tab-button', { active: activeTab === 'latest' }]"
        @click="activeTab = 'latest'"
      >
        Latest
      </button>
      <button
        v-if="authStore.isAuthenticated"
        :class="['tab-button', { active: activeTab === 'uploads' }]"
        @click="activeTab = 'uploads'"
      >
        My Contributions
      </button>
      <button
        v-if="authStore.isAdmin"
        :class="['tab-button', { active: activeTab === 'admin' }]"
        @click="activeTab = 'admin'"
      >
        Admin
      </button>
    </div>

    <div class="sidecolumn__content">
      <!-- AI : Show content based on active tab -->
      <LatestOverlaysPanel v-if="activeTab === 'latest'" />
      <MyContributionsPanel v-else-if="activeTab === 'uploads' && authStore.isAuthenticated" />
      <ModerationPanel v-else-if="activeTab === 'admin' && authStore.isAdmin" />

      <!-- AI : Show sign-in prompt for authenticated tabs when not signed in -->
      <div
        v-else-if="(!authStore.isAuthenticated && (activeTab === 'uploads' || activeTab === 'admin')) || (activeTab === 'admin' && !authStore.isAdmin)"
        class="signin-prompt"
      >
        <div class="signin-content">
          <i class="pi pi-user text-4xl text-muted-color mb-4"></i>
          <h3 class="text-lg font-semibold mb-2">
            {{ activeTab === 'admin' && authStore.isAuthenticated && !authStore.isAdmin ? 'Admin Access Required' : 'Authentication Required' }}
          </h3>
          <p class="text-muted-color text-sm mb-4 text-center">
            {{ activeTab === 'admin' && authStore.isAuthenticated && !authStore.isAdmin 
              ? 'You need administrator privileges to access this section.'
              : 'Please sign in using the button in the top-right corner to access this section.' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent, watch } from 'vue'
import Button from 'primevue/button'
import LatestOverlaysPanel from './LatestOverlaysPanel.vue' // static import since it's the default panel
import { useAuthStore } from '@stores/authStore'

// AI : Lazy load panels to reduce initial bundle size
const ModerationPanel = defineAsyncComponent(() => import('./ModerationPanel.vue'))
const MyContributionsPanel = defineAsyncComponent(() => import('./MyContributionsPanel.vue'))

const authStore = useAuthStore()

const props = defineProps<{
  isOpen: boolean
  isModerator?: boolean
}>()

defineEmits<{
  close: []
}>()

// AI : Tab state - default to "latest" like the prototype
const activeTab = ref<'latest' | 'uploads' | 'admin'>('latest')

// AI : Watch for authentication changes and reset tab if user signs out or loses admin rights
watch(() => authStore.isAuthenticated, (isAuthenticated) => {
  if (!isAuthenticated && (activeTab.value === 'uploads' || activeTab.value === 'admin')) {
    activeTab.value = 'latest'
  }
})

// AI : Watch for admin role changes and reset admin tab if user loses admin rights
watch(() => authStore.isAdmin, (isAdmin) => {
  if (!isAdmin && activeTab.value === 'admin') {
    activeTab.value = 'latest'
  }
})

</script>

<style scoped>
/* AI : Mobile backdrop for overlay */
.mobile-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 999;
  display: none;
}

.sidecolumn {
  /* to make the accordion header highlight on hover */
  --p-accordion-header-hover-background: var(--p-surface-100);
  --p-accordion-header-active-hover-background: var(--p-surface-100);

  position: relative;
  flex-shrink: 0;
  width: 380px;
  height: 100vh;
  max-height: 100vh;
  background-color: var(--p-surface-0);
  border-right: 1px solid var(--p-surface-200);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  transition: all 300ms ease-in-out;
  display: flex;
  flex-direction: column;
  z-index: 1000;
  overflow: hidden;
}


.sidecolumn--collapsed {
  width: 0;
  border-right: none;
  overflow: hidden;
}

.sidecolumn__header {
  flex-shrink: 0;
  padding: 2rem 1.5rem 1.5rem;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
  display: flex;
  align-items: center;
  justify-content: space-between;
}


.site-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.025em;
  color: var(--p-surface-800);
}

/* AI : Tab navigation styles */
.tab-navigation {
  display: flex;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
}

.tab-button {
  flex: 1;
  padding: 1rem 0;
  border: none;
  background: transparent;
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 150ms ease-out;
  text-align: center;
  border-bottom: 2px solid transparent;
  color: var(--p-surface-500);
}

.tab-button:hover {
  color: var(--p-surface-600);
  background-color: var(--p-surface-50);
}

.tab-button.active {
  font-weight: 600;
  color: var(--p-primary-600);
  background-color: var(--p-surface-0);
  border-bottom-color: var(--p-primary-600);
}

.header-actions {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.close-button {
  display: none;
  color: var(--p-surface-500);
}

.sidecolumn__content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  scrollbar-gutter: stable;
}


/* AI : Mobile responsive styles */
@media (max-width: 768px) {
  .mobile-backdrop {
    display: block;
  }

  .close-button {
    display: flex;
  }

  .site-title {
    font-size: 1.375rem;
  }

  .sidecolumn__header {
    padding: 1rem;
  }

  .sidecolumn {
    position: fixed;
    top: 0;
    left: 0;
    width: 85%;
    max-width: 380px;
    height: 100vh;
    transform: translateX(-100%);
    transition: transform 0.3s ease-in-out;
    border-right: none;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
  }

  .sidecolumn:not(.sidecolumn--collapsed) {
    transform: translateX(0);
  }

  .sidecolumn--collapsed {
    width: 85%;
    max-width: 380px;
    transform: translateX(-100%);
  }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .sidecolumn {
    width: 500px;
  }
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
