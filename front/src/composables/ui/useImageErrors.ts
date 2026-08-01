import { ref } from "vue";

export function useImageErrors() {
  const imageErrors = ref<Record<string, boolean>>({});

  function handleImageError(id: string) {
    imageErrors.value[id] = true;
  }

  return {
    imageErrors,
    handleImageError,
  };
}
