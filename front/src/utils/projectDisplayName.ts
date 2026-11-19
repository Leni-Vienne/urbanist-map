import { formatConstructionName } from "@shared/osmConstructionName";
import type { JsonObject } from "@shared/json";

export interface ProjectDisplayData {
  name: string | null;
  externalProperties?: JsonObject | null;
  importSource?: { type: string } | null;
}

interface ProjectTitleTranslations {
  t: (key: string) => string;
  te: (key: string) => boolean;
  locale: { readonly value: string };
}

export function getProjectDisplayName(
  project: ProjectDisplayData | null | undefined,
  { t, te, locale }: ProjectTitleTranslations,
): string {
  if (project?.name?.trim()) return project.name;
  const construction = project?.externalProperties?.construction;
  const constructionName =
    typeof construction === "string" ? formatConstructionName(construction) : null;
  if (constructionName) {
    const slug = constructionName.toLowerCase().replaceAll(" ", "_");
    const categoryKey = `tags.${slug}`;
    if (te(categoryKey)) return t(categoryKey);
    if (locale.value === "en") return constructionName;
  }
  return t(project?.importSource?.type === "osm" ? "project.osmName" : "project.unnamed");
}
