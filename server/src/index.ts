import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { issues, issueComments, activityLogs } from "./db/schema";
import { eq, gt, sql } from "drizzle-orm";
import { cors } from "hono/cors";
import { SyncRoom } from "./sync-room";

export { SyncRoom };

type Bindings = {
  DB: D1Database;
  SYNC_ROOM: DurableObjectNamespace<SyncRoom>;
  API_RATE_LIMITER: RateLimit;
};

type SyncMutation = {
  id: string;
  type: "create" | "update" | "delete";
  entity: "issue" | "comment";
  targetId: string;
  baseVersion: number;
  userId: string;
  data?: Record<string, any>;
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
  return c.text("hello hono");
});

app.get("/sync/ws", async (c) => {
  const roomId = c.req.query("roomId") ?? "global";
  const id = c.env.SYNC_ROOM.idFromName(roomId);
  const stub = c.env.SYNC_ROOM.get(id);

  const url = new URL(c.req.raw.url);
  url.pathname = "/sync/ws";
  return stub.fetch(new Request(url.toString(), c.req.raw));
});

app.get("/sync/pull", async (c) => {
  const db = drizzle(c.env.DB);
  const lastPulledAt = c.req.query("lastPulledAt");
  const timestamp = lastPulledAt ? new Date(lastPulledAt) : new Date(0);

  const [changedIssues, changedComments, recentActivity] = await Promise.all([
    db.select().from(issues).where(gt(issues.updatedAt, timestamp)),
    db.select().from(issueComments).where(gt(issueComments.updatedAt, timestamp)),
    db.select().from(activityLogs).where(gt(activityLogs.createdAt, timestamp)),
  ]);

  return c.json({
    issues: changedIssues,
    comments: changedComments,
    activity: recentActivity,
    timestamp: new Date().toISOString(),
  });
});

app.post("/sync/push", async (c) => {
  const db = drizzle(c.env.DB);
  const { mutations } = await c.req.json<{ mutations: SyncMutation[] }>();
  const now = new Date();
  const conflicts: Array<{ mutationId: string; serverState: any }> = [];

  for (const op of mutations) {
    const { success } = await c.env.API_RATE_LIMITER.limit({
      key: op.userId,
    });

    if (!success) {
      return c.json(
        {
          error: "rate_limit_exceeded",
          message: "Too many requests",
        },
        429,
      );
    }

    if (op.entity === "issue") {
      const existing = await db.select().from(issues).where(eq(issues.id, op.targetId)).get();

      if (op.type === "create") {
        await db
          .insert(issues)
          .values({
            id: op.targetId,
            title: op.data?.title ?? "Untitled",
            description: op.data?.description,
            status: op.data?.status ?? "open",
            priority: op.data?.priority ?? "medium",
            position: op.data?.position ?? 0,
            labels: op.data?.labels ?? [],
            createdById: op.userId,
            updatedById: op.userId,
            version: 1,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: issues.id,
            set: {
              title: op.data?.title ?? "Untitled",
              description: op.data?.description,
              status: op.data?.status ?? "open",
              priority: op.data?.priority ?? "medium",
              position: op.data?.position ?? 0,
              labels: op.data?.labels ?? [],
              updatedById: op.userId,
              version: sql`${issues.version} + 1`,
              deletedAt: null,
              updatedAt: now,
            },
          });

        await db.insert(activityLogs).values({
          id: crypto.randomUUID(),
          issueId: op.targetId,
          userId: op.userId,
          action: "created",
          details: op.data,
          createdAt: now,
        });
      } else if (op.type === "update") {
        if (!existing) continue;

        if (existing.version !== op.baseVersion) {
          conflicts.push({ mutationId: op.id, serverState: existing });
        }

        const mergedData = {
          title: op.data?.title ?? existing.title,
          description:
            op.data?.description !== undefined ? op.data.description : existing.description,
          status: op.data?.status ?? existing.status,
          priority: op.data?.priority ?? existing.priority,
          position: op.data?.position ?? existing.position,
          labels: op.data?.labels ?? existing.labels,
        };

        await db
          .update(issues)
          .set({
            ...mergedData,
            updatedById: op.userId,
            version: sql`${issues.version} + 1`,
            updatedAt: now,
          })
          .where(eq(issues.id, op.targetId));

        await db.insert(activityLogs).values({
          id: crypto.randomUUID(),
          issueId: op.targetId,
          userId: op.userId,
          action: "updated",
          details: op.data,
          createdAt: now,
        });
      } else if (op.type === "delete") {
        await db
          .update(issues)
          .set({
            deletedAt: now,
            updatedById: op.userId,
            version: sql`${issues.version} + 1`,
            updatedAt: now,
          })
          .where(eq(issues.id, op.targetId));

        await db.insert(activityLogs).values({
          id: crypto.randomUUID(),
          issueId: op.targetId,
          userId: op.userId,
          action: "deleted",
          createdAt: now,
        });
      }
    } else if (op.entity === "comment") {
      if (op.type === "create") {
        await db.insert(issueComments).values({
          id: op.targetId,
          issueId: op.data?.issueId,
          authorId: op.userId,
          authorName: op.data?.authorName ?? "Anonymous",
          body: op.data?.body ?? "",
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      } else if (op.type === "delete") {
        await db
          .update(issueComments)
          .set({
            deletedAt: now,
            version: sql`${issueComments.version} + 1`,
            updatedAt: now,
          })
          .where(eq(issueComments.id, op.targetId));
      }
    }
  }

  const roomId = c.req.query("roomId") ?? "global";
  const id = c.env.SYNC_ROOM.idFromName(roomId);
  const stub = c.env.SYNC_ROOM.get(id);

  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({
      type: "sync_available",
      timestamp: now.toISOString(),
      mutations,
    }),
  });

  return c.json({ success: true, timestamp: now.toISOString(), conflicts });
});

export default app;
