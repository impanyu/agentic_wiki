CREATE TABLE `page_chat_summaries` (
	`session_id` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`through` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `page_chat_turns` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`message` text NOT NULL,
	`reply` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_page_chat_turns_session` ON `page_chat_turns` (`session_id`,`sequence`);