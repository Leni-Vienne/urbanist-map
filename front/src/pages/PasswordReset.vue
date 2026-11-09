<template>
  <div
    class="flex justify-center items-center min-h-screen bg-linear-to-br from-primary-color/5 to-primary-color/10 p-5"
  >
    <div
      class="bg-content-background p-12 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] text-center max-w-100 w-full"
    >
      <div v-if="hasToken" class="flex flex-col items-center gap-6">
        <i class="pi pi-key text-[3rem] text-primary-color"></i>
        <h2 class="m-0 text-2xl text-color">
          {{ $t("auth.resetPasswordTitle") }}
        </h2>
        <form @submit.prevent="handleResetPassword" class="flex flex-col gap-4 w-full">
          <div class="flex flex-col gap-2 text-left">
            <label for="password" class="font-medium text-color">{{
              $t("auth.newPassword")
            }}</label>
            <Password
              inputId="password"
              v-model="newPassword"
              :feedback="true"
              toggleMask
              :placeholder="$t('auth.chooseStrongPassword')"
              :class="{ 'p-invalid': validationAttempted && passwordError }"
              :inputProps="{ autocomplete: 'new-password' }"
              required
            />
            <small
              v-if="validationAttempted && passwordError"
              class="text-red-600 dark:text-red-400"
              >{{ passwordError }}</small
            >
          </div>

          <div class="flex flex-col gap-2 text-left">
            <label for="confirmPassword" class="font-medium text-color">{{
              $t("auth.confirmPassword")
            }}</label>
            <Password
              inputId="confirmPassword"
              v-model="confirmPassword"
              :feedback="false"
              toggleMask
              :placeholder="$t('auth.confirmPassword')"
              :class="{ 'p-invalid': validationAttempted && confirmError }"
              :inputProps="{ autocomplete: 'new-password' }"
              required
            />
            <small
              v-if="validationAttempted && confirmError"
              class="text-red-600 dark:text-red-400"
              >{{ confirmError }}</small
            >
          </div>

          <Button
            type="submit"
            :label="$t('auth.resetPassword')"
            :loading="submitting"
            :disabled="submitting || !isFormValid"
            class="w-full"
          />
        </form>
      </div>

      <div v-else class="flex flex-col items-center gap-6">
        <i class="pi pi-times-circle text-[3rem] text-red-500"></i>
        <h2 class="m-0 text-2xl text-color">
          {{ $t("auth.invalidResetToken") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ errorMessage }}
        </p>
        <Button @click="goToApp" :label="$t('auth.backToSignIn')" severity="secondary" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toastSuccess, toastError } from "@/services/core/toast";

import { ref, computed, watch, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";

const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const token = computed(() => (typeof route.query.token === "string" ? route.query.token : null));
const hasToken = computed(() => Boolean(token.value));
let active = true;
onBeforeUnmount(() => {
  active = false;
});
const submitting = ref(false);
const newPassword = ref("");
const confirmPassword = ref("");
const validationAttempted = ref(false);
const errorMessage = computed(() => t("auth.invalidResetToken"));

const passwordError = computed(() =>
  newPassword.value.length < 8 ? t("auth.chooseStrongPassword") : "",
);
const confirmError = computed(() =>
  newPassword.value !== confirmPassword.value ? t("auth.passwordsDontMatch") : "",
);
const isFormValid = computed(() => !passwordError.value && !confirmError.value);

watch(token, () => {
  newPassword.value = "";
  confirmPassword.value = "";
  validationAttempted.value = false;
});

async function handleResetPassword() {
  if (submitting.value || !token.value) return;
  const submittedToken = token.value;
  try {
    validationAttempted.value = true;
    if (!isFormValid.value) return;

    submitting.value = true;
    const reset = authStore.resetPassword(submittedToken, newPassword.value);
    const epoch = authStore.getSessionEpoch();
    const result = await reset;
    if (!active || token.value !== submittedToken || epoch !== authStore.getSessionEpoch()) return;

    if (result.success) {
      toastSuccess(t("auth.passwordResetSuccess"));

      router.push("/");
    } else {
      throw new Error(result.error ?? t("auth.invalidResetToken"));
    }
  } catch (error) {
    console.error("Password reset failed:", error);
    toastError(error instanceof Error ? error.message : t("auth.invalidResetToken"));
  } finally {
    submitting.value = false;
  }
}

function goToApp() {
  router.push("/");
}
</script>
