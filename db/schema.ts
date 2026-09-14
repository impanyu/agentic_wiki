import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const pages = sqliteTable('pages', {
 id:text('id').primaryKey(), ownerId:text('owner_id').notNull(), question:text('question').notNull(),
 title:text('title').notNull(), summary:text('summary').notNull(), body:text('body').notNull(),
 kind:text('kind').notNull().default('static'),dynamicConfig:text('dynamic_config'),
 category:text('category').notNull(), sources:text('sources').notNull(),
 language:text('language').notNull().default('und'), labels:text('labels').notNull().default('{}'),
 visibility:text('visibility',{enum:['private','public']}).notNull().default('private'), createdAt:text('created_at').notNull(),updatedAt:text('updated_at'),checkedAt:text('checked_at'),
},t=>[index('idx_pages_language').on(t.language),index('idx_pages_owner').on(t.ownerId),index('idx_pages_visibility_created').on(t.visibility,t.createdAt)]);
export const questions = sqliteTable('questions', {
 id:text('id').primaryKey(), pageId:text('page_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),
 routingScope:text('routing_scope').notNull().default('wiki'),
 capability:text('capability').notNull().default('article'),parameters:text('parameters').notNull().default('{}'),
 matchVersion:integer('match_version').notNull().default(0),
 normalized:text('normalized').notNull(), question:text('question').notNull(), embedding:text('embedding').notNull(), createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('idx_questions_page_normalized').on(t.pageId,t.normalized),index('idx_questions_normalized').on(t.normalized),index('idx_questions_router').on(t.routingScope,t.normalized)]);
export const locks = sqliteTable('generation_locks',{name:text('name').primaryKey(),token:text('token').notNull(),expires:integer('expires').notNull()});

export const pageAliases=sqliteTable('page_aliases',{id:text('id').primaryKey(),pageId:text('page_id').notNull().references(()=>pages.id,{onDelete:'cascade'})});

export const internalLinks=sqliteTable('internal_links',{
 id:text('id').primaryKey(),sourceId:text('source_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),
 targetId:text('target_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),
 parameters:text('parameters').notNull().default('{}'),
 quote:text('quote').notNull(),segments:text('segments').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_internal_links_source').on(t.sourceId)]);

export const pageVisits=sqliteTable('page_visits',{
 id:text('id').primaryKey(),ownerKey:text('owner_key').notNull(),pageId:text('page_id').notNull(),
 title:text('title').notNull(),question:text('question').notNull(),parameters:text('parameters').notNull().default('{}'),
 visitedAt:integer('visited_at'),recordedAt:integer('recorded_at').notNull(),
},t=>[index('idx_page_visits_owner_time').on(t.ownerKey,t.visitedAt,t.recordedAt,t.id)]);

// Pages retain their existing article fields as a subtype of the component pool.
export const components=sqliteTable('components',{
 id:text('id').primaryKey(),type:text('type').notNull(),version:integer('version').notNull().default(1),
 ownerId:text('owner_id').notNull(),visibility:text('visibility').notNull(),language:text('language').notNull(),
 title:text('title').notNull(),description:text('description').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_components_type_language').on(t.type,t.language)]);
export const componentQuestions=sqliteTable('component_questions',{
 id:text('id').primaryKey(),componentId:text('component_id').notNull().references(()=>components.id,{onDelete:'cascade'}),
 type:text('type').notNull(),scope:text('scope').notNull(),language:text('language').notNull(),
 question:text('question').notNull(),normalized:text('normalized').notNull(),embedding:text('embedding').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('idx_component_question_key').on(t.scope,t.type,t.language,t.normalized),index('idx_component_question_search').on(t.type,t.language,t.id)]);
export const componentDependencies=sqliteTable('component_dependencies',{
 parentId:text('parent_id').notNull().references(()=>components.id,{onDelete:'cascade'}),
 role:text('role').notNull(),componentId:text('component_id').notNull().references(()=>components.id),version:integer('version').notNull(),
},t=>[uniqueIndex('idx_component_dependency_role').on(t.parentId,t.role)]);
export const agentInstances=sqliteTable('agent_instances',{
 id:text('id').primaryKey(),role:text('role').notNull(),ownerId:text('owner_id').notNull(),parentId:text('parent_id'),createdAt:text('created_at').notNull(),
});
export const agentMemory=sqliteTable('agent_memory',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),agentId:text('agent_id').notNull().references(()=>agentInstances.id,{onDelete:'cascade'}),
 action:text('action').notNull(),result:text('result').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_agent_memory_fifo').on(t.agentId,t.sequence)]);

export const sandboxSessions=sqliteTable('sandbox_sessions',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),providerId:text('provider_id').notNull(),kind:text('kind').notNull(),state:text('state').notNull(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),
},t=>[index('idx_sandbox_owner').on(t.ownerId,t.createdAt)]);

export const pageReplacements=sqliteTable('page_replacements',{
 userId:text('user_id').notNull(),sourceId:text('source_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),pageId:text('page_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),
},t=>[uniqueIndex('idx_page_replacement_user_source').on(t.userId,t.sourceId)]);

export const pageChatTurns=sqliteTable('page_chat_turns',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),sessionId:text('session_id').notNull().references(()=>agentInstances.id,{onDelete:'cascade'}),message:text('message').notNull(),reply:text('reply').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_page_chat_turns_session').on(t.sessionId,t.sequence)]);
export const pageChatSummaries=sqliteTable('page_chat_summaries',{
 sessionId:text('session_id').primaryKey().references(()=>agentInstances.id,{onDelete:'cascade'}),summary:text('summary').notNull(),through:integer('through').notNull(),
});

export const wikiComments=sqliteTable('wiki_comments',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),pageId:text('page_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),
 sessionId:text('session_id').notNull().references(()=>agentInstances.id,{onDelete:'cascade'}),authorName:text('author_name').notNull(),
 message:text('message').notNull(),reply:text('reply').notNull(),createdAt:text('created_at').notNull(),
 legacyKey:text('legacy_key'),
},t=>[index('idx_wiki_comments_page_sequence').on(t.pageId,t.sequence),uniqueIndex('idx_wiki_comments_legacy').on(t.legacyKey)]);

export const pageFiles=sqliteTable('page_files',{
 id:text('id').primaryKey(),pageId:text('page_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),
 componentId:text('component_id').notNull().references(()=>components.id,{onDelete:'cascade'}),
 ownerId:text('owner_id').notNull(),scope:text('scope').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_page_files_context').on(t.pageId,t.scope)]);

export const contextJobs=sqliteTable('context_jobs',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),kind:text('kind').notNull(),title:text('title').notNull(),pageId:text('page_id'),state:text('state').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),expires:integer('expires').notNull(),
},t=>[index('idx_context_jobs_owner_state').on(t.ownerId,t.state,t.expires)]);

export const sessionRoutes=sqliteTable('session_routes',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),questionId:text('question_id').notNull().references(()=>questions.id,{onDelete:'cascade'}),
 sessionId:text('session_id').notNull().references(()=>agentInstances.id,{onDelete:'cascade'}),pageId:text('page_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('idx_session_routes_owner_question').on(t.ownerId,t.questionId),index('idx_session_routes_session').on(t.sessionId)]);

export const wikiRoutes=sqliteTable('wiki_routes',{
 questionId:text('question_id').primaryKey().references(()=>questions.id,{onDelete:'cascade'}),
 pageId:text('page_id').notNull().references(()=>pages.id,{onDelete:'cascade'}),
});
export const rootRoutes=sqliteTable('root_routes',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),question:text('question').notNull(),normalized:text('normalized').notNull(),language:text('language').notNull(),embedding:text('embedding').notNull(),
 targetType:text('target_type').notNull(),appId:text('app_id').references(()=>pages.id,{onDelete:'cascade'}),intent:text('intent').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('idx_root_routes_owner_question').on(t.ownerId,t.language,t.normalized)]);

export const pageForks=sqliteTable('page_forks',{
 pageId:text('page_id').primaryKey().references(()=>pages.id,{onDelete:'cascade'}),
 groupId:text('group_id').notNull(),parentId:text('parent_id'),createdAt:text('created_at').notNull(),
},t=>[index('idx_page_forks_group').on(t.groupId)]);

export const generationProgress = sqliteTable('generation_progress', {
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),data:text('data').notNull(),expires:integer('expires').notNull(),
});
