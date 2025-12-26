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

      <h1>{{ t('pages.legal.title') }}</h1>

      <!-- AI : Publisher identity - required by French law -->
      <section>
        <h2>{{ t('pages.legal.publisher.title') }}</h2>
        <p>{{ t('pages.legal.publisher.content') }}</p>
        <ul>
          <li>
            <strong>{{ t('pages.legal.publisher.name') }}:</strong> Léni Vienne
          </li>
          <li>
            <strong>{{ t('pages.legal.publisher.email') }}:</strong> contact@constructionmap.org
          </li>
        </ul>
      </section>

      <!-- AI : Data collection -->
      <section>
        <h2>{{ t('pages.legal.dataCollection.title') }}</h2>
        <p>{{ t('pages.legal.dataCollection.content') }}</p>
        <ul>
          <li>{{ t('pages.legal.dataCollection.username') }}</li>
          <li>{{ t('pages.legal.dataCollection.email') }}</li>
          <li>{{ t('pages.legal.dataCollection.password') }}</li>
          <li>{{ t('pages.legal.dataCollection.ipAddresses') }}</li>
          <li>{{ t('pages.legal.dataCollection.oauthData') }}</li>
        </ul>
        <p class="legal-basis">{{ t('pages.legal.dataCollection.legalBasis') }}</p>
      </section>

      <!-- AI : GDPR user rights -->
      <section>
        <h2>{{ t('pages.legal.rights.title') }}</h2>
        <p>{{ t('pages.legal.rights.content') }}</p>
        <ul>
          <li>{{ t('pages.legal.rights.access') }}</li>
          <li>{{ t('pages.legal.rights.rectification') }}</li>
          <li>{{ t('pages.legal.rights.deletion') }}</li>
          <li>{{ t('pages.legal.rights.portability') }}</li>
        </ul>
        <p>{{ t('pages.legal.rights.howTo') }}</p>
        <p class="legal-basis">
          <strong>{{ t('pages.legal.rights.note') }}</strong>
        </p>
      </section>

      <!-- AI : Third-party services -->
      <section>
        <h2>{{ t('pages.legal.thirdParty.title') }}</h2>
        <p>{{ t('pages.legal.thirdParty.content') }}</p>
        <ul>
          <li>
            <strong>Google OAuth:</strong> {{ t('pages.legal.thirdParty.google') }}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener"
              >{{ t('pages.legal.thirdParty.googleLink') }}</a
            >
          </li>
          <li>
            <strong>Cloudflare:</strong> {{ t('pages.legal.thirdParty.cloudflare') }}
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener"
              >{{ t('pages.legal.thirdParty.cloudflareLink') }}</a
            >
          </li>
          <li>
            <strong>AWS:</strong> {{ t('pages.legal.thirdParty.aws') }}
            <a
              href="https://aws.amazon.com/privacy/"
              target="_blank"
              rel="noopener"
              >{{ t('pages.legal.thirdParty.awsLink') }}</a
            >
          </li>
        </ul>
      </section>

      <!-- AI : Data retention -->
      <section>
        <h2>{{ t('pages.legal.retention.title') }}</h2>
        <p>{{ t('pages.legal.retention.content') }}</p>
        <ul>
          <li>{{ t('pages.legal.retention.account') }}</li>
          <li>{{ t('pages.legal.retention.logs') }}</li>
          <li>{{ t('pages.legal.retention.sessions') }}</li>
          <li>{{ t('pages.legal.retention.contributions') }}</li>
        </ul>
        <p class="legal-basis">{{ t('pages.legal.retention.deletion') }}</p>
      </section>

      <!-- AI : Cookies -->
      <section>
        <h2>{{ t('pages.legal.cookies.title') }}</h2>
        <p>{{ t('pages.legal.cookies.content') }}</p>
        <ul>
          <li>{{ t('pages.legal.cookies.sessionCookie') }}</li>
          <li>{{ t('pages.legal.cookies.purpose') }}</li>
        </ul>
        <p>{{ t('pages.legal.cookies.noTracking') }}</p>
      </section>

      <!-- AI : User content / Terms -->
      <section>
        <h2>{{ t('pages.legal.userContent.title') }}</h2>
        <p>{{ t('pages.legal.userContent.content') }}</p>
        <ul>
          <li>{{ t('pages.legal.userContent.ownership') }}</li>
          <li>{{ t('pages.legal.userContent.license') }}</li>
          <li>{{ t('pages.legal.userContent.moderation') }}</li>
          <li>{{ t('pages.legal.userContent.forbidden') }}</li>
        </ul>
      </section>

      <p class="last-updated">{{ t('pages.legal.lastUpdated') }}: 22/11/2025</p>
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
  max-width: 700px;
  width: 100%;
}

h1 {
  margin: 1.5rem 0 1rem;
  color: var(--p-text-color);
  font-size: 1.75rem;
}

h2 {
  margin: 1.5rem 0 0.5rem;
  color: var(--p-text-color);
  font-size: 1.1rem;
}

section {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--p-surface-200);
}

section:last-of-type {
  border-bottom: none;
}

p,
li {
  color: var(--p-text-muted-color);
  line-height: 1.6;
  margin: 0;
}

ul {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

li {
  margin-bottom: 0.25rem;
}

a {
  color: var(--p-primary-color);
}

.legal-basis {
  margin-top: 0.5rem;
  font-style: italic;
}

.last-updated {
  margin-top: 2rem;
  font-size: 0.9rem;
  text-align: center;
  color: var(--p-text-muted-color);
}
</style>
