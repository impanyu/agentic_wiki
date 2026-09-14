CREATE TABLE `session_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`question_id` text NOT NULL,
	`session_id` text NOT NULL,
	`page_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_routes_owner_question` ON `session_routes` (`owner_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `idx_session_routes_session` ON `session_routes` (`session_id`);