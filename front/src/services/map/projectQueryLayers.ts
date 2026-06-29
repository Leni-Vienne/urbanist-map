// Rendered MapLibre layer IDs that carry project/overlay features and are queryable for hover and
// the visible-projects panel. Identical across both vector layer styles, so it lives here free of
// any interaction code (selectOverlay, click handlers) to stay cheap to import.
export const VECTOR_QUERY_LAYERS = [
  "overlay-footprints-fill",
  "project-shapes-fill",
  "project-shapes-proposed-fill",
  "project-shapes",
  "project-shapes-completed",
  "project-shapes-proposed-dashed",
] as const;
