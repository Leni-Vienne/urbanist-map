import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  doublePrecision,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
  char,
  geometry,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql, type InferSelectModel } from "drizzle-orm";
import type { JsonObject } from "@shared/json";

// Custom column type for PostGIS GeometryCollection.
// Drizzle's built-in geometry() hardcodes getSQLType() to "geometry(point)" and
// cannot represent complex geometry types. This customType declares the correct
// SQL type for DDL generation and provides the right TypeScript data type.
// Reads always use ST_AsGeoJSON(...) SQL expressions; writes always use ST_GeomFromGeoJSON(...).
const geometryCollectionType = customType<{
  data: GeoJSON.GeometryCollection | null;
  driverData: string;
}>({
  dataType() {
    return "geometry(geometrycollection,4326)";
  },
});

// Custom column type for PostGIS MultiPolygon, used for administrative boundary shapes.
// Same rationale as geometryCollectionType: Drizzle's geometry() can't express this SQL type.
// Reads use ST_AsGeoJSON(...); writes use ST_GeomFromGeoJSON(...) / ST_Multi(...).
const multiPolygonType = customType<{
  data: GeoJSON.MultiPolygon | null;
  driverData: string;
}>({
  dataType() {
    return "geometry(multipolygon,4326)";
  },
});

// Custom column type for PostGIS Polygon, used for overlay corner footprints.
// Same rationale as the types above: Drizzle's built-in geometry() ignores the `type`
// option and always emits "geometry(point,...)", so a polygon column must be declared here.
// Reads use ST_DumpPoints(...); writes use ST_MakePolygon(...).
const polygonType = customType<{
  data: GeoJSON.Polygon | null;
  driverData: string;
}>({
  dataType() {
    return "geometry(polygon,4326)";
  },
});

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "replaced",
]);
export type ApprovalStatus = (typeof approvalStatusEnum.enumValues)[number];

// Exported so drizzle-kit collects it; unexported pgEnum declarations are invisible to the
// migration generator, which then reads the type as dropped.
export const changeRequestStatusEnum = pgEnum("change_request_status", [
  "pending",
  "approved",
  "rejected",
  "conflicted",
]);

export type ChangeRequestStatus = (typeof changeRequestStatusEnum.enumValues)[number];

// Date precision values - used for flexible date display
// Using const array + text column (not enum) for easier modification
const DATE_PRECISION_VALUES = ["year", "month", "day"] as const;
export type DatePrecision = (typeof DATE_PRECISION_VALUES)[number];

// Timeline status values - project lifecycle stage
// Using const array + text column (not enum) for easier modification
const TIMELINE_STATUS_VALUES = [
  "proposed", // Just an idea/proposal
  "planned", // Approved/funded but not yet started
  "under_construction", // Active construction
  "completed", // Finished
  "canceled", // Abandoned/canceled
] as const;
export type TimelineStatus = (typeof TIMELINE_STATUS_VALUES)[number];

export type EntityType = "project" | "overlay";

// Import sources table for tracking external data origins (OSM, city datasets, etc.)
export const importSources = pgTable(
  "import_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").unique().notNull(), // e.g., "osm_germany", "osm_france"
    name: text("name").notNull(), // Display name: "OpenStreetMap Germany"
    type: text("type").notNull(), // "osm", "citydata", etc.
    urlTemplate: text("url_template"), // e.g., "https://www.openstreetmap.org/{id}"
    attribution: text("attribution"), // e.g., "(c) OpenStreetMap contributors"
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }), // When last import completed
    lastSyncStartedAt: timestamp("last_sync_started_at", { withTimezone: true }), // For pruning stale data
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_import_sources_slug").on(table.slug),
    index("idx_import_sources_type").on(table.type),
  ],
);

// Users table for custom authentication
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").unique().notNull(),
    username: text("username").unique(),
    passwordHash: text("password_hash"), // nullable because OAuth users don't have one
    role: text("role").default("user"), // Role can be 'user', 'admin', etc.
    moderatedCountries: text("moderated_countries").array(), // Array of ISO 3-letter country codes this moderator can moderate.
    emailVerified: boolean("email_verified").default(false).notNull(),
    emailVerificationToken: text("email_verification_token"),
    passwordResetToken: text("password_reset_token"),
    passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
    // Moderation stats for spam prevention - tracks approval/rejection counts across all entity types
    approvedCount: integer("approved_count").default(0).notNull(),
    rejectedCount: integer("rejected_count").default(0).notNull(),
    // Soft ban fields for spam/abuse prevention
    banned: boolean("banned").default(false).notNull(),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    bannedBy: uuid("banned_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    banReason: text("ban_reason"),
    // Track when user last acknowledged approved contributions
    // Used to highlight new approvals in the UI without modifying content tables
    lastApprovalAcknowledgementAt: timestamp("last_approval_acknowledgement_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // eslint-disable-next-line eslint/no-shadow
  (users) => [
    index("idx_users_email").on(users.email),
    index("idx_users_email_verification").on(users.emailVerificationToken),
    index("idx_users_password_reset").on(users.passwordResetToken),
  ],
);

// One row per linked external identity (Google, OSM, GitHub, ...). Provider-agnostic
// so new providers need no schema change: just a new `provider` value.
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    provider: text("provider").notNull(), // "google", "osm", ...
    providerAccountId: text("provider_account_id").notNull(), // the provider's unique user id
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_oauth_accounts_provider_account").on(table.provider, table.providerAccountId),
    index("idx_oauth_accounts_user_id").on(table.userId),
  ],
);

// Sessions table for database-backed session storage
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // Session ID from hono-sessions
    data: jsonb("data").notNull(), // Session data (user info, expiresAt, etc)
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // eslint-disable-next-line eslint/no-shadow
  (sessions) => [
    index("idx_sessions_expires_at").on(sessions.expiresAt), // Index for cleanup queries
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name"), // Nullable: OSM-imported projects may lack a name
    slug: text("slug").unique(), // Nullable: generated from name
    description: text("description"),
    status: approvalStatusEnum("status").default("pending").notNull(),
    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    countryCode: char("country_code", { length: 3 }).notNull(), // 3 letter country code, resolved server-side from the nearest admin boundary on creation.
    // Timeline status - project lifecycle stage
    timelineStatus: text("timeline_status").$type<TimelineStatus>().default("proposed").notNull(),
    // Import source tracking - NULL for user-submitted projects
    importSourceId: uuid("import_source_id").references(() => importSources.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    externalId: text("external_id"), // Namespaced ID from source (e.g., "relation/123456", "way/789")
    // Raw properties from source (OSM tags, etc.): an open key set, values whatever the source emitted.
    externalProperties: jsonb("external_properties").$type<JsonObject>(),
    externalLastModified: timestamp("external_last_modified", { withTimezone: true }), // When source data was last modified (e.g., osm_last_modified)
    externalRevision: text("external_revision"),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true }), // For pruning stale imports
    sourceUrl: text("source_url"),
    proposalDate: timestamp("proposal_date", { withTimezone: true }),
    proposalDatePrecision: text("proposal_date_precision").$type<DatePrecision | null>(),
    startDate: timestamp("start_date", { withTimezone: true }),
    startDatePrecision: text("start_date_precision").$type<DatePrecision | null>(),
    endDate: timestamp("end_date", { withTimezone: true }),
    endDatePrecision: text("end_date_precision").$type<DatePrecision | null>(),
    // Center coordinate for all projects - used as marker position when no images exist
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    // srid omitted (see overlays.centroid): values are SRID 4326, column typmod is unconstrained.
    centerCoordinate: geometry("center_coordinate", { type: "point", mode: "xy" }), // PostGIS point for spatial queries (computed from lat/lng)
    geometry: geometryCollectionType("geometry"), // PostGIS GeometryCollection for project shapes (lines + polygons)
    geometrySizeM: doublePrecision("geometry_size_m"), // Shape extent in meters: traced length or perimeter, capped by the bounding box. Null = no geometry.
    tags: text("tags").array(), // Project category tags (e.g. 'tram', 'rail', 'bike')
    version: integer("version").default(1).notNull(), // Version for optimistic locking during moderation
    rejectionReason: text("rejection_reason"), // Moderator-selected reason when rejecting (NULL for approved/pending)
    adminBoundaryId: text("admin_boundary_id").references(
      (): AnyPgColumn => adminBoundaries.osmId,
      {
        onDelete: "set null",
        onUpdate: "cascade",
      },
    ), // Boundary (osm_id) holding the majority of the project's shape; city/state/country derived via its parent chain
    detachedAt: timestamp("detached_at", { withTimezone: true }), // Set when OSM source was deleted/redrawn and project had overlays; import link is severed
    importLockedAt: timestamp("import_locked_at", { withTimezone: true }), // Set when a user edit is approved on an imported project; the OSM import must not overwrite its fields
    // Materialized curation filter for SEO: true when the project is approved AND named AND has
    // visual content (an approved overlay, or an external wikidata/image tag). Drives both the
    // sitemap source and the per-page noindex decision. Refreshed in bulk after the OSM import and
    // per-project on moderation approval (see db/indexable.ts); never set by the request path.
    indexable: boolean("indexable").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Partial: only non-approved rows are ever looked up by status; approved is the 99.99% bulk and always seq-scanned
    index("idx_projects_status")
      .on(table.status)
      .where(sql`${table.status} <> 'approved'`),
    // Partial: owner_id is non-null for a tiny fraction of rows; queries always filter by a specific owner
    index("idx_projects_owner_id")
      .on(table.ownerId)
      .where(sql`${table.ownerId} IS NOT NULL`),
    index("idx_projects_timeline_status").on(table.timelineStatus),
    index("idx_projects_external_id").on(table.externalId),
    index("idx_projects_last_imported").on(table.lastImportedAt),
    index("idx_projects_external_last_modified").on(table.externalLastModified), // For filtering stale imported data
    index("idx_projects_feed_imported_recency")
      .on(sql`COALESCE(${table.externalLastModified}, ${table.updatedAt})`, table.id)
      .where(
        sql`${table.status} = 'approved' AND ${table.importSourceId} IS NOT NULL AND ${table.importLockedAt} IS NULL`,
      ),
    index("idx_projects_feed_direct_recency")
      .on(
        sql`(CASE WHEN ${table.importLockedAt} IS NOT NULL THEN ${table.updatedAt} ELSE COALESCE(${table.externalLastModified}, ${table.updatedAt}) END)`,
        table.id,
      )
      .where(
        sql`${table.status} = 'approved' AND (${table.importSourceId} IS NULL OR ${table.importLockedAt} IS NOT NULL)`,
      ),
    index("idx_projects_admin_boundary").on(table.adminBoundaryId),
    // Partial: the sitemap and SEO lookups only ever scan indexable rows (~4.5k of ~500k).
    index("idx_projects_indexable")
      .on(table.slug)
      .where(sql`${table.indexable} = true`),
    sql.raw(
      "CREATE INDEX IF NOT EXISTS idx_projects_center_coordinate ON projects USING GIST (center_coordinate)",
    ), // Spatial index for project center coordinates
    sql.raw("CREATE INDEX IF NOT EXISTS idx_projects_geometry ON projects USING GIST (geometry)"), // Spatial index for geometry bbox filtering and MVT tiles
    sql.raw("CREATE INDEX IF NOT EXISTS idx_projects_tags ON projects USING GIN (tags)"), // GIN index for efficient tag filtering
    // Unique constraint for external data - prevents duplicate imports from same source
    // Note: PostgreSQL allows multiple (NULL, NULL) rows since NULL != NULL in unique constraints
    uniqueIndex("idx_projects_source_external").on(table.importSourceId, table.externalId),
  ],
);

export const overlays = pgTable(
  "overlays",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    filename: text("filename").notNull(),
    caption: text("caption"),
    status: approvalStatusEnum("status").default("pending").notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    replacesOverlayId: uuid("replaces_overlay_id"), // Reference to the overlay this replaces (set by user during upload)
    replacedByOverlayId: uuid("replaced_by_overlay_id"), // Reference to the overlay that replaced this one (set by moderator during approval)

    // 'map' = georeferenced image placed on the map (has corners/centroid).
    // 'render' = a non-georeferenced project image (artist's impression); corners/centroid are null.
    kind: text("kind").$type<"map" | "render">().default("map").notNull(),

    // Null for renders, which are not placed on the map.
    corners: polygonType("corners"),
    // srid omitted: the column typmod is unconstrained (srid 0); values are stored as
    // SRID 4326 via ST_SetSRID in overlay writes. Declaring srid here would emit
    // "geometry(point,4326)" and force a no-op typmod rewrite.
    centroid: geometry("centroid", { type: "point", mode: "xy" }),

    version: integer("version").default(1).notNull(), // Version for optimistic locking during moderation
    rejectionReason: text("rejection_reason"), // Moderator-selected reason when rejecting (NULL for approved/pending)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_overlays_status").on(table.status),
    index("idx_overlays_author_id").on(table.authorId),
    index("idx_overlays_project").on(table.projectId),
    index("idx_overlays_replaces").on(table.replacesOverlayId),
    index("idx_overlays_kind").on(table.kind),
    sql.raw("CREATE INDEX IF NOT EXISTS idx_overlays_corners ON overlays USING GIST (corners)"),
    sql.raw("CREATE INDEX IF NOT EXISTS idx_overlays_centroid ON overlays USING GIST (centroid)"),
  ],
);

// Administrative boundaries (country/state/city/neighborhood) imported from OSM.
// Projects attach to the boundary holding the majority of their shape; city/state/country
// are read by walking parentId up the hierarchy. Geometry is simplified (not coastline-accurate)
// since it is only used for point/shape containment, never for rendering.
export const adminBoundaries = pgTable(
  "admin_boundaries",
  {
    osmId: text("osm_id").primaryKey(), // Stable natural key, e.g. "relation/1403916"
    adminLevel: integer("admin_level").notNull(), // OSM admin_level: 2=country, 4=state, 6=county, 8=city, 10=neighborhood
    parentId: text("parent_id").references((): AnyPgColumn => adminBoundaries.osmId, {
      onDelete: "set null",
      onUpdate: "cascade",
    }), // Smallest containing boundary one level up; computed at import via containment
    name: text("name").notNull(), // OSM `name` tag (usually the local-language name)
    nameEn: text("name_en"), // OSM `name:en` tag
    names: jsonb("names"), // All `name:*` tag variants, keyed by language code
    countryCode: char("country_code", { length: 3 }), // ISO 3166-1 alpha-3, denormalized for filtering
    geom: multiPolygonType("geom"), // Simplified boundary polygon, GIST indexed for containment
    externalLastModified: timestamp("external_last_modified", { withTimezone: true }), // OSM last-edit timestamp
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true }), // For pruning stale boundaries
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_admin_boundaries_admin_level").on(table.adminLevel),
    index("idx_admin_boundaries_parent").on(table.parentId),
    index("idx_admin_boundaries_country").on(table.countryCode),
    sql.raw(
      "CREATE INDEX IF NOT EXISTS idx_admin_boundaries_geom ON admin_boundaries USING GIST (geom)",
    ),
    // pg_trgm GIN indexes backing the location search (searchBoundariesNearLocation). They make
    // the normalized `LIKE '%term%'` index-driven; without them the search scans the whole table by
    // distance whenever matches aren't near the map center. immutable_search_text (accent fold +
    // lowercase + strip non-alphanumerics) is defined in migration.
    sql.raw(
      "CREATE INDEX IF NOT EXISTS idx_admin_boundaries_name_trgm ON admin_boundaries USING gin (immutable_search_text(name) gin_trgm_ops)",
    ),
    sql.raw(
      "CREATE INDEX IF NOT EXISTS idx_admin_boundaries_name_en_trgm ON admin_boundaries USING gin (immutable_search_text(coalesce(name_en, '')) gin_trgm_ops)",
    ),
    sql.raw(
      "CREATE INDEX IF NOT EXISTS idx_admin_boundaries_names_trgm ON admin_boundaries USING gin (immutable_search_text(coalesce(names::text, '')) gin_trgm_ops)",
    ),
  ],
);

export const changeRequests = pgTable(
  "change_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").$type<EntityType>().notNull(),
    entityId: uuid("entity_id").notNull(),
    fieldName: text("field_name").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"), // Nullable: null is a valid new value (e.g. clearing a geometry field)
    changeReason: text("change_reason"),
    status: changeRequestStatusEnum("status").default("pending").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("idx_change_requests_entity").on(table.entityType, table.entityId),
    index("idx_change_requests_requested_by").on(table.requestedBy),
    index("idx_change_requests_status").on(table.status),
  ],
);

export const changeHistory = pgTable(
  "change_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    changeRequestId: uuid("change_request_id").references(() => changeRequests.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    entityType: text("entity_type").$type<EntityType>().notNull(),
    entityId: uuid("entity_id").notNull(),
    fieldName: text("field_name").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"), // Nullable: mirrors change_requests.new_value
    changedBy: uuid("changed_by").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_change_history_entity").on(table.entityType, table.entityId),
    index("idx_change_history_request").on(table.changeRequestId),
  ],
);

// Attribution index for every file written by the upload endpoint, recorded before the bytes hit
// disk. An upload exists on disk from the moment it is stored, but an overlay row only appears if
// the user goes on to submit; without this table those in-between files have no owner, so they
// escape the per-user pending storage quota and no cleanup path can ever find them.
export const uploadedFiles = pgTable(
  "uploaded_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Compressed image filename, joined against overlays.filename to find the submission (if any).
    filename: text("filename").notNull(),
    // Retained pre-compression source; null when the original could not be written.
    originalFilename: text("original_filename"),
    uploaderId: uuid("uploader_id")
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_uploaded_files_filename").on(table.filename),
    index("idx_uploaded_files_uploader").on(table.uploaderId),
    index("idx_uploaded_files_created_at").on(table.createdAt),
  ],
);

// Scheduled deletions table for managing timed cleanup of replaced/rejected overlay images
export const scheduledDeletions = pgTable(
  "scheduled_deletions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    overlayId: uuid("overlay_id").references(() => overlays.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    filename: text("filename").notNull(),
    deletionDate: timestamp("deletion_date", { withTimezone: true }).notNull(),
    deletionType: text("deletion_type").notNull(), // 'full', 'thumbnail', or 'both'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_scheduled_deletions_date").on(table.deletionDate),
    index("idx_scheduled_deletions_overlay").on(table.overlayId),
  ],
);

// Config table for application-wide settings (single row with id=1)
export const config = pgTable("config", {
  id: integer("id").primaryKey().default(1),
  infoMessage: text("info_message"), // Optional info message to display at top of website
  reportThreshold: integer("report_threshold").default(2).notNull(), // Number of moderator reports before user is blocked
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// User reports table for spam prevention
// Tracks which moderators have reported which users
// Rules: 1 report = hide for that moderator, 2+ reports = warning for all, 3+ or admin = global hide
export const userReports = pgTable(
  "user_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportedUserId: uuid("reported_user_id")
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    reportedBy: uuid("reported_by")
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    reason: text("reason"), // Optional reason for the report
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_user_reports_reported_user").on(table.reportedUserId),
    index("idx_user_reports_reported_by").on(table.reportedBy),
  ],
);

// Tombstones for hard-deleted projects, written by the OSM prune step immediately before deletion.
// A minimal record (not a full copy) so the SEO route can answer HTTP 410 for an indexed URL whose
// project is gone, and the SPA can still center the map on the last known location. Soft-detached
// projects keep their row and never get a tombstone. Because slugs are deterministic, a reappearing
// OSM feature regenerates the same slug; the live row then wins (the resolver checks projects first).
export const deletedProjects = pgTable(
  "deleted_projects",
  {
    slug: text("slug").primaryKey(), // Matches the deleted project's permanent slug
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    status: text("status").$type<"completed" | "removed">().default("removed").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_deleted_projects_deleted_at").on(table.deletedAt)],
);

export type DBDeletedProject = InferSelectModel<typeof deletedProjects>;

// Export Drizzle-inferred types for frontend consumption
export type DBProject = Omit<InferSelectModel<typeof projects>, "externalRevision">;
export type DBOverlay = InferSelectModel<typeof overlays>;
export type DBUser = InferSelectModel<typeof users>;
export type DBChangeRequest = InferSelectModel<typeof changeRequests>;
export type DBChangeHistory = InferSelectModel<typeof changeHistory>;
export type DBScheduledDeletion = InferSelectModel<typeof scheduledDeletions>;
export type DBConfig = InferSelectModel<typeof config>;
export type DBUserReport = InferSelectModel<typeof userReports>;
export type DBImportSource = InferSelectModel<typeof importSources>;
export type DBAdminBoundary = InferSelectModel<typeof adminBoundaries>;
