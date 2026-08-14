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
        class="flex items-center gap-4 p-4 rounded-lg border-2 border-primary-200"
        style="
          background: linear-gradient(135deg, var(--p-primary-50) 0%, var(--p-primary-100) 100%);
        "
      >
        <i
          class="pi pi-user text-4xl text-primary-600 bg-content-background p-3 rounded-full shadow-sm"
        ></i>
        <div class="flex-1">
          <div class="text-xs font-semibold uppercase tracking-wider text-primary-color mb-1">
            {{ $t("moderation.userStats.submittedBy") }}
          </div>
          <div class="text-xl font-bold text-color">
            {{ username || $t("moderation.unknownUser") }}
          </div>
        </div>
      </div>

      <div class="h-px bg-content-border-color"></div>

      <!-- Approved stat -->
      <div class="flex justify-between items-center p-2 bg-content-hover-background rounded">
        <span class="font-semibold text-color">{{ $t("moderation.userStats.approved") }}:</span>
        <span class="font-bold text-lg text-green-600">{{ approvedCount }}</span>
      </div>

      <!-- Rejected stat -->
      <div class="flex justify-between items-center p-2 bg-content-hover-background rounded">
        <span class="font-semibold text-color">{{ $t("moderation.userStats.rejected") }}:</span>
        <span class="font-bold text-lg text-red-600">{{ rejectedCount }}</span>
      </div>

      <!-- Reports stat -->
      <div
        v-if="reportCount > 0"
        class="flex justify-between items-center p-2 bg-orange-50 border border-orange-200 rounded"
      >
        <span class="font-semibold text-color flex items-center gap-2">
          <i class="pi pi-exclamation-triangle"></i>
          {{ $t("moderation.userStats.reports") }}:
        </span>
        <span class="font-bold text-lg text-orange-600">{{ reportCount }}</span>
      </div>

      <!-- High rejection warning -->
      <InlineBanner
        v-if="hasHighRejectionRate"
        severity="error"
        class="text-red-700 font-semibold text-sm"
      >
        {{ $t("moderation.userStats.highRejectionRate") }}
      </InlineBanner>
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
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/authStore";
import InlineBanner from "@/components/common/InlineBanner.vue";

interface Props {
  visible?: boolean;
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

const router = useRouter();
const authStore = useAuthStore();

const isVisible = computed({
  get: () => props.visible,
  set: (value) => emit("update:visible", value),
});

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

function openReportDialog() {
  if (props.userId) {
    emit("report", props.userId);
    handleClose();
  }
}

function goToContributions() {
  if (props.userId) {
    handleClose();
    router.push(`/admin/user/${props.userId}`);
  }
}
</script>
