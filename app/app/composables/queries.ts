import { useQuery, useMutation, type QueryObserverResult } from "@tanstack/vue-query";
import type { Ref } from "vue";
import type { MutationRecord, Task } from "~/typings";
import { initDB, loadLocalState } from "~/utils";

export const pushMut = (
  pendingMutationsCount: Ref<number>,
  localTasks: Ref<Task[]>,
  refetchPull: () => Promise<QueryObserverResult<any, Error>>,
) => {
  return useMutation({
    mutationFn: async (mutations: MutationRecord[]) => {
      const res = await fetch("http://localhost:8787/sync/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mutations }),
      });
      if (!res.ok) throw new Error("Push failed");
      return res.json();
    },
    onSuccess: async (_, variables) => {
      const db = await initDB();
      const tx = db.transaction(["mutations", "issues"], "readwrite");
      const mutationStore = tx.objectStore("mutations");
      const issueStore = tx.objectStore("issues");

      for (const m of variables) {
        await mutationStore.delete(m.id);
      }

      const issuesList = await issueStore.getAll();
      for (const issue of issuesList) {
        if (issue._syncStatus === "pending") {
          await issueStore.put({
            ...issue,
            _syncStatus: "synced",
          });
        }
      }

      await tx.done;
      await loadLocalState(pendingMutationsCount, localTasks);
      await refetchPull();
    },
  });
};

export const getIssuesQuery = (
  pendingMutationsCount: Ref<number>,
  localTasks: Ref<Task[]>,
  isOnline: Ref<boolean>,
) => {
  return useQuery({
    queryKey: ["issues-pull"],
    queryFn: async () => {
      if (!import.meta.client) return { issues: [], timestamp: "" };
      const db = await initDB();
      const lastPull = await db.get("meta", "lastPulledAt");
      const lastPulledAt = lastPull ? lastPull.value : new Date(0).toISOString();

      const res = await fetch(
        `http://localhost:8787/sync/pull?lastPulledAt=${encodeURIComponent(lastPulledAt)}`,
      );
      if (!res.ok) throw new Error("Pull failed");
      const data = await res.json();

      const serverIssues: Task[] = data.issues;
      const pendingMutations = await db.getAll("mutations");
      const pendingIds = new Set(pendingMutations.map((m) => m.issueId));

      const tx = db.transaction("issues", "readwrite");
      const store = tx.objectStore("issues");

      for (const issue of serverIssues) {
        if (pendingIds.has(issue.id)) continue;

        const local = await store.get(issue.id);
        if (!local || issue.version >= (local.version ?? 0)) {
          if (issue.deletedAt) {
            await store.delete(issue.id);
          } else {
            await store.put({
              ...issue,
              tag: issue.priority,
              tagColor: issue.priority === "urgent" ? "error" : "primary",
              _syncStatus: "synced",
            });
          }
        }
      }

      await tx.done;

      await db.put("meta", { key: "lastPulledAt", value: data.timestamp });
      await loadLocalState(pendingMutationsCount, localTasks);
      return data;
    },
    refetchInterval: 15000,
    enabled: computed(() => isOnline.value && import.meta.client),
  });
};
