type DiscordEmbedField = { name: string; value: string; inline?: boolean };

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: DiscordEmbedField[];
  timestamp?: string;
};

type DiscordPayload = {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
};

type Author = {
  email: string;
  username: string | null;
};

type SubmissionLocation = {
  lat: number | null;
  lng: number | null;
};

type SubmissionNotification = SubmissionLocation &
  (
    | {
        kind: "project";
        author: Author;
        projectId: string;
        projectName: string | null;
        countryCode: string | null;
      }
    | {
        kind: "overlay";
        author: Author;
        overlayId: string;
        caption: string | null;
        projectId: string;
      }
    | {
        kind: "change_request";
        author: Author;
        entityType: "project" | "overlay";
        entityId: string;
        fieldNames: string[];
      }
  );

const COLOR_PROJECT = 0x3b_82_f6;
const COLOR_OVERLAY = 0x10_b9_81;
const COLOR_CHANGE = 0xf5_9e_0b;

function buildShareUrl(frontendUrl: string, lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return frontendUrl;
  return `${frontendUrl}/#map=16.00/${lat.toFixed(4)}/${lng.toFixed(4)}`;
}

function buildEmbed(notification: SubmissionNotification, envName: string): DiscordEmbed {
  const authorLabel = notification.author.username
    ? `${notification.author.username} (${notification.author.email})`
    : notification.author.email;

  const commonFields: DiscordEmbedField[] = [
    { name: "Author", value: authorLabel, inline: true },
    { name: "Environment", value: envName, inline: true },
  ];

  if (notification.kind === "project") {
    return {
      title: "New project submitted",
      description: notification.projectName ?? "(unnamed)",
      color: COLOR_PROJECT,
      fields: [
        ...commonFields,
        { name: "Country", value: notification.countryCode ?? "—", inline: true },
        { name: "Project ID", value: notification.projectId },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  if (notification.kind === "overlay") {
    return {
      title: "New overlay submitted",
      description: notification.caption ?? "(no caption)",
      color: COLOR_OVERLAY,
      fields: [
        ...commonFields,
        { name: "Overlay ID", value: notification.overlayId },
        { name: "Project ID", value: notification.projectId },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  return {
    title: "New change request submitted",
    description: `${notification.fieldNames.length} field(s) on ${notification.entityType}`,
    color: COLOR_CHANGE,
    fields: [
      ...commonFields,
      { name: "Fields", value: notification.fieldNames.join(", ") || "—" },
      { name: `${notification.entityType} ID`, value: notification.entityId },
    ],
    timestamp: new Date().toISOString(),
  };
}

export async function notifyNewSubmission(notification: SubmissionNotification): Promise<void> {
  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      return;
    }

    const envName = process.env.COMPOSE_PROJECT_NAME ?? process.env.NODE_ENV ?? "unknown";
    const frontendUrl = process.env.FRONTEND_URL;

    const embed = buildEmbed(notification, envName);
    if (frontendUrl) {
      embed.url = buildShareUrl(frontendUrl, notification.lat, notification.lng);
    }

    const body: DiscordPayload = {
      embeds: [embed],
      username: "Urbanist Backend",
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      console.warn(`Discord webhook returned ${response.status}: ${text}`);
    }
  } catch (error) {
    console.error("Failed to send Discord notification:", error);
  }
}
