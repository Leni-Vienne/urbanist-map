<template>
  <!-- Shared project form fields component used by both CreateProjectForm and EditProjectForm -->
  <!-- Edits made through this form are not propagated to OpenStreetMap -->
  <div
    class="flex items-start gap-2 p-2.5 rounded-md text-xs leading-relaxed bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
  >
    <i class="pi pi-info-circle mt-0.5 shrink-0"></i>
    <span>{{ $t("common.osmSyncNotice") }}</span>
  </div>

  <!-- Project name field -->
  <div class="flex flex-col gap-1">
    <FloatLabel class="w-full" variant="in">
      <!-- @vue-expect-error PrimeVue v-model type mismatch -->
      <InputText
        id="project-name-input"
        v-model="localFormData.name"
        :class="getInputClass('name')"
        required
        minlength="8"
        autocomplete="off"
        dir="auto"
        @blur="validateFieldHelper('name')"
        @input="validateFieldHelper('name')"
      />
      <label for="project-name-input" class="text-(--p-text-color-secondary)"
        >{{ $t("project.name") }} *</label
      >
    </FloatLabel>
    <small v-if="getFieldError('name')" class="text-red-600 text-xs block">{{
      getFieldError("name")
    }}</small>
    <ChangeIndicator
      :show="showChangeIndicators && hasChanged?.('name')"
      :original-value="originalData?.name"
    />
  </div>

  <!-- Project description field -->
  <div class="flex flex-col gap-1">
    <FloatLabel class="w-full" variant="in">
      <Textarea
        id="project-description-input"
        v-model="localFormData.description"
        :class="getInputClass('description')"
        rows="2"
        dir="auto"
        @blur="validateFieldHelper('description')"
        @input="validateFieldHelper('description')"
      />
      <label for="project-description-input" class="text-(--p-text-color-secondary)">{{
        $t("common.description")
      }}</label>
    </FloatLabel>
    <small v-if="getFieldError('description')" class="text-red-600 text-xs block">{{
      getFieldError("description")
    }}</small>
    <ChangeIndicator
      :show="showChangeIndicators && hasChanged?.('description')"
      :original-value="originalData?.description"
    />
  </div>

  <!-- Timeline status selector -->
  <TimelineStatusSelector
    v-model="localTimelineStatus"
    :id-prefix="idPrefix"
    @change="handleTimelineStatusChange"
  />
  <ChangeIndicator
    :show="showChangeIndicators && hasChanged?.('timelineStatus')"
    :original-value="originalData?.timelineStatus"
  />

  <!-- Start and end date fields (always shown) -->
  <div class="flex flex-col gap-4">
    <!-- Start Date -->
    <div class="flex flex-col gap-1">
      <FlexibleDatePicker
        v-model="flexibleStartDate"
        :label="$t('project.startDate')"
        unique-id="start-date"
        :error="getFieldError('startDate') ?? undefined"
        @blur="validateFieldHelper('startDate')"
      />
      <ChangeIndicator
        :show="showChangeIndicators && hasChanged?.('startDate')"
        :original-value="formatFlexibleDateFromProp(originalData?.startDate)"
      />
    </div>

    <!-- End Date -->
    <div class="flex flex-col gap-1">
      <FlexibleDatePicker
        v-model="flexibleEndDate"
        :label="$t('project.endDate')"
        unique-id="end-date"
        :error="getFieldError('endDate') ?? undefined"
        @blur="validateFieldHelper('endDate')"
      />
      <ChangeIndicator
        :show="showChangeIndicators && hasChanged?.('endDate')"
        :original-value="formatFlexibleDateFromProp(originalData?.endDate)"
      />
    </div>
  </div>

  <!-- Additional details section (collapsible) -->
  <Panel :header="$t('project.additionalDetails')" toggleable collapsed>
    <div class="flex flex-col gap-4">
      <!-- Proposal date field -->
      <div class="flex flex-col gap-1">
        <FlexibleDatePicker
          v-model="flexibleProposalDate"
          :label="$t('project.proposalDate')"
          :max-date="new Date()"
          unique-id="proposal-date"
          :error="getFieldError('proposalDate') ?? undefined"
          @blur="validateFieldHelper('proposalDate')"
        />
        <small class="text-muted-color block mt-1">{{ $t("project.proposalDateHelp") }}</small>
        <ChangeIndicator
          :show="showChangeIndicators && hasChanged?.('proposalDate')"
          :original-value="formatFlexibleDateFromProp(originalData?.proposalDate)"
        />
      </div>
    </div>
  </Panel>

  <!-- Source URL field -->
  <div class="flex flex-col gap-1">
    <FloatLabel class="w-full" variant="in">
      <!-- @vue-expect-error PrimeVue v-model type mismatch -->
      <InputText
        id="source-url-input"
        type="url"
        v-model="localFormData.sourceUrl"
        :class="getInputClass('sourceUrl')"
        autocomplete="off"
        @blur="validateFieldHelper('sourceUrl')"
        @input="validateFieldHelper('sourceUrl')"
      />
      <label for="source-url-input" class="text-(--p-text-color-secondary)">{{
        $t("project.sourceUrl")
      }}</label>
    </FloatLabel>
    <small v-if="getFieldError('sourceUrl')" class="text-red-600 text-xs block">{{
      getFieldError("sourceUrl")
    }}</small>
    <ChangeIndicator
      :show="showChangeIndicators && hasChanged?.('sourceUrl')"
      :original-value="originalData?.sourceUrl"
    />
  </div>

  <!-- Tags field -->
  <div class="flex flex-col gap-2">
    <span class="text-sm text-(--p-text-color-secondary)">
      {{ $t("project.tags") }}
    </span>

    <!-- Selected tags: primary first (marked with a star), in chosen order -->
    <div v-if="selectedTags.length > 0" class="flex flex-wrap gap-2">
      <div
        v-for="(tag, index) in selectedTags"
        :key="tag.slug"
        role="button"
        tabindex="0"
        class="flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-full text-xs font-semibold border-2 cursor-pointer"
        :style="{ backgroundColor: tag.color, color: tag.textColor, borderColor: tag.color }"
        :title="$t('project.removeTag')"
        @click="removeTag(tag.slug)"
        @keydown.enter.prevent="removeTag(tag.slug)"
        @keydown.space.prevent="removeTag(tag.slug)"
      >
        <i v-if="index === 0" class="pi pi-star-fill" style="font-size: 0.7rem"></i>
        <button
          v-else
          type="button"
          class="flex items-center cursor-pointer opacity-70 hover:opacity-100"
          :title="$t('project.setPrimaryTag')"
          @click.stop="makePrimary(tag.slug)"
        >
          <i class="pi pi-star" style="font-size: 0.7rem"></i>
        </button>
        <span>{{ tagLabel(tag.slug) }}</span>
      </div>
    </div>

    <!-- Available tags to add -->
    <div v-if="availableTags.length > 0" class="flex flex-wrap gap-2">
      <button
        v-for="tag in availableTags"
        :key="tag.slug"
        type="button"
        class="px-3 py-1 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
        :style="{ backgroundColor: 'transparent', color: tag.color, borderColor: tag.color }"
        @click="addTag(tag.slug)"
      >
        {{ tagLabel(tag.slug) }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRaw } from "vue";
import { useI18n } from "vue-i18n";
import type { ProjectFormData } from "@/types/index";
import {
  dbToFlexibleDate,
  flexibleDateToDb,
  formatFlexibleDate,
} from "@/utils/flexibleDateHelpers";
import { useFieldValidation } from "@/composables/forms/useFieldValidation";
import { projectSchema } from "@shared/validation/schemas";
import { prepareProjectValidationData } from "@/utils/validationHelpers";
import { PROJECT_TAGS, PROJECT_TAG_MAP } from "@/constants/projectTags";

import TimelineStatusSelector, { type TimelineStatus } from "./TimelineStatusSelector.vue";
import FlexibleDatePicker from "./FlexibleDatePicker.vue";
import ChangeIndicator from "./ChangeIndicator.vue";

interface Props {
  formData: ProjectFormData;
  originalData?: ProjectFormData;
  showChangeIndicators?: boolean;
  idPrefix?: string;
  timelineStatus?: TimelineStatus;
  fieldClasses?: (fieldName: string) => string | object | undefined;
  hasChanged?: (fieldName: string) => boolean;
}

type Emits = {
  (e: "update:formData", value: ProjectFormData): void;
  (e: "update:timelineStatus", value: TimelineStatus): void;
};

const props = withDefaults(defineProps<Props>(), {
  showChangeIndicators: false,
  idPrefix: "project",
  timelineStatus: "proposed",
});

const emit = defineEmits<Emits>();

const { t, te } = useI18n();

const { getFieldError, hasFieldError, validateField } = useFieldValidation(projectSchema);

// Local timelineStatus state synced with parent
const localTimelineStatus = ref(props.timelineStatus);

// Local copy of formData to avoid mutating props
const localFormData = ref<ProjectFormData>({
  ...props.formData,
  proposalDatePrecision: props.formData.proposalDatePrecision ?? null,
  startDatePrecision: props.formData.startDatePrecision ?? null,
  endDatePrecision: props.formData.endDatePrecision ?? null,
  tags: props.formData.tags,
});

const allTags = PROJECT_TAGS.filter((tag) => !tag.hidden);

const selectedTags = computed(() =>
  localFormData.value.tags
    .map((slug) => PROJECT_TAG_MAP.get(slug))
    .filter((tag): tag is (typeof PROJECT_TAGS)[number] => tag !== undefined),
);

const availableTags = computed(() =>
  allTags.filter((tag) => !localFormData.value.tags.includes(tag.slug)),
);

function tagLabel(slug: string) {
  return te(`tags.${slug}`) ? t(`tags.${slug}`) : slug;
}

function addTag(slug: string) {
  if (!localFormData.value.tags.includes(slug)) {
    localFormData.value.tags = [...localFormData.value.tags, slug];
  }
}

function removeTag(slug: string) {
  localFormData.value.tags = localFormData.value.tags.filter((tag) => tag !== slug);
}

function makePrimary(slug: string) {
  localFormData.value.tags = [slug, ...localFormData.value.tags.filter((tag) => tag !== slug)];
}

// Computed flexible dates that automatically read/write to localFormData
const flexibleProposalDate = computed({
  get() {
    return dbToFlexibleDate(
      localFormData.value.proposalDate,
      localFormData.value.proposalDatePrecision,
    );
  },
  set(newVal) {
    localFormData.value.proposalDate = flexibleDateToDb(newVal);
    localFormData.value.proposalDatePrecision = newVal?.precision ?? null;
    validateFieldHelper("proposalDate");
  },
});

const flexibleStartDate = computed({
  get() {
    return dbToFlexibleDate(localFormData.value.startDate, localFormData.value.startDatePrecision);
  },
  set(newVal) {
    localFormData.value.startDate = flexibleDateToDb(newVal);
    localFormData.value.startDatePrecision = newVal?.precision ?? null;
    validateFieldHelper("startDate");
    validateFieldHelper("endDate");
  },
});

const flexibleEndDate = computed({
  get() {
    return dbToFlexibleDate(localFormData.value.endDate, localFormData.value.endDatePrecision);
  },
  set(newVal) {
    localFormData.value.endDate = flexibleDateToDb(newVal);
    localFormData.value.endDatePrecision = newVal?.precision ?? null;
    validateFieldHelper("startDate");
    validateFieldHelper("endDate");
  },
});

// Watch for external formData changes and sync local copy
watch(
  () => props.formData,
  (newFormData) => {
    localFormData.value = { ...newFormData };
  },
  { deep: true },
);

// Watch local formData changes and emit to parent
watch(
  localFormData,
  (newFormData) => {
    emit("update:formData", toRaw(newFormData));
  },
  { deep: true },
);

function validateFieldHelper(fieldPath: string) {
  const validationData = prepareProjectValidationData(localFormData.value);
  validateField(fieldPath, validationData);
}

function getInputClass(fieldName: string) {
  const baseClasses = props.fieldClasses?.(fieldName) ?? "";
  const errorClass = hasFieldError(fieldName) ? "p-invalid" : "";
  return [{ "w-full": true }, baseClasses, errorClass];
}

watch(
  () => props.timelineStatus,
  (newValue) => {
    localTimelineStatus.value = newValue;
  },
);

function handleTimelineStatusChange(newStatus: TimelineStatus) {
  localTimelineStatus.value = newStatus;
  emit("update:timelineStatus", newStatus);
}

function formatFlexibleDateFromProp(date: Date | null | undefined): string {
  return formatFlexibleDate(dbToFlexibleDate(date));
}
</script>
