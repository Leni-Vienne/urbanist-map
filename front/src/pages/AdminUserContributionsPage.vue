<template>
  <div class="p-8 max-w-300 mx-auto h-full overflow-y-auto">
    <div class="flex items-center gap-4 mb-8">
      <Button
        icon="pi pi-arrow-left"
        class="shrink-0"
        severity="secondary"
        text
        @click="$router.push('/admin/reports')"
      />
      <h1 class="m-0 text-2xl font-semibold">
        {{ t("admin.userContributions.title") }}
      </h1>
    </div>

    <div v-if="isLoading" class="flex justify-center items-center min-h-75">
      <ProgressSpinner />
    </div>

    <div v-else-if="errorRef" class="flex justify-center items-center min-h-75">
      <Message severity="error" :closable="false">
        {{ t("admin.userContributions.messages.loadError") }}
      </Message>
    </div>

    <template v-else-if="data">
      <!-- User header card -->
      <div
        class="flex items-center gap-8 p-6 bg-(--p-content-hover-background) rounded-lg mb-8 flex-wrap"
      >
        <div class="flex items-center gap-4">
          <i
            class="pi pi-user text-[2rem] p-4 rounded-full text-primary-color bg-[color-mix(in_srgb,var(--p-primary-color)_12%,transparent)]"
          ></i>
          <div class="flex flex-col">
            <span class="text-xl font-semibold">{{ data.user.username ?? data.user.email }}</span>
            <span class="text-muted-color text-sm">{{ data.user.email }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 ml-auto">
          <Badge :value="data.user.approvedCount" severity="success" />
          <span>{{ t("common.approved") }}</span>
          <Badge :value="data.user.rejectedCount" severity="danger" />
          <span>{{ t("approvalStatus.rejected") }}</span>
        </div>
        <Badge v-if="data.user.banned" severity="danger" class="ml-4">
          {{ t("admin.userContributions.banned") }}
        </Badge>
      </div>

      <!-- Countries accordion -->
      <div v-if="data.countries.length === 0" class="flex justify-center items-center min-h-75">
        <Message severity="info" :closable="false">
          {{ t("admin.userContributions.messages.noContributions") }}
        </Message>
      </div>

      <Accordion v-else class="mt-4">
        <AccordionPanel
          v-for="country in data.countries"
          :key="country.countryCode"
          :value="country.countryCode ?? ''"
        >
          <AccordionHeader>
            <div
              class="flex items-center gap-4 w-full"
              @click="loadCountryDetails(country.countryCode)"
            >
              <span class="font-semibold">{{ country.countryName ?? country.countryCode }}</span>
              <span class="text-muted-color text-sm">{{ country.countryCode }}</span>
              <div class="flex items-center gap-2 ml-auto text-sm">
                <Badge :value="country.projectCount" severity="secondary" />
                <span>{{ t("admin.userContributions.projects") }}</span>
                <Badge :value="country.overlayCount" severity="secondary" />
                <span>{{ t("admin.userContributions.overlays") }}</span>
              </div>
            </div>
          </AccordionHeader>
          <AccordionContent>
            <div v-if="loadingCountry === country.countryCode" class="flex justify-center p-8">
              <ProgressSpinner style="width: 30px; height: 30px" />
            </div>
            <div
              v-else-if="country.countryCode && countryDetails[country.countryCode]"
              class="flex flex-col gap-6"
            >
              <!-- Projects with their overlays grouped together -->
              <div
                v-for="project in countryDetails[country.countryCode]?.projects"
                :key="project.id"
                class="bg-(--p-content-hover-background) rounded-lg p-4"
              >
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-surface">
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

                <!-- Overlays for this project -->
                <div
                  v-if="getOverlaysForProject(country.countryCode, project.id).length > 0"
                  class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3"
                >
                  <div
                    v-for="overlay in getOverlaysForProject(country.countryCode, project.id)"
                    :key="overlay.id"
                    class="relative bg-(--p-content-hover-background) rounded-lg overflow-hidden"
                  >
                    <img
                      :src="getThumbnailUrl(overlay.filename)"
                      :alt="overlay.caption ?? t('overlay.imageAlt')"
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
                <div v-else class="text-muted-color text-sm italic p-2">
                  {{ t("admin.userContributions.noOverlays") }}
                </div>
              </div>

              <div
                v-if="countryDetails[country.countryCode]?.projects.length === 0"
                class="text-muted-color text-center p-8"
              >
                {{ t("admin.userContributions.messages.noContributions") }}
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </template>

    <!-- Unified Delete Confirmation Dialog -->
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
            dir="auto"
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
import { toastError, toastSuccess } from "@/services/core/toast";

import { ref, onMounted, reactive, computed } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";

import { trpc, type RouterOutput } from "@/client";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { getStatusSeverity } from "@/utils/statusHelpers";

type UserContributions = RouterOutput["admin"]["adminGetUserContributions"];
type CountryDetails = NonNullable<UserContributions["countryDetails"]>;
type ProjectType = CountryDetails["projects"][number];
type OverlayType = CountryDetails["overlays"][number];

const route = useRoute();
const { t } = useI18n();

const userId = route.params.userId as string;

const data = ref<UserContributions | null>(null);
const isLoading = ref(true);
const errorRef = ref(false);
const loadingCountry = ref<string | null>(null);
const countryDetails = reactive<
  Record<string, { projects: ProjectType[]; overlays: OverlayType[] }>
>({});

const showDeleteDialog = ref(false);
const deleteTargetType = ref<"project" | "overlay" | null>(null);
const projectToDelete = ref<ProjectType | null>(null);
let overlayToDelete: OverlayType | null = null;
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

async function loadUserContributions() {
  isLoading.value = true;
  errorRef.value = false;
  try {
    data.value = await trpc.admin.adminGetUserContributions.query({
      userId,
    });
  } catch (error) {
    console.error("Error loading user contributions:", error);
    errorRef.value = true;
    toastError(
      error instanceof Error ? error.message : undefined,
      t("admin.userContributions.messages.loadError"),
    );
  } finally {
    isLoading.value = false;
  }
}

async function loadCountryDetails(countryCode: string | null) {
  if (!countryCode || countryDetails[countryCode]) return;

  loadingCountry.value = countryCode;
  try {
    const result = await trpc.admin.adminGetUserContributions.query({
      userId,
      countryCode,
    });
    if (result.countryDetails) {
      countryDetails[countryCode] = result.countryDetails;
    }
  } catch (error) {
    console.error("Error loading country details:", error);
    toastError(
      error instanceof Error ? error.message : undefined,
      t("admin.userContributions.messages.loadError"),
    );
  } finally {
    loadingCountry.value = null;
  }
}

function getOverlaysForProject(countryCode: string | null, projectId: string): OverlayType[] {
  if (!countryCode) return [];
  const details = countryDetails[countryCode];
  if (!details) return [];
  return details.overlays.filter((o) => o.projectId === projectId);
}

function getThumbnailUrl(filename: string): string {
  // Force backend URL for pending images that aren't on R2 yet
  return buildThumbnailUrl(filename, true);
}

function confirmDeleteProject(project: ProjectType) {
  projectToDelete.value = project;
  deleteTargetType.value = "project";
  deleteReason.value = "";
  showDeleteDialog.value = true;
}

function confirmDeleteOverlay(overlay: OverlayType) {
  overlayToDelete = overlay;
  deleteTargetType.value = "overlay";
  deleteReason.value = "";
  showDeleteDialog.value = true;
}

async function executeDelete() {
  if (deleteTargetType.value === "project") {
    await adminDeleteProject();
  } else {
    await adminDeleteOverlay();
  }
}

async function adminDeleteProject() {
  if (!projectToDelete.value) return;

  const projectId = projectToDelete.value.id;

  isDeleting.value = true;
  try {
    await trpc.admin.deleteProject.mutate({
      projectId,
      reason: deleteReason.value || undefined,
    });

    // Remove project and its overlays from all country details and update counts
    for (const countryCode of Object.keys(countryDetails)) {
      const details = countryDetails[countryCode];
      if (details) {
        // Count overlays being deleted for this project
        const overlaysDeleted = details.overlays.filter((o) => o.projectId === projectId).length;

        details.projects = details.projects.filter((p) => p.id !== projectId);
        details.overlays = details.overlays.filter((o) => o.projectId !== projectId);

        // Update country summary counts in the accordion header
        const country = data.value?.countries.find((c) => c.countryCode === countryCode);
        if (country) {
          country.projectCount -= 1;
          country.overlayCount -= overlaysDeleted;
        }
      }
    }

    toastSuccess(t("admin.userContributions.messages.projectDeleted"));

    showDeleteDialog.value = false;
  } catch (error) {
    console.error("Error deleting project:", error);
    toastError(
      error instanceof Error ? error.message : undefined,
      t("admin.userContributions.messages.deleteError"),
    );
  } finally {
    isDeleting.value = false;
  }
}

async function adminDeleteOverlay() {
  if (!overlayToDelete) return;

  const overlayId = overlayToDelete.id;

  isDeleting.value = true;
  try {
    await trpc.moderation.adminDeleteOverlay.mutate({
      id: overlayId,
      reason: deleteReason.value || undefined,
    });

    // Remove overlay from all country details and update counts
    for (const countryCode of Object.keys(countryDetails)) {
      const details = countryDetails[countryCode];
      if (details) {
        const hadOverlay = details.overlays.some((o) => o.id === overlayId);
        details.overlays = details.overlays.filter((o) => o.id !== overlayId);

        // Update country summary count in the accordion header
        if (hadOverlay) {
          const country = data.value?.countries.find((c) => c.countryCode === countryCode);
          if (country) {
            country.overlayCount -= 1;
          }
        }
      }
    }

    toastSuccess(t("admin.userContributions.messages.overlayDeleted"));

    showDeleteDialog.value = false;
  } catch (error) {
    console.error("Error deleting overlay:", error);
    toastError(
      error instanceof Error ? error.message : undefined,
      t("admin.userContributions.messages.deleteError"),
    );
  } finally {
    isDeleting.value = false;
  }
}

onMounted(() => {
  loadUserContributions();
});
</script>
