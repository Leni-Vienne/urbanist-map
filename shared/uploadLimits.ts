// Per-file ceiling for a single uploaded image, shared by the frontend pre-checks and the
// backend Zod guard so the three check sites can never drift apart. This mainly bounds the
// memory cost of decoding and re-encoding one request; aggregate disk abuse is bounded
// separately by the per-user pending storage quota (back/src/lib/storageQuota.ts) and the
// pending-contribution count limit.
export const MAX_UPLOAD_FILE_SIZE_MB = 25;
export const MAX_UPLOAD_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
