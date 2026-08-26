import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
