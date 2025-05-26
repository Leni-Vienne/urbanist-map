import {
  pgTable, uuid, text, timestamp, jsonb, index, doublePrecision, geometry
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