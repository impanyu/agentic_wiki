CREATE TABLE `wiki_comments` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` text NOT NULL,
	`session_id` text NOT NULL,
	`author_name` text NOT NULL,
	`message` text NOT NULL,
	`reply` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wiki_comments_page_sequence` ON `wiki_comments` (`page_id`,`sequence`);