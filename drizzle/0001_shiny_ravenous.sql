CREATE TABLE `toilet_routing_cache` (
	`id` integer PRIMARY KEY NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`cache_key` text,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`result_json` text
);
