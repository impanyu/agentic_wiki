CREATE TABLE `page_live_agents` (
	`page_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`interval_hours` integer DEFAULT 24 NOT NULL,
	`focus` text DEFAULT '' NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_status` text DEFAULT '' NOT NULL,
	`last_summary` text DEFAULT '' NOT NULL,
	`last_revision_id` text,
	`running_until` integer DEFAULT 0 NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_live_agents_due` ON `page_live_agents` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`snapshot` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_revisions_page` ON `page_revisions` (`page_id`,`created_at`);
