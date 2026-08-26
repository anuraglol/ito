import type { QueryObserverResult } from "@tanstack/vue-query";
import type { MutationRecord, Task } from "~/typings";

export const pushMut = (
  pendingMutationsCount: globalThis.Ref,
  localTasks: globalThis.Ref,
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
    onSuccess: async () => {
      const db = await initDB();
      await db.clear("mutations");
      const issuesList = await db.getAll("issues");
      for (const issue of issuesList) {
        if (issue._syncStatus === "pending") {
          issue._syncStatus = "synced";
          await db.put("issues", issue);
        }
      }
      await loadLocalState(pendingMutationsCount, localTasks);
      refetchPull();
    },
  });
};

export const getIssuesQuery = (
  pendingMutationsCount: globalThis.Ref,
  localTasks: globalThis.Ref,
  isOnline: globalThis.Ref,
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

      for (const issue of serverIssues) {
        if (!pendingIds.has(issue.id)) {
          await db.put("issues", {
            ...issue,
            tag: issue.priority,
            tagColor: issue.priority === "urgent" ? "error" : "primary",
            _syncStatus: "synced",
          });
        }
      }

      await db.put("meta", { key: "lastPulledAt", value: data.timestamp });
      await loadLocalState(pendingMutationsCount, localTasks);
      return data;
    },
    refetchInterval: 15000,
    enabled: computed(() => isOnline.value && import.meta.client),
  });
};
