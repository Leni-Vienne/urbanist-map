<template>
  <div
    class="flex justify-center items-start h-full bg-linear-to-br from-primary-color/5 to-primary-color/10 p-10 overflow-y-auto"
  >
    <div
      class="bg-content-background p-8 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] max-w-175 w-full"
    >
      <Button
        icon="pi pi-arrow-left"
        :label="t('common.back')"
        severity="secondary"
        text
        @click="goHome"
      />

      <h1 class="mt-6 mb-4 text-[1.75rem] font-semibold text-color">
        {{ t("pages.legal.title") }}
      </h1>

      <!-- Data collection -->
      <section class="mb-6 pb-4 border-b border-surface">
        <h2 class="mt-6 mb-2 text-[1.1rem] font-semibold text-color">
          {{ t("pages.legal.dataCollection.title") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.dataCollection.content") }}
        </p>
        <ul class="my-2 pl-6">
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.dataCollection.username") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.dataCollection.email") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.dataCollection.password") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.dataCollection.ipAddresses") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.dataCollection.oauthData") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.dataCollection.analytics") }}
          </li>
        </ul>
        <p class="mt-2 italic m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.dataCollection.legalBasis") }}
        </p>
      </section>

      <!-- GDPR user rights -->
      <section class="mb-6 pb-4 border-b border-surface">
        <h2 class="mt-6 mb-2 text-[1.1rem] font-semibold text-color">
          {{ t("pages.legal.rights.title") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.rights.content") }}
        </p>
        <ul class="my-2 pl-6">
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.rights.access", { email }) }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.rights.rectification") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{
              t("pages.legal.rights.deletion", {
                email,
              })
            }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{
              t("pages.legal.rights.portability", {
                email,
              })
            }}
          </li>
        </ul>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.rights.howTo", { email }) }}
        </p>
        <p class="mt-2 italic m-0 text-muted-color leading-relaxed">
          <strong>{{ t("pages.legal.rights.note") }}</strong>
        </p>
      </section>

      <!-- Third-party services -->
      <section class="mb-6 pb-4 border-b border-surface">
        <h2 class="mt-6 mb-2 text-[1.1rem] font-semibold text-color">
          {{ t("pages.legal.thirdParty.title") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.thirdParty.content") }}
        </p>
        <ul class="my-2 pl-6">
          <li class="mb-1 text-muted-color leading-relaxed">
            <strong>Google OAuth:</strong>
            {{ t("pages.legal.thirdParty.google") }}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary-color"
              >{{ t("pages.legal.thirdParty.googleLink") }}</a
            >
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            <strong>Cloudflare:</strong>
            {{ t("pages.legal.thirdParty.cloudflare") }}
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary-color"
              >{{ t("pages.legal.thirdParty.cloudflareLink") }}</a
            >
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            <strong>Umami:</strong>
            {{ t("pages.legal.thirdParty.umami") }}
            <a
              href="https://umami.is/privacy"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary-color"
              >{{ t("pages.legal.thirdParty.umamiLink") }}</a
            >
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            <strong>AWS:</strong>
            {{ t("pages.legal.thirdParty.aws") }}
            <a
              href="https://aws.amazon.com/privacy/"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary-color"
              >{{ t("pages.legal.thirdParty.awsLink") }}</a
            >
          </li>
        </ul>
      </section>

      <!-- Data retention -->
      <section class="mb-6 pb-4 border-b border-surface">
        <h2 class="mt-6 mb-2 text-[1.1rem] font-semibold text-color">
          {{ t("pages.legal.retention.title") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.retention.content") }}
        </p>
        <ul class="my-2 pl-6">
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.retention.account") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.retention.logs") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.retention.sessions") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.retention.contributions") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.retention.analytics") }}
          </li>
        </ul>
        <p class="mt-2 italic m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.retention.deletion") }}
        </p>
      </section>

      <!-- Cookies -->
      <section class="mb-6 pb-4 border-b border-surface">
        <h2 class="mt-6 mb-2 text-[1.1rem] font-semibold text-color">
          {{ t("pages.legal.cookies.title") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.cookies.content") }}
        </p>
        <ul class="my-2 pl-6">
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.cookies.sessionCookie") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.cookies.purpose") }}
          </li>
        </ul>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.cookies.noTracking") }}
        </p>
      </section>

      <!-- User content / Terms -->
      <section class="mb-6 pb-0">
        <h2 class="mt-6 mb-2 text-[1.1rem] font-semibold text-color">
          {{ t("pages.legal.userContent.title") }}
        </h2>
        <p class="m-0 text-muted-color leading-relaxed">
          {{ t("pages.legal.userContent.content") }}
        </p>
        <ul class="my-2 pl-6">
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.userContent.ownership") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.userContent.license") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.userContent.moderation") }}
          </li>
          <li class="mb-1 text-muted-color leading-relaxed">
            {{ t("pages.legal.userContent.forbidden") }}
          </li>
        </ul>
      </section>

      <p class="mt-8 text-[0.9rem] text-center text-muted-color m-0 leading-relaxed">
        {{ t("pages.legal.lastUpdated") }}: 26/08/2026
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

const router = useRouter();
const { t } = useI18n();
const email = "contact@urbanistmap.org";

function goHome() {
  router.push("/");
}
</script>
