<template>
  <div class="user-menu-container">
    <!-- AI : Language switcher always visible -->
    <LanguageSwitcherMenu />

    <!-- AI : Sign In Button for unauthenticated users -->
    <Button
      v-if="!authStore.isAuthenticated"
      :label="$t('auth.signIn')"
      size="small"
      raised
      data-testid="sign-in-button"
      @dblclick.stop
      @click="showAuthModal = true"
    />

    <!-- AI : User Menu for authenticated users -->
    <div
      v-else
      class="user-menu"
      data-testid="user-menu"
      @click="toggleMenu"
      @dblclick.stop
      ref="userMenuRef"
    >
      <div class="user-avatar">
        <i class="pi pi-user"></i>
      </div>
      <span class="username">{{ authStore.user?.username }}</span>
      <i
        class="pi pi-chevron-down"
        :class="{ 'rotated': isMenuOpen }"
      ></i>
    </div>

    <!-- AI : User menu popover -->
    <Popover ref="userPopover">
      <div class="flex flex-col w-48">
        <div class="px-3 py-2 bg-surface-50 border-round">
          <div class="font-medium text-sm">{{ authStore.user?.email }}</div>

        </div>
        <div
          class="flex items-center gap-2 px-3 py-2 hover:bg-surface-100 cursor-pointer border-round"
          data-testid="sign-out-button"
          @click="handleSignOut"
          role="button"
          tabindex="0"
          @keydown.enter="handleSignOut"
          @keydown.space="handleSignOut"
        >
          <i class="pi pi-sign-out"></i>
          <span>{{ $t('auth.logout') }}</span>
        </div>
      </div>
    </Popover>

    <!-- AI : Auth Modal -->
    <AuthModal v-model:visible="showAuthModal" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import AuthModal from './AuthModal.vue'
import LanguageSwitcherMenu from '../map/LanguageSwitcherMenu.vue'
import { useAuthStore } from '@stores/authStore'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from 'vue-i18n'

const authStore = useAuthStore()
const toast = useToast()
const { t } = useI18n()
const showAuthModal = ref(false)
const isMenuOpen = ref(false)
const userPopover = ref()

// AI : Toggle menu visibility using Popover
function toggleMenu(event: Event) {
  userPopover.value.toggle(event)
  isMenuOpen.value = !isMenuOpen.value
}

// AI : Handle sign out
async function handleSignOut() {
  try {
    const result = await authStore.signOut()
    if (result.success) {
      toast.add({
        severity: 'success',
        summary: t('auth.signedOut'),
        detail: t('auth.signedOutMessage'),
        life: 3000
      })
    }
  } catch (error) {
    console.error('Error signing out:', error)
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

.user-menu-container {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  z-index: 10000; /* important on mobile */
  isolation: isolate;
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

@media (max-width: 768px) {
  .user-menu {
    min-width: auto;
    padding: 0;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    justify-content: center;
    gap: 0;
  }

  .user-avatar {
    background: transparent;
    color: var(--p-surface-600);
    font-size: 16px;
  }

  .username,
  .pi-chevron-down {
    display: none;
  }
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