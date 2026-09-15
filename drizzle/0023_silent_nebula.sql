CREATE TABLE `page_file_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`scope` text NOT NULL,
	`path` text NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_page_file_folders` ON `page_file_folders` (`page_id`,`scope`,`path`);--> statement-breakpoint
ALTER TABLE `page_files` ADD `folder_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `page_files` ADD `display_name` text;