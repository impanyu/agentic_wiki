CREATE TABLE `page_replacements` (
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`page_id` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_page_replacement_user_source` ON `page_replacements` (`user_id`,`source_id`);