<template>
  <div
    class="flex items-center gap-2 z-1000 isolate pointer-events-auto max-md:flex-col-reverse max-md:items-end"
  >
    <!-- Sign In for unauthenticated users: text button on desktop, square user icon on mobile -->
    <template v-if="!authStore.isAuthenticated">
      <span class="max-md:hidden">
        <Button :label="$t('auth.signIn')" raised @dblclick.stop @click.stop="openAuthModal" />
      </span>
      <span class="md:hidden">
        <Button
          icon="pi pi-user"
          severity="primary"
          raised
          :aria-label="$t('auth.signIn')"
          @dblclick.stop
          @click.stop="openAuthModal"
        />
      </span>
    </template>

    <!-- User Menu for authenticated users: avatar + username on desktop, square icon button on mobile -->
    <template v-else>
      <button
        type="button"
        class="max-md:hidden appearance-none flex items-center gap-[0.35rem] px-[0.6rem] py-[0.4rem] bg-content-background border border-surface rounded-md cursor-pointer shadow transition-all duration-200 min-w-27 hover:shadow-md"
        @click.stop="toggleMenu"
        @dblclick.stop
      >
        <span
          class="relative w-6 h-6 rounded-full bg-primary-color/10 flex items-center justify-center text-primary-color text-xs"
        >
          <i class="pi pi-user"></i>
        </span>
        <span class="text-sm font-medium text-color flex-1">{{ authStore.user?.username }}</span>
        <i
          class="pi pi-chevron-down text-xs text-muted-color transition-transform duration-200"
          :class="{ 'rotate-180': isMenuOpen }"
        ></i>
      </button>

      <span class="md:hidden relative">
        <Button
          icon="pi pi-user"
          raised
          :severity="isMenuOpen ? undefined : 'secondary'"
          :aria-label="authStore.user?.username ?? undefined"
          @click.stop="toggleMenu"
          @dblclick.stop
        />
      </span>
    </template>

    <!-- User menu popover -->
    <Popover ref="userPopover">
      <div class="flex flex-col w-48">
        <div class="px-2 py-1.5 bg-(--p-content-hover-background) rounded-border mb-1">
          <div class="font-medium text-sm text-ellipsis overflow-hidden">
            {{ isOsmAccount ? authStore.user?.username : authStore.user?.email }}
          </div>
          <div v-if="isOsmAccount" class="text-xs text-muted-color">
            {{ $t("auth.openStreetMapAccount") }}
          </div>
        </div>

        <button
          type="button"
          class="appearance-none bg-transparent border-none text-left flex items-center gap-[0.35rem] px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] hover:bg-black/5 dark:hover:bg-white/10"
          @click="handleSignOut"
        >
          <i class="pi pi-sign-out"></i>
          <span>{{ $t("auth.logout") }}</span>
        </button>
      </div>
    </Popover>

    <!-- Auth Modal, v-if prevents mounting (and async loading) until actually needed -->
    <AuthModal
      v-if="uiStore.authModalVisible"
      v-model:visible="uiStore.authModalVisible"
      :initial-mode="uiStore.authModalInitialMode"
    />
  </div>
</template>

<script setup lang="ts">
import { toastError } from "@/services/core/toast";

import { ref, computed, defineAsyncComponent } from "vue";
import { isSyntheticEmail } from "@shared/types";
import { hasUnsavedChanges } from "@/services/overlay/unsavedState";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";

import { signOut } from "@/services/auth/signOut";
import { useI18n } from "vue-i18n";

// Lazy-load AuthModal for chunk splitting, avoids pulling primevue's password
const AuthModal = defineAsyncComponent(() => import("./AuthModal.vue"));
const authStore = useAuthStore();
const uiStore = useUiStore();
const { t } = useI18n();
const userPopover = ref<{
  visible: boolean;
  toggle: (event: Event) => void;
  hide: () => void;
} | null>(null);
const isMenuOpen = computed<boolean>(() => userPopover.value?.visible ?? false);

// OSM accounts have a synthetic, non-routable email, so show the username instead.
const isOsmAccount = computed(() =>
  authStore.user?.email ? isSyntheticEmail(authStore.user.email) : false,
);

// Toggle menu visibility using Popover
function toggleMenu(event: Event) {
  userPopover.value?.toggle(event);
}

function openAuthModal() {
  uiStore.openAuthModal("login");
}

async function handleSignOut() {
  if (hasUnsavedChanges()) {
    // Use a generic warning about unsaved data (reusing existing key)
    if (!confirm(t("navigation.unsavedOverlaysWarning"))) {
      userPopover.value?.hide();
      return;
    }
  }

  const result = await signOut();
  if (!result.success) {
    toastError(result.error ?? undefined, t("auth.error.signOutFailed"));
  }
  userPopover.value?.hide();
}
</script>
