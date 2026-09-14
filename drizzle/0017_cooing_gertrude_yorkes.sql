ALTER TABLE `questions` ADD `routing_scope` text DEFAULT 'wiki' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_questions_router` ON `questions` (`routing_scope`,`normalized`);