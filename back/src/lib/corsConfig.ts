// Domains permitted for CORS, parsed once from CORS_ORIGIN (comma-separated).
// Used by the global CORS middleware and the /uploads file-serving handler.
export const allowedDomains = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);
