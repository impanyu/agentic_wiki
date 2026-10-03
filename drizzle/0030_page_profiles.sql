CREATE TABLE `page_profiles` (
	`page_id` text PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`embedding` text NOT NULL,
	`source_updated` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
