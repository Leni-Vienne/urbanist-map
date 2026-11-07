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

    <div v-if="loadState === 'loading'" class="flex justify-center items-center min-h-75">
      <ProgressSpinner />
    </div>

    <div v-else-if="loadState === 'error'" class="flex justify-center items-center min-h-75">
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
            <div
              v-if="country.countryCode && loadingCountries.has(country.countryCode)"
              class="flex justify-center p-8"
            >
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
                    :disabled="isDeleting"
                    @click="confirmDeleteProject(project, country.countryCode)"
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
                      :disabled="isDeleting"
                      @click="confirmDeleteOverlay(overlay, country.countryCode)"
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

    <Dialog
      v-if="deleteDialog"
      :visible="true"
      @update:visible="!$event && closeDeleteDialog()"
      :closable="!isDeleting"
      :close-on-escape="!isDeleting"
      :header="deleteDialogHeader"
      :modal="true"
      :style="{ width: '450px' }"
    >
      <p>{{ deleteDialogMessage }}</p>
      <div class="mt-4">
        <label for="deleteReason" class="block mb-2 font-semibold">{{
          t("admin.userContributions.deleteDialog.reason")
        }}</label>
        <Textarea
          id="deleteReason"
          v-model="deleteDialog.reason"
          :disabled="isDeleting"
          :placeholder="t('admin.userContributions.deleteDialog.reasonPlaceholder')"
          :autoResize="true"
          rows="2"
          class="w-full"
          dir="auto"
        />
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          :disabled="isDeleting"
          @click="closeDeleteDialog"
        />
        <Button
          :label="t('admin.userContributions.deleteDialog.confirm')"
          severity="danger"
          icon="pi pi-trash"
          :loading="isDeleting"
          :disabled="isDeleting"
          @click="executeDelete"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { toastError, toastSuccess } from "@/services/core/toast";

import { ref, reactive, computed, watch, onScopeDispose } from "vue";
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

const userId = computed(() => String(route.params.userId));

const data = ref<UserContributions | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const loadingCountries = reactive(new Set<string>());
const countryDetails = ref<Record<string, CountryDetails>>({});

type DeleteTarget =
  | { kind: "project"; project: ProjectType }
  | { kind: "overlay"; overlay: OverlayType };
const deleteDialog = ref<{
  target: DeleteTarget;
  countryCode: string;
  reason: string;
  phase: "confirming" | "submitting";
} | null>(null);
const isDeleting = computed(() => deleteDialog.value?.phase === "submitting");
let pageRequests = new AbortController();
onScopeDispose(() => pageRequests.abort());

const deleteDialogHeader = computed(() => {
  return deleteDialog.value?.target.kind === "project"
    ? t("admin.userContributions.deleteProjectDialog.title")
    : t("admin.userContributions.deleteOverlayDialog.title");
});

const deleteDialogMessage = computed(() => {
  const target = deleteDialog.value?.target;
  return target?.kind === "project"
    ? t("admin.userContributions.deleteProjectDialog.message", {
        name: target.project.name,
      })
    : t("admin.userContributions.deleteOverlayDialog.message");
});

async function loadUserContributions() {
  const page = pageRequests;
  try {
    const result = await trpc.admin.adminGetUserContributions.query(
      { userId: userId.value },
      { signal: page.signal },
    );
    if (page.signal.aborted) return;
    data.value = result;
    loadState.value = "ready";
  } catch (error) {
    if (page.signal.aborted) return;
    console.error("Error loading user contributions:", error);
    loadState.value = "error";
    toastError(
      error instanceof Error ? error.message : undefined,
      t("admin.userContributions.messages.loadError"),
    );
  }
}

async function loadCountryDetails(countryCode: string | null) {
  if (!countryCode || countryDetails.value[countryCode] || loadingCountries.has(countryCode))
    return;

  const page = pageRequests;
  loadingCountries.add(countryCode);
  try {
    const result = await trpc.admin.adminGetUserContributions.query(
      {
        userId: userId.value,
        countryCode,
      },
      { signal: page.signal },
    );
    if (page.signal.aborted) return;
    if (result.countryDetails) {
      countryDetails.value[countryCode] = result.countryDetails;
    }
  } catch (error) {
    if (page.signal.aborted) return;
    console.error("Error loading country details:", error);
    toastError(
      error instanceof Error ? error.message : undefined,
      t("admin.userContributions.messages.loadError"),
    );
  } finally {
    if (!page.signal.aborted) loadingCountries.delete(countryCode);
  }
}

function getOverlaysForProject(countryCode: string | null, projectId: string): OverlayType[] {
  if (!countryCode) return [];
  const details = countryDetails.value[countryCode];
  if (!details) return [];
  return details.overlays.filter((o) => o.projectId === projectId);
}

function getThumbnailUrl(filename: string): string {
  // Force backend URL for pending images that aren't on R2 yet
  return buildThumbnailUrl(filename, true);
}

function confirmDeleteProject(project: ProjectType, countryCode: string) {
  if (isDeleting.value) return;
  deleteDialog.value = {
    target: { kind: "project", project },
    countryCode,
    reason: "",
    phase: "confirming",
  };
}

function confirmDeleteOverlay(overlay: OverlayType, countryCode: string) {
  if (isDeleting.value) return;
  deleteDialog.value = {
    target: { kind: "overlay", overlay },
    countryCode,
    reason: "",
    phase: "confirming",
  };
}

function closeDeleteDialog() {
  if (!isDeleting.value) deleteDialog.value = null;
}

async function executeDelete() {
  const dialog = deleteDialog.value;
  const page = pageRequests;
  if (!dialog || dialog.phase !== "confirming" || page.signal.aborted) return;
  dialog.phase = "submitting";
  const { target, countryCode } = dialog;
  try {
    const reason = dialog.reason || undefined;
    if (target.kind === "project") {
      await trpc.admin.deleteProject.mutate({ projectId: target.project.id, reason });
    } else {
      await trpc.moderation.adminDeleteOverlay.mutate({ id: target.overlay.id, reason });
    }
    if (page.signal.aborted || deleteDialog.value !== dialog) return;

    const details = countryDetails.value[countryCode];
    const country = data.value?.countries.find((item) => item.countryCode === countryCode);
    if (details && country) {
      if (target.kind === "project") {
        const projectId = target.project.id;
        country.overlayCount -= details.overlays.filter(
          (overlay) => overlay.projectId === projectId,
        ).length;
        country.projectCount -= 1;
        details.projects = details.projects.filter((project) => project.id !== projectId);
        details.overlays = details.overlays.filter((overlay) => overlay.projectId !== projectId);
      } else {
        country.overlayCount -= 1;
        details.overlays = details.overlays.filter((overlay) => overlay.id !== target.overlay.id);
      }
    }

    toastSuccess(
      t(
        target.kind === "project"
          ? "admin.userContributions.messages.projectDeleted"
          : "admin.userContributions.messages.overlayDeleted",
      ),
    );
    deleteDialog.value = null;
  } catch (error) {
    if (page.signal.aborted || deleteDialog.value !== dialog) return;
    console.error("Error deleting contribution:", error);
    toastError(
      error instanceof Error ? error.message : undefined,
      t("admin.userContributions.messages.deleteError"),
    );
  } finally {
    if (deleteDialog.value === dialog) dialog.phase = "confirming";
  }
}

watch(
  userId,
  () => {
    pageRequests.abort();
    pageRequests = new AbortController();
    data.value = null;
    countryDetails.value = {};
    loadingCountries.clear();
    deleteDialog.value = null;
    loadState.value = "loading";
    void loadUserContributions();
  },
  { immediate: true, flush: "sync" },
);
</script>
