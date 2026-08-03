<template>
  <div
    class="flex justify-center items-center min-h-screen bg-linear-to-br from-primary-50 to-primary-100 p-5"
  >
    <div
      class="bg-content-background p-12 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] text-center max-w-100 w-full"
    >
      <div v-if="loading" class="flex flex-col items-center gap-6">
        <i class="pi pi-spin pi-spinner text-[2rem] text-primary-color"></i>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ $t("common.loading") }}
        </p>
      </div>

      <div v-else-if="tokenValid" class="flex flex-col items-center gap-6">
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
              :class="{ 'p-invalid': passwordError }"
              :inputProps="{ autocomplete: 'new-password' }"
              required
            />
            <small v-if="passwordError" class="p-error">{{ passwordError }}</small>
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
              :class="{ 'p-invalid': confirmError }"
              :inputProps="{ autocomplete: 'new-password' }"
              required
            />
            <small v-if="confirmError" class="p-error">{{ confirmError }}</small>
          </div>

          <Button
            type="submit"
            :label="$t('auth.resetPassword')"
            :loading="submitting"
            :disabled="!isFormValid"
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

import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";

const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const loading = ref(true);
const tokenValid = ref(false);
const submitting = ref(false);
const newPassword = ref("");
const confirmPassword = ref("");
const passwordError = ref("");
const confirmError = ref("");
const errorMessage = ref("");

const isFormValid = computed(() => {
  return (
    newPassword.value.length >= 8 &&
    newPassword.value === confirmPassword.value &&
    !passwordError.value &&
    !confirmError.value
  );
});

function validatePasswords() {
  passwordError.value = "";
  confirmError.value = "";

  if (newPassword.value && newPassword.value.length < 8) {
    passwordError.value = t("auth.chooseStrongPassword");
  }

  if (confirmPassword.value && newPassword.value !== confirmPassword.value) {
    confirmError.value = t("auth.passwordsDontMatch");
  }
}

async function checkTokenPresent() {
  try {
    const token = route.query.token as string;

    if (!token) {
      throw new Error(t("auth.invalidResetToken"));
    }

    tokenValid.value = true;
  } catch (error) {
    console.error("Token validation failed:", error);
    errorMessage.value = error instanceof Error ? error.message : t("auth.invalidResetToken");
  } finally {
    loading.value = false;
  }
}

async function handleResetPassword() {
  try {
    validatePasswords();
    if (!isFormValid.value) return;

    submitting.value = true;
    const token = route.query.token as string;

    const result = await authStore.resetPassword(token, newPassword.value);

    if (result.success) {
      // Auto-login after successful password reset, failure is non-fatal
      if (result.email) {
        await authStore.signIn(result.email, newPassword.value);
      }

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

onMounted(() => {
  checkTokenPresent();
});
</script>
