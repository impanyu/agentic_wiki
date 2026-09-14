CREATE TABLE `generation_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`question` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`category` text NOT NULL,
	`sources` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pages_owner` ON `pages` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_pages_visibility_created` ON `pages` (`visibility`,`created_at`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`normalized` text NOT NULL,
	`question` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_questions_page_normalized` ON `questions` (`page_id`,`normalized`);--> statement-breakpoint
CREATE INDEX `idx_questions_normalized` ON `questions` (`normalized`);