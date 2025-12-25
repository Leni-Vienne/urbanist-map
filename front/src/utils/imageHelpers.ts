import { ref } from "vue";

/**
 * AI : Get country flag URL from flagcdn.com
 */
export function getFlagUrl(countryCode: string): string {
  return `https://flagcdn.com/16x12/${countryCode.toLowerCase()}.png`;
}

/**
 * AI : Hide element on image error
 */
export function hideFlagOnError(event: Event) {
  const target = event.target as HTMLImageElement;
  target.style.display = "none";
}

/**
 * AI : Create composable for managing image loading errors
 * AI : Returns reactive error state and handlers
 */
export function useImageErrors() {
  const imageErrors = ref<Record<string, boolean>>({});

  function handleImageError(event: Event, id: string) {
    imageErrors.value[id] = true;
    const target = event.target as HTMLImageElement;
    target.style.display = "none";
  }

  function handleImageLoad(event: Event, id: string) {
    imageErrors.value[id] = false;
  }

  return {
    imageErrors,
    handleImageError,
    handleImageLoad,
  };
}
