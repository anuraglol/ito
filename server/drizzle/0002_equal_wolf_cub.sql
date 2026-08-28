CREATE TABLE `activity_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`details` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `issues` ADD `position` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `issues` ADD `labels` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `issues` ADD `created_by_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `issues` ADD `updated_by_id` text NOT NULL;