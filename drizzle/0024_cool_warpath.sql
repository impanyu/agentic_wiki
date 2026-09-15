CREATE TABLE `connector_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`revision` integer NOT NULL,
	`page_id` text,
	`tool` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_connector_actions_owner` ON `connector_actions` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_connectors` (
	`id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`allowed` text DEFAULT '[]' NOT NULL,
	`automatic` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connector_owner_id` ON `user_connectors` (`owner_id`,`id`);