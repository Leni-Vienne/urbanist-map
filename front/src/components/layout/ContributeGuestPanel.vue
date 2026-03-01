<template>
  <div class="flex items-center justify-center h-full p-8">
    <div class="text-center max-w-[300px] flex flex-col items-center gap-4">
      <i class="pi pi-map text-5xl text-primary-400"></i>
      <div>
        <h3 class="text-lg font-semibold mb-2 text-surface-800">
          {{ $t("contribute.guest.title") }}
        </h3>
        <p class="text-muted-color text-sm leading-relaxed">
          {{ $t("contribute.guest.description") }}
        </p>
      </div>
      <div class="flex flex-col gap-2 w-full mt-2">
        <Button
          :label="$t('contribute.guest.createAccount')"
          severity="primary"
          @click="openSignUp"
        />
        <Button
          :label="$t('contribute.guest.signIn')"
          severity="secondary"
          variant="outlined"
          @click="openSignIn"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from "@/stores/uiStore";

const uiStore = useUiStore();

function openSignUp() {
  uiStore.authModalInitialMode = "signup";
  uiStore.authModalVisible = true;
}

function openSignIn() {
  uiStore.authModalInitialMode = "login";
  uiStore.authModalVisible = true;
}
</script>
