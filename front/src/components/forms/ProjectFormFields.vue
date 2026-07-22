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
        v-model="projectName"
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
      :show="showChangeIndicators && anyFieldChanged('name')"
      :original-value="originalData?.name"
    />
  </div>

  <!-- Project description field -->
  <div class="flex flex-col gap-1">
    <FloatLabel class="w-full" variant="in">
      <Textarea
        id="project-description-input"
        v-model="projectDescription"
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
      :show="showChangeIndicators && anyFieldChanged('description')"
      :original-value="originalData?.description"
    />
  </div>

  <!-- Timeline status selector -->
  <TimelineStatusSelector v-model="localTimelineStatus" :id-prefix="idPrefix" />
  <ChangeIndicator
    :show="showChangeIndicators && anyFieldChanged('timelineStatus')"
    :original-value="formatTimelineStatus(originalData?.timelineStatus)"
  />

  <!-- Start and end date fields (always shown) -->
  <div class="flex flex-col gap-4">
    <!-- Start Date -->
    <div class="flex flex-col gap-1">
      <FlexibleDatePicker
        v-model="flexibleStartDate"
        :label="$t('project.startDate')"
        :error="getFieldError('startDate') ?? undefined"
        @blur="validateFieldHelper('startDate')"
      />
      <ChangeIndicator
        :show="showChangeIndicators && anyFieldChanged('startDate', 'startDatePrecision')"
        :original-value="
          formatFlexibleDateFromProp(originalData?.startDate, originalData?.startDatePrecision)
        "
      />
    </div>

    <!-- End Date -->
    <div class="flex flex-col gap-1">
      <FlexibleDatePicker
        v-model="flexibleEndDate"
        :label="$t('project.endDate')"
        :error="getFieldError('endDate') ?? undefined"
        @blur="validateFieldHelper('endDate')"
      />
      <ChangeIndicator
        :show="showChangeIndicators && anyFieldChanged('endDate', 'endDatePrecision')"
        :original-value="
          formatFlexibleDateFromProp(originalData?.endDate, originalData?.endDatePrecision)
        "
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
          :error="getFieldError('proposalDate') ?? undefined"
          @blur="validateFieldHelper('proposalDate')"
        />
        <small class="text-muted-color block mt-1">{{ $t("project.proposalDateHelp") }}</small>
        <ChangeIndicator
          :show="showChangeIndicators && anyFieldChanged('proposalDate', 'proposalDatePrecision')"
          :original-value="
            formatFlexibleDateFromProp(
              originalData?.proposalDate,
              originalData?.proposalDatePrecision,
            )
          "
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
        v-model="sourceUrl"
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
      :show="showChangeIndicators && anyFieldChanged('sourceUrl')"
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

    <ChangeIndicator
      :show="showChangeIndicators && anyFieldChanged('tags')"
      :original-value="formatTags(originalData?.tags)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
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
import { projectFormFieldsDiffer } from "@/utils/projectFormHelpers";

import TimelineStatusSelector, { type TimelineStatus } from "./TimelineStatusSelector.vue";
import FlexibleDatePicker from "./FlexibleDatePicker.vue";
import ChangeIndicator from "./ChangeIndicator.vue";

interface Props {
  formData: ProjectFormData;
  originalData?: ProjectFormData;
  showChangeIndicators?: boolean;
  idPrefix?: string;
  timelineStatus?: TimelineStatus;
}

type Emits = {
  (e: "update:formData", value: ProjectFormData): void;
  (e: "update:timelineStatus", value: TimelineStatus): void;
};

const props = withDefaults(defineProps<Props>(), {
  originalData: undefined,
  showChangeIndicators: false,
  idPrefix: "project",
  timelineStatus: "proposed",
});

const emit = defineEmits<Emits>();

const { t, te } = useI18n();

const { getFieldError, hasFieldError, validateField } = useFieldValidation(projectSchema);

const localTimelineStatus = computed({
  get: () => props.timelineStatus,
  set: (value: TimelineStatus) => emit("update:timelineStatus", value),
});

// formData is owned by the parent: reads come from the prop, writes emit a merged snapshot.
function patchFormData(patch: Partial<ProjectFormData>) {
  emit("update:formData", { ...props.formData, ...patch });
}

function formDataField<K extends keyof ProjectFormData>(key: K) {
  return computed<ProjectFormData[K]>({
    get: () => props.formData[key],
    set: (value) => patchFormData({ [key]: value } as Pick<ProjectFormData, K>),
  });
}

const projectName = formDataField("name");
const projectDescription = formDataField("description");
const sourceUrl = formDataField("sourceUrl");

const allTags = PROJECT_TAGS.filter((tag) => !tag.hidden);

const selectedTags = computed(() =>
  props.formData.tags
    .map((slug) => PROJECT_TAG_MAP.get(slug))
    .filter((tag): tag is (typeof PROJECT_TAGS)[number] => tag !== undefined),
);

const availableTags = computed(() =>
  allTags.filter((tag) => !props.formData.tags.includes(tag.slug)),
);

function tagLabel(slug: string) {
  return te(`tags.${slug}`) ? t(`tags.${slug}`) : slug;
}

function anyFieldChanged(...fieldNames: (keyof ProjectFormData)[]): boolean {
  const originalData = props.originalData;
  if (!originalData) return false;

  for (const fieldName of fieldNames) {
    if (projectFormFieldsDiffer(originalData[fieldName], props.formData[fieldName])) return true;
  }
  return false;
}

function formatTags(tags: string[] | undefined): string {
  return tags?.map(tagLabel).join(", ") ?? "";
}

function formatTimelineStatus(status: TimelineStatus | undefined): string {
  return t(`timelineStatus.${status ?? "proposed"}`);
}

function addTag(slug: string) {
  if (!props.formData.tags.includes(slug)) {
    patchFormData({ tags: [...props.formData.tags, slug] });
  }
}

function removeTag(slug: string) {
  patchFormData({ tags: props.formData.tags.filter((tag) => tag !== slug) });
}

function makePrimary(slug: string) {
  patchFormData({ tags: [slug, ...props.formData.tags.filter((tag) => tag !== slug)] });
}

const flexibleProposalDate = computed({
  get() {
    return dbToFlexibleDate(props.formData.proposalDate, props.formData.proposalDatePrecision);
  },
  set(newVal) {
    patchFormData({
      proposalDate: flexibleDateToDb(newVal),
      proposalDatePrecision: newVal?.precision ?? null,
    });
    validateFieldHelper("proposalDate");
  },
});

const flexibleStartDate = computed({
  get() {
    return dbToFlexibleDate(props.formData.startDate, props.formData.startDatePrecision);
  },
  set(newVal) {
    patchFormData({
      startDate: flexibleDateToDb(newVal),
      startDatePrecision: newVal?.precision ?? null,
    });
    validateFieldHelper("startDate");
    validateFieldHelper("endDate");
  },
});

const flexibleEndDate = computed({
  get() {
    return dbToFlexibleDate(props.formData.endDate, props.formData.endDatePrecision);
  },
  set(newVal) {
    patchFormData({
      endDate: flexibleDateToDb(newVal),
      endDatePrecision: newVal?.precision ?? null,
    });
    validateFieldHelper("startDate");
    validateFieldHelper("endDate");
  },
});

function validateFieldHelper(fieldPath: string) {
  const validationData = prepareProjectValidationData(props.formData);
  validateField(fieldPath, validationData);
}

function getInputClass(fieldName: string) {
  const errorClass = hasFieldError(fieldName) ? "p-invalid" : "";
  return [{ "w-full": true }, errorClass];
}

function formatFlexibleDateFromProp(
  date: Date | null | undefined,
  precision: ProjectFormData["proposalDatePrecision"] = null,
): string {
  return formatFlexibleDate(dbToFlexibleDate(date, precision));
}
</script>
