import {
  pgTable, uuid, text, timestamp, jsonb, index, doublePrecision, geometry, char, pgEnum, boolean, integer,
} from 'drizzle-orm/pg-core';
import {
  sql, InferSelectModel, relations,
} from 'drizzle-orm';

export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'replaced']);
export const changeRequestStatusEnum = pgEnum('change_request_status', ['pending', 'approved', 'rejected', 'conflicted']);

// AI : Users table for custom authentication
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').unique().notNull(),
  username: text('username').unique(),
  passwordHash: text('password_hash'), // AI : Now nullable for OAuth users
  role: text('role').default('user'), // AI : Role can be 'user', 'admin', etc.
  moderatedCountries: text('moderated_countries').array(), // AI : Array of ISO 3-letter country codes this moderator can moderate (null = admin with all countries)
  emailVerified: boolean('email_verified').default(false).notNull(),
  emailVerificationToken: text('email_verification_token'),
  passwordResetToken: text('password_reset_token'),
  passwordResetExpiresAt: timestamp('password_reset_expires_at', { withTimezone: true }),
  // AI : OAuth provider IDs for secure authentication
  googleId: text('google_id').unique(), // AI : Google's unique user ID (sub field)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (users) => [
  index('idx_users_email').on(users.email),
  index('idx_users_email_verification').on(users.emailVerificationToken),
  index('idx_users_password_reset').on(users.passwordResetToken),
  index('idx_users_google_id').on(users.googleId), // AI : Index for Google OAuth lookups
]);;


export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  overlays: many(overlays),
}));

// AI : Sessions table for database-backed session storage
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // AI : Session ID from hono-sessions
  data: jsonb('data').notNull(), // AI : Session data (user info, expiresAt, etc)
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (sessions) => [
  index('idx_sessions_expires_at').on(sessions.expiresAt), // AI : Index for cleanup queries
]);

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  isDevelopment: boolean('is_development').default(false).notNull(), // AI : true for simple development markers, false for overlay projects
  status: approvalStatusEnum('status').default('pending').notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null', onUpdate: 'cascade' }).notNull(), // AI : Reference to the city where the project is located
  sourceUrl: text('source_url'),
  proposalDate: timestamp('proposal_date', { withTimezone: true }),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  latestUpdateOn: timestamp('latest_update_on', { withTimezone: true }),
  // AI : Coordinates for development projects (null for overlay projects)
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  coordinates: geometry('coordinates', { type: 'point', mode: 'xy', srid: 4326 }), // AI : PostGIS point for spatial queries (computed from lat/lng)
  version: integer('version').default(1).notNull(), // AI : Version for optimistic locking during moderation
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (_projects) => [
  sql.raw('CREATE INDEX idx_projects_coordinates ON projects USING GIST (coordinates)'), // AI : Spatial index for development projects
]);

export const projectsRelations = relations(projects, ({
  one, many,
}) => ({
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

export const overlays = pgTable('overlays', {
  id: uuid('id').defaultRandom().primaryKey(),
  filename: text('filename').notNull(),
  caption: text('caption'),
  status: approvalStatusEnum('status').default('pending').notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  replacesOverlayId: uuid('replaces_overlay_id'), // AI : Reference to the overlay this replaces (set by user during upload)
  replacedByOverlayId: uuid('replaced_by_overlay_id'), // AI : Reference to the overlay that replaced this one (set by moderator during approval)

  corners: geometry('corners', { type: 'polygon', mode: 'xy', srid: 4326 }).notNull(),
  centroid: geometry('centroid', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),

  version: integer('version').default(1).notNull(), // AI : Version for optimistic locking during moderation
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (overlays) => [
  index('idx_overlays_project').on(overlays.projectId),
  index('idx_overlays_replaces').on(overlays.replacesOverlayId),
  sql.raw('CREATE INDEX IF NOT EXISTS idx_overlays_corners ON overlays USING GIST (corners)'),
  sql.raw('CREATE INDEX IF NOT EXISTS idx_overlays_centroid ON overlays USING GIST (centroid)'),
]);

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
    relationName: 'overlay_replacement'
  }),
}));

export const cities = pgTable('cities', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  countryCode: char('country_code', { length: 3 }).notNull(), // AI : 3-letter country code (ISO 3166-1 alpha-3)
  coordinates: geometry('coordinates', { type: 'point', mode: 'xy', srid: 4326 }).notNull(), // AI : Geographic coordinates as PostGIS point
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (cities) => [
  index('idx_cities_country').on(cities.countryCode),
  sql.raw('CREATE INDEX idx_cities_coordinates ON cities USING GIST (coordinates)'),
]);

export const citiesRelations = relations(cities, ({ many }) => ({
  projects: many(projects),
}));

export const countries = pgTable('countries', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: char('code', { length: 3 }).notNull().unique(), // AI : ISO 3166-1 alpha-3 country code
  name: text('name').notNull(), // AI : Country name in English
  centerCoordinates: geometry('center_coordinates', { type: 'point', mode: 'xy', srid: 4326 }).notNull(), // AI : Geographic center of the country
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date())
}, (countries) => [
  index('idx_countries_code').on(countries.code),
  sql.raw(`CREATE INDEX idx_countries_center ON countries USING GIST (center_coordinates)`)
]);


export const changeRequests = pgTable('change_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  fieldName: text('field_name').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value').notNull(),
  changeReason: text('change_reason'),
  status: changeRequestStatusEnum('status').default('pending').notNull(),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
}, (table) => [
  index('idx_change_requests_entity').on(table.entityType, table.entityId),
  index('idx_change_requests_requested_by').on(table.requestedBy),
  index('idx_change_requests_status').on(table.status),
]);

export const changeHistory = pgTable('change_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  fieldName: text('field_name').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value').notNull(),
  changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_change_history_entity').on(table.entityType, table.entityId),
  index('idx_change_history_request').on(table.changeRequestId),
]);

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
    relationName: 'changed_by'
  }),
  approvedByUser: one(users, {
    fields: [changeHistory.approvedBy],
    references: [users.id],
    relationName: 'approved_by'
  }),
}));

// AI : Scheduled deletions table for managing timed cleanup of replaced/rejected overlay images
export const scheduledDeletions = pgTable('scheduled_deletions', {
  id: uuid('id').defaultRandom().primaryKey(),
  overlayId: uuid('overlay_id').references(() => overlays.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  filename: text('filename').notNull(),
  deletionDate: timestamp('deletion_date', { withTimezone: true }).notNull(),
  deletionType: text('deletion_type').notNull(), // AI : 'full', 'thumbnail', or 'both'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_scheduled_deletions_date').on(table.deletionDate),
  index('idx_scheduled_deletions_overlay').on(table.overlayId),
]);

export const scheduledDeletionsRelations = relations(scheduledDeletions, ({ one }) => ({
  overlay: one(overlays, {
    fields: [scheduledDeletions.overlayId],
    references: [overlays.id],
  }),
}));

// AI : Config table for application-wide settings (single row with id=1)
export const config = pgTable('config', {
  id: integer('id').primaryKey().default(1),
  infoMessage: text('info_message'), // AI : Optional info message to display at top of website
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});

// AI : Export Drizzle-inferred types for frontend consumption
export type DBCity = InferSelectModel<typeof cities>;
export type DBProject = InferSelectModel<typeof projects>;
export type DBOverlay = InferSelectModel<typeof overlays>;
export type DBUser = InferSelectModel<typeof users>;
export type DBCountry = InferSelectModel<typeof countries>;
export type DBChangeRequest = InferSelectModel<typeof changeRequests>;
export type DBChangeHistory = InferSelectModel<typeof changeHistory>;
export type DBScheduledDeletion = InferSelectModel<typeof scheduledDeletions>;
export type DBConfig = InferSelectModel<typeof config>;
