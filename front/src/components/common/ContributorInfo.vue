<template>
  <span>
    {{ formatRelativeTime(date, t)
    }}<template v-if="contributorUsername"
      >, {{ $t("moderation.by") }}

      <span
        v-if="clickable"
        class="text-[var(--p-primary-700)] cursor-pointer underline decoration-solid hover:text-[var(--p-primary-500)]"
        @click.stop="handleClick"
        >{{ contributorUsername }}</span
      >
      <span v-else>{{ contributorUsername }}</span>
      <i
        v-if="reportCount > 0"
        class="pi pi-exclamation-triangle text-[var(--p-orange-500)] text-xs font-black ml-1"
      ></i>
    </template>
  </span>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { formatRelativeTime } from "@/utils/dateFormat";

interface Props {
  date: Date | string | null | undefined;
  contributorId?: string | null;
  contributorUsername?: string | null;
  reportCount?: number;
  clickable?: boolean;
}

type Emits = (
  e: "click-contributor",
  data: { userId: string; username: string | null; reportCount: number },
) => void;

const props = withDefaults(defineProps<Props>(), {
  reportCount: 0,
  clickable: false,
});

const emit = defineEmits<Emits>();
const { t } = useI18n();

function handleClick() {
  if (props.contributorId && props.clickable) {
    emit("click-contributor", {
      userId: props.contributorId,
      username: props.contributorUsername ?? null,
      reportCount: props.reportCount,
    });
  }
}
</script>
