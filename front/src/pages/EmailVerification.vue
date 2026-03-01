<template>
  <div
    class="flex justify-center items-center min-h-screen bg-gradient-to-br from-[var(--p-primary-50)] to-[var(--p-primary-100)] p-5"
  >
    <div
      class="bg-[var(--p-surface-0)] p-12 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] text-center max-w-[400px] w-full"
    >
      <div v-if="loading" class="flex flex-col items-center gap-6">
        <i class="pi pi-spin pi-spinner text-[2rem] text-[var(--p-primary-color)]"></i>
        <p class="m-0 text-[var(--p-text-muted-color)] leading-relaxed">
          {{ t("pages.emailVerification.verifying") }}
        </p>
      </div>

      <div v-else-if="success" class="flex flex-col items-center gap-6">
        <i class="pi pi-check-circle text-[3rem] text-[var(--p-green-500)]"></i>
        <h2 class="m-0 text-2xl text-[var(--p-text-color)]">
          {{ t("pages.emailVerification.verified") }}
        </h2>
        <p v-if="!signingIn" class="m-0 text-[var(--p-text-muted-color)] leading-relaxed">
          {{ t("pages.emailVerification.verifiedMessage") }}
        </p>
        <p
          v-else
          class="m-0 text-[var(--p-text-muted-color)] leading-relaxed flex items-center gap-2 justify-center"
        >
          <i class="pi pi-spin pi-spinner"></i>
          {{ t("pages.emailVerification.signingIn") }}
        </p>
      </div>

      <div v-else class="flex flex-col items-center gap-6">
        <i class="pi pi-times-circle text-[3rem] text-[var(--p-red-500)]"></i>
        <h2 class="m-0 text-2xl text-[var(--p-text-color)]">
          {{ t("pages.emailVerification.verificationFailed") }}
        </h2>
        <p class="m-0 text-[var(--p-text-muted-color)] leading-relaxed">{{ errorMessage }}</p>
        <Button
          @click="goToApp"
          :label="t('pages.emailVerification.backToApp')"
          severity="secondary"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/authStore";
import { useToast } from "@/composables/ui/useToast";
import { useI18n } from "vue-i18n";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const toast = useToast();
const { t } = useI18n();

const loading = ref(true);
const success = ref(false);
const signingIn = ref(false);
const errorMessage = ref("");

async function verifyEmail() {
  try {
    const token = route.query.token as string;

    if (!token) {
      throw new Error(t("pages.emailVerification.errors.noToken"));
    }

    const result = await authStore.verifyEmail(token);

    if (!result.success) {
      throw new Error(result.error || t("pages.emailVerification.errors.verificationFailed"));
    }

    success.value = true;
    loading.value = false;

    toast.add({
      severity: "success",
      summary: t("common.success"),
      detail: t("pages.emailVerification.successDetail"),
      life: 3000,
    });

    // AI : Auto-login by setting user data from verification response
    if (result.user) {
      signingIn.value = true;

      // AI : Wait a moment so user can see the success message
      await new Promise<void>((resolve) => void setTimeout(() => resolve(), 1500));

      // AI : Set user directly on auth store (session is already created by backend via cookies)
      authStore.user = result.user;

      // AI : Redirect to home page
      router.push("/");
    }
  } catch (error) {
    console.error("Email verification failed:", error);
    errorMessage.value =
      error instanceof Error
        ? error.message
        : t("pages.emailVerification.errors.verificationFailed");
    loading.value = false;
  }
}

function goToApp() {
  router.push("/");
}

onMounted(() => {
  verifyEmail();
});
</script>
