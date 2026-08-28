PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`labels` text DEFAULT '[]',
	`created_by_id` text DEFAULT 'system' NOT NULL,
	`updated_by_id` text DEFAULT 'system' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_issues`("id", "title", "description", "status", "priority", "position", "labels", "created_by_id", "updated_by_id", "version", "deleted_at", "created_at", "updated_at") SELECT "id", "title", "description", "status", "priority", "position", "labels", "created_by_id", "updated_by_id", "version", "deleted_at", "created_at", "updated_at" FROM `issues`;--> statement-breakpoint
DROP TABLE `issues`;--> statement-breakpoint
ALTER TABLE `__new_issues` RENAME TO `issues`;--> statement-breakpoint
PRAGMA foreign_keys=ON;