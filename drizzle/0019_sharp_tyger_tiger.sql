CREATE TABLE `root_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`question` text NOT NULL,
	`normalized` text NOT NULL,
	`language` text NOT NULL,
	`embedding` text NOT NULL,
	`target_type` text NOT NULL,
	`app_id` text,
	`intent` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_root_routes_owner_question` ON `root_routes` (`owner_id`,`language`,`normalized`);--> statement-breakpoint
CREATE TABLE `wiki_routes` (
	`question_id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
