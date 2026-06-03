// @ts-expect-error PrimeVue toasteventbus lacks type declarations
import ToastEventBus from "primevue/toasteventbus";

interface ToastMessage {
  severity?: "success" | "info" | "warn" | "error";
  summary?: string;
  detail?: string;
  life?: number;
  group?: string;
  closable?: boolean;
}

interface ToastServiceMethods {
  add: (message: ToastMessage) => void;
}

export function useToast(): ToastServiceMethods {
  return {
    add: (message) => {
      ToastEventBus.emit("add", message);
    },
  };
}
