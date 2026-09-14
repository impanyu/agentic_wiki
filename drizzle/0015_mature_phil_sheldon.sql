CREATE TABLE `page_files` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`component_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_page_files_context` ON `page_files` (`page_id`,`scope`);