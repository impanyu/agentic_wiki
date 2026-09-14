ALTER TABLE `pages` ADD `language` text DEFAULT 'und' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `labels` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_pages_language` ON `pages` (`language`);