ALTER TABLE `wiki_comments` ADD `legacy_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wiki_comments_legacy` ON `wiki_comments` (`legacy_key`);