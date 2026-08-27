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
  const { pendingMutationsCount, localTasks, isOnline, triggerSync } = useTaskBoard();

  return useMutation({
    mutationFn: async (payload: CreateTaskInput) => {
      const issueId = crypto.randomUUID();
      const primaryTag = payload.tags?.[0] ?? payload.priority;

      const taskData: Partial<Task> = {
        title: payload.title,
        description: payload.description ?? undefined,
        priority: payload.priority,
        status: payload.status ?? "open",
        tag: primaryTag,
        tagColor:
          payload.priority === "high" || payload.priority === "urgent" ? "error" : "primary",
      };

      await mutateLocal(
        "create",
        issueId,
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
