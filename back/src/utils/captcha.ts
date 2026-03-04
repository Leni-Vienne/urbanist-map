// Verification URL for Cloudflare Turnstile
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token: string, ip?: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  // If no secret key is configured (e.g. local dev), we skip verification
  // This ensures we don't break the app in development environments
  if (!secretKey) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "WARNING: Turnstile secret key not configured in production. CAPTCHA verification skipped.",
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
      console.warn("Turnstile verification failed:", outcome["error-codes"]);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error verifying Turnstile token:", error);
    // Fail open or closed? For security, we should probably fail closed,
    // But connection errors to Cloudflare shouldn't necessarily block users if it's intermittent.
    // Let's fail safe (return false) to prevent automation if the service is unreachable?
    // Actually, false means "check failed", so user is blocked.
    return false;
  }
}
