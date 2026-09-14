ALTER TABLE `internal_links` ADD `parameters` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `kind` text DEFAULT 'static' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `dynamic_config` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `capability` text DEFAULT 'article' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `parameters` text DEFAULT '{}' NOT NULL;