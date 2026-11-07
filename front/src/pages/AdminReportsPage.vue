<template>
  <div class="p-8 max-w-350 mx-auto h-full overflow-y-auto">
    <div class="flex items-center gap-4 mb-8">
      <h1 class="m-0 text-3xl font-semibold">
        {{ t("admin.reports.title") }}
      </h1>
      <Badge
        v-if="reportedUsers && reportedUsers.length > 0"
        :value="reportedUsers.length"
        severity="warning"
      />
      <Button
        :label="t('admin.detached.title')"
        icon="pi pi-link"
        severity="secondary"
        size="small"
        class="ml-auto"
        @click="$router.push('/admin/detached')"
      />
    </div>

    <div v-if="loadState === 'loading'" class="flex justify-center items-center min-h-100">
      <ProgressSpinner />
    </div>

    <div
      v-else-if="loadState === 'error'"
      class="flex flex-col items-center justify-center gap-4 min-h-100"
    >
      <Message severity="error" :closable="false">{{
        t("admin.reports.messages.loadError")
      }}</Message>
      <Button :label="t('common.retry')" @click="loadReportedUsers" />
    </div>

    <div
      v-else-if="!reportedUsers || reportedUsers.length === 0"
      class="flex justify-center items-center min-h-100"
    >
      <Message severity="info" :closable="false">
        {{ t("admin.reports.messages.noReports") }}
      </Message>
    </div>

    <DataTable
      v-else
      :value="reportedUsers"
      dataKey="userId"
      :paginator="true"
      :rows="20"
      :rowsPerPageOptions="[10, 20, 50]"
      paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
    >
      <Column :expander="true" headerStyle="width: 3rem" />

      <Column field="username" :header="t('auth.username')" sortable>
        <template #body="slotProps">
          <span class="font-semibold">{{ slotProps.data.username || "N/A" }}</span>
        </template>
      </Column>

      <Column field="email" :header="t('common.email')" sortable />

      <Column field="reportCount" :header="t('admin.reports.columns.reportCount')" sortable>
        <template #body="slotProps">
          <Badge :value="slotProps.data.reportCount" severity="danger" />
        </template>
      </Column>

      <Column :header="t('admin.reports.columns.pendingItems')" sortable>
        <template #body="slotProps">
          {{ slotProps.data.pendingProjects + slotProps.data.pendingOverlays }}
        </template>
      </Column>

      <Column :header="t('admin.reports.columns.rejectedItems')" sortable>
        <template #body="slotProps">
          {{ slotProps.data.rejectedProjects + slotProps.data.rejectedOverlays }}
        </template>
      </Column>

      <Column field="banned" :header="t('admin.reports.columns.status')" sortable>
        <template #body="slotProps">
          <Badge
            v-if="slotProps.data.banned"
            :value="t('admin.reports.status.banned')"
            severity="danger"
          />
          <Badge v-else :value="t('admin.reports.status.blocked')" severity="warning" />
        </template>
      </Column>

      <Column :header="t('common.actions')">
        <template #body="slotProps">
          <div class="flex gap-2 flex-wrap">
            <Button
              :label="t('admin.reports.actions.clearReports')"
              icon="pi pi-check"
              size="small"
              severity="success"
              outlined
              @click="clearReports(slotProps.data)"
              :disabled="
                slotProps.data.banned || isBanning || clearingUsers.has(slotProps.data.userId)
              "
            />
            <Button
              :label="t('admin.reports.actions.banUser')"
              icon="pi pi-ban"
              size="small"
              severity="danger"
              outlined
              @click="openBanDialog(slotProps.data)"
              :disabled="
                slotProps.data.banned || isBanning || clearingUsers.has(slotProps.data.userId)
              "
            />
          </div>
        </template>
      </Column>

      <template #expansion="slotProps">
        <div class="px-8 py-4">
          <h3 class="mt-6 mb-4 text-lg font-semibold">
            {{ t("admin.reports.details.reporters") }}
          </h3>
          <DataTable :value="slotProps.data.reports" class="mb-6">
            <Column
              field="reporterUsername"
              :header="t('admin.reports.details.reporterUsername')"
            />
            <Column field="reporterEmail" :header="t('common.email')" />
            <Column field="reason" :header="t('admin.reports.details.reason')">
              <template #body="reportSlot">
                {{ reportSlot.data.reason || t("admin.reports.details.noReason") }}
              </template>
            </Column>
            <Column field="createdAt" :header="t('admin.reports.details.reportedAt')">
              <template #body="reportSlot">
                {{ new Date(reportSlot.data.createdAt).toLocaleString() }}
              </template>
            </Column>
          </DataTable>

          <div
            v-if="slotProps.data.banned"
            class="bg-(--p-content-hover-background) p-4 rounded-md mt-4"
          >
            <h3 class="mt-0 mb-4 text-lg font-semibold">
              {{ t("admin.reports.details.banInfo") }}
            </h3>
            <p class="my-2">
              <strong>{{ t("admin.reports.details.bannedAt") }}:</strong>
              {{ new Date(slotProps.data.bannedAt).toLocaleString() }}
            </p>
            <p class="my-2">
              <strong>{{ t("admin.reports.details.banReason") }}:</strong>
              {{ slotProps.data.banReason }}
            </p>
          </div>
        </div>
      </template>
    </DataTable>

    <!-- Ban User Dialog -->
    <Dialog
      v-if="banDialog"
      :visible="true"
      @update:visible="!$event && closeBanDialog()"
      :header="t('admin.reports.actions.banUser')"
      :modal="true"
      :closable="!isBanning"
      :close-on-escape="!isBanning"
      :style="{ width: '500px' }"
    >
      <p class="mb-4">
        {{
          t("admin.reports.banDialog.confirmMessage", {
            username: banDialog.user.username,
          })
        }}
      </p>

      <div class="mb-4">
        <label for="banReason" class="block mb-2 font-semibold">{{
          t("admin.reports.banDialog.reason")
        }}</label>
        <Textarea
          id="banReason"
          v-model="banDialog.reason"
          :disabled="isBanning"
          :placeholder="t('admin.reports.banDialog.reasonPlaceholder')"
          :autoResize="true"
          rows="3"
          maxlength="500"
          class="w-full"
          dir="auto"
        />
        <small class="text-muted-color">{{ banDialog.reason.length }}/500</small>
      </div>

      <div class="flex items-center gap-2 mt-4">
        <Checkbox
          inputId="deleteContent"
          v-model="banDialog.deleteContent"
          :binary="true"
          :disabled="isBanning"
        />
        <label for="deleteContent">{{ t("admin.reports.banDialog.deleteContent") }}</label>
      </div>

      <template #footer>
        <Button
          :label="t('common.cancel')"
          icon="pi pi-times"
          text
          :disabled="isBanning"
          @click="closeBanDialog"
        />
        <Button
          :label="t('admin.reports.actions.banUser')"
          icon="pi pi-ban"
          severity="danger"
          @click="confirmBan"
          :disabled="!banDialog.reason.trim() || isBanning"
          :loading="isBanning"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, onScopeDispose } from "vue";
import { useI18n } from "vue-i18n";
import { toastSuccess, toastError } from "@/services/core/toast";
import { trpc, type RouterOutput } from "@/client";

type ReportedUser = RouterOutput["moderation"]["getReportedUsers"][number];

const { t } = useI18n();

const reportedUsers = ref<ReportedUser[]>([]);
const loadState = ref<"loading" | "ready" | "error">("loading");
const banDialog = ref<{
  user: ReportedUser;
  reason: string;
  deleteContent: boolean;
  phase: "confirming" | "submitting";
} | null>(null);
const isBanning = computed(() => banDialog.value?.phase === "submitting");
const clearingUsers = reactive(new Set<string>());
const lifetime = new AbortController();
let loadRequest = 0;
onScopeDispose(() => lifetime.abort());

async function loadReportedUsers() {
  if (lifetime.signal.aborted) return;
  loadRequest += 1;
  const request = loadRequest;
  loadState.value = "loading";
  try {
    const users = await trpc.moderation.getReportedUsers.query(undefined, {
      signal: lifetime.signal,
    });
    if (lifetime.signal.aborted || request !== loadRequest) return;
    reportedUsers.value = users;
    loadState.value = "ready";
  } catch (error) {
    if (lifetime.signal.aborted || request !== loadRequest) return;
    loadState.value = "error";
    console.error("Error loading reported users:", error);
    toastError(
      error instanceof Error ? error.message : String(error),
      t("admin.reports.messages.loadError"),
    );
  }
}

async function clearReports(user: ReportedUser) {
  if (lifetime.signal.aborted || isBanning.value || clearingUsers.has(user.userId)) return;
  clearingUsers.add(user.userId);
  try {
    await trpc.moderation.clearUserReports.mutate({ userId: user.userId });
    if (lifetime.signal.aborted) return;
    toastSuccess(
      t("admin.reports.messages.clearSuccessDetail", {
        username: user.username,
      }),
      t("admin.reports.messages.clearSuccess"),
    );
    await loadReportedUsers();
  } catch (error) {
    if (lifetime.signal.aborted) return;
    console.error("Error clearing reports:", error);
    toastError(
      error instanceof Error ? error.message : String(error),
      t("admin.reports.messages.clearError"),
    );
  } finally {
    clearingUsers.delete(user.userId);
  }
}

function openBanDialog(user: ReportedUser) {
  if (isBanning.value || clearingUsers.has(user.userId)) return;
  banDialog.value = { user, reason: "", deleteContent: false, phase: "confirming" };
}

function closeBanDialog() {
  if (!isBanning.value) banDialog.value = null;
}

async function confirmBan() {
  const dialog = banDialog.value;
  if (!dialog || dialog.phase !== "confirming" || !dialog.reason.trim() || lifetime.signal.aborted)
    return;

  dialog.phase = "submitting";
  try {
    await trpc.moderation.banUser.mutate({
      userId: dialog.user.userId,
      reason: dialog.reason.trim(),
      deleteContent: dialog.deleteContent,
    });
    if (lifetime.signal.aborted || banDialog.value !== dialog) return;

    toastSuccess(
      t("admin.reports.messages.banSuccessDetail", {
        username: dialog.user.username,
      }),
      t("admin.reports.messages.banSuccess"),
    );

    banDialog.value = null;
    await loadReportedUsers();
  } catch (error) {
    if (lifetime.signal.aborted || banDialog.value !== dialog) return;
    console.error("Error banning user:", error);
    toastError(
      error instanceof Error ? error.message : String(error),
      t("admin.reports.messages.banError"),
    );
  } finally {
    if (banDialog.value === dialog) dialog.phase = "confirming";
  }
}

onMounted(() => {
  loadReportedUsers();
});
</script>
