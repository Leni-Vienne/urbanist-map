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
  char,
  geometry,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

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
    return "geometry(geometrycollection, 4326)";
  },
});
import { sql, relations, type InferSelectModel } from "drizzle-orm";

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "replaced",
]);
export type ApprovalStatus = (typeof approvalStatusEnum.enumValues)[number];

export const changeRequestStatusEnum = pgEnum("change_request_status", [
  "pending",
  "approved",
  "rejected",
  "conflicted",
]);

export type ChangeRequestStatus = (typeof changeRequestStatusEnum.enumValues)[number];

// Date precision values - used for flexible date display
// Using const array + text column (not enum) for easier modification
export const DATE_PRECISION_VALUES = ["year", "month", "day"] as const;
export type DatePrecision = (typeof DATE_PRECISION_VALUES)[number];

export type EntityType = "project" | "overlay";

// Users table for custom authentication
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").unique().notNull(),
    username: text("username").unique(),
    passwordHash: text("password_hash"), // Now nullable for OAuth users
    role: text("role").default("user"), // Role can be 'user', 'admin', etc.
    moderatedCountries: text("moderated_countries").array(), // Array of ISO 3-letter country codes this moderator can moderate (null = admin with all countries)
    emailVerified: boolean("email_verified").default(false).notNull(),
    emailVerificationToken: text("email_verification_token"),
    passwordResetToken: text("password_reset_token"),
    passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
    // OAuth provider IDs for secure authentication
    googleId: text("google_id").unique(), // Google's unique user ID (sub field)
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
    index("idx_users_google_id").on(users.googleId), // Index for Google OAuth lookups
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  overlays: many(overlays),
}));

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
    name: text("name").notNull(),
    description: text("description"),
    status: approvalStatusEnum("status").default("pending").notNull(),
    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    cityId: integer("city_id")
      .references(() => cities.id, { onDelete: "set null", onUpdate: "cascade" })
      .notNull(), // Reference to the city where the project is located
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
    centerCoordinate: geometry("center_coordinate", { type: "point", mode: "xy", srid: 4326 }), // PostGIS point for spatial queries (computed from lat/lng)
    geometry: geometryCollectionType("geometry"), // PostGIS GeometryCollection for project shapes (lines + polygons)
    geometrySizeM: doublePrecision("geometry_size_m"), // Bbox diagonal in meters (null = no geometry). Computed on save.
    tags: text("tags").array(), // Project category tags (e.g. 'tram', 'rail', 'bike')
    version: integer("version").default(1).notNull(), // Version for optimistic locking during moderation
    rejectionReason: text("rejection_reason"), // Moderator-selected reason when rejecting (NULL for approved/pending)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_projects_status").on(table.status),
    index("idx_projects_owner_id").on(table.ownerId),
    sql.raw(
      "CREATE INDEX idx_projects_center_coordinate ON projects USING GIST (center_coordinate)",
    ), // Spatial index for project center coordinates
    sql.raw("CREATE INDEX IF NOT EXISTS idx_projects_geometry ON projects USING GIST (geometry)"), // Spatial index for geometry bbox filtering and MVT tiles
    sql.raw("CREATE INDEX IF NOT EXISTS idx_projects_tags ON projects USING GIN (tags)"), // GIN index for efficient tag filtering
  ],
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  city: one(cities, {
    fields: [projects.cityId],
    references: [cities.id],
  }),
  overlays: many(overlays),
}));

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

    corners: geometry("corners", { type: "polygon", mode: "xy", srid: 4326 }).notNull(),
    centroid: geometry("centroid", { type: "point", mode: "xy", srid: 4326 }).notNull(),

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
    sql.raw("CREATE INDEX IF NOT EXISTS idx_overlays_corners ON overlays USING GIST (corners)"),
    sql.raw("CREATE INDEX IF NOT EXISTS idx_overlays_centroid ON overlays USING GIST (centroid)"),
  ],
);

export const overlaysRelations = relations(overlays, ({ one }) => ({
  project: one(projects, {
    fields: [overlays.projectId],
    references: [projects.id],
  }),
  author: one(users, {
    fields: [overlays.authorId],
    references: [users.id],
  }),
  replacesOverlay: one(overlays, {
    fields: [overlays.replacesOverlayId],
    references: [overlays.id],
    relationName: "overlay_replacement",
  }),
}));

export const cities = pgTable(
  "cities",
  {
    id: integer("id").primaryKey(), // GeoNames city ID (natural key from GeoNames database)
    name: text("name").notNull(), // English/ASCII name from GeoNames
    nameLocal: text("name_local"), // Local/native name in country's primary language (nullable - only if alternateNames available)
    countryCode: char("country_code", { length: 3 }).notNull(), // 3-letter country code (ISO 3166-1 alpha-3)
    coordinates: geometry("coordinates", { type: "point", mode: "xy", srid: 4326 }).notNull(), // Geographic coordinates as PostGIS point
    approvedProjectCount: integer("approved_project_count").default(0).notNull(), // Pre-computed count of approved projects for fast search
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // eslint-disable-next-line eslint/no-shadow
  (cities) => [
    index("idx_cities_country").on(cities.countryCode),
    index("idx_cities_name").on(cities.name), // Index for fast ILIKE searches on English name
    index("idx_cities_name_local").on(cities.nameLocal), // Index for fast ILIKE searches on local name
    sql.raw("CREATE INDEX idx_cities_coordinates ON cities USING GIST (coordinates)"),
  ],
);

export const citiesRelations = relations(cities, ({ many }) => ({
  projects: many(projects),
}));

export const countries = pgTable(
  "countries",
  {
    id: integer("id").primaryKey(), // GeoNames country ID (natural key from GeoNames database)
    code: char("code", { length: 3 }).notNull().unique(), // ISO 3166-1 alpha-3 country code (e.g., "FRA", "USA", "JPN")
    code2: char("code2", { length: 2 }).notNull().unique(), // ISO 3166-1 alpha-2 country code for flags (e.g., "FR", "US", "JP")
    name: text("name").notNull(), // Country name in English
    centerCoordinates: geometry("center_coordinates", {
      type: "point",
      mode: "xy",
      srid: 4326,
    }).notNull(), // Geographic center of the country
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // eslint-disable-next-line eslint/no-shadow
  (countries) => [
    index("idx_countries_code").on(countries.code),
    index("idx_countries_code2").on(countries.code2), // Index for flag lookups
    sql.raw(`CREATE INDEX idx_countries_center ON countries USING GIST (center_coordinates)`),
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

export const changeRequestsRelations = relations(changeRequests, ({ one }) => ({
  requestedByUser: one(users, {
    fields: [changeRequests.requestedBy],
    references: [users.id],
  }),
}));

export const changeHistoryRelations = relations(changeHistory, ({ one }) => ({
  changeRequest: one(changeRequests, {
    fields: [changeHistory.changeRequestId],
    references: [changeRequests.id],
  }),
  changedByUser: one(users, {
    fields: [changeHistory.changedBy],
    references: [users.id],
    relationName: "changed_by",
  }),
  approvedByUser: one(users, {
    fields: [changeHistory.approvedBy],
    references: [users.id],
    relationName: "approved_by",
  }),
}));

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

export const scheduledDeletionsRelations = relations(scheduledDeletions, ({ one }) => ({
  overlay: one(overlays, {
    fields: [scheduledDeletions.overlayId],
    references: [overlays.id],
  }),
}));

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

export const userReportsRelations = relations(userReports, ({ one }) => ({
  reportedUser: one(users, {
    fields: [userReports.reportedUserId],
    references: [users.id],
    relationName: "reports_received",
  }),
  reporter: one(users, {
    fields: [userReports.reportedBy],
    references: [users.id],
    relationName: "reports_made",
  }),
}));

// Export Drizzle-inferred types for frontend consumption
export type DBCity = InferSelectModel<typeof cities>;
export type DBProject = InferSelectModel<typeof projects>;
export type DBOverlay = InferSelectModel<typeof overlays>;
export type DBUser = InferSelectModel<typeof users>;
export type DBCountry = InferSelectModel<typeof countries>;
export type DBChangeRequest = InferSelectModel<typeof changeRequests>;
export type DBChangeHistory = InferSelectModel<typeof changeHistory>;
export type DBScheduledDeletion = InferSelectModel<typeof scheduledDeletions>;
export type DBConfig = InferSelectModel<typeof config>;
export type DBUserReport = InferSelectModel<typeof userReports>;
