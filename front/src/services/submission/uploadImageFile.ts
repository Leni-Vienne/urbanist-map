import { getApiUrl } from "@/utils/apiUrl";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";
import { t } from "@/locales";
import { useAuthStore } from "@/stores/authStore";

const uploadedFiles = new WeakMap<
  File,
  { epoch: number; userId?: string; request: Promise<string> }
>();
let uploadQueue = Promise.resolve();

// Upload an image file to local storage and return its stored filename. Images migrate to R2
// only after moderator approval, mirroring the overlay flow. Throws a translated Error on failure.
export async function uploadImageFile(file: File): Promise<string> {
  const auth = useAuthStore();
  const epoch = auth.getSessionEpoch();
  const userId = auth.user?.id;
  const cached = uploadedFiles.get(file);
  if (cached?.epoch === epoch && cached.userId === userId) return cached.request;
  // The single backend processes one upload at a time. Preserve batch submissions without
  // sending competing uploads, and never send queued file bytes after an account switch.
  const request = uploadQueue.then(async () => {
    if (auth.getSessionEpoch() !== epoch || auth.user?.id !== userId) {
      throw new Error(t("upload.error.uploadFailed"));
    }
    return upload(file);
  });
  uploadQueue = request.then(
    () => undefined,
    () => undefined,
  );
  uploadedFiles.set(file, { epoch, userId, request });
  try {
    return await request;
  } catch (error) {
    if (uploadedFiles.get(file)?.request === request) uploadedFiles.delete(file);
    throw error;
  }
}

async function upload(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    throw new Error(t("upload.fileTooLarge", { maxSize: MAX_UPLOAD_FILE_SIZE_MB }));
  }

  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`${getApiUrl()}/api/upload-image`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    // The endpoint returns { error } where error is an i18n key (quota, rate limit, etc.).
    let message = t("upload.error.uploadFailed");
    try {
      const body: { error?: string } = await response.json();
      if (body.error) message = t(body.error);
    } catch {
      // Non-JSON body: keep the generic message.
    }
    throw new Error(message);
  }

  const result: { filename: string } = await response.json();
  return result.filename;
}
