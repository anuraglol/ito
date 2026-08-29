import { useMutation } from "@tanstack/vue-query";
import type { Task } from "~/typings";
import { mutateLocal } from "~/utils";
import { useTaskBoard } from "~/composables/useTaskBoard";

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  tags?: string[];
  status?: "open" | "in_progress" | "resolved" | "closed";
}

export function useCreateTask() {
  const { currentUser, pendingMutationsCount, localTasks, isOnline, triggerSync } = useTaskBoard();

  return useMutation({
    networkMode: "always",
    mutationFn: async (payload: CreateTaskInput) => {
      const issueId = crypto.randomUUID();
      const primaryTag = payload.tags?.[0] ?? payload.priority;
      const targetStatus = payload.status ?? "open";

      const tasksInStatus = localTasks.value.filter((t) => t.status === targetStatus);
      const maxPos = tasksInStatus.reduce((max, t) => Math.max(max, t.position || 0), 0);

      const taskData: Partial<Task> = {
        title: payload.title,
        description: payload.description ?? undefined,
        priority: payload.priority,
        status: targetStatus,
        labels: payload.tags ?? [],
        position: maxPos + 1000,
        tag: primaryTag,
        tagColor:
          payload.priority === "high" || payload.priority === "urgent" ? "error" : "primary",
      };

      await mutateLocal(
        "create",
        "issue",
        issueId,
        1,
        currentUser.value.userId,
        pendingMutationsCount,
        localTasks,
        isOnline,
        triggerSync,
        taskData,
      );

      return { id: issueId, ...taskData };
    },
  });
}
