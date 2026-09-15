CREATE TABLE `agent_run_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_run_history` ON `agent_run_events` (`agent_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `agent_session_state` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`through_sequence` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '{}' NOT NULL,
	`plan` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
