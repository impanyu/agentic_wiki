CREATE TABLE `app_records` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`collection` text NOT NULL,
	`owner_id` text NOT NULL,
	`data` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_app_records_collection` ON `app_records` (`page_id`,`collection`,`owner_id`,`created_at`);
