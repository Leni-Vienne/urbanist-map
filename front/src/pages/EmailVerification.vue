<template>
  <div
    class="flex justify-center items-center min-h-screen bg-linear-to-br from-primary-color/5 to-primary-color/10 p-5"
  >
    <div
      class="bg-content-background p-12 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] text-center max-w-100 w-full"
    >
      <div v-if="phase === 'verifying'" class="flex flex-col items-center gap-6">
        <i class="pi pi-spin pi-spinner text-[2rem] text-primary-color"></i>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.emailVerification.verifying") }}
        </p>
      </div>

      <div v-else-if="phase === 'redirecting'" class="flex flex-col items-center gap-6">
        <i class="pi pi-check-circle text-[3rem] text-green-500"></i>
        <h2 class="m-0 text-2xl text-color">
          {{ t("pages.emailVerification.verified") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed flex items-center gap-2 justify-center">
          <i class="pi pi-spin pi-spinner"></i>
          {{ t("pages.emailVerification.signingIn") }}
        </p>
      </div>

      <div v-else class="flex flex-col items-center gap-6">
        <i class="pi pi-times-circle text-[3rem] text-red-500"></i>
        <h2 class="m-0 text-2xl text-color">
          {{ t("pages.emailVerification.verificationFailed") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ errorMessage }}
        </p>
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
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/authStore";

import { useI18n } from "vue-i18n";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const { t } = useI18n();

const phase = ref<"verifying" | "redirecting" | "error">("verifying");
const errorMessage = ref("");

watch(
  () => route.query.token,
  async (token, _previous, onCleanup) => {
    let active = true;
    let redirect: ReturnType<typeof setTimeout> | undefined = undefined;
    onCleanup(() => {
      active = false;
      clearTimeout(redirect);
    });
    phase.value = "verifying";
    errorMessage.value = "";
    if (typeof token !== "string" || !token) {
      phase.value = "error";
      errorMessage.value = t("pages.emailVerification.errors.noToken");
      return;
    }

    const verification = authStore.verifyEmail(token);
    const epoch = authStore.getSessionEpoch();
    const result = await verification;
    if (!active || epoch !== authStore.getSessionEpoch()) return;
    if (!result.success) {
      phase.value = "error";
      errorMessage.value = result.error || t("pages.emailVerification.errors.verificationFailed");
      return;
    }
    phase.value = "redirecting";
    redirect = setTimeout(() => {
      if (active && epoch === authStore.getSessionEpoch()) void router.replace("/");
    }, 1500);
  },
  { immediate: true },
);

function goToApp() {
  router.push("/");
}
</script>
