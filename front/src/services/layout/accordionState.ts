import { ref } from "vue";
import type { ProjectForModeration } from "@/types/index";

// AI : ============================================================================
// AI : ACCORDION STATE SERVICE - Singleton state for panel accordions
// AI : ============================================================================
// AI : Shared accordion state that persists across My Contributions and Moderation panels
// AI : This allows users to maintain their expanded/collapsed state when switching between panels
// AI : ============================================================================

// AI : ============================================================================
// AI : STATE
// AI : ============================================================================

export const activeAccordionPanels = ref<string[]>([]);
const expandedCountries = ref<Set<string>>(new Set());
const expandedCities = ref<Set<string>>(new Set());

// AI : ============================================================================
// AI : SCROLL REQUESTS
// AI : ============================================================================

export type ScrollRequestType = "city" | "project" | "overlay";

interface ScrollRequest {
  type: ScrollRequestType;
  id: string | number;
}

const pendingScrollRequest = ref<ScrollRequest | null>(null);

/**
 * AI : Request scrolling to a specific element in the panel
 * AI : This sets a pending request that the panel will consume when ready
 */
export function requestScrollTo(type: ScrollRequestType, id: string | number) {
  pendingScrollRequest.value = { type, id };
}

/**
 * AI : Consume the current scroll request (retrieve and clear it)
 */
export function consumeScrollRequest(): ScrollRequest | null {
  const request = pendingScrollRequest.value;
  pendingScrollRequest.value = null;
  return request;
}

// AI : ============================================================================
// AI : COUNTRY METHODS
// AI : ============================================================================

export function toggleCountryExpanded(
  countryCode: string,
  countryGroup?: { cities: { key: string }[] },
) {
  if (expandedCountries.value.has(countryCode)) {
    expandedCountries.value.delete(countryCode);
  } else {
    expandedCountries.value.add(countryCode);

    // AI : When expanding a country, also expand all its cities
    if (countryGroup) {
      countryGroup.cities.forEach((city) => {
        expandedCities.value.add(city.key);
      });
    }
  }
}

export function isCountryExpanded(countryCode: string): boolean {
  return expandedCountries.value.has(countryCode);
}

// AI : ============================================================================
// AI : CITY METHODS
// AI : ============================================================================

export function toggleCityExpanded(cityKey: string) {
  if (expandedCities.value.has(cityKey)) {
    expandedCities.value.delete(cityKey);
  } else {
    expandedCities.value.add(cityKey);
  }
}

export function isCityExpanded(cityKey: string): boolean {
  return expandedCities.value.has(cityKey);
}

// AI : ============================================================================
// AI : PROJECT METHODS
// AI : ============================================================================

function expandProjectAccordion(projectId: string) {
  if (!activeAccordionPanels.value.includes(projectId)) {
    activeAccordionPanels.value.push(projectId);
  }
}

// AI : ============================================================================
// AI : AUTO-EXPAND METHODS
// AI : ============================================================================

/**
 * AI : Auto-expand accordion hierarchy for a specific overlay
 * AI : Expands country -> city -> project to reveal the overlay
 */
export function expandAccordionForOverlay(
  overlayId: string,
  projects: ProjectForModeration[],
): boolean {
  // AI : Find the project and overlay
  for (const project of projects) {
    const overlay = project.overlays?.find((o) => o.id === overlayId);
    if (overlay) {
      // AI : Expand country
      if (project.countryCode) {
        expandedCountries.value.add(project.countryCode);
      }

      // AI : Expand city
      const cityKey = `${project.countryCode}-${project.cityName}`;
      expandedCities.value.add(cityKey);

      // AI : Expand project
      expandProjectAccordion(project.id);

      return true;
    }
  }

  return false;
}

/**
 * AI : Auto-expand accordion hierarchy for a specific project (standalone project)
 * AI : Expands country -> city -> project
 */
export function expandAccordionForProject(
  projectId: string,
  projects: ProjectForModeration[],
): boolean {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return false;

  // AI : Expand country
  if (project.countryCode) {
    expandedCountries.value.add(project.countryCode);
  }

  // AI : Expand city
  const cityKey = `${project.countryCode}-${project.cityName}`;
  expandedCities.value.add(cityKey);

  // AI : Expand project
  expandProjectAccordion(project.id);

  return true;
}
