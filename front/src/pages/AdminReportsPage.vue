<template>
  <div class="admin-reports-page">
    <div class="page-header">
      <h1>{{ t("admin.reports.title") }}</h1>
      <Badge
        v-if="reportedUsers && reportedUsers.length > 0"
        :value="reportedUsers.length"
        severity="warning"
      />
    </div>

    <div v-if="isLoading" class="loading-container">
      <ProgressSpinner />
    </div>

    <div v-else-if="error" class="error-container">
      <Message severity="error" :closable="false">
        {{ t("admin.reports.messages.loadError") }}
      </Message>
    </div>

    <div v-else-if="!reportedUsers || reportedUsers.length === 0" class="empty-container">
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
      class="reports-table"
    >
      <Column :expander="true" headerStyle="width: 3rem" />

      <Column field="username" :header="t('admin.reports.columns.username')" sortable>
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
          <div class="action-buttons">
            <Button
              :label="t('admin.reports.actions.clearReports')"
              icon="pi pi-check"
              size="small"
              severity="success"
              outlined
              @click="clearReports(slotProps.data)"
              :disabled="slotProps.data.banned"
            />
            <Button
              :label="t('admin.reports.actions.banUser')"
              icon="pi pi-ban"
              size="small"
              severity="danger"
              outlined
              @click="openBanDialog(slotProps.data)"
              :disabled="slotProps.data.banned"
            />
          </div>
        </template>
      </Column>

      <template #expansion="slotProps">
        <div class="expansion-content">
          <h3>{{ t("admin.reports.details.reporters") }}</h3>
          <DataTable :value="slotProps.data.reports" class="reporters-table">
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

          <div v-if="slotProps.data.banned" class="ban-info">
            <h3>{{ t("admin.reports.details.banInfo") }}</h3>
            <p>
              <strong>{{ t("admin.reports.details.bannedAt") }}:</strong>
              {{ new Date(slotProps.data.bannedAt).toLocaleString() }}
            </p>
            <p>
              <strong>{{ t("admin.reports.details.banReason") }}:</strong>
              {{ slotProps.data.banReason }}
            </p>
          </div>
        </div>
      </template>
    </DataTable>

    <!-- Ban User Dialog -->
    <Dialog
      v-model:visible="showBanDialog"
      :header="t('admin.reports.banDialog.title')"
      :modal="true"
      :closable="true"
      class="ban-dialog"
      :style="{ width: '500px' }"
    >
      <div class="ban-dialog-content">
        <p class="mb-4">
          {{ t("admin.reports.banDialog.confirmMessage", { username: selectedUser?.username }) }}
        </p>

        <div class="field">
          <label for="banReason">{{ t("admin.reports.banDialog.reason") }}</label>
          <Textarea
            id="banReason"
            v-model="banReason"
            :placeholder="t('admin.reports.banDialog.reasonPlaceholder')"
            :autoResize="true"
            rows="3"
            maxlength="500"
            class="w-full"
          />
          <small class="text-muted">{{ banReason.length }}/500</small>
        </div>

        <div class="field-checkbox mt-4">
          <Checkbox id="deleteContent" v-model="deleteContent" :binary="true" />
          <label for="deleteContent">{{ t("admin.reports.banDialog.deleteContent") }}</label>
        </div>
      </div>

      <template #footer>
        <Button
          :label="t('admin.reports.banDialog.cancel')"
          icon="pi pi-times"
          text
          @click="closeBanDialog"
        />
        <Button
          :label="t('admin.reports.banDialog.confirm')"
          icon="pi pi-ban"
          severity="danger"
          @click="confirmBan"
          :disabled="!banReason.trim() || isBanning"
          :loading="isBanning"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "primevue/usetoast";
import { trpc, type RouterOutput } from "@/client";

// AI : Use tRPC types from RouterOutput
type ReportedUser = RouterOutput["moderation"]["getReportedUsers"][number];

const { t } = useI18n();
const toast = useToast();

// AI : State with proper tRPC types
const reportedUsers = ref<ReportedUser[]>([]);
const isLoading = ref(true);
const error = ref(false);
const showBanDialog = ref(false);
const selectedUser = ref<ReportedUser | null>(null);
const banReason = ref("");
const deleteContent = ref(false);
const isBanning = ref(false);

// AI : Load reported users
async function loadReportedUsers() {
  try {
    isLoading.value = true;
    error.value = false;
    reportedUsers.value = await trpc.moderation.getReportedUsers.query();
  } catch (error) {
    console.error("Error loading reported users:", error);
    toast.add({
      severity: "error",
      summary: t("admin.reports.messages.loadError"),
      life: 5000,
    });
  } finally {
    isLoading.value = false;
  }
}

// AI : Clear reports for a user
async function clearReports(user: ReportedUser) {
  try {
    await trpc.moderation.clearUserReports.mutate({ userId: user.userId });
    toast.add({
      severity: "success",
      summary: t("admin.reports.messages.clearSuccess"),
      detail: t("admin.reports.messages.clearSuccessDetail", { username: user.username }),
      life: 5000,
    });
    // AI : Reload the list
    await loadReportedUsers();
  } catch (error) {
    console.error("Error clearing reports:", error);
    toast.add({
      severity: "error",
      summary: t("admin.reports.messages.clearError"),
      life: 5000,
    });
  }
}

// AI : Open ban dialog
function openBanDialog(user: ReportedUser) {
  selectedUser.value = user;
  banReason.value = "";
  deleteContent.value = false;
  showBanDialog.value = true;
}

// AI : Close ban dialog
function closeBanDialog() {
  showBanDialog.value = false;
  selectedUser.value = null;
  banReason.value = "";
  deleteContent.value = false;
}

// AI : Confirm ban
async function confirmBan() {
  if (!selectedUser.value || !banReason.value.trim()) return;

  try {
    isBanning.value = true;
    await trpc.moderation.banUser.mutate({
      userId: selectedUser.value.userId,
      reason: banReason.value.trim(),
      deleteContent: deleteContent.value,
    });

    toast.add({
      severity: "success",
      summary: t("admin.reports.messages.banSuccess"),
      detail: t("admin.reports.messages.banSuccessDetail", {
        username: selectedUser.value.username,
      }),
      life: 5000,
    });

    closeBanDialog();
    await loadReportedUsers();
  } catch (error) {
    console.error("Error banning user:", error);
    toast.add({
      severity: "error",
      summary: t("admin.reports.messages.banError"),
      life: 5000,
    });
  } finally {
    isBanning.value = false;
  }
}

// AI : Load data on mount
onMounted(() => {
  loadReportedUsers();
});
</script>

<style scoped>
.admin-reports-page {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}

.page-header h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: 600;
}

.loading-container,
.error-container,
.empty-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.expansion-content {
  padding: 1rem 2rem;
}

.expansion-content h3 {
  margin-top: 1.5rem;
  margin-bottom: 1rem;
  font-size: 1.125rem;
  font-weight: 600;
}

.reporters-table {
  margin-bottom: 1.5rem;
}

.ban-info {
  background: var(--surface-50);
  padding: 1rem;
  border-radius: 6px;
  margin-top: 1rem;
}

.ban-info h3 {
  margin-top: 0;
}

.ban-info p {
  margin: 0.5rem 0;
}

.ban-dialog-content .field {
  margin-bottom: 1rem;
}

.ban-dialog-content label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.field-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.text-muted {
  color: var(--text-color-secondary);
}
</style>
