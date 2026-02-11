<template>
  <div class="verification-container">
    <div class="verification-card">
      <div v-if="loading" class="loading-state">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem; color: var(--p-primary-color)"></i>
        <p>{{ t("pages.emailVerification.verifying") }}</p>
      </div>

      <div v-else-if="success" class="success-state">
        <i class="pi pi-check-circle" style="font-size: 3rem; color: var(--p-green-500)"></i>
        <h2>{{ t("pages.emailVerification.verified") }}</h2>
        <p v-if="!signingIn">{{ t("pages.emailVerification.verifiedMessage") }}</p>
        <p v-else class="signing-in-text">
          <i class="pi pi-spin pi-spinner"></i>
          {{ t("pages.emailVerification.signingIn") }}
        </p>
      </div>

      <div v-else class="error-state">
        <i class="pi pi-times-circle" style="font-size: 3rem; color: var(--p-red-500)"></i>
        <h2>{{ t("pages.emailVerification.verificationFailed") }}</h2>
        <p>{{ errorMessage }}</p>
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
      await new Promise((resolve) => setTimeout(resolve, 1500));

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

<style scoped>
.verification-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, var(--p-primary-50), var(--p-primary-100));
  padding: 20px;
}

.verification-card {
  background: white;
  padding: 3rem;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  text-align: center;
  max-width: 400px;
  width: 100%;
}

.loading-state,
.success-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

h2 {
  margin: 0;
  color: var(--p-text-color);
  font-size: 1.5rem;
}

p {
  margin: 0;
  color: var(--p-text-muted-color);
  line-height: 1.5;
}

.signing-in-text {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
}
</style>
