import type { DBSchema } from "idb";

export interface Task {
  id: string;
  title: string;
  description?: string;
  tag?: string;
  tagColor?: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority?: "low" | "medium" | "high" | "urgent";
  createdAt: string;
  updatedAt: string;
  _syncStatus?: "synced" | "pending";
}

export interface MutationRecord {
  id: string;
  type: "create" | "update" | "delete";
  issueId: string;
  data?: Partial<Task>;
  timestamp: string;
}

export interface KanbanDB extends DBSchema {
  issues: {
    key: string;
    value: Task;
  };
  mutations: {
    key: string;
    value: MutationRecord;
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}
