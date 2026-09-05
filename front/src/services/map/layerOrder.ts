type LayerWithId = { id: string };

// Pending geometry is inserted below approved geometry, so the first of either marks the bottom of
// the complete project-data band.
export function projectDataLayersBottomId(layers: readonly LayerWithId[]): string | undefined {
  return layers.find(
    (layer) => layer.id === "pending-project-shapes-fill" || layer.id.startsWith("project-shapes"),
  )?.id;
}
