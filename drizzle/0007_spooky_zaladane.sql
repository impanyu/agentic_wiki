CREATE TABLE `component_dependencies` (
	`parent_id` text NOT NULL,
	`role` text NOT NULL,
	`component_id` text NOT NULL,
	`version` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_component_dependency_role` ON `component_dependencies` (`parent_id`,`role`);--> statement-breakpoint
CREATE TABLE `component_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`component_id` text NOT NULL,
	`type` text NOT NULL,
	`scope` text NOT NULL,
	`language` text NOT NULL,
	`question` text NOT NULL,
	`normalized` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_component_question_key` ON `component_questions` (`scope`,`type`,`language`,`normalized`);--> statement-breakpoint
CREATE INDEX `idx_component_question_search` ON `component_questions` (`type`,`language`,`id`);--> statement-breakpoint
CREATE TABLE `components` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`owner_id` text NOT NULL,
	`visibility` text NOT NULL,
	`language` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_components_type_language` ON `components` (`type`,`language`);--> statement-breakpoint
INSERT INTO components SELECT id,'page',1,owner_id,visibility,language,title,summary,json_object('pageId',id,'capability',CASE WHEN kind='dynamic' THEN 'unit-converter-v1' ELSE 'article' END),created_at FROM pages;
--> statement-breakpoint
INSERT OR REPLACE INTO component_questions SELECT q.id,p.id,'page',CASE WHEN p.visibility='public' THEN 'public' ELSE p.owner_id END,p.language,q.question,q.normalized,q.embedding,q.created_at FROM questions q JOIN pages p ON p.id=q.page_id WHERE NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=p.id) ORDER BY q.created_at,q.id;
--> statement-breakpoint
CREATE TRIGGER components_page_insert AFTER INSERT ON pages BEGIN
 INSERT INTO components VALUES(NEW.id,'page',1,NEW.owner_id,NEW.visibility,NEW.language,NEW.title,NEW.summary,json_object('pageId',NEW.id,'capability',CASE WHEN NEW.kind='dynamic' THEN COALESCE(json_extract(NEW.dynamic_config,'$.capability'),'unit-converter-v1') ELSE 'article' END),NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER components_page_update AFTER UPDATE ON pages BEGIN
 UPDATE components SET owner_id=NEW.owner_id,visibility=NEW.visibility,language=NEW.language,title=NEW.title,description=NEW.summary WHERE id=NEW.id;
 DELETE FROM component_questions WHERE component_id=NEW.id;
 INSERT OR REPLACE INTO component_questions SELECT id,page_id,'page',CASE WHEN NEW.visibility='public' THEN 'public' ELSE NEW.owner_id END,NEW.language,question,normalized,embedding,created_at FROM questions WHERE page_id=NEW.id ORDER BY created_at,id;
END;
--> statement-breakpoint
CREATE TRIGGER components_page_delete AFTER DELETE ON pages BEGIN DELETE FROM components WHERE id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER components_question_insert AFTER INSERT ON questions BEGIN
 INSERT OR REPLACE INTO component_questions SELECT NEW.id,p.id,'page',CASE WHEN p.visibility='public' THEN 'public' ELSE p.owner_id END,p.language,NEW.question,NEW.normalized,NEW.embedding,NEW.created_at FROM pages p WHERE p.id=NEW.page_id AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=p.id);
END;
--> statement-breakpoint
CREATE TRIGGER components_question_delete AFTER DELETE ON questions BEGIN DELETE FROM component_questions WHERE id=OLD.id; END;
--> statement-breakpoint
INSERT INTO components SELECT id||':frontend','frontend_template',1,owner_id,visibility,language,title,summary,json_object('kind','registered','implementation','unit-converter-v1','labels',json_extract(dynamic_config,'$.labels')),created_at FROM pages WHERE kind='dynamic';
--> statement-breakpoint
INSERT INTO components SELECT id||':backend','backend_code',1,owner_id,visibility,language,title,summary,json_object('kind','registered','implementation','unit-converter-v1'),created_at FROM pages WHERE kind='dynamic';
--> statement-breakpoint
INSERT OR REPLACE INTO component_questions SELECT q.id||':frontend',p.id||':frontend','frontend_template',CASE WHEN p.visibility='public' THEN 'public' ELSE p.owner_id END,p.language,q.question,q.normalized,q.embedding,q.created_at FROM questions q JOIN pages p ON p.id=q.page_id WHERE p.kind='dynamic' ORDER BY q.created_at,q.id;
--> statement-breakpoint
INSERT OR REPLACE INTO component_questions SELECT q.id||':backend',p.id||':backend','backend_code',CASE WHEN p.visibility='public' THEN 'public' ELSE p.owner_id END,p.language,q.question,q.normalized,q.embedding,q.created_at FROM questions q JOIN pages p ON p.id=q.page_id WHERE p.kind='dynamic' ORDER BY q.created_at,q.id;
--> statement-breakpoint
INSERT INTO component_dependencies SELECT id,'frontend',id||':frontend',1 FROM pages WHERE kind='dynamic';
--> statement-breakpoint
INSERT INTO component_dependencies SELECT id,'backend',id||':backend',1 FROM pages WHERE kind='dynamic';
--> statement-breakpoint
UPDATE pages SET dynamic_config=json_set(dynamic_config,'$.components',json_object('frontend',json_object('id',id||':frontend','version',1),'backend',json_object('id',id||':backend','version',1))) WHERE kind='dynamic';
