<template>
  <div v-if="project" class="flex flex-col gap-3">
    <div v-if="showName" :class="cls.row">
      <span :class="cls.label">{{ $t("project.name") }}</span>
      <span :class="cls.value">{{ project.name ?? "—" }}</span>
    </div>

    <!-- Description: prefer OSM description, fall back to Wikidata description -->
    <div v-if="showDescription && (project.description || wikidataDescription)" :class="cls.row">
      <span :class="cls.label">{{ $t("common.description") }}</span>
      <span :class="cls.value">{{ project.description || wikidataDescription }}</span>
    </div>

    <div class="flex flex-wrap gap-x-6 gap-y-3">
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

      <!-- Creator (user-made projects only) -->
      <div v-if="!project.importSourceId && project.ownerUsername" :class="cls.row">
        <span :class="cls.label">{{ $t("project.createdBy") }}</span>
        <span :class="cls.value">{{ project.ownerUsername }}</span>
      </div>

      <!-- Last Modified (user-made projects only) -->
      <div v-if="!project.importSourceId && project.updatedAt" :class="cls.row">
        <span :class="cls.label">{{ $t("project.lastModified") }}</span>
        <span :class="cls.value">{{ formatDate(project.updatedAt) }}</span>
      </div>

      <!-- Location: full admin breadcrumb when loaded (getById), else country. Hidden when neither
           is known (empty-state add handled by the consolidated affordance). -->
      <div v-if="projectLocationDisplay !== '—'" :class="cls.row">
        <span :class="cls.label">{{ $t("project.location") }}</span>
        <span :class="cls.value">{{ projectLocationDisplay }}</span>
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
        @click.stop
        >{{ formatSourceUrl(project.sourceUrl) }}</a
      >
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
        @click.stop
        >{{ project.externalId }}</a
      >
    </div>

    <!-- External properties (OSM tags) for imported projects -->
    <template v-if="project.importSourceId && externalProperties">
      <!-- Architect, Wikipedia, Wikidata -->
      <div v-if="externalEntries.length > 0" class="flex flex-wrap gap-x-6 gap-y-3">
        <div v-for="entry in externalEntries" :key="entry.key" class="flex flex-col gap-0.5">
          <span :class="cls.label">{{ entry.label }}</span>
          <a
            v-if="entry.href"
            :href="entry.href"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[13px] text-indigo-600! dark:text-indigo-300! no-underline hover:underline wrap-break-word"
            @click.stop
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
        @click.stop
      >
        <img
          :src="externalImageUrl"
          class="w-full rounded-lg object-cover max-h-36"
          loading="lazy"
          referrerpolicy="no-referrer"
        />
      </a>
    </template>

    <!-- Wikidata main image (P18). Opt-in: the detail panel renders its own, so only standalone
         surfaces enable it here. Click to zoom in the self-contained lightbox below. -->
    <img
      v-if="showWikidataMedia && wikidataEntityData?.imageUrl"
      :src="wikidataEntityData.imageUrl"
      class="w-full rounded-lg object-cover max-h-36 cursor-zoom-in"
      loading="lazy"
      referrerpolicy="no-referrer"
      v-tooltip.top="$t('overlay.viewFullImage')"
      @click.stop="
        lightbox?.open({
          url: wikidataEntityData?.imageUrl,
          header: project?.name || $t('project.unnamed'),
          referrerpolicy: 'no-referrer',
        })
      "
    />

    <ImageLightbox ref="lightbox" />
  </div>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import type { Project } from "@/types/index";
import { formatProjectDateRangeParts } from "@/utils/projectDateFormat";
import { formatSourceUrl } from "@/utils/urlFormat";
import { useI18n } from "vue-i18n";
import { PROJECT_TAG_MAP } from "@/constants/projectTags";
import { useWikidataEntity } from "@/composables/project/useWikidataEntity";
import ImageLightbox from "@/components/common/ImageLightbox.vue";
import { mapLabelLanguageRef, pickBoundaryName } from "@/services/map/mapLabelLanguage";

const { t: $t, locale } = useI18n();

const lightbox = useTemplateRef<InstanceType<typeof ImageLightbox>>("lightbox");

interface Props {
  project: Project | null;
  showName?: boolean;
  showDescription?: boolean;
  // Render the Wikidata logo + main image inside the card. Off by default because the detail
  // panel renders its own (logo next to the name, image with a zoom lightbox).
  showWikidataMedia?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showName: true,
  showDescription: false,
  showWikidataMedia: false,
});

const wikidataId = computed(() => {
  const p = props.project?.externalProperties;
  if (!p || typeof p !== "object") return null;
  const id = (p as Record<string, unknown>)["wikidata"];
  return typeof id === "string" ? id : null;
});
const { entity: wikidataEntityData } = useWikidataEntity(wikidataId);
const wikidataDescription = computed(() => wikidataEntityData.value?.description ?? null);

const cls = {
  row: "flex flex-col gap-0.5",
  label: "text-[10px] font-medium uppercase tracking-[0.07em] text-muted-color",
  value: "text-[13px] text-color wrap-break-word",
};

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
  return formatProjectDateRangeParts(props.project, $t);
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

// Collapse a deepest-first boundary breadcrumb: drop exact duplicates (e.g. "Caen, Caen") and
// entries that merely qualify a less-specific ancestor (e.g. "France Métropolitaine" when "France"
// is already present), keeping the shorter country-ward name. Iterating from the country end means
// the kept name is the shallower one. Only word-boundary prefixes count, so distinct names that
// happen to contain an ancestor (e.g. "Hauts-de-France") are preserved.
function collapseBoundaryNames(names: string[]): string[] {
  const kept: string[] = [];
  // Walk from the country end so the kept representative of a redundant group is the shallower name.
  for (const name of names.toReversed()) {
    const lower = name.toLowerCase();
    const redundant = kept.some((k) => {
      const kl = k.toLowerCase();
      if (kl === lower) return true;
      return lower.startsWith(kl) && /[^\p{L}\p{N}]/u.test(lower.charAt(kl.length));
    });
    if (!redundant) kept.unshift(name);
  }
  return kept;
}

const projectLocationDisplay = computed(() => {
  const project = props.project;
  if (!project) return "—";

  const path = project.boundaryPath;
  if (path && path.length > 0) {
    // Even admin levels are the primary civil divisions (commune/county/region/country); odd levels
    // are intermediate groupings (arrondissement, "France métropolitaine") that read as noise in a
    // location breadcrumb. Fall back to the full path if filtering would leave nothing.
    const major = path.filter((entry) => entry.adminLevel % 2 === 0);
    // Localize each level via the map label language (falling back to the UI locale), so the
    // breadcrumb matches the map labels and stays readable instead of showing local script.
    const names = (major.length > 0 ? major : path).map((entry) =>
      pickBoundaryName(entry, mapLabelLanguageRef.value, locale.value),
    );
    return collapseBoundaryNames(names).join(", ");
  }

  return project.countryName ?? project.countryCode ?? "—";
});
</script>
