<template>
  <div
    class="flex justify-center items-start h-full bg-linear-to-br from-primary-50 to-primary-100 p-10 overflow-y-auto"
  >
    <div
      class="bg-content-background p-8 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] max-w-150 w-full text-center"
    >
      <Button
        icon="pi pi-arrow-left"
        :label="t('common.back')"
        severity="secondary"
        text
        @click="goHome"
      />

      <h1 class="mt-6 mb-4 text-[1.75rem] font-semibold text-color">
        {{ t("common.contact") }}
      </h1>

      <p class="text-muted-color leading-relaxed mb-6">
        {{ t("pages.contact.description") }}
      </p>

      <div class="mt-4">
        <a
          href="mailto:contact@urbanistmap.org"
          class="inline-flex items-center gap-2 no-underline text-lg px-6 py-3 rounded-lg bg-primary-50 hover:bg-primary-100 transition-colors text-primary-color"
        >
          <i class="pi pi-envelope"></i>
          contact@urbanistmap.org
        </a>
      </div>

      <Divider />

      <div class="mt-8 text-left">
        <h2 class="text-xl font-semibold mb-3 text-color">
          {{ t("pages.contact.basemapTitle") }}
        </h2>
        <p class="text-muted-color leading-relaxed mb-0">
          {{ t("pages.contact.basemapDescription") }}
        </p>
        <div
          class="relative overflow-hidden mt-4 p-5 bg-zinc-900 rounded-lg border border-zinc-700 break-all before:content-[''] before:absolute before:top-0 before:left-0 before:w-1 before:h-full before:bg-primary-500"
        >
          <span
            class="block font-semibold mb-3 text-white text-[0.85rem] uppercase tracking-[0.05em]"
            >{{ t("pages.contact.basemapExample") }}</span
          >
          <code
            class="font-mono text-[0.8rem] text-primary-300 px-[0.6rem] py-[0.4rem] rounded leading-relaxed block"
            >https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product/default/2025/3857/{z}/{x}/{y}.png</code
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

const router = useRouter();
const { t } = useI18n();

function goHome() {
  router.push("/");
}
</script>
