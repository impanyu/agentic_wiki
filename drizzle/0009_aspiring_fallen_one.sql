CREATE TABLE `sandbox_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sandbox_owner` ON `sandbox_sessions` (`owner_id`,`created_at`);