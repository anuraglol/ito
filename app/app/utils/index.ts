import { openDB, type IDBPDatabase } from "idb";
import type { KanbanDB, MutationRecord, Task } from "~/typings";

export const BASE_API_URL = import.meta.dev
  ? "http://localhost:8787"
  : "https://ito-server.imanuraglol.workers.dev";

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

const DB_NAME = "kanban_local_db";
const DB_VERSION = 2;

export async function initDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("issues")) {
        db.createObjectStore("issues", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("comments")) {
        db.createObjectStore("comments", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("activity")) {
        db.createObjectStore("activity", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("mutations")) {
        db.createObjectStore("mutations", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    },
  });
}

export async function loadLocalState(pendingCount: Ref<number>, tasks: Ref<Task[]>) {
  if (!import.meta.client) return;
  const db = await initDB();
  const localMutations = await db.getAll("mutations");
  pendingCount.value = localMutations.length;

  const localTasks: Task[] = await db.getAll("issues");
  tasks.value = localTasks.sort((a, b) => a.position - b.position);
}

export async function mutateLocal(
  type: "create" | "update" | "delete",
  entity: "issue" | "comment",
  targetId: string,
  baseVersion: number,
  userId: string,
  pendingCount: Ref<number>,
  tasks: Ref<Task[]>,
  isOnline: Ref<boolean>,
  triggerSync: () => Promise<void>,
  data?: Record<string, any>,
) {
  const db = await initDB();
  const mutation: MutationRecord = {
    id: crypto.randomUUID(),
    type,
    entity,
    targetId,
    baseVersion,
    userId,
    data,
    createdAt: new Date().toISOString(),
  };

  const tx = db.transaction([entity === "issue" ? "issues" : "comments", "mutations"], "readwrite");
  await tx.objectStore("mutations").put(mutation);

  if (entity === "issue") {
    const store = tx.objectStore("issues");
    if (type === "delete") {
      await store.delete(targetId);
    } else if (type === "create") {
      await store.put({
        id: targetId,
        version: baseVersion,
        createdById: userId,
        updatedById: userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        position: data?.position ?? 0,
        labels: data?.labels ?? [],
        ...data,
        _syncStatus: "pending",
      });
    } else if (type === "update") {
      const existing = await store.get(targetId);
      if (existing) {
        await store.put({
          ...existing,
          ...data,
          updatedById: userId,
          updatedAt: new Date().toISOString(),
          _syncStatus: "pending",
        });
      }
    }
  }

  await tx.done;
  await loadLocalState(pendingCount, tasks);

  if (isOnline.value) {
    triggerSync();
  }
}
