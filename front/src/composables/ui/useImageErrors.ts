import { ref } from "vue";

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
