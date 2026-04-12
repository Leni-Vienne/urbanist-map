export function getStatusSeverity(
  status: string | null | undefined,
): "success" | "danger" | "warn" | "secondary" | "info" {
  switch (status) {
    case "approved": {
      return "success";
    }
    case "rejected": {
      return "danger";
    }
    case "pending": {
      return "warn";
    }
    case "replaced": {
      return "secondary";
    }
    case null:
    case undefined: {
      return "info";
    }
    default: {
      return "info";
    }
  }
}
