<template>
  <div class="user-menu-container">
    <!-- AI : Sign In Button for unauthenticated users -->
    <Button
      v-if="!authStore.isAuthenticated"
      label="Sign In"
      size="small"
      outlined
      @click="showAuthModal = true"
      class="sign-in-button whitespace-nowrap"
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
      <i
        class="pi pi-chevron-down"
        :class="{ 'rotated': isMenuOpen }"
      ></i>
    </div>

    <!-- AI : User menu popover -->
    <Popover ref="userPopover">
      <div class="flex flex-col gap-4 w-48">
        <div class="px-3 py-2 bg-surface-50 border-round">
          <div class="font-medium text-sm">{{ authStore.user?.email }}</div>
          <div 
            v-if="authStore.user?.user_metadata?.role"
            class="text-xs text-surface-500 mt-1"
          >
            {{ authStore.user.user_metadata.role }}
          </div>
        </div>
        <div
          class="flex items-center gap-2 px-3 py-2 hover:bg-surface-100 cursor-pointer border-round"
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
    </Popover>

    <!-- AI : Auth Modal -->
    <AuthModal v-model:visible="showAuthModal" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import AuthModal from './AuthModal.vue'
import { useAuthStore } from '@stores/authStore'
import { useToast } from '@composables/ui/useToast'

const authStore = useAuthStore()
const toast = useToast()
const showAuthModal = ref(false)
const isMenuOpen = ref(false)
const userPopover = ref()

// AI : Computed username display
const username = computed(() => {
  return authStore.user?.user_metadata?.username ||
    authStore.user?.email?.split('@')[0] ||
    'User'
})

// AI : Toggle menu visibility using Popover
function toggleMenu(event: Event) {
  userPopover.value.toggle(event)
  isMenuOpen.value = !isMenuOpen.value
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
  userPopover.value.hide()
  isMenuOpen.value = false
}

// AI : Watch for popover visibility changes
watch(() => userPopover.value?.visible, (visible) => {
  isMenuOpen.value = visible ?? false
})
</script>

<style scoped>


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
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
  min-width: 120px;
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

</style>