import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Only the latest crew position is retained. Capability tokens are never stored.
export const crewRooms = sqliteTable("crew_rooms", {
  viewHash: text("view_hash").primaryKey(),
  publishHash: text("publish_hash").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  sharing: integer("sharing", { mode: "boolean" }).notNull().default(false),
  lat: real("lat"),
  lng: real("lng"),
  accuracy: real("accuracy"),
  positionUpdatedAt: integer("position_updated_at"),
  positionRecordedAt: integer("position_recorded_at"),
  bib: text("bib").notNull().default(""),
  meetupJson: text("meetup_json"),
  googleMapsUrl: text("google_maps_url"),
}, (table) => [index("crew_rooms_expires_idx").on(table.expiresAt)]);

// A separate, single-row cache/lease protects the public routing provider.
// It never reads or changes the crew room or checkpoint state.
export const toiletRoutingCache = sqliteTable("toilet_routing_cache", {
  id: integer("id").primaryKey(),
  leaseUntil: integer("lease_until").notNull().default(0),
  leaseToken: text("lease_token"),
  cacheKey: text("cache_key"),
  expiresAt: integer("expires_at").notNull().default(0),
  resultJson: text("result_json"),
});
