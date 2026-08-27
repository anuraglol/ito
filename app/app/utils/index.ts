import { openDB, type IDBPDatabase } from "idb";
import type { KanbanDB, MutationRecord, Task } from "~/typings";

export const statusToColumnMap: Record<string, string> = {
  open: "backlog",
  in_progress: "in-progress",
  resolved: "in-review",
  closed: "done",
};

export const columnToStatusMap: Record<string, "open" | "in_progress" | "resolved" | "closed"> = {
  backlog: "open",
  "in-progress": "in_progress",
  "in-review": "resolved",
  done: "closed",
};

export const initDB = async (): Promise<IDBPDatabase<KanbanDB>> => {
  return openDB<KanbanDB>("kanban-sync-db", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("issues")) {
        db.createObjectStore("issues", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("mutations")) {
        db.createObjectStore("mutations", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    },
  });
};

export const loadLocalState = async (
  pendingMutationsCount: globalThis.Ref<number, number>,
  localTasks: globalThis.Ref<Task[]>,
) => {
  if (!import.meta.client) return;
  const db = await initDB();
  const allIssues = await db.getAll("issues");
  const allMutations = await db.getAll("mutations");

  pendingMutationsCount.value = allMutations.length;
  localTasks.value = allIssues;
};

export const mutateLocal = async (
  type: "create" | "update" | "delete",
  issueId: string,
  pendingMutationsCount: globalThis.Ref<number, number>,
  localTasks: globalThis.Ref<Task[]>,
  isOnline: globalThis.Ref<boolean>,
  triggerSync: () => Promise<void>,
  data?: Partial<Task>,
) => {
  const db = await initDB();
  const now = new Date().toISOString();
  const existing = await db.get("issues", issueId);

  const mutationId = crypto.randomUUID();
  const mutation: MutationRecord = {
    id: mutationId,
    type,
    issueId,
    data: type === "delete" ? undefined : { ...data, updatedAt: now },
    timestamp: now,
  };

  await db.put("mutations", mutation);

  if (type === "delete" && existing) {
    await db.put("issues", {
      ...existing,
      deletedAt: now,
      version: (existing.version ?? 0) + 1,
      updatedAt: now,
      _syncStatus: "pending",
    });
  } else if (type === "update" && existing && data) {
    await db.put("issues", {
      ...existing,
      ...data,
      version: (existing.version ?? 0) + 1,
      updatedAt: now,
      _syncStatus: "pending",
    });
  } else if (type === "create" && data) {
    const newTask: Task = {
      id: issueId,
      title: data.title ?? "Untitled",
      description: data.description ?? null,
      status: data.status ?? "open",
      priority: data.priority ?? "medium",
      tag: data.priority ?? "medium",
      tagColor: data.priority === "urgent" ? "error" : "primary",
      version: 1,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      _syncStatus: "pending",
    };
    await db.put("issues", newTask);
  }

  await loadLocalState(pendingMutationsCount, localTasks);
  if (isOnline.value) {
    await triggerSync();
  }
};
