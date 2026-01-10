import { ref } from "vue";
import type { ProjectForModeration } from "@/types/index";

// AI : Shared accordion state that persists across My Contributions and Moderation panels
// AI : This allows users to maintain their expanded/collapsed state when switching between panels

const activeAccordionPanels = ref<string[]>([]);
const expandedCountries = ref<Set<string>>(new Set());
const expandedCities = ref<Set<string>>(new Set());

// AI : Define scroll request type
export type ScrollRequestType = "city" | "project" | "overlay";

interface ScrollRequest {
  type: ScrollRequestType;
  id: string | number;
}

// AI : Singleton state for scroll requests
const pendingScrollRequest = ref<ScrollRequest | null>(null);

export function useAccordionState() {
  function toggleCountryExpanded(
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

  function isCountryExpanded(countryCode: string): boolean {
    return expandedCountries.value.has(countryCode);
  }

  function toggleCityExpanded(cityKey: string) {
    if (expandedCities.value.has(cityKey)) {
      expandedCities.value.delete(cityKey);
    } else {
      expandedCities.value.add(cityKey);
    }
  }

  function isCityExpanded(cityKey: string): boolean {
    return expandedCities.value.has(cityKey);
  }

  function expandProjectAccordion(projectId: string) {
    if (!activeAccordionPanels.value.includes(projectId)) {
      activeAccordionPanels.value.push(projectId);
    }
  }

  function collapseProjectAccordion(projectId: string) {
    activeAccordionPanels.value = activeAccordionPanels.value.filter((id) => id !== projectId);
  }

  function toggleProjectAccordion(projectId: string) {
    if (activeAccordionPanels.value.includes(projectId)) {
      collapseProjectAccordion(projectId);
    } else {
      expandProjectAccordion(projectId);
    }
  }

  /**
   * AI : Auto-expand accordion hierarchy for a specific overlay
   * AI : Expands country -> city -> project to reveal the overlay
   */
  function expandAccordionForOverlay(overlayId: string, projects: ProjectForModeration[]): boolean {
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
  function expandAccordionForProject(projectId: string, projects: ProjectForModeration[]): boolean {
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

  /**
   * AI : Request scrolling to a specific element in the panel
   * AI : This sets a pending request that the panel will consume when ready
   */
  function requestScrollTo(type: ScrollRequestType, id: string | number) {
    pendingScrollRequest.value = { type, id };
  }

  /**
   * AI : Consume the current scroll request (retrieve and clear it)
   */
  function consumeScrollRequest(): ScrollRequest | null {
    const request = pendingScrollRequest.value;
    pendingScrollRequest.value = null;
    return request;
  }

  return {
    // State
    activeAccordionPanels,
    expandedCountries,
    expandedCities,

    // Country methods
    toggleCountryExpanded,
    isCountryExpanded,

    // City methods
    toggleCityExpanded,
    isCityExpanded,

    // Project methods
    expandProjectAccordion,
    collapseProjectAccordion,
    toggleProjectAccordion,

    // Auto-expand
    expandAccordionForOverlay,
    expandAccordionForProject,

    // Scroll requests
    requestScrollTo,
    consumeScrollRequest,
  };
}
