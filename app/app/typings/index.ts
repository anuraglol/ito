import type { DBSchema } from "idb";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  position: number;
  labels: string[];
  createdById: string;
  updatedById: string;
  version: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  tag?: string;
  tagColor?: "primary" | "error" | "neutral";
  _syncStatus?: "pending" | "synced";
}

export interface Comment {
  id: string;
  issueId: string;
  authorId: string;
  authorName: string;
  body: string;
  version: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  _syncStatus?: "pending" | "synced";
}

export interface ActivityLog {
  id: string;
  issueId: string;
  userId: string;
  action: string;
  details?: Record<string, any>;
  createdAt: string;
}

export interface MutationRecord {
  id: string;
  type: "create" | "update" | "delete";
  entity: "issue" | "comment";
  targetId: string;
  baseVersion: number;
  userId: string;
  data?: Record<string, any>;
  createdAt: string;
}

export interface UserPresence {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
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
