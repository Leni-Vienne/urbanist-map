<template>
  <div class="user-menu-container">
    <!-- AI : Sign In Button for unauthenticated users -->
    <template v-if="!authStore.isAuthenticated">
      <LanguageSwitcherMenu display-mode="icon" />
      <Button
        :label="$t('auth.signIn')"
        size="small"
        raised
        data-testid="sign-in-button"
        @dblclick.stop
        @click="uiStore.openAuthModal()"
      />
    </template>

    <!-- AI : User Menu for authenticated users -->
    <button
      v-else
      type="button"
      class="user-menu"
      data-testid="user-menu"
      @click="toggleMenu"
      @dblclick.stop
      ref="userMenuRef"
    >
      <span class="user-avatar relative">
        <i class="pi pi-user"></i>
        <!-- AI : Red dot on avatar if there are unread notifications -->
        <span v-if="hasUnacknowledgedItems" class="notification-dot-avatar"></span>
      </span>
      <span class="username">{{ authStore.user?.username }}</span>
      <i class="pi pi-chevron-down" :class="{ rotated: isMenuOpen }"></i>
    </button>

    <!-- AI : User menu popover -->
    <Popover ref="userPopover">
      <div class="flex flex-col w-48">
        <div class="px-2 py-1.5 bg-surface-50 border-round mb-1">
          <div class="font-medium text-sm text-ellipsis overflow-hidden">
            {{ authStore.user?.email }}
          </div>
        </div>

        <!-- AI : Language Switcher as list item -->
        <LanguageSwitcherMenu display-mode="list-item" />

        <!-- AI : Moderation Results as list item -->
        <button type="button" class="menu-item-btn" @click="openModerationResults">
          <div class="flex items-center gap-2">
            <i class="pi pi-bell"></i>
            <span>{{ $t("moderation.moderatedContributions.viewResults") }}</span>
          </div>
          <Badge v-if="hasUnacknowledgedItems" severity="danger" class="ml-auto" value="!" />
        </button>

        <div class="separator my-1"></div>

        <button
          type="button"
          class="menu-item-btn"
          data-testid="sign-out-button"
          @click="handleSignOut"
        >
          <i class="pi pi-sign-out"></i>
          <span>{{ $t("auth.logout") }}</span>
        </button>
      </div>
    </Popover>

    <!-- AI : Auth Modal -->
    <AuthModal v-model:visible="authModalVisible" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useUnsavedChanges } from "@/composables/core/useUnsavedChanges";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useToast } from "@/composables/ui/useToast";
import { useI18n } from "vue-i18n";
import { useModeratedContributions } from "@/composables/moderation/useModeratedContributions";

import AuthModal from "./AuthModal.vue";
import LanguageSwitcherMenu from "../map/LanguageSwitcherMenu.vue";

const authStore = useAuthStore();
const uiStore = useUiStore();
const toast = useToast();
const { t } = useI18n();
const isMenuOpen = ref(false);
const userPopover = ref();
const { hasUnacknowledgedItems } = useModeratedContributions();

// AI : Use store state directly for auth modal
const authModalVisible = computed({
  get: () => uiStore.authModalVisible,
  set: (value) => {
    if (value) {
      uiStore.openAuthModal();
    } else {
      uiStore.closeAuthModal();
    }
  },
});

// AI : Toggle menu visibility using Popover
function toggleMenu(event: Event) {
  userPopover.value.toggle(event);
  isMenuOpen.value = !isMenuOpen.value;
}

const { hasUnsavedChanges } = useUnsavedChanges();

// AI : Handle sign out
async function handleSignOut() {
  if (hasUnsavedChanges()) {
    // AI : Use a generic warning about unsaved data (reusing existing key)
    if (!confirm(t("navigation.unsavedOverlaysWarning"))) {
      userPopover.value.hide();
      isMenuOpen.value = false;
      return;
    }
  }

  try {
    const result = await authStore.signOut();
    if (result.success) {
      toast.add({
        severity: "success",
        summary: t("auth.signedOut"),
        detail: t("auth.signedOutMessage"),
        life: 3000,
      });
    }
  } catch (error) {
    console.error("Error signing out:", error);
  }
  userPopover.value.hide();
  isMenuOpen.value = false;
}

// AI : Handle opening moderation results (closes menu)
function openModerationResults() {
  uiStore.openModeratedContributionsDialog();
  userPopover.value.hide();
  isMenuOpen.value = false;
}

// AI : Watch for popover visibility changes
watch(
  () => userPopover.value?.visible,
  (visible) => {
    isMenuOpen.value = visible ?? false;
  },
);

// AI : Close menu on window resize to prevent positioning issues
function handleResize() {
  if (isMenuOpen.value && userPopover.value) {
    userPopover.value.hide();
    isMenuOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("resize", handleResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
});
</script>

<style scoped>
.user-menu-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  z-index: 1000;
  /* important on mobile */
  isolation: isolate;
  pointer-events: auto;
}

.menu-item-btn {
  appearance: none;
  font-family: inherit;
  background: transparent;
  border: none;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  width: 100%;
  cursor: pointer;
  border-radius: var(--p-border-radius);
  color: var(--p-surface-700);
  transition: background-color 0.2s;
  font-size: 0.9rem;
}

.menu-item-btn:hover {
  background-color: var(--p-surface-100);
}

.separator {
  height: 1px;
  background-color: var(--p-surface-200);
  margin: 0.25rem 0;
}

/* AI : Initial notification dot on avatar */
.notification-dot-avatar {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  background-color: var(--p-red-500);
  border-radius: 50%;
  border: 2px solid white;
}

.user-menu {
  /* AI : Reset button defaults */
  appearance: none;
  font-family: inherit;
  /* AI : Layout and styling */
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.6rem;
  background: white;
  border: 1px solid var(--p-surface-300);
  border-radius: 0.375rem;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
  min-width: 110px;
}

/* AI : Reset button defaults for sign out button */
.sign-out-btn {
  appearance: none;
  font-family: inherit;
  background: transparent;
  border: none;
  text-align: left;
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
  .user-menu-container {
    flex-direction: column-reverse;
    align-items: flex-end;
    gap: 0.5rem;
  }

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
