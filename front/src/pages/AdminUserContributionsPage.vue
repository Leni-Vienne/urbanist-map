<template>
  <div class="admin-user-contributions-page">
    <div class="page-header">
      <Button
        icon="pi pi-arrow-left"
        class="back-button"
        severity="secondary"
        text
        @click="$router.push('/admin/reports')"
      />
      <h1>{{ t("admin.userContributions.title") }}</h1>
    </div>

    <div v-if="isLoading" class="loading-container">
      <ProgressSpinner />
    </div>

    <div v-else-if="errorRef" class="error-container">
      <Message severity="error" :closable="false">
        {{ t("admin.userContributions.messages.loadError") }}
      </Message>
    </div>

    <template v-else-if="data">
      <!-- AI : User header card -->
      <div class="user-header-card">
        <div class="user-info">
          <i class="pi pi-user user-icon"></i>
          <div class="user-details">
            <span class="username">{{ data.user.username ?? data.user.email }}</span>
            <span class="email">{{ data.user.email }}</span>
          </div>
        </div>
        <div class="user-stats">
          <Badge :value="data.user.approvedCount" severity="success" />
          <span>{{ t("common.approved") }}</span>
          <Badge :value="data.user.rejectedCount" severity="danger" />
          <span>{{ t("admin.userContributions.rejected") }}</span>
        </div>
        <Badge v-if="data.user.banned" severity="danger" class="banned-badge">
          {{ t("admin.userContributions.banned") }}
        </Badge>
      </div>

      <!-- AI : Cities accordion -->
      <div v-if="data.cities.length === 0" class="empty-container">
        <Message severity="info" :closable="false">
          {{ t("admin.userContributions.messages.noContributions") }}
        </Message>
      </div>

      <Accordion v-else class="cities-accordion">
        <AccordionPanel v-for="city in data.cities" :key="city.cityId" :value="String(city.cityId)">
          <AccordionHeader @click="loadCityDetails(city.cityId)">
            <div class="city-header">
              <span class="city-name">{{ city.cityName }}</span>
              <span class="country-code">{{ city.countryCode }}</span>
              <div class="city-counts">
                <Badge :value="city.projectCount" severity="secondary" />
                <span>{{ t("admin.userContributions.projects") }}</span>
                <Badge :value="city.overlayCount" severity="secondary" />
                <span>{{ t("admin.userContributions.overlays") }}</span>
              </div>
            </div>
          </AccordionHeader>
          <AccordionContent>
            <div v-if="loadingCity === city.cityId" class="city-loading">
              <ProgressSpinner style="width: 30px; height: 30px" />
            </div>
            <div v-else-if="cityDetails[city.cityId]" class="city-details">
              <!-- AI : Projects with their overlays grouped together -->
              <div
                v-for="project in cityDetails[city.cityId]?.projects"
                :key="project.id"
                class="project-section"
              >
                <div class="project-header">
                  <div class="project-info">
                    <span class="project-name">{{ project.name }}</span>
                    <Badge :value="project.status" :severity="getStatusSeverity(project.status)" />
                  </div>
                  <Button
                    icon="pi pi-trash"
                    severity="danger"
                    size="small"
                    outlined
                    v-tooltip.top="t('admin.userContributions.deleteProjectDialog.title')"
                    @click="confirmDeleteProject(project)"
                  />
                </div>

                <!-- AI : Overlays for this project -->
                <div
                  v-if="getOverlaysForProject(city.cityId, project.id).length > 0"
                  class="project-overlays"
                >
                  <div
                    v-for="overlay in getOverlaysForProject(city.cityId, project.id)"
                    :key="overlay.id"
                    class="overlay-card"
                  >
                    <img
                      :src="getThumbnailUrl(overlay.filename)"
                      :alt="overlay.caption ?? 'Overlay'"
                      class="overlay-thumbnail"
                    />
                    <div class="overlay-info">
                      <span class="overlay-caption">{{
                        overlay.caption ?? t("admin.userContributions.noCaption")
                      }}</span>
                      <Badge
                        :value="overlay.status"
                        :severity="getStatusSeverity(overlay.status)"
                        class="overlay-status"
                      />
                    </div>
                    <Button
                      icon="pi pi-trash"
                      severity="danger"
                      size="small"
                      class="delete-btn"
                      @click="confirmDeleteOverlay(overlay)"
                    />
                  </div>
                </div>
                <div v-else class="no-overlays">
                  {{ t("admin.userContributions.noOverlays") }}
                </div>
              </div>

              <div v-if="cityDetails[city.cityId]?.projects.length === 0" class="empty-city">
                {{ t("admin.userContributions.messages.noContributions") }}
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </template>

    <!-- AI : Delete Project Confirmation Dialog -->
    <Dialog
      v-model:visible="showDeleteProjectDialog"
      :header="t('admin.userContributions.deleteProjectDialog.title')"
      :modal="true"
      :style="{ width: '450px' }"
    >
      <div class="delete-dialog-content">
        <p>
          {{
            t("admin.userContributions.deleteProjectDialog.message", {
              name: projectToDelete?.name,
            })
          }}
        </p>
        <div class="field">
          <label for="deleteReason">{{ t("admin.userContributions.deleteDialog.reason") }}</label>
          <Textarea
            id="deleteReason"
            v-model="deleteReason"
            :placeholder="t('admin.userContributions.deleteDialog.reasonPlaceholder')"
            :autoResize="true"
            rows="2"
            class="w-full"
          />
        </div>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          @click="showDeleteProjectDialog = false"
        />
        <Button
          :label="t('admin.userContributions.deleteDialog.confirm')"
          severity="danger"
          icon="pi pi-trash"
          :loading="isDeleting"
          @click="adminDeleteProject"
        />
      </template>
    </Dialog>

    <!-- AI : Delete Overlay Confirmation Dialog -->
    <Dialog
      v-model:visible="showDeleteOverlayDialog"
      :header="t('admin.userContributions.deleteOverlayDialog.title')"
      :modal="true"
      :style="{ width: '450px' }"
    >
      <div class="delete-dialog-content">
        <p>{{ t("admin.userContributions.deleteOverlayDialog.message") }}</p>
        <div class="field">
          <label for="deleteReason2">{{ t("admin.userContributions.deleteDialog.reason") }}</label>
          <Textarea
            id="deleteReason2"
            v-model="deleteReason"
            :placeholder="t('admin.userContributions.deleteDialog.reasonPlaceholder')"
            :autoResize="true"
            rows="2"
            class="w-full"
          />
        </div>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          @click="showDeleteOverlayDialog = false"
        />
        <Button
          :label="t('admin.userContributions.deleteDialog.confirm')"
          severity="danger"
          icon="pi pi-trash"
          :loading="isDeleting"
          @click="adminDeleteOverlay"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "primevue/usetoast";
import { trpc, type RouterOutput } from "@/client";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { getStatusSeverity } from "@/utils/statusHelpers";

type UserContributions = RouterOutput["admin"]["adminGetUserContributions"];
type CityDetails = NonNullable<UserContributions["cityDetails"]>;
type ProjectType = CityDetails["projects"][number];
type OverlayType = CityDetails["overlays"][number];

const route = useRoute();
const { t } = useI18n();
const toast = useToast();

const userId = route.params.userId as string;

const data = ref<UserContributions | null>(null);
const isLoading = ref(true);
const errorRef = ref(false);
const loadingCity = ref<number | null>(null);
const cityDetails = reactive<Record<number, { projects: ProjectType[]; overlays: OverlayType[] }>>(
  {},
);

const showDeleteProjectDialog = ref(false);
const showDeleteOverlayDialog = ref(false);
const projectToDelete = ref<ProjectType | null>(null);
const overlayToDelete = ref<OverlayType | null>(null);
const deleteReason = ref("");
const isDeleting = ref(false);

// AI : Load initial user data with city summary
async function loadUserContributions() {
  try {
    isLoading.value = true;
    errorRef.value = false;
    data.value = await trpc.admin.adminGetUserContributions.query({ userId });
  } catch (error) {
    console.error("Error loading user contributions:", error);
    errorRef.value = true;
  } finally {
    isLoading.value = false;
  }
}

// AI : Load city details when accordion is expanded
async function loadCityDetails(cityId: number) {
  // AI : Skip if already loaded
  if (cityDetails[cityId]) return;

  try {
    loadingCity.value = cityId;
    const result = await trpc.admin.adminGetUserContributions.query({ userId, cityId });
    if (result.cityDetails) {
      cityDetails[cityId] = result.cityDetails;
    }
  } catch (error) {
    console.error("Error loading city details:", error);
    toast.add({
      severity: "error",
      summary: t("admin.userContributions.messages.loadError"),
      life: 5000,
    });
  } finally {
    loadingCity.value = null;
  }
}

// AI : Get overlays for a specific project
function getOverlaysForProject(cityId: number, projectId: string): OverlayType[] {
  const details = cityDetails[cityId];
  if (!details) return [];
  return details.overlays.filter((o) => o.projectId === projectId);
}

// AI : Get thumbnail URL for an overlay
function getThumbnailUrl(filename: string): string {
  // AI : Force backend URL for pending images that aren't on R2 yet
  return buildThumbnailUrl(filename, true);
}

// AI : Delete project confirmation
function confirmDeleteProject(project: ProjectType) {
  projectToDelete.value = project;
  deleteReason.value = "";
  showDeleteProjectDialog.value = true;
}

// AI : Delete overlay confirmation
function confirmDeleteOverlay(overlay: OverlayType) {
  overlayToDelete.value = overlay;
  deleteReason.value = "";
  showDeleteOverlayDialog.value = true;
}

// AI : Execute project deletion and remove from UI (admin-specific)
async function adminDeleteProject() {
  if (!projectToDelete.value) return;

  const projectId = projectToDelete.value.id;

  try {
    isDeleting.value = true;
    await trpc.admin.deleteProject.mutate({
      projectId,
      reason: deleteReason.value || undefined,
    });

    // AI : Remove project and its overlays from all city details and update counts
    for (const cityId of Object.keys(cityDetails)) {
      const details = cityDetails[Number(cityId)];
      if (details) {
        // AI : Count overlays being deleted for this project
        const overlaysDeleted = details.overlays.filter((o) => o.projectId === projectId).length;

        details.projects = details.projects.filter((p) => p.id !== projectId);
        details.overlays = details.overlays.filter((o) => o.projectId !== projectId);

        // AI : Update city summary counts in the accordion header
        const city = data.value?.cities.find((c) => c.cityId === Number(cityId));
        if (city) {
          city.projectCount -= 1;
          city.overlayCount -= overlaysDeleted;
        }
      }
    }

    toast.add({
      severity: "success",
      summary: t("admin.userContributions.messages.projectDeleted"),
      life: 5000,
    });

    showDeleteProjectDialog.value = false;
  } catch (error) {
    console.error("Error deleting project:", error);
    toast.add({
      severity: "error",
      summary: t("admin.userContributions.messages.deleteError"),
      life: 5000,
    });
  } finally {
    isDeleting.value = false;
  }
}

// AI : Execute overlay deletion and remove from UI (admin-specific)
async function adminDeleteOverlay() {
  if (!overlayToDelete.value) return;

  const overlayId = overlayToDelete.value.id;

  try {
    isDeleting.value = true;
    await trpc.moderation.adminDeleteOverlay.mutate({
      id: overlayId,
      reason: deleteReason.value || undefined,
    });

    // AI : Remove overlay from all city details and update counts
    for (const cityId of Object.keys(cityDetails)) {
      const details = cityDetails[Number(cityId)];
      if (details) {
        const hadOverlay = details.overlays.some((o) => o.id === overlayId);
        details.overlays = details.overlays.filter((o) => o.id !== overlayId);

        // AI : Update city summary count in the accordion header
        if (hadOverlay) {
          const city = data.value?.cities.find((c) => c.cityId === Number(cityId));
          if (city) {
            city.overlayCount -= 1;
          }
        }
      }
    }

    toast.add({
      severity: "success",
      summary: t("admin.userContributions.messages.overlayDeleted"),
      life: 5000,
    });

    showDeleteOverlayDialog.value = false;
  } catch (error) {
    console.error("Error deleting overlay:", error);
    toast.add({
      severity: "error",
      summary: t("admin.userContributions.messages.deleteError"),
      life: 5000,
    });
  } finally {
    isDeleting.value = false;
  }
}

onMounted(() => {
  loadUserContributions();
});
</script>

<style scoped>
.admin-user-contributions-page {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  height: 100vh;
  overflow-y: auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}

.page-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.back-button {
  flex-shrink: 0;
}

.loading-container,
.error-container,
.empty-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
}

.user-header-card {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 1.5rem;
  background: var(--p-surface-50);
  border-radius: 8px;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-icon {
  font-size: 2rem;
  color: var(--p-primary-600);
  background: var(--p-primary-100);
  padding: 1rem;
  border-radius: 50%;
}

.user-details {
  display: flex;
  flex-direction: column;
}

.username {
  font-size: 1.25rem;
  font-weight: 600;
}

.email {
  color: var(--p-text-secondary);
  font-size: 0.875rem;
}

.user-stats {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.banned-badge {
  margin-left: 1rem;
}

.cities-accordion {
  margin-top: 1rem;
}

.city-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

.city-name {
  font-weight: 600;
}

.country-code {
  color: var(--p-text-secondary);
  font-size: 0.875rem;
}

.city-counts {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  font-size: 0.875rem;
}

.city-loading {
  display: flex;
  justify-content: center;
  padding: 2rem;
}

.city-details {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* AI : Project section with grouped overlays */
.project-section {
  background: var(--p-surface-50);
  border-radius: 8px;
  padding: 1rem;
}

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--p-surface-200);
}

.project-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.project-name {
  font-weight: 600;
  font-size: 1rem;
}

/* AI : Overlays grid within project */
.project-overlays {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.75rem;
}

.overlay-card {
  position: relative;
  background: var(--p-surface-100);
  border-radius: 8px;
  overflow: hidden;
}

.overlay-thumbnail {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.overlay-info {
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.overlay-caption {
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.overlay-status {
  align-self: flex-start;
}

.delete-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}

.no-overlays {
  color: var(--p-text-secondary);
  font-size: 0.875rem;
  font-style: italic;
  padding: 0.5rem;
}

.empty-city {
  color: var(--p-text-secondary);
  text-align: center;
  padding: 2rem;
}

.delete-dialog-content .field {
  margin-top: 1rem;
}

.delete-dialog-content label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
}
</style>
