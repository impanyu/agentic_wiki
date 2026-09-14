CREATE TABLE `page_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
