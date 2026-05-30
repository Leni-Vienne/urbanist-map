import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";

/**
 * Check if the current user can moderate a given country.
 * Admins can moderate all countries; moderators only their assigned ones.
 */
export function canModerateCountry(countryCode: string): boolean {
  const authStore = useAuthStore();
  const user = authStore.user;
  if (!user) return false;
  if (user.role === "admin") {
    return true;
  }
  return user.moderatedCountries?.includes(countryCode) ?? false;
}

/**
 * Set the active country so the moderation panel reloads its pending submissions.
 */
export function syncModerationCountry(countryCode: string): void {
  const mapStore = useMapStore();
  if (mapStore.selectedCountryCode !== countryCode) {
    mapStore.selectedCountryCode = countryCode;
  }
}

/**
 * Clicking a feature on the map while in moderation mode switches the moderation panel
 * to that feature's country (when the user may moderate it), so the panel loads its
 * pending submissions and scrolls to the clicked item without using the country dropdown.
 * No-op outside moderation mode or for countries the user can't moderate.
 */
export function syncModerationCountryFromMapClick(countryCode: string | null | undefined): void {
  if (!countryCode) return;
  const mapStore = useMapStore();
  if (mapStore.mode !== "moderation") return;
  if (!canModerateCountry(countryCode)) return;
  syncModerationCountry(countryCode);
}
