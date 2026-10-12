CREATE TABLE `source_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`notes` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_notes_owner_source` ON `source_notes` (`owner_id`,`source`);
