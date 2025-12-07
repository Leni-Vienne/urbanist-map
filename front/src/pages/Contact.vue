<template>
  <div class="page-container">
    <div class="page-card">
      <Button icon="pi pi-arrow-left" :label="t('common.back')" severity="secondary" text @click="goHome" />

      <h1>{{ t('pages.contact.title') }}</h1>

      <p>{{ t('pages.contact.description') }}</p>

      <div class="contact-info">
        <a href="mailto:contact@constructionmap.org" class="contact-link">
          <i class="pi pi-envelope"></i>
          contact@constructionmap.org
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()

function goHome() {
  router.push('/')
}
</script>

<style scoped>
.page-container {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;
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
</style>
