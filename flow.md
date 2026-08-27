1. Data model changes

Add version and soft-delete tracking.

```ts
// server/src/db/schema.ts
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
```

- version is a monotonic integer used for optimistic locking.
- deletedAt makes deletes tombstones so pull can propagate deletions to offline clients.

────────────────────────────────────────────────────────────────────────────────

2.  Sync protocol

### Mutation shape

```ts
  type SyncOperation = {
    type: "create" | "update" | "delete";
    issueId: string;
    baseVersion: number;   // version the client last saw
    clientId: string;      // stable per-browser/client
    data?: Partial<...>;
  };
```

- baseVersion is captured from the local record at the moment the user edits it.
- The client keeps sending the mutation until the server acknowledges it.

### Pull response

```ts
  {
    issues: Issue[];       // changed non-deleted records
    tombstones: string[];  // ids deleted since last pull
    timestamp: string;     // server time cursor
  }
```

### Push response

```ts
  {
    applied: string[];     // issueIds successfully applied
    conflicts: Conflict[]; // mutations that lost the race
    timestamp: string;
  }
```

────────────────────────────────────────────────────────────────────────────────

3.  Server push handler

For each mutation:

1.  Load current record.
2.  If it is a tombstone → conflict.
3.  If current.version !== baseVersion → conflict.
4.  Otherwise apply and atomically bump version.

Use RETURNING to know if the WHERE version = ? clause matched.

```ts
app.post("/sync/push", async (c) => {
  const db = drizzle(c.env.DB);
  const { mutations } = await c.req.json<{ mutations: SyncOperation[] }>();
  const now = new Date();

  const applied: string[] = [];
  const conflicts: Conflict[] = [];

  for (const op of mutations) {
    const current = await db.select().from(issues).where(eq(issues.id, op.issueId)).get();

    // ---------- CREATE ----------
    if (op.type === "create" && op.data) {
      if (current && !current.deletedAt) {
        // Already exists. If versions match, treat as an upsert;
        // otherwise it's a conflict.
        if (current.version !== op.baseVersion) {
          conflicts.push({ op, serverVersion: current });
          continue;
        }
      }
      await db
        .insert(issues)
        .values({
          id: op.issueId,
          title: op.data.title ?? "Untitled",
          description: op.data.description,
          status: op.data.status ?? "open",
          priority: op.data.priority ?? "medium",
          version: 1,
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
            updatedAt: now,
            deletedAt: null, // resurrect if it was a tombstone
          },
        });
      applied.push(op.issueId);
      continue;
    }

    // ---------- UPDATE ----------
    if (op.type === "update" && op.data) {
      if (!current || current.deletedAt) {
        conflicts.push({ op, reason: "missing_or_deleted", serverVersion: current });
        continue;
      }
      if (current.version !== op.baseVersion) {
        conflicts.push({ op, serverVersion: current });
        continue;
      }

      const updated = await db
        .update(issues)
        .set({
          ...(op.data.title !== undefined ? { title: op.data.title } : {}),
          ...(op.data.description !== undefined ? { description: op.data.description } : {}),
          ...(op.data.status !== undefined ? { status: op.data.status } : {}),
          ...(op.data.priority !== undefined ? { priority: op.data.priority } : {}),
          version: sql`${issues.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(issues.id, op.issueId), eq(issues.version, op.baseVersion)))
        .returning();

      if (updated.length === 0) {
        conflicts.push({ op, reason: "concurrent_update" });
      } else {
        applied.push(op.issueId);
      }
      continue;
    }

    // ---------- DELETE ----------
    if (op.type === "delete") {
      if (!current) {
        applied.push(op.issueId);
        continue;
      }
      if (current.version !== op.baseVersion) {
        conflicts.push({ op, serverVersion: current });
        continue;
      }

      await db
        .update(issues)
        .set({
          deletedAt: now,
          version: sql`${issues.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(issues.id, op.issueId), eq(issues.version, op.baseVersion)))
        .returning();

      applied.push(op.issueId);
    }
  }

  return c.json({ applied, conflicts, timestamp: now.toISOString() });
});
```

│ If you want atomic batch semantics instead of per-mutation success/failure, wrap the loop in a D1 batch/transaction and abort on the first
│ conflict. For offline-first clients, per-mutation reporting is usually more forgiving.

────────────────────────────────────────────────────────────────────────────────

4.  Pull handler

Return tombstones so clients can purge deleted records.

```ts
app.get("/sync/pull", async (c) => {
  const db = drizzle(c.env.DB);
  const lastPulledAt = c.req.query("lastPulledAt");
  const cursor = lastPulledAt ? new Date(lastPulledAt) : new Date(0);

  const changed = await db.select().from(issues).where(gt(issues.updatedAt, cursor));

  return c.json({
    issues: changed.filter((i) => !i.deletedAt),
    tombstones: changed.filter((i) => i.deletedAt).map((i) => i.id),
    timestamp: new Date().toISOString(),
  });
});
```

────────────────────────────────────────────────────────────────────────────────

5.  Client flow

### Capturing mutations

When the user edits an issue, capture the version before applying the local change.

```ts
const mutateLocal = async (type, issueId, data) => {
  const db = await initDB();
  const existing = await db.get("issues", issueId);
  const baseVersion = existing?.version ?? 0;

  const mutation: MutationRecord = {
    id: crypto.randomUUID(),
    type,
    issueId,
    baseVersion, // <-- new
    clientId, // <-- stable per device/tab
    data,
    timestamp: new Date().toISOString(),
  };

  await db.put("mutations", mutation);

  // optimistic local apply
  if (type === "delete") await db.delete("issues", issueId);
  else if (type === "update" && existing) {
    await db.put("issues", {
      ...existing,
      ...data,
      _syncStatus: "pending",
    });
  } else if (type === "create") {
    await db.put("issues", {
      id: issueId,
      ...data,
      version: baseVersion, // will be 0 until server confirms
      _syncStatus: "pending",
    });
  }

  triggerSync();
};
```

### Pushing

Send all pending mutations. On success:

1.  Remove applied mutations from the queue.
2.  For each conflict, either auto-merge or surface UI.
3.  Re-pull to get the latest server state.
4.  Re-apply any remaining pending mutations on top of the pulled state.

```ts
const pushMutation = useMutation({
  mutationFn: async (mutations) => {
    const res = await fetch("/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mutations }),
    });
    return res.json();
  },
  onSuccess: async ({ applied, conflicts }) => {
    const db = await initDB();

    // 1. drop acknowledged mutations
    for (const id of applied) {
      const mut = await db.get("mutations", id); // you may need to index by issueId
      if (mut) await db.delete("mutations", mut.id);
    }

    // 2. handle conflicts
    for (const conflict of conflicts) {
      await handleConflict(conflict);
    }

    // 3. pull fresh state and reconcile
    refetchPull();
  },
});
```

### Conflict resolution strategy

Pick one of these and stick to it:

A. Per-field last-write-wins — simplest, good enough for issue metadata.
Compare server version fields with local pending fields. For each field, keep the value whose mutation has the later client timestamp.

B. Server-wins, client re-apply — safest.
When a conflict happens, keep the server version, show a toast/modal with the user's changes, and let them re-apply manually.

C. Auto-merge non-overlapping fields.
If user A changed title and user B changed status, merge both. If both changed title, fall back to server-wins or prompt.

For a kanban where drag-and-drop changes status, A or C is usually the right UX.

────────────────────────────────────────────────────────────────────────────────

6.  Additional features to layer on top

┌────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Feature │ How to add it │
├────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Comments │ New table issue_comments with id, issueId, author, body, createdAt, updatedAt, version. Same sync rules: push with │
│ │ baseVersion, pull by updatedAt. │
├────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Activity log / audit │ New table activity_log (or use D1 triggers). Record every successful push mutation. Pull returns recent activity per │
│ trail │ issue. │
├────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Labels/tags │ Either a JSON array on issues (simple) or a join table issue_labels ↔ labels. If join table, version the relation row. │
├────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Users/assignees │ users table, assigneeId on issues. Sync users the same way, or treat them as read-only reference data. │
├────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Manual kanban ordering │ Add position: real (fractional index) to issues. Moving a card sets position to the midpoint of its new neighbors. │
│ │ Concurrent moves rarely collide; if they do, re-fetch and recompute. │
├────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Real-time updates │ Add SSE endpoint /sync/events that emits { issueId, version, updatedAt } on every push. Clients pull only when they │
│ │ receive an event for a record they don't own. This replaces the 15s polling. │
├────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Offline queue │ You're already using IndexedDB. Add a syncStatus per issue and retry with exponential backoff when online. │
│ durability │ │
├────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ File attachments │ Store files in R2, metadata in issue_attachments. Upload directly to R2 from the client with presigned URLs; sync only │
│ │ metadata through D1. │
└────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

────────────────────────────────────────────────────────────────────────────────

7.  Order of implementation

1.  Add version and deletedAt to schema + migrate.
1.  Update push handler to use baseVersion and return conflicts.
1.  Update pull handler to return tombstones.
1.  Update client to capture baseVersion and resolve conflicts.
1.  Add SSE/WebSocket for real-time (drops the polling).
1.  Add comments/activity log.
1.  Add fractional-index position if you want manual ordering.

That gives you a proper offline-first, concurrent-safe kanban.
