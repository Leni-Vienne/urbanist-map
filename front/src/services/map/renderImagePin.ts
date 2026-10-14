import type { GeoJSONFeature } from "maplibre-gl";
import { PROJECT_TAGS } from "@/constants/projectTags";
import { buildImageUrl, buildThumbnailUrl } from "@/utils/imageUrl";

export interface RenderImagePinData {
  projectId: string;
  name: string | null;
  coordinates: [number, number];
  thumbnailUrl: string;
  imageUrl: string;
  color: string;
}

// Visible shapes carry an explicit project center, so their pins survive center-point
// clustering. Point-only projects still use individual points, never a cluster representative.
export function decodeRenderImagePin(
  feature: Pick<GeoJSONFeature, "geometry" | "properties"> & { id?: string | number },
): RenderImagePinData | null {
  const props: Record<string, unknown> = feature.properties;
  const filename = props.render_filename;
  const projectId = props.id ?? feature.id;
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    projectId === undefined ||
    String(projectId).length === 0 ||
    Number(props.cell_count ?? 1) !== 1
  )
    return null;

  const [lng, lat] =
    feature.geometry.type === "Point"
      ? feature.geometry.coordinates
      : [props.render_lng, props.render_lat];
  if (
    typeof lng !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat)
  )
    return null;
  const pending = props.render_status !== undefined && props.render_status !== "approved";
  return {
    projectId: String(projectId),
    name: typeof props.name === "string" ? props.name : null,
    coordinates: [lng, lat],
    thumbnailUrl: buildThumbnailUrl(filename, pending),
    imageUrl: buildImageUrl(filename, pending),
    color: PROJECT_TAGS.find((tag) => tag.slug === props.first_tag)?.color ?? "#7ea2b7",
  };
}
