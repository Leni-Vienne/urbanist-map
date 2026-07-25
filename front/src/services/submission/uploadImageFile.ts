import { getApiUrl } from "@/utils/apiUrl";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";
import { t } from "@/locales";

// Upload an image file to local storage and return its stored filename. Images migrate to R2
// only after moderator approval, mirroring the overlay flow. Throws a translated Error on failure.
export async function uploadImageFile(file: File): Promise<string> {
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
