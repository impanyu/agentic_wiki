CREATE TABLE `earth_engine_usage` (
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`account` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `day`, `account`)
);
--> statement-breakpoint
CREATE TABLE `earth_engine_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account` text NOT NULL,
	`project` text NOT NULL,
	`map_name` text NOT NULL,
	`created_at` integer NOT NULL
);
