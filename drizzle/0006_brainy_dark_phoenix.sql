CREATE TABLE `page_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`page_id` text NOT NULL,
	`title` text NOT NULL,
	`question` text NOT NULL,
	`parameters` text DEFAULT '{}' NOT NULL,
	`visited_at` integer,
	`recorded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_page_visits_owner_time` ON `page_visits` (`owner_key`,`visited_at`,`recorded_at`,`id`);