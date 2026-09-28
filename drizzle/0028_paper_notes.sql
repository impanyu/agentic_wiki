CREATE TABLE `paper_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`document` text NOT NULL,
	`page_number` integer NOT NULL,
	`color` text NOT NULL,
	`quote` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`rects` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `paper_notes_reader` ON `paper_notes` (`owner_id`,`page_id`,`document`);
