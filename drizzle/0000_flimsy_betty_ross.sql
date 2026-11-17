CREATE TABLE `crew_rooms` (
	`view_hash` text PRIMARY KEY NOT NULL,
	`publish_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sharing` integer DEFAULT false NOT NULL,
	`lat` real,
	`lng` real,
	`accuracy` real,
	`position_updated_at` integer,
	`position_recorded_at` integer,
	`bib` text DEFAULT '' NOT NULL,
	`meetup_json` text,
	`google_maps_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crew_rooms_publish_hash_unique` ON `crew_rooms` (`publish_hash`);--> statement-breakpoint
CREATE INDEX `crew_rooms_expires_idx` ON `crew_rooms` (`expires_at`);