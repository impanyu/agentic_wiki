CREATE TABLE `agent_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`owner_id` text NOT NULL,
	`parent_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_memory` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_memory_fifo` ON `agent_memory` (`agent_id`,`sequence`);