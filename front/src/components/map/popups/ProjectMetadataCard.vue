<template>
  <div v-if="project" class="flex flex-col gap-3">
    <div v-if="showName" :class="cls.row">
      <span :class="cls.label">{{ $t("project.name") }}</span>
      <span :class="cls.value">{{ project.name ?? "—" }}</span>
    </div>

    <!-- Description: hidden when null and not editable -->
    <div
      v-if="showDescription && (project.description || (editMode && !project.importSourceId))"
      :class="cls.row"
    >
      <span :class="cls.label">{{ $t("common.description") }}</span>
      <span v-if="project.description" :class="cls.value">{{ project.description }}</span>
      <button v-else :class="cls.addBtn" @click="emit('field-click')">
        + {{ $t("common.addField") }}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-x-6 gap-y-3">
      <!-- Timeline Status -->
      <div :class="cls.row">
        <span :class="cls.label">{{ $t("project.timelineStatus") }}</span>
        <div class="flex items-center gap-1.5">
          <span :class="cls.value">{{
            $te(`timelineStatus.${project.timelineStatus}`)
              ? $t(`timelineStatus.${project.timelineStatus}`)
              : project.timelineStatus
          }}</span>
        </div>
      </div>

      <!-- Last Modified -->
      <div v-if="project.importSourceId" :class="cls.row">
        <span :class="cls.label">{{ $t("project.lastModified") }}</span>
        <span :class="cls.value">{{
          formatDate(project.externalLastModified ?? project.updatedAt)
        }}</span>
      </div>

      <!-- Location: hidden when null and not editable -->
      <div
        v-if="projectLocationDisplay !== '—' || (editMode && !project.importSourceId)"
        :class="cls.row"
      >
        <span :class="cls.label">{{ $t("project.location") }}</span>
        <span v-if="projectLocationDisplay !== '—'" :class="cls.value">{{
          projectLocationDisplay
        }}</span>
        <button v-else :class="cls.addBtn" @click="emit('field-click')">
          + {{ $t("common.addField") }}
        </button>
      </div>

      <!-- Period: hidden when empty -->
      <div v-if="periodParts" :class="cls.row">
        <span :class="cls.label">{{ periodParts.label }}</span>
        <span :class="cls.value">{{ periodParts.value }}</span>
      </div>
    </div>

    <!-- Tags -->
    <div v-if="project.tags && project.tags.length > 0" :class="cls.row">
      <span :class="cls.label">{{ $t("project.tags") }}</span>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="tag in project.tags"
          :key="tag"
          class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
          :style="getTagStyle(tag)"
        >
          {{ $te(`tags.${tag}`) ? $t(`tags.${tag}`) : tag }}
        </span>
      </div>
    </div>

    <!-- Source URL (user-provided reference: article, city hall page, etc.) -->
    <div v-if="project.sourceUrl" :class="cls.row">
      <span :class="cls.label">{{ $t("project.source") }}</span>
      <a
        :href="project.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[13px] text-indigo-600! dark:text-indigo-300! no-underline hover:underline wrap-break-word"
        >{{ formatSourceUrl(project.sourceUrl) }}</a
      >
    </div>
    <div v-else-if="editMode && !project.importSourceId" :class="cls.row">
      <span :class="cls.label">{{ $t("project.source") }}</span>
      <button :class="cls.addBtn" @click="emit('field-click')">
        + {{ $t("common.addField") }}
      </button>
    </div>

    <!-- Modify on source link (imported projects only, edit mode) -->
    <div v-if="osmEditUrl" :class="cls.row">
      <span :class="cls.label">{{
        $t("project.modifyOn", { name: project.importSource?.name ?? "OpenStreetMap" })
      }}</span>
      <a
        :href="osmEditUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[13px] text-indigo-600! dark:text-indigo-300! no-underline hover:underline"
        >{{ project.externalId }}</a
      >
    </div>

    <!-- External properties (OSM tags) for imported projects -->
    <template v-if="project.importSourceId && externalProperties">
      <!-- Architect, Wikipedia, Wikidata -->
      <div v-if="externalEntries.length > 0" class="grid grid-cols-2 gap-x-6 gap-y-3">
        <div v-for="entry in externalEntries" :key="entry.key" class="flex flex-col gap-0.5">
          <span :class="cls.label">{{ entry.label }}</span>
          <a
            v-if="entry.href"
            :href="entry.href"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[13px] text-indigo-600! dark:text-indigo-300! no-underline hover:underline wrap-break-word"
            >{{ entry.display }}</a
          >
          <span v-else :class="cls.value">{{ entry.display }}</span>
        </div>
      </div>

      <!-- OSM image (Wikimedia Commons photo) -->
      <a
        v-if="externalImageUrl"
        :href="externalImageUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="block"
      >
        <img
          :src="externalImageUrl"
          class="w-full rounded-lg object-cover max-h-36"
          loading="lazy"
          referrerpolicy="no-referrer"
        />
      </a>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Project } from "@/types/index";
import { formatProjectDateRangeParts } from "@/utils/projectDateFormat";
import { formatSourceUrl } from "@/utils/urlFormat";
import { useI18n } from "vue-i18n";
import { PROJECT_TAG_MAP } from "@/config/projectTags";

const { t: $t } = useI18n();

const emit = defineEmits<{ "field-click": [] }>();

const cls = {
  row: "flex flex-col gap-0.5",
  label: "text-[10px] font-medium uppercase tracking-[0.07em] text-muted-color",
  value: "text-[13px] text-color wrap-break-word",
  addBtn:
    "text-xs italic text-primary-400 hover:text-primary-700 dark:hover:text-primary-200 cursor-pointer bg-transparent border-none p-0 outline-none text-left",
};

interface Props {
  project: Project | null;
  showName?: boolean;
  showDescription?: boolean;
  editMode?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showName: true,
  showDescription: false,
  editMode: false,
});

function getTagStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: "#64748b", color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(date));
}

const periodParts = computed(() => {
  if (!props.project) return null;
  return formatProjectDateRangeParts(
    props.project.timelineStatus,
    props.project.startDate,
    props.project.endDate,
    props.project.proposalDate,
    props.project.startDatePrecision,
    props.project.endDatePrecision,
    props.project.proposalDatePrecision,
    $t,
  );
});

const osmEditUrl = computed(() => {
  const project = props.project;
  if (!project?.importSource || project.importSource.type !== "osm" || !project.externalId) {
    return null;
  }
  const template = project.importSource.urlTemplate;
  if (!template) return null;
  return template.replace("{id}", project.externalId);
});

interface ExternalEntry {
  key: string;
  label: string;
  display: string;
  href?: string;
}

function buildWikipediaUrl(value: string): string {
  const colonIdx = value.indexOf(":");
  if (colonIdx === -1) return `https://en.wikipedia.org/wiki/${encodeURIComponent(value)}`;
  const lang = value.slice(0, colonIdx);
  const article = value.slice(colonIdx + 1);
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.replace(/ /g, "_"))}`;
}

function buildWikidataUrl(value: string): string {
  return `https://www.wikidata.org/wiki/${encodeURIComponent(value)}`;
}

const externalProperties = computed(() => {
  const p = props.project?.externalProperties;
  if (!p || typeof p !== "object") return null;
  return p as Record<string, unknown>;
});

const externalImageUrl = computed<string | null>(() => {
  const p = externalProperties.value;
  if (!p) return null;
  // image URLs are sanitized at import time to http/https only
  return String(p["image"] ?? "").trim() || null;
});

const externalEntries = computed<ExternalEntry[]>(() => {
  const p = externalProperties.value;
  if (!p) return [];
  const entries: ExternalEntry[] = [];

  const altName = String(p["alt_name"] ?? "").trim();
  if (altName) entries.push({ key: "alt_name", label: $t("project.altName"), display: altName });

  const from = String(p["from"] ?? "").trim();
  if (from) entries.push({ key: "from", label: "From", display: from });

  const to = String(p["to"] ?? "").trim();
  if (to) entries.push({ key: "to", label: "To", display: to });

  const website = String(p["website"] ?? "").trim();
  if (website)
    entries.push({ key: "website", label: $t("project.website"), display: website, href: website });

  const architect = String(p["architect"] ?? "").trim();
  if (architect)
    entries.push({ key: "architect", label: $t("project.architect"), display: architect });

  const wikipedia = String(p["wikipedia"] ?? "").trim();
  if (wikipedia)
    entries.push({
      key: "wikipedia",
      label: "Wikipedia",
      display: wikipedia,
      href: buildWikipediaUrl(wikipedia),
    });

  const wikidata = String(p["wikidata"] ?? "").trim();
  if (wikidata)
    entries.push({
      key: "wikidata",
      label: "Wikidata",
      display: wikidata,
      href: buildWikidataUrl(wikidata),
    });

  return entries;
});

const projectLocationDisplay = computed(() => {
  if (!props.project) return "—";

  const project = props.project;

  // Check if project has a cityId first (imported projects may not have one)
  if (!project.cityId) {
    return "—";
  }

  if (project.city?.name) {
    return `${project.city.name}, ${project.city.countryCode}`;
  }

  return "—";
});
</script>
