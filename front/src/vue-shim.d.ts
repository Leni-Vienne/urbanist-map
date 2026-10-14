// Keep imports inside this declaration so it remains a global ambient module.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}
