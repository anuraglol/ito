import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const issues = sqliteTable("issues", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["open", "in_progress", "resolved", "closed"] })
    .default("open")
    .notNull(),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] })
    .default("medium")
    .notNull(),
  position: real("position").notNull().default(0),
  labels: text("labels", { mode: "json" }).$type<string[]>().default([]),
  createdById: text("created_by_id").notNull().default("system"),
  updatedById: text("updated_by_id").notNull().default("system"),
  version: integer("version").notNull().default(1),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const issueComments = sqliteTable("issue_comments", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const activityLogs = sqliteTable("activity_logs", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  details: text("details", { mode: "json" }).$type<Record<string, any>>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Issue = typeof issues.$inferSelect;
export type IssueComment = typeof issueComments.$inferSelect;
export type ActivityLog = typeof activityLogs.$inferSelect;
