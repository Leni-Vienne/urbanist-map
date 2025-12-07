// @ts-expect-error AI : PrimeVue toasteventbus lacks type declarations
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
  add(message: ToastMessage): void;
  remove(message: ToastMessage): void;
  removeGroup(group: string): void;
  removeAllGroups(): void;
}

/**
 * Returns a toast service instance for displaying notifications
 */
export function useToast(): ToastServiceMethods {
  return {
    add: (message) => {
      ToastEventBus.emit("add", message);
    },
    remove: (message) => {
      ToastEventBus.emit("remove", message);
    },
    removeGroup: (group) => {
      ToastEventBus.emit("remove-group", group);
    },
    removeAllGroups: () => {
      ToastEventBus.emit("remove-all-groups");
    },
  };
}
