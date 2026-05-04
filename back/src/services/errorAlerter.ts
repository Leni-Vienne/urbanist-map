import { sendEmail } from "./emailService";

interface ErrorEntry {
  timestamp: number;
  method: string;
  path: string;
  status: number;
  message?: string;
  ip?: string;
}

const THRESHOLD_COUNT = 5;
const THRESHOLD_WINDOW = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL = 5 * 60 * 1000;
const COOLDOWN_PERIOD = 30 * 60 * 1000;

const errors: ErrorEntry[] = [];
let lastAlertTime = 0;
let intervalId: NodeJS.Timeout | undefined;

export function addError(error: ErrorEntry): void {
  errors.push(error);
  // Cap at 100 entries to prevent memory leak
  if (errors.length > 100) {
    errors.shift();
  }
}

async function sendAlert(recentErrors: ErrorEntry[]): Promise<void> {
  try {
    const alertEmail = process.env.ALERT_EMAIL;
    if (!alertEmail) {
      console.warn("ALERT_EMAIL not configured, skipping error alert");
      return;
    }

    // Uses COMPOSE_PROJECT_NAME which is already set per-environment (e.g., construction-map-prod, construction-map-preview)
    const envName = process.env.COMPOSE_PROJECT_NAME ?? process.env.NODE_ENV ?? "unknown";

    const errorsByPath: Record<string, number> = {};
    for (const error of recentErrors) {
      const key = `${error.method} ${error.path}`;
      errorsByPath[key] = (errorsByPath[key] ?? 0) + 1;
    }

    const errorList = Object.entries(errorsByPath)
      .map(([endpoint, count]) => `<li><strong>${endpoint}</strong>: ${count} errors</li>`)
      .join("");

    const recentErrorsList = recentErrors
      .slice(-5)
      .map(
        (error) => `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${new Date(error.timestamp).toISOString()}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${error.method} ${error.path}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${error.status}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${error.message ?? "N/A"}</td>
          </tr>
        `,
      )
      .join("");

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error Alert</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f44336; color: white; padding: 20px; border-radius: 5px;">
    <h1 style="margin: 0;">⚠️ Error Alert - ${envName.toUpperCase()}</h1>
  </div>

  <div style="background-color: #f9f9f9; padding: 20px; margin-top: 20px; border-radius: 5px;">
    <h2 style="color: #f44336; margin-top: 0;">Error Threshold Exceeded</h2>
    <p><strong>Environment:</strong> ${envName}</p>
    <p><strong>${recentErrors.length} errors</strong> detected in the last <strong>5 minutes</strong>.</p>

    <h3>Errors by Endpoint:</h3>
    <ul>
      ${errorList}
    </ul>

    <h3>Recent Errors:</h3>
    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
      <thead>
        <tr style="background-color: #333; color: white;">
          <th style="padding: 8px; border: 1px solid #ddd;">Time</th>
          <th style="padding: 8px; border: 1px solid #ddd;">Endpoint</th>
          <th style="padding: 8px; border: 1px solid #ddd;">Status</th>
          <th style="padding: 8px; border: 1px solid #ddd;">Message</th>
        </tr>
      </thead>
      <tbody>
        ${recentErrorsList}
      </tbody>
    </table>

    <p style="margin-top: 20px; color: #666;">
      This alert was triggered because more than ${THRESHOLD_COUNT} errors occurred within ${THRESHOLD_WINDOW / 60_000} minutes.
      You will not receive another alert for 30 minutes to prevent spam.
    </p>
  </div>

  <div style="margin-top: 20px; padding: 20px; background-color: #f0f0f0; border-radius: 5px;">
    <p style="margin: 0; font-size: 12px; color: #666;">
      This is an automated alert from Urbanist Map (${envName}). To stop receiving these alerts, update the ALERT_EMAIL environment variable.
    </p>
  </div>
</body>
</html>
      `;

    await sendEmail(
      alertEmail,
      `[Urbanist Map] [${envName.toUpperCase()}] Error Alert - ${recentErrors.length} errors detected`,
      html,
    );

    console.log(`Error alert sent to ${alertEmail} for ${recentErrors.length} errors`);
  } catch (error) {
    console.error("Failed to send error alert:", error);
  }
}

async function checkThreshold(): Promise<void> {
  const now = Date.now();
  const recentErrors = errors.filter((error) => now - error.timestamp < THRESHOLD_WINDOW);

  if (recentErrors.length >= THRESHOLD_COUNT && now - lastAlertTime > COOLDOWN_PERIOD) {
    await sendAlert(recentErrors);
    lastAlertTime = now;
  }
}

export function startErrorAlerter(): void {
  if (intervalId) {
    console.warn("ErrorAlerter already started");
    return;
  }

  intervalId = setInterval(() => {
    void checkThreshold();
  }, CHECK_INTERVAL);

  console.log(
    `ErrorAlerter started - monitoring for ${THRESHOLD_COUNT} errors in ${THRESHOLD_WINDOW / 60_000} minutes`,
  );
}
