import { logger } from "../services/logger";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token: string, ip?: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  // If no secret key is configured (e.g. local dev), we skip verification
  if (!secretKey) {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        "Turnstile secret key not configured in production, CAPTCHA verification skipped",
      );
    }
    return true;
  }

  try {
    const formData = new FormData();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (ip) {
      formData.append("remoteip", ip);
    }

    const result = await fetch(TURNSTILE_VERIFY_URL, {
      body: formData,
      method: "POST",
    });

    const outcome = (await result.json()) as { success: boolean; "error-codes": string[] };

    if (!outcome.success) {
      logger.warn({ errorCodes: outcome["error-codes"] }, "Turnstile verification failed");
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ error }, "Error verifying Turnstile token");
    // Fail closed: connection errors to Cloudflare block the request to prevent automation bypasses.
    return false;
  }
}
