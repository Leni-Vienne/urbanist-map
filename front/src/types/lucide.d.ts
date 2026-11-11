declare module "@lucide/vue/dist/esm/icons/*.mjs" {
  import type { FunctionalComponent, SVGAttributes } from "vue";
  const component: FunctionalComponent<
    Partial<SVGAttributes> & {
      size?: number | string;
      strokeWidth?: number | string;
      defaultClass?: string;
    }
  >;
  export default component;
}
