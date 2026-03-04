import { ref } from "vue";
import type { ProjectForModeration } from "@/types/index";

// ============================================================================
// ACCORDION STATE SERVICE - Singleton state for panel accordions
// ============================================================================
// Shared accordion state that persists across My Contributions and Moderation panels
// This allows users to maintain their expanded/collapsed state when switching between panels
// ============================================================================

// ============================================================================
// STATE
// ============================================================================

export const activeAccordionPanels = ref<string[]>([]);
const expandedCountries = ref<Set<string>>(new Set());
const expandedCities = ref<Set<string>>(new Set());

// ============================================================================
// SCROLL REQUESTS
// ============================================================================

type ScrollRequestType = "city" | "project" | "overlay";

interface ScrollRequest {
  type: ScrollRequestType;
  id: string | number;
}

export const pendingScrollRequest = ref<ScrollRequest | null>(null);

/**
 * Request scrolling to a specific element in the panel
 * This sets a pending request that the panel will consume when ready
 */
export function requestScrollTo(type: ScrollRequestType, id: string | number) {
  pendingScrollRequest.value = { type, id };
}

/**
 * Consume the current scroll request (retrieve and clear it)
 */
export function consumeScrollRequest(): ScrollRequest | null {
  const request = pendingScrollRequest.value;
  pendingScrollRequest.value = null;
  return request;
}

// ============================================================================
// COUNTRY METHODS
// ============================================================================

export function toggleCountryExpanded(
  countryCode: string,
  countryGroup?: { cities: { key: string }[] },
) {
  if (expandedCountries.value.has(countryCode)) {
    expandedCountries.value.delete(countryCode);
  } else {
    expandedCountries.value.add(countryCode);

    // When expanding a country, also expand all its cities
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

// ============================================================================
// CITY METHODS
// ============================================================================

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

// ============================================================================
// PROJECT METHODS
// ============================================================================

function expandProjectAccordion(projectId: string) {
  if (!activeAccordionPanels.value.includes(projectId)) {
    activeAccordionPanels.value.push(projectId);
  }
}

// ============================================================================
// AUTO-EXPAND METHODS
// ============================================================================

/**
 * Auto-expand accordion hierarchy for a specific overlay
 * Expands country -> city -> project to reveal the overlay
 */
export function expandAccordionForOverlay(
  overlayId: string,
  projects: ProjectForModeration[],
): boolean {
  // Find the project and overlay
  for (const project of projects) {
    const overlay = project.overlays.find((o) => o.id === overlayId);
    if (overlay) {
      let didExpand = false;

      // Expand country (only if not already expanded)
      if (project.countryCode && !expandedCountries.value.has(project.countryCode)) {
        expandedCountries.value.add(project.countryCode);
        didExpand = true;
      }

      // Expand city (only if not already expanded)
      const cityKey = `${project.countryCode}-${project.cityName}`;
      if (!expandedCities.value.has(cityKey)) {
        expandedCities.value.add(cityKey);
        didExpand = true;
      }

      // Expand project (only if not already expanded)
      if (!activeAccordionPanels.value.includes(project.id)) {
        activeAccordionPanels.value.push(project.id);
        didExpand = true;
      }

      // Return true only if we actually expanded something
      return didExpand;
    }
  }

  return false;
}

/**
 * Auto-expand accordion hierarchy for a specific project (standalone project)
 * Expands country -> city -> project
 */
export function expandAccordionForProject(
  projectId: string,
  projects: ProjectForModeration[],
): boolean {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return false;

  // Expand country
  if (project.countryCode) {
    expandedCountries.value.add(project.countryCode);
  }

  // Expand city
  const cityKey = `${project.countryCode}-${project.cityName}`;
  expandedCities.value.add(cityKey);

  // Expand project
  expandProjectAccordion(project.id);

  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
