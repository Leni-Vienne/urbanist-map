<template>
  <div
    class="flex items-center gap-2 z-1000 isolate pointer-events-auto max-md:flex-col-reverse max-md:items-end"
  >
    <!-- Sign In for unauthenticated users: text button on desktop, square user icon on mobile -->
    <template v-if="!authStore.isAuthenticated">
      <span class="max-md:hidden">
        <Button
          :label="$t('auth.signIn')"
          raised
          data-testid="sign-in-button"
          @dblclick.stop
          @click.stop="openAuthModal"
        />
      </span>
      <span class="md:hidden">
        <Button
          icon="pi pi-user"
          severity="primary"
          raised
          :aria-label="$t('auth.signIn')"
          data-testid="sign-in-button"
          @dblclick.stop
          @click.stop="openAuthModal"
        />
      </span>
    </template>

    <!-- User Menu for authenticated users: avatar + username on desktop, square icon button on mobile -->
    <template v-else>
      <button
        type="button"
        class="max-md:hidden appearance-none font-[inherit] flex items-center gap-[0.35rem] px-[0.6rem] py-[0.4rem] bg-content-background border border-surface rounded-md cursor-pointer shadow transition-all duration-200 min-w-27 hover:shadow-md"
        data-testid="user-menu"
        @click.stop="toggleMenu"
        @dblclick.stop
      >
        <span
          class="relative w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs"
        >
          <i class="pi pi-user"></i>
          <!-- Red dot on avatar if there are unread notifications -->
          <span
            v-if="uiStore.hasUnacknowledgedModeratedContributions"
            class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-content-background"
          ></span>
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
          data-testid="user-menu"
          @click.stop="toggleMenu"
          @dblclick.stop
        />
        <!-- Red dot if there are unread notifications -->
        <span
          v-if="uiStore.hasUnacknowledgedModeratedContributions"
          class="absolute top-0.5 right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-content-background pointer-events-none"
        ></span>
      </span>
    </template>

    <!-- User menu popover -->
    <Popover ref="userPopover">
      <div class="flex flex-col w-48">
        <div class="px-2 py-1.5 bg-content-hover-background border-round mb-1">
          <div class="font-medium text-sm text-ellipsis overflow-hidden">
            {{ isOsmAccount ? authStore.user?.username : authStore.user?.email }}
          </div>
          <div v-if="isOsmAccount" class="text-xs text-muted-color">
            {{ $t("auth.openStreetMapAccount") }}
          </div>
        </div>

        <!-- Moderation Results as list item -->
        <button
          type="button"
          class="appearance-none font-[inherit] bg-transparent border-none text-left flex items-center gap-[0.35rem] px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] hover:bg-black/5 dark:hover:bg-white/10"
          @click="openModerationResults"
        >
          <div class="flex items-center gap-2">
            <i class="pi pi-bell"></i>
            <span>{{ $t("moderation.moderatedContributions.viewResults") }}</span>
          </div>
          <Badge
            v-if="uiStore.hasUnacknowledgedModeratedContributions"
            severity="danger"
            class="ml-auto"
            value="!"
          />
        </button>

        <div class="h-px bg-content-border-color my-1"></div>

        <button
          type="button"
          class="appearance-none font-[inherit] bg-transparent border-none text-left flex items-center gap-[0.35rem] px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] hover:bg-black/5 dark:hover:bg-white/10"
          data-testid="sign-out-button"
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

    <!-- Moderated Contributions Dialog, same pattern as AuthModal -->
    <ModeratedContributionsDialog
      v-if="uiStore.moderatedContributionsDialogVisible"
      v-model:visible="uiStore.moderatedContributionsDialogVisible"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from "vue";
import { isSyntheticEmail } from "@shared/types";
import { hasUnsavedChanges } from "@/utils/unsavedState";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useToast } from "@/composables/ui/useToast";
import { signOut } from "@/services/auth/signOut";
import { useI18n } from "vue-i18n";

// Lazy-load AuthModal for chunk splitting, avoids pulling primevue's password
const AuthModal = defineAsyncComponent(() => import("./AuthModal.vue"));
const ModeratedContributionsDialog = defineAsyncComponent(
  () => import("@/components/moderation/ModeratedContributionsDialog.vue"),
);

const authStore = useAuthStore();
const uiStore = useUiStore();
const toast = useToast();
const { t } = useI18n();
const isMenuOpen = ref(false);
const userPopover = ref();

// OSM accounts have a synthetic, non-routable email, so show the username instead.
const isOsmAccount = computed(() =>
  authStore.user?.email ? isSyntheticEmail(authStore.user.email) : false,
);

// Toggle menu visibility using Popover
function toggleMenu(event: Event) {
  userPopover.value.toggle(event);
  isMenuOpen.value = !isMenuOpen.value;
}

function openAuthModal() {
  uiStore.authModalInitialMode = "login";
  uiStore.authModalVisible = true;
}

async function handleSignOut() {
  if (hasUnsavedChanges()) {
    // Use a generic warning about unsaved data (reusing existing key)
    if (!confirm(t("navigation.unsavedOverlaysWarning"))) {
      userPopover.value.hide();
      isMenuOpen.value = false;
      return;
    }
  }

  const result = await signOut();
  if (result.success) {
    toast.add({
      severity: "success",
      summary: t("auth.signedOut"),
      detail: t("auth.signedOutMessage"),
      life: 3000,
    });
  } else {
    toast.add({
      severity: "error",
      summary: t("auth.error.signOutFailed"),
      detail: result.error ?? undefined,
      life: 5000,
    });
  }
  userPopover.value.hide();
  isMenuOpen.value = false;
}

// Handle opening moderation results (closes menu)
function openModerationResults() {
  uiStore.moderatedContributionsDialogVisible = true;
  userPopover.value.hide();
  isMenuOpen.value = false;
}

// Watch for popover visibility changes
watch(
  () => userPopover.value?.visible,
  (visible) => {
    isMenuOpen.value = visible ?? false;
  },
);

// Close menu on window resize to prevent positioning issues
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
