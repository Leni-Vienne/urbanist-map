<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('moderation.userStats.contributorStats')"
    :style="{ width: '450px' }"
    @update:visible="handleClose"
  >
    <div class="flex flex-col gap-4 py-2">
      <!-- Submitter header card -->
      <div
        class="flex items-center gap-4 p-4 rounded-lg border-2 border-[var(--p-primary-200)]"
        style="
          background: linear-gradient(135deg, var(--p-primary-50) 0%, var(--p-primary-100) 100%);
        "
      >
        <i
          class="pi pi-user text-4xl text-[var(--p-primary-600)] bg-white p-3 rounded-full shadow-sm"
        ></i>
        <div class="flex-1">
          <div
            class="text-xs font-semibold uppercase tracking-wider text-[var(--p-primary-700)] mb-1"
          >
            {{ $t("moderation.userStats.submittedBy") }}
          </div>
          <div class="text-xl font-bold text-[var(--p-primary-900)]">
            {{ username || $t("moderation.unknownUser") }}
          </div>
        </div>
      </div>

      <div class="h-px bg-[var(--p-surface-200)]"></div>

      <!-- Approved stat -->
      <div class="flex justify-between items-center p-2 bg-[var(--p-surface-50)] rounded">
        <span class="font-semibold text-[var(--p-surface-700)]"
          >{{ $t("moderation.userStats.approved") }}:</span
        >
        <span class="font-bold text-lg text-[var(--p-green-600)]">{{ approvedCount }}</span>
      </div>

      <!-- Rejected stat -->
      <div class="flex justify-between items-center p-2 bg-[var(--p-surface-50)] rounded">
        <span class="font-semibold text-[var(--p-surface-700)]"
          >{{ $t("moderation.userStats.rejected") }}:</span
        >
        <span class="font-bold text-lg text-[var(--p-red-600)]">{{ rejectedCount }}</span>
      </div>

      <!-- Reports stat -->
      <div
        v-if="reportCount > 0"
        class="flex justify-between items-center p-2 bg-[var(--p-orange-50)] border border-[var(--p-orange-200)] rounded"
      >
        <span class="font-semibold text-[var(--p-surface-700)] flex items-center gap-2">
          <i class="pi pi-exclamation-triangle"></i>
          {{ $t("moderation.userStats.reports") }}:
        </span>
        <span class="font-bold text-lg text-[var(--p-orange-600)]">{{ reportCount }}</span>
      </div>

      <!-- High rejection warning -->
      <div
        v-if="hasHighRejectionRate"
        class="flex items-center gap-2 p-3 bg-[var(--p-red-50)] border border-[var(--p-red-200)] rounded text-[var(--p-red-700)] font-semibold text-sm"
      >
        <i class="pi pi-exclamation-triangle text-[var(--p-red-600)]"></i>
        {{ $t("moderation.userStats.highRejectionRate") }}
      </div>
    </div>

    <template #footer>
      <Button
        v-if="isAdmin && userId"
        :label="$t('admin.userContributions.manageContributions')"
        icon="pi pi-folder-open"
        severity="info"
        @click="goToContributions"
      />
      <Button
        :label="$t('moderation.reportUser.report')"
        icon="pi pi-flag"
        severity="warning"
        @click="openReportDialog"
      />
      <Button :label="$t('common.close')" severity="secondary" @click="handleClose" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/authStore";

interface Props {
  visible: boolean;
  userId?: string | null;
  username?: string | null;
  approvedCount?: number | null;
  rejectedCount?: number | null;
  reportCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  userId: null,
  username: null,
  approvedCount: 0,
  rejectedCount: 0,
  reportCount: 0,
});

const emit = defineEmits<{
  "update:visible": [value: boolean];
  report: [userId: string];
}>();

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();

const isVisible = computed({
  get: () => props.visible,
  set: (value) => emit("update:visible", value),
});

// AI : Check if current user is admin
const isAdmin = computed(() => authStore.user?.role === "admin");

const hasHighRejectionRate = computed(() => {
  const approved = props.approvedCount ?? 0;
  const rejected = props.rejectedCount ?? 0;
  const total = approved + rejected;
  if (total < 3) return false;
  return rejected >= 3 && approved / total < 0.3;
});

function handleClose() {
  emit("update:visible", false);
}

// AI : Open report dialog for this user
function openReportDialog() {
  if (props.userId) {
    emit("report", props.userId);
    handleClose();
  }
}

// AI : Navigate to admin contributions page
function goToContributions() {
  if (props.userId) {
    handleClose();
    router.push(`/admin/user/${props.userId}`);
  }
}
</script>
