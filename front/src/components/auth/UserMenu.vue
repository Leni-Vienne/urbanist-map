<template>
  <div class="user-menu-container">
    <!-- AI : Sign In Button for unauthenticated users -->
    <Button
      v-if="!authStore.isAuthenticated"
      label="Sign In"
      size="small"
      outlined
      @click="showAuthModal = true"
      class="sign-in-button"
    />
    
    <!-- AI : User Menu for authenticated users -->
    <div
      v-else
      class="user-menu"
      @click="toggleMenu"
      ref="userMenuRef"
    >
      <div class="user-avatar">
        <i class="pi pi-user"></i>
      </div>
      <span class="username">{{ username }}</span>
      <i class="pi pi-chevron-down" :class="{ 'rotated': isMenuOpen }"></i>
    </div>

    <!-- AI : Auth Modal -->
    <AuthModal v-model:visible="showAuthModal" />
  </div>
  
  <!-- AI : Teleported dropdown, ugly code but Primevue Popper didn't work-->
  <Teleport to="body">
    <div
      v-if="isMenuOpen"
      class="user-dropdown-portal"
      :style="dropdownStyle"
    >
      <div class="dropdown-item user-info">
        <div class="user-details">
          <span class="user-email">{{ authStore.user?.email }}</span>
          <span class="user-role" v-if="authStore.user?.user_metadata?.role">
            {{ authStore.user.user_metadata.role }}
          </span>
        </div>
      </div>
      <div class="dropdown-divider"></div>
      <div
        class="dropdown-item dropdown-button"
        @click="handleSignOut"
        role="button"
        tabindex="0"
        @keydown.enter="handleSignOut"
        @keydown.space="handleSignOut"
      >
        <i class="pi pi-sign-out"></i>
        <span>Sign Out</span>
      </div>
    </div>
    
    <!-- AI : Click outside to close -->
    <div
      v-if="isMenuOpen"
      class="menu-backdrop"
      @click="isMenuOpen = false"
    ></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import Button from 'primevue/button'
import AuthModal from './AuthModal.vue'
import { useAuthStore } from '@stores/authStore'
import { useToast } from '@composables/ui/useToast'

const authStore = useAuthStore()
const toast = useToast()
const showAuthModal = ref(false)
const isMenuOpen = ref(false)
const userMenuRef = ref<HTMLElement>()
const dropdownStyle = ref({})

// AI : Computed username display
const username = computed(() => {
  return authStore.user?.user_metadata?.username || 
         authStore.user?.email?.split('@')[0] || 
         'User'
})

// AI : Update dropdown position
function updateDropdownPosition() {
  if (!userMenuRef.value) return
  
  const rect = userMenuRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    right: `${window.innerWidth - rect.right}px`,
    zIndex: '10001',
    minWidth: '200px',
    background: 'white',
    border: '1px solid var(--p-surface-200)',
    borderRadius: '0.5rem',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
    overflow: 'hidden',
    pointerEvents: 'auto',
    isolation: 'isolate',
    cursor: 'default'
  }
}

// AI : Toggle menu visibility
async function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
  if (isMenuOpen.value) {
    await nextTick()
    updateDropdownPosition()
  }
}

// AI : Handle sign out
async function handleSignOut() {
  console.log('AI : handleSignOut called')
  try {
    const result = await authStore.signOut()
    if (result.success) {
      toast.add({
        severity: 'success',
        summary: 'Signed Out',
        detail: 'You have successfully signed out.',
        life: 3000
      })
    }
  } catch (error) {
    console.error('AI : Error signing out:', error)
  }
  isMenuOpen.value = false
}

// AI : Close menu on escape key
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isMenuOpen.value) {
    isMenuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.user-menu-container {
  position: relative;
  z-index: 10000;
  pointer-events: auto;
  isolation: isolate;
}

/* AI : Force cursor override for all interactive elements */
.user-menu-container * {
  cursor: inherit !important;
}

.user-menu-container .user-menu,
.user-menu-container .dropdown-button,
.user-menu-container .sign-in-button {
  cursor: pointer !important;
}

.sign-in-button {
  background: white;
  border: 1px solid var(--p-surface-300);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.sign-in-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: white;
  border: 1px solid var(--p-surface-300);
  border-radius: 0.375rem;
  cursor: pointer !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
  min-width: 120px;
  pointer-events: auto !important;
  position: relative;
  z-index: 1;
}

.user-menu:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.user-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--p-primary-100);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-primary-600);
  font-size: 0.75rem;
}

.username {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--p-surface-800);
  flex: 1;
}

.pi-chevron-down {
  font-size: 0.75rem;
  color: var(--p-surface-500);
  transition: transform 0.2s ease;
}

.pi-chevron-down.rotated {
  transform: rotate(180deg);
}

.dropdown-item {
  padding: 0.75rem;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
}

.dropdown-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  transition: background-color 0.15s ease;
  color: var(--p-surface-700);
  font-size: 0.875rem;
  min-height: 44px;
  outline: none;
}

.dropdown-button:hover {
  background-color: var(--p-surface-50);
}

.dropdown-button:active {
  background-color: var(--p-surface-100);
}

.user-info {
  background-color: var(--p-surface-25);
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.user-email {
  font-size: 0.875rem;
  color: var(--p-surface-800);
  font-weight: 500;
}

.user-role {
  font-size: 0.75rem;
  color: var(--p-surface-600);
  text-transform: capitalize;
  padding: 0.125rem 0.375rem;
  background: var(--p-primary-100);
  border-radius: 0.25rem;
  display: inline-block;
  width: fit-content;
}

.dropdown-divider {
  height: 1px;
  background-color: var(--p-surface-200);
}

.menu-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  pointer-events: auto;
  cursor: default;
}
</style>