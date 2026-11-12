export function getStatusSeverity(
  status: string | null | undefined,
): "success" | "danger" | "warn" | "secondary" | "info" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "pending") return "warn";
  if (status === "replaced") return "secondary";
  return "info";
}
