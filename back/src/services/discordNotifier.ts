import { db } from "../database";
import { adminBoundaries, overlays, projects } from "../db/schema";
import { eq, sql, type SQL } from "drizzle-orm";

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
        changes: ChangeDetail[];
      }
  );

type ChangeDetail = {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  changeReason?: string | null;
};

// Resolves a single boundary name at a given OSM admin_level bucket by walking the project's
// assigned admin boundary up its parent_id chain, mirroring feed.ts. `range` maps to a grade:
//   city -> deepest of 6..8, state -> level 4 exactly, country -> level 2.
function boundaryName(range: SQL): SQL<string | null> {
  return sql<string | null>`(
    WITH RECURSIVE chain AS (
      SELECT osm_id, parent_id, admin_level, name
      FROM ${adminBoundaries} WHERE osm_id = ${projects.adminBoundaryId}
      UNION ALL
      SELECT b.osm_id, b.parent_id, b.admin_level, b.name
      FROM ${adminBoundaries} b JOIN chain c ON b.osm_id = c.parent_id
    )
    SELECT name FROM chain WHERE ${range} ORDER BY admin_level DESC LIMIT 1
  )`;
}

// Maps a notification to the project whose boundary describes its location. Change requests on an
// overlay entity carry the overlay id, so they need an extra lookup to reach the owning project.
async function resolveProjectId(notification: SubmissionNotification): Promise<string | null> {
  if (notification.kind === "project" || notification.kind === "overlay") {
    return notification.projectId;
  }
  if (notification.entityType === "project") {
    return notification.entityId;
  }
  const rows = await db
    .select({ projectId: overlays.projectId })
    .from(overlays)
    .where(eq(overlays.id, notification.entityId))
    .limit(1);
  return rows[0]?.projectId ?? null;
}

// Builds a "City, State, Country" label from the project's admin boundary chain, like feed.ts.
async function resolveLocationLabel(notification: SubmissionNotification): Promise<string | null> {
  try {
    const projectId = await resolveProjectId(notification);
    if (!projectId) return null;
    const rows = await db
      .select({
        city: boundaryName(sql`admin_level BETWEEN 6 AND 8`),
        state: boundaryName(sql`admin_level = 4`),
        country: boundaryName(sql`admin_level = 2`),
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const parts = [row.city, row.state, row.country].filter((part): part is string =>
      Boolean(part),
    );
    return parts.length > 0 ? parts.join(", ") : null;
  } catch (error) {
    console.error("Failed to resolve location for Discord notification:", error);
    return null;
  }
}

const COLOR_PROJECT = 0x3b_82_f6;
const COLOR_OVERLAY = 0x10_b9_81;
const COLOR_CHANGE = 0xf5_9e_0b;

function buildShareUrl(frontendUrl: string, lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return frontendUrl;
  return `${frontendUrl}/#map=15.00/${lat.toFixed(4)}/${lng.toFixed(4)}`;
}

function buildEmbed(
  notification: SubmissionNotification,
  envName: string,
  locationLabel: string | null,
): DiscordEmbed {
  const authorLabel = notification.author.username
    ? `${notification.author.username} (${notification.author.email})`
    : notification.author.email;

  const commonFields: DiscordEmbedField[] = [
    { name: "Author", value: authorLabel, inline: true },
    { name: "Location", value: locationLabel ?? "—", inline: true },
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

  const fieldChanges = notification.changes.filter((change) => !isGeometryField(change.fieldName));
  const geometryChanges = notification.changes.filter((change) =>
    isGeometryField(change.fieldName),
  );

  const changeFields: DiscordEmbedField[] = fieldChanges.map((change) => ({
    name: change.fieldName,
    value: formatChange(change),
  }));

  const descriptionParts = [
    `${notification.changes.length} field(s) on ${notification.entityType}`,
  ];
  for (const change of geometryChanges) {
    descriptionParts.push(
      `**${change.fieldName} (new):** ${truncate(formatValue(change.newValue), DESCRIPTION_LIMIT - 200)}`,
    );
  }

  return {
    title: "New change request submitted",
    description: truncate(descriptionParts.join("\n\n"), DESCRIPTION_LIMIT),
    color: COLOR_CHANGE,
    fields: [
      ...commonFields,
      { name: `${notification.entityType} ID`, value: notification.entityId },
      ...changeFields,
    ],
    timestamp: new Date().toISOString(),
  };
}

const FIELD_VALUE_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4096;

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function isGeometryField(fieldName: string): boolean {
  return fieldName === "geometry";
}

function formatChange(change: ChangeDetail): string {
  const lines = [
    `**Old:** ${truncate(formatValue(change.oldValue), 400)}`,
    `**New:** ${truncate(formatValue(change.newValue), 400)}`,
  ];
  if (change.changeReason) {
    lines.push(`**Reason:** ${truncate(change.changeReason, 200)}`);
  }
  return truncate(lines.join("\n"), FIELD_VALUE_LIMIT);
}

export async function notifyNewSubmission(notification: SubmissionNotification): Promise<void> {
  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      return;
    }

    const envName = process.env.COMPOSE_PROJECT_NAME ?? process.env.NODE_ENV ?? "unknown";
    const frontendUrl = process.env.FRONTEND_URL;

    const locationLabel = await resolveLocationLabel(notification);
    const embed = buildEmbed(notification, envName, locationLabel);
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
