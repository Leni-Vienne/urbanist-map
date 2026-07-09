import { ref } from "vue";

export function useImageErrors() {
  const imageErrors = ref<Record<string, boolean>>({});

  function handleImageError(event: Event, id: string) {
    imageErrors.value[id] = true;
    // eslint-disable-next-line no-unsafe-type-assertion
    const target = event.target as HTMLImageElement;
    target.style.display = "none";
  }

  function handleImageLoad(id: string) {
    imageErrors.value[id] = false;
  }

  return {
    imageErrors,
    handleImageError,
    handleImageLoad,
  };
}
