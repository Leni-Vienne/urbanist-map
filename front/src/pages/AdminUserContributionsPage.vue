<template>
  <div class="p-8 max-w-[1200px] mx-auto h-full overflow-y-auto">
    <div class="flex items-center gap-4 mb-8">
      <Button
        icon="pi pi-arrow-left"
        class="shrink-0"
        severity="secondary"
        text
        @click="$router.push('/admin/reports')"
      />
      <h1 class="m-0 text-2xl font-semibold">{{ t("admin.userContributions.title") }}</h1>
    </div>

    <div v-if="isLoading" class="flex justify-center items-center min-h-[300px]">
      <ProgressSpinner />
    </div>

    <div v-else-if="errorRef" class="flex justify-center items-center min-h-[300px]">
      <Message severity="error" :closable="false">
        {{ t("admin.userContributions.messages.loadError") }}
      </Message>
    </div>

    <template v-else-if="data">
      <!-- AI : User header card -->
      <div class="flex items-center gap-8 p-6 bg-[var(--p-surface-50)] rounded-lg mb-8 flex-wrap">
        <div class="flex items-center gap-4">
          <i
            class="pi pi-user text-[2rem] p-4 rounded-full text-[var(--p-primary-600)] bg-[var(--p-primary-100)]"
          ></i>
          <div class="flex flex-col">
            <span class="text-xl font-semibold">{{ data.user.username ?? data.user.email }}</span>
            <span class="text-[var(--p-text-muted-color)] text-sm">{{ data.user.email }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 ml-auto">
          <Badge :value="data.user.approvedCount" severity="success" />
          <span>{{ t("common.approved") }}</span>
          <Badge :value="data.user.rejectedCount" severity="danger" />
          <span>{{ t("admin.userContributions.rejected") }}</span>
        </div>
        <Badge v-if="data.user.banned" severity="danger" class="ml-4">
          {{ t("admin.userContributions.banned") }}
        </Badge>
      </div>

      <!-- AI : Cities accordion -->
      <div v-if="data.cities.length === 0" class="flex justify-center items-center min-h-[300px]">
        <Message severity="info" :closable="false">
          {{ t("admin.userContributions.messages.noContributions") }}
        </Message>
      </div>

      <Accordion v-else class="mt-4">
        <AccordionPanel v-for="city in data.cities" :key="city.cityId" :value="String(city.cityId)">
          <AccordionHeader @click="loadCityDetails(city.cityId)">
            <div class="flex items-center gap-4 w-full">
              <span class="font-semibold">{{ city.cityName }}</span>
              <span class="text-[var(--p-text-muted-color)] text-sm">{{ city.countryCode }}</span>
              <div class="flex items-center gap-2 ml-auto text-sm">
                <Badge :value="city.projectCount" severity="secondary" />
                <span>{{ t("admin.userContributions.projects") }}</span>
                <Badge :value="city.overlayCount" severity="secondary" />
                <span>{{ t("admin.userContributions.overlays") }}</span>
              </div>
            </div>
          </AccordionHeader>
          <AccordionContent>
            <div v-if="loadingCity === city.cityId" class="flex justify-center p-8">
              <ProgressSpinner style="width: 30px; height: 30px" />
            </div>
            <div v-else-if="cityDetails[city.cityId]" class="flex flex-col gap-6">
              <!-- AI : Projects with their overlays grouped together -->
              <div
                v-for="project in cityDetails[city.cityId]?.projects"
                :key="project.id"
                class="bg-[var(--p-surface-50)] rounded-lg p-4"
              >
                <div
                  class="flex justify-between items-center mb-4 pb-3 border-b border-[var(--p-surface-200)]"
                >
                  <div class="flex items-center gap-3">
                    <span class="font-semibold text-base">{{ project.name }}</span>
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
                  class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3"
                >
                  <div
                    v-for="overlay in getOverlaysForProject(city.cityId, project.id)"
                    :key="overlay.id"
                    class="relative bg-[var(--p-surface-100)] rounded-lg overflow-hidden"
                  >
                    <img
                      :src="getThumbnailUrl(overlay.filename)"
                      :alt="overlay.caption ?? 'Overlay'"
                      class="w-full aspect-square object-cover"
                    />
                    <div class="p-2 flex flex-col gap-1">
                      <span class="text-xs truncate">{{
                        overlay.caption ?? t("admin.userContributions.noCaption")
                      }}</span>
                      <Badge
                        :value="overlay.status"
                        :severity="getStatusSeverity(overlay.status)"
                        class="self-start"
                      />
                    </div>
                    <Button
                      icon="pi pi-trash"
                      severity="danger"
                      size="small"
                      class="absolute top-2 right-2"
                      @click="confirmDeleteOverlay(overlay)"
                    />
                  </div>
                </div>
                <div v-else class="text-[var(--p-text-muted-color)] text-sm italic p-2">
                  {{ t("admin.userContributions.noOverlays") }}
                </div>
              </div>

              <div
                v-if="cityDetails[city.cityId]?.projects.length === 0"
                class="text-[var(--p-text-muted-color)] text-center p-8"
              >
                {{ t("admin.userContributions.messages.noContributions") }}
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </template>

    <!-- AI : Unified Delete Confirmation Dialog -->
    <Dialog
      v-model:visible="showDeleteDialog"
      :header="deleteDialogHeader"
      :modal="true"
      :style="{ width: '450px' }"
    >
      <div>
        <p>{{ deleteDialogMessage }}</p>
        <div class="mt-4">
          <label for="deleteReason" class="block mb-2 font-semibold">{{
            t("admin.userContributions.deleteDialog.reason")
          }}</label>
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
          @click="showDeleteDialog = false"
        />
        <Button
          :label="t('admin.userContributions.deleteDialog.confirm')"
          severity="danger"
          icon="pi pi-trash"
          :loading="isDeleting"
          @click="executeDelete"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from "vue";
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

const showDeleteDialog = ref(false);
const deleteTargetType = ref<"project" | "overlay" | null>(null);
const projectToDelete = ref<ProjectType | null>(null);
const overlayToDelete = ref<OverlayType | null>(null);
const deleteReason = ref("");
const isDeleting = ref(false);

const deleteDialogHeader = computed(() => {
  return deleteTargetType.value === "project"
    ? t("admin.userContributions.deleteProjectDialog.title")
    : t("admin.userContributions.deleteOverlayDialog.title");
});

const deleteDialogMessage = computed(() => {
  return deleteTargetType.value === "project"
    ? t("admin.userContributions.deleteProjectDialog.message", {
        name: projectToDelete.value?.name,
      })
    : t("admin.userContributions.deleteOverlayDialog.message");
});

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
  deleteTargetType.value = "project";
  deleteReason.value = "";
  showDeleteDialog.value = true;
}

// AI : Delete overlay confirmation
function confirmDeleteOverlay(overlay: OverlayType) {
  overlayToDelete.value = overlay;
  deleteTargetType.value = "overlay";
  deleteReason.value = "";
  showDeleteDialog.value = true;
}

// AI : Unified delete execution
async function executeDelete() {
  if (deleteTargetType.value === "project") {
    await adminDeleteProject();
  } else {
    await adminDeleteOverlay();
  }
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

    showDeleteDialog.value = false;
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

    showDeleteDialog.value = false;
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
