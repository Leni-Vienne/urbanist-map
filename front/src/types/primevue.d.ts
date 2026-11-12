declare module "primevue/toasteventbus" {
  import type { EventBus } from "@primeuix/utils/eventbus";
  const ToastEventBus: ReturnType<typeof EventBus>;
  export default ToastEventBus;
}
