import { ref } from "vue";

// Lazy cityId -> name lookup populated when CitySelect surfaces cities to the user.
// Read by the submission diff dialog so a brand-new city pick renders by name instead of by ID.
const cache = ref<Record<number, string>>({});

export function cacheCityName(cityId: number, name: string): void {
  if (cache.value[cityId] === name) return;
  cache.value = { ...cache.value, [cityId]: name };
}

export function getCityNameCache(): Readonly<Record<number, string>> {
  return cache.value;
}

export function clearCityNameCache(): void {
  cache.value = {};
}
