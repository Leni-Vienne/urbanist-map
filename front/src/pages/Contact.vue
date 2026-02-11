<template>
  <div class="page-container">
    <div class="page-card">
      <Button
        icon="pi pi-arrow-left"
        :label="t('common.back')"
        severity="secondary"
        text
        @click="goHome"
      />

      <h1>{{ t("common.contact") }}</h1>

      <p>{{ t("pages.contact.description") }}</p>

      <div class="contact-info">
        <a
          href="mailto:contact@urbanistmap.org"
          class="contact-link"
        >
          <i class="pi pi-envelope"></i>
          contact@urbanistmap.org
        </a>
      </div>

      <Divider />

      <div class="basemap-submission">
        <h2>{{ t("pages.contact.basemapTitle") }}</h2>
        <p>{{ t("pages.contact.basemapDescription") }}</p>
        <div class="example-box">
          <span class="example-label">{{ t("pages.contact.basemapExample") }}</span>
          <code>https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product/default/2025/3857/{z}/{x}/{y}.png</code>
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

<style scoped>
.page-container {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  height: 100vh;
  background: linear-gradient(135deg, var(--p-primary-50), var(--p-primary-100));
  padding: 40px 20px;
  overflow-y: auto;
}

.page-card {
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  max-width: 600px;
  width: 100%;
  text-align: center;
}

h1 {
  margin: 1.5rem 0 1rem;
  color: var(--p-text-color);
  font-size: 1.75rem;
}

p {
  color: var(--p-text-muted-color);
  line-height: 1.6;
  margin: 0 0 1.5rem;
}

.contact-info {
  margin-top: 1rem;
}

.contact-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--p-primary-color);
  text-decoration: none;
  font-size: 1.1rem;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  background: var(--p-primary-50);
  transition: background 0.2s;
}

.contact-link:hover {
  background: var(--p-primary-100);
}

.basemap-submission {
  margin-top: 2rem;
  text-align: left;
}

h2 {
  font-size: 1.25rem;
  margin-bottom: 0.75rem;
  color: var(--p-text-color);
}

.example-box {
  margin-top: 1rem;
  padding: 1.25rem;
  background: var(--p-surface-900);
  border-radius: 8px;
  border: 1px solid var(--p-surface-700);
  word-break: break-all;
  position: relative;
  overflow: hidden;
}

.example-box::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: var(--p-primary-500);
}

.example-label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: var(--p-surface-0);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

code {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.8rem;
  color: var(--p-primary-300);
  background: rgba(var(--p-primary-500-rgb), 0.1);
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  line-height: 1.5;
  display: block;
}
</style>
