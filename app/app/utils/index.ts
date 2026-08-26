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
  localTasks: globalThis.Ref,
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
  localTasks: globalThis.Ref,
  isOnline: globalThis.Ref,
  triggerSync: () => Promise<void>,
  data?: Partial<Task>,
) => {
  const db = await initDB();
  const mutationId = crypto.randomUUID();
  const mutation: MutationRecord = {
    id: mutationId,
    type,
    issueId,
    data,
    timestamp: new Date().toISOString(),
  };

  await db.put("mutations", mutation);

  if (type === "delete") {
    await db.delete("issues", issueId);
  } else if (type === "update" && data) {
    const existing = await db.get("issues", issueId);
    if (existing) {
      await db.put("issues", {
        ...existing,
        ...data,
        updatedAt: new Date().toISOString(),
        _syncStatus: "pending",
      });
    }
  } else if (type === "create" && data) {
    const now = new Date().toISOString();
    const newTask: Task = {
      id: issueId,
      title: data.title ?? "Untitled",
      description: data.description,
      status: data.status ?? "open",
      priority: data.priority ?? "medium",
      tag: data.priority ?? "medium",
      tagColor: data.priority === "urgent" ? "error" : "primary",
      createdAt: now,
      updatedAt: now,
      _syncStatus: "pending",
    };
    await db.put("issues", newTask);
  }

  await loadLocalState(pendingMutationsCount, localTasks);
  if (isOnline.value) {
    triggerSync();
  }
};
