import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { issues } from "./db/schema";
import { eq, gt, sql } from "drizzle-orm";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
};

type SyncOperation = {
  type: "create" | "update" | "delete";
  issueId: string;
  data?: {
    title?: string;
    description?: string;
    status?: "open" | "in_progress" | "resolved" | "closed";
    priority?: "low" | "medium" | "high" | "urgent";
    updatedAt?: string;
  };
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "https://ito.imanuraglol.workers.dev"],
    allowMethods: ["POST", "GET", "OPTIONS", "DELETE", "PATCH"],
    exposeHeaders: ["Content-Length", "X-Kuma-Revision"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  }),
);

app.get("/", (c) => {
  return c.text("hello hehe");
});

app.get("/sync/pull", async (c) => {
  const db = drizzle(c.env.DB);
  const lastPulledAt = c.req.query("lastPulledAt");
  const timestamp = lastPulledAt ? new Date(lastPulledAt) : new Date(0);

  const changedIssues = await db.select().from(issues).where(gt(issues.updatedAt, timestamp));

  return c.json({
    issues: changedIssues,
    timestamp: new Date().toISOString(),
  });
});

app.post("/sync/push", async (c) => {
  const db = drizzle(c.env.DB);
  const { mutations } = await c.req.json<{ mutations: SyncOperation[] }>();
  const now = new Date();

  for (const op of mutations) {
    if (op.type === "create" && op.data) {
      await db
        .insert(issues)
        .values({
          id: op.issueId,
          title: op.data.title ?? "Untitled",
          description: op.data.description,
          status: op.data.status ?? "open",
          priority: op.data.priority ?? "medium",
          version: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: issues.id,
          set: {
            title: op.data.title ?? "Untitled",
            description: op.data.description,
            status: op.data.status ?? "open",
            priority: op.data.priority ?? "medium",
            version: sql`${issues.version} + 1`,
            deletedAt: null,
            updatedAt: now,
          },
        });
    } else if (op.type === "update" && op.data) {
      await db
        .update(issues)
        .set({
          ...(op.data.title !== undefined ? { title: op.data.title } : {}),
          ...(op.data.description !== undefined ? { description: op.data.description } : {}),
          ...(op.data.status !== undefined ? { status: op.data.status } : {}),
          ...(op.data.priority !== undefined ? { priority: op.data.priority } : {}),
          version: sql`${issues.version} + 1`,
          updatedAt: now,
        })
        .where(eq(issues.id, op.issueId));
    } else if (op.type === "delete") {
      await db
        .update(issues)
        .set({
          deletedAt: now,
          version: sql`${issues.version} + 1`,
          updatedAt: now,
        })
        .where(eq(issues.id, op.issueId));
    }
  }

  return c.json({ success: true, timestamp: now.toISOString() });
});

export default app;
