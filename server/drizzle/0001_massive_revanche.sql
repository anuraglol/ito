ALTER TABLE `issues` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `issues` ADD `deleted_at` integer;