CREATE TABLE `page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`number` integer NOT NULL,
	`author_id` text NOT NULL,
	`source` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_versions_number` ON `page_versions` (`page_id`,`number`);
