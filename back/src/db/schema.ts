import {
  pgTable, uuid, text, timestamp, jsonb, index, doublePrecision, geometry, char
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});


export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  ownerId: uuid('owner_id').references(() => users.id),
  cityId: uuid('city_id').references(() => cities.id), // AI : Reference to the city where the project is located
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});


export const images = pgTable('images', {
  id: uuid('id').defaultRandom().primaryKey(),
  filename: text('filename').notNull(),
  caption: text('caption'),
  projectId: uuid('project_id').references(() => projects.id),
  authorId: uuid('author_id').references(() => users.id),
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
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (images) => ({
  projectIndex: index('idx_images_project').on(images.projectId),
  centroidIndex: sql.raw(`CREATE INDEX idx_images_centroid ON images USING GIST (centroid)`)
}));

export const cities = pgTable('cities', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  countryCode: char('country_code', { length: 3 }).notNull(), // AI : 3-letter country code (ISO 3166-1 alpha-3)
  coordinates: geometry('coordinates', { type: 'point', mode: 'xy', srid: 4326 }).notNull(), // AI : Geographic coordinates as PostGIS point
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (cities) => ({
  countryIndex: index('idx_cities_country').on(cities.countryCode),
  coordinatesIndex: sql.raw(`CREATE INDEX idx_cities_coordinates ON cities USING GIST (coordinates)`)
}));

export const countries = pgTable('countries', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: char('code', { length: 3 }).notNull().unique(), // AI : ISO 3166-1 alpha-3 country code
  name: text('name').notNull(), // AI : Country name in English
  centerCoordinates: geometry('center_coordinates', { type: 'point', mode: 'xy', srid: 4326 }).notNull(), // AI : Geographic center of the country
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (countries) => ({
  codeIndex: index('idx_countries_code').on(countries.code),
  centerIndex: sql.raw(`CREATE INDEX idx_countries_center ON countries USING GIST (center_coordinates)`)
}));