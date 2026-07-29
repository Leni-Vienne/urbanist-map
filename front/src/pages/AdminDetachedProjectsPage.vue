<template>
  <div class="p-8 max-w-350 mx-auto h-full overflow-y-auto">
    <div class="flex items-center gap-4 mb-2">
      <h1 class="m-0 text-3xl font-semibold">
        {{ t("admin.detached.title") }}
      </h1>
      <Badge v-if="detachedProjects.length > 0" :value="detachedProjects.length" severity="warn" />
      <Button
        :label="t('admin.reports.title')"
        icon="pi pi-flag"
        severity="secondary"
        size="small"
        class="ml-auto"
        @click="$router.push('/admin/reports')"
      />
    </div>
    <p class="mt-0 mb-8 text-muted-color text-[0.9375rem] max-w-200">
      {{ t("admin.detached.subtitle") }}
    </p>

    <div v-if="isLoading" class="flex justify-center items-center min-h-100">
      <ProgressSpinner />
    </div>

    <div
      v-else-if="detachedProjects.length === 0"
      class="flex justify-center items-center min-h-100"
    >
      <Message severity="info" :closable="false">
        {{ t("admin.detached.noProjects") }}
      </Message>
    </div>

    <DataTable
      v-else
      :value="detachedProjects"
      dataKey="id"
      v-model:expandedRows="expandedRows"
      class="detached-table"
    >
      <Column :expander="true" headerStyle="width: 3rem" />

      <Column :header="t('admin.detached.columns.project')">
        <template #body="{ data }">
          <div class="flex items-center gap-3">
            <ShapeThumbnail
              :geometry="data.geometry"
              :title="data.name || undefined"
              class="w-9 h-9"
            />
            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold">{{ data.name || t("admin.detached.unnamed") }}</span>
                <Tag
                  v-if="data.editedFields.length || data.hasManualEdits"
                  severity="warn"
                  icon="pi pi-pencil"
                  :value="t('admin.detached.manualEdits.badge')"
                  v-tooltip.top="t('admin.detached.manualEdits.tooltip')"
                />
                <a
                  v-if="projectMapUrl(data)"
                  :href="projectMapUrl(data)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary-color text-sm whitespace-nowrap"
                >
                  <i class="pi pi-map-marker"></i> {{ t("admin.detached.viewOnMap") }}
                </a>
              </div>
              <div class="flex items-center gap-2 flex-wrap text-muted-color text-sm">
                <span>{{ data.countryCode }}</span>
                <span
                  v-for="tag in data.tags || []"
                  :key="tag"
                  class="px-2 py-0.5 rounded-full text-xs font-semibold"
                  :style="getTagStyle(tag)"
                >
                  {{ tagLabel(tag) }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </Column>

      <Column :header="t('admin.detached.columns.overlays')" headerStyle="width: 7rem">
        <template #body="{ data }">
          <Badge :value="data.overlayCount" severity="info" />
        </template>
      </Column>

      <Column :header="t('admin.detached.columns.detachedAt')" headerStyle="width: 12rem">
        <template #body="{ data }">
          {{ new Date(data.detachedAt).toLocaleDateString() }}
        </template>
      </Column>

      <Column :header="t('admin.detached.columns.candidates')" headerStyle="width: 9rem">
        <template #body="{ data }">
          <Badge
            :value="data.candidates.length"
            :severity="data.candidates.length > 0 ? 'success' : 'secondary'"
          />
        </template>
      </Column>

      <Column :header="t('common.actions')" headerStyle="width: 12rem">
        <template #body="{ data }">
          <Button
            :label="t('admin.detached.keepStandalone')"
            icon="pi pi-check"
            size="small"
            severity="secondary"
            outlined
            :loading="busyProjectId === data.id"
            @click="handleKeepStandalone(data)"
          />
        </template>
      </Column>

      <template #expansion="{ data }">
        <div class="px-8 py-4 flex flex-col gap-4">
          <Message
            v-if="data.editedFields.length || data.hasManualEdits"
            severity="warn"
            :closable="false"
          >
            <div class="flex flex-col gap-1">
              <span>{{ t("admin.detached.manualEdits.relinkWarning") }}</span>
              <span v-if="data.editedFields.length" class="font-medium">
                {{ formatFields(data.editedFields) }}
              </span>
            </div>
          </Message>
          <div v-if="data.candidates.length === 0" class="text-muted-color text-[0.9375rem] py-2">
            {{ t("admin.detached.candidate.noCandidates") }}
          </div>
          <DataTable v-else :value="data.candidates" dataKey="id">
            <Column :header="t('admin.detached.columns.project')">
              <template #body="{ data: cand }">
                <div class="flex items-center gap-3">
                  <ShapeThumbnail
                    :geometry="cand.geometry"
                    :title="cand.name || undefined"
                    class="w-9 h-9"
                  />
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                      <span class="font-medium">{{
                        cand.name || t("admin.detached.unnamed")
                      }}</span>
                      <a
                        v-if="projectMapUrl(cand)"
                        :href="projectMapUrl(cand)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-primary-color text-sm whitespace-nowrap"
                      >
                        <i class="pi pi-map-marker"></i> {{ t("admin.detached.viewOnMap") }}
                      </a>
                      <a
                        v-if="cand.sourceUrl"
                        :href="cand.sourceUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-primary-color text-sm"
                      >
                        <i class="pi pi-external-link"></i>
                        {{ t("admin.detached.candidate.viewOsm") }}
                      </a>
                    </div>
                    <div
                      v-if="cand.tags && cand.tags.length"
                      class="flex items-center gap-1 flex-wrap"
                    >
                      <span
                        v-for="tag in cand.tags"
                        :key="tag"
                        class="px-2 py-0.5 rounded-full text-xs font-semibold"
                        :style="getTagStyle(tag)"
                      >
                        {{ tagLabel(tag) }}
                      </span>
                    </div>
                  </div>
                </div>
              </template>
            </Column>
            <Column
              :header="t('admin.detached.candidate.sharedIdsHeader')"
              headerStyle="width: 9rem"
            >
              <template #body="{ data: cand }">
                <Badge v-if="cand.sharedIds > 0" :value="cand.sharedIds" severity="success" />
                <span v-else class="text-muted-color">—</span>
              </template>
            </Column>
            <Column
              :header="t('admin.detached.candidate.distanceHeader')"
              headerStyle="width: 9rem"
            >
              <template #body="{ data: cand }">
                {{ cand.distanceM != null ? Math.round(cand.distanceM) + " m" : "—" }}
              </template>
            </Column>
            <Column headerStyle="width: 10rem">
              <template #body="{ data: cand }">
                <Button
                  :label="t('admin.detached.candidate.relink')"
                  icon="pi pi-link"
                  size="small"
                  severity="success"
                  :loading="busyProjectId === data.id"
                  @click="openRelinkDialog(data, cand)"
                />
              </template>
            </Column>
          </DataTable>
        </div>
      </template>
    </DataTable>

    <Dialog
      v-model:visible="showRelinkDialog"
      :header="t('admin.detached.relinkDialog.title')"
      :modal="true"
      :style="{ width: '480px' }"
    >
      <p class="m-0">
        {{
          t("admin.detached.relinkDialog.message", {
            orphan: pendingRelink?.orphan.name || t("admin.detached.unnamed"),
            target: pendingRelink?.candidate.name || t("admin.detached.unnamed"),
            count: pendingRelink?.orphan.overlayCount ?? 0,
          })
        }}
      </p>
      <Message
        v-if="
          pendingRelink &&
          (pendingRelink.orphan.editedFields.length || pendingRelink.orphan.hasManualEdits)
        "
        severity="warn"
        :closable="false"
        class="mt-4"
      >
        {{
          t("admin.detached.relinkDialog.editsWarning", {
            fields: formatFields(pendingRelink.orphan.editedFields),
          })
        }}
      </Message>
      <template #footer>
        <Button :label="t('common.cancel')" text @click="showRelinkDialog = false" />
        <Button
          :label="t('admin.detached.candidate.relink')"
          icon="pi pi-link"
          severity="success"
          :loading="isRelinking"
          @click="confirmRelink"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toastSuccess, toastError, toastInfo } from "@/services/core/toast";
import { trpc, type RouterOutput } from "@/client";
import type { DataTableExpandedRows } from "primevue/datatable";
import ShapeThumbnail from "@/components/common/ShapeThumbnail.vue";
import { PROJECT_TAG_MAP } from "@/constants/projectTags";

type DetachedProject = RouterOutput["moderation"]["getDetachedProjects"][number];
type Candidate = DetachedProject["candidates"][number];

const { t, te } = useI18n();

const detachedProjects = ref<DetachedProject[]>([]);
const isLoading = ref(true);
const expandedRows = ref<DataTableExpandedRows | DetachedProject[]>({});
const busyProjectId = ref<string | null>(null);

const showRelinkDialog = ref(false);
const isRelinking = ref(false);
const pendingRelink = ref<{ orphan: DetachedProject; candidate: Candidate } | null>(null);

async function loadDetachedProjects() {
  isLoading.value = true;
  try {
    detachedProjects.value = await trpc.moderation.getDetachedProjects.query();
  } catch (error) {
    console.error("Error loading detached projects:", error);
    toastError(error instanceof Error ? error.message : undefined, t("admin.detached.loadError"));
  } finally {
    isLoading.value = false;
  }
}

// Translate the project field names from change history into human labels (shared fields.* keys),
// falling back to the raw key for any field without a label.
function formatFields(fields: string[]): string {
  return fields.map((f) => (te(`fields.${f}`) ? t(`fields.${f}`) : f)).join(", ");
}

// Chip background/text colors per tag, matching the map's tag styling.
function getTagStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: "#64748b", color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}

function tagLabel(slug: string): string {
  return te(`tags.${slug}`) ? t(`tags.${slug}`) : slug;
}

// Link that focuses this project on the map: prefer the /project/<slug> deep link (opens the detail
// panel), else a #map=zoom/lat/lng hash that just centers the view for slugless (unnamed) projects.
// Returns undefined when there's nothing to point at.
function projectMapUrl(p: {
  slug: string | null;
  lat: number | null;
  lng: number | null;
}): string | undefined {
  if (p.slug) return `/project/${encodeURIComponent(p.slug)}`;
  if (p.lat !== null && p.lng !== null) return `/#map=16/${p.lat.toFixed(4)}/${p.lng.toFixed(4)}`;
  return undefined;
}

function openRelinkDialog(orphan: DetachedProject, candidate: Candidate) {
  pendingRelink.value = { orphan, candidate };
  showRelinkDialog.value = true;
}

async function confirmRelink() {
  if (!pendingRelink.value) return;
  const { orphan, candidate } = pendingRelink.value;
  isRelinking.value = true;
  busyProjectId.value = orphan.id;
  try {
    const result = await trpc.moderation.relinkDetachedProject.mutate({
      orphanId: orphan.id,
      targetProjectId: candidate.id,
    });
    toastSuccess(
      t("admin.detached.relinkSuccessDetail", { count: result.movedOverlays }),
      t("admin.detached.relinkSuccess"),
    );
    showRelinkDialog.value = false;
    pendingRelink.value = null;
    await loadDetachedProjects();
  } catch (error) {
    console.error("Error re-linking detached project:", error);
    toastError(
      error instanceof Error ? error.message : String(error),
      t("admin.detached.relinkError"),
    );
  } finally {
    isRelinking.value = false;
    busyProjectId.value = null;
  }
}

async function handleKeepStandalone(orphan: DetachedProject) {
  busyProjectId.value = orphan.id;
  try {
    await trpc.moderation.dismissDetachedProject.mutate({ projectId: orphan.id });
    toastInfo(t("admin.detached.dismissSuccess"));
    await loadDetachedProjects();
  } catch (error) {
    console.error("Error dismissing detached project:", error);
    toastError(
      error instanceof Error ? error.message : undefined,
      t("admin.detached.dismissError"),
    );
  } finally {
    busyProjectId.value = null;
  }
}

onMounted(() => {
  loadDetachedProjects();
});
</script>
