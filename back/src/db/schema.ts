import {
  pgTable, uuid, text, timestamp, jsonb, index, doublePrecision, geometry, char, pgEnum,
} from 'drizzle-orm/pg-core';
import {
  sql, InferSelectModel, relations,
} from 'drizzle-orm';

export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  overlays: many(overlays),
}));

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: approvalStatusEnum('status').default('pending').notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null', onUpdate: 'cascade' }), // AI : Reference to the city where the project is located
  metadata: jsonb('metadata'),
  sourceUrl: text('source_url'),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  latestUpdateOn: timestamp('latest_update_on', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});

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
  replacesOverlayId: uuid('replaces_overlay_id'), // AI : Reference to the overlay this replaces (self-reference added via relations)
  metadata: jsonb('metadata'), // pour EXIF, etc.

  // Coordonnées des 4 coins (séparées)
  topLeftLat: doublePrecision('top_left_lat').notNull(),
  topLeftLng: doublePrecision('top_left_lng').notNull(),
  topRightLat: doublePrecision('top_right_lat').notNull(),
  topRightLng: doublePrecision('top_right_lng').notNull(),
  bottomRightLat: doublePrecision('bottom_right_lat').notNull(),
  bottomRightLng: doublePrecision('bottom_right_lng').notNull(),
  bottomLeftLat: doublePrecision('bottom_left_lat').notNull(),
  bottomLeftLng: doublePrecision('bottom_left_lng').notNull(),

  centroid: geometry('centroid', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (overlays) => ({
  projectIndex: index('idx_overlays_project').on(overlays.projectId),
  centroidIndex: sql.raw('CREATE INDEX idx_overlays_centroid ON overlays USING GIST (centroid)'),
}));

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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (cities) => ({
  countryIndex: index('idx_cities_country').on(cities.countryCode),
  coordinatesIndex: sql.raw('CREATE INDEX idx_cities_coordinates ON cities USING GIST (coordinates)'),
}));

export const citiesRelations = relations(cities, ({ many }) => ({
  projects: many(projects),
}));

export const countries = pgTable('countries', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: char('code', { length: 3 }).notNull().unique(), // AI : ISO 3166-1 alpha-3 country code
  name: text('name').notNull(), // AI : Country name in English
  centerCoordinates: geometry('center_coordinates', { type: 'point', mode: 'xy', srid: 4326 }).notNull(), // AI : Geographic center of the country
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date())
}, (countries) => ({
  codeIndex: index('idx_countries_code').on(countries.code),
  centerIndex: sql.raw(`CREATE INDEX idx_countries_center ON countries USING GIST (center_coordinates)`)
}));


// AI : Export Drizzle-inferred types for frontend consumption
export type DBCity = InferSelectModel<typeof cities>;
export type DBProject = InferSelectModel<typeof projects>;
export type DBOverlay = InferSelectModel<typeof overlays>;
export type DBUser = InferSelectModel<typeof users>;
export type DBCountry = InferSelectModel<typeof countries>;
