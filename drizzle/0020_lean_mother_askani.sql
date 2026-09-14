CREATE TABLE `page_forks` (
	`page_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`parent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_page_forks_group` ON `page_forks` (`group_id`);