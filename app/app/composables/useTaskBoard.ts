import type { Task } from "@/typings";
import { getIssuesQuery, pushMut } from "~/composables/queries";
import { useSyncSocket } from "~/composables/useSyncSocket";
import { columnToStatusMap, initDB, loadLocalState, mutateLocal, statusToColumnMap } from "~/utils";

export interface Column {
  id: string;
  title: string;
  icon: string;
  items: Task[];
}

export interface DraggedItemState {
  columnId: string;
  item: Task;
}

export interface DropTargetState {
  columnId: string;
  index: number;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
}

export function useTaskBoard() {
  const isOnline = useState<boolean>("is-online", () =>
    import.meta.client ? navigator.onLine : true,
  );
  const pendingMutationsCount = useState<number>("pending-mutations-count", () => 0);
  const isCreateModalOpen = useState<boolean>("is-create-modal-open", () => false);
  const draggedItem = useState<DraggedItemState | null>("dragged-item", () => null);
  const dragOverColumnId = useState<string | null>("drag-over-column-id", () => null);
  const dropTargetIndex = useState<DropTargetState | null>("drop-target-index", () => null);
  const localTasks = useState<Task[]>("local-tasks", () => []);

  const { refetch: refetchPull, isFetching: isPulling } = getIssuesQuery(
    pendingMutationsCount,
    localTasks,
    isOnline,
  );

  const pushMutation = pushMut(pendingMutationsCount, localTasks, refetchPull);

  const triggerSync = async () => {
    if (!isOnline.value || !import.meta.client) return;
    const db = await initDB();
    const mutations = await db.getAll("mutations");
    if (mutations.length > 0) {
      pushMutation.mutate(mutations);
    } else {
      refetchPull();
    }
  };

  const { connect: connectSocket, disconnect: disconnectSocket } = useSyncSocket(
    isOnline,
    triggerSync,
  );

  const handleCreateTask = (payload: CreateTaskPayload) => {
    const newId = crypto.randomUUID();
    mutateLocal("create", newId, pendingMutationsCount, localTasks, isOnline, triggerSync, payload);
  };

  const onDeleteTask = (columnId: string, id: string) => {
    mutateLocal("delete", id, pendingMutationsCount, localTasks, isOnline, triggerSync);
  };

  const columns = computed<Column[]>(() => {
    const cols: Column[] = [
      { id: "backlog", title: "Backlog", icon: "i-lucide-archive", items: [] },
      { id: "in-progress", title: "In Progress", icon: "i-lucide-clock", items: [] },
      { id: "in-review", title: "In Review", icon: "i-lucide-eye", items: [] },
      { id: "done", title: "Done", icon: "i-lucide-check-circle", items: [] },
    ];

    for (const task of localTasks.value) {
      if (task.deletedAt) continue;
      const colId = statusToColumnMap[task.status] || "backlog";
      const targetCol = cols.find((c) => c.id === colId);
      if (targetCol) targetCol.items.push(task);
    }

    return cols;
  });

  const onDragStart = (columnId: string, item: Task) => {
    draggedItem.value = { columnId, item };
  };

  const onDragEnd = () => {
    draggedItem.value = null;
    dragOverColumnId.value = null;
    dropTargetIndex.value = null;
  };

  const onColumnDragOver = (columnId: string, event: DragEvent) => {
    dragOverColumnId.value = columnId;
    const column = columns.value.find((c) => c.id === columnId);
    if (column && column.items.length === 0) {
      dropTargetIndex.value = { columnId, index: 0 };
      return;
    }

    if (event.target === event.currentTarget) {
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      if (event.clientY > rect.bottom - 100) {
        dropTargetIndex.value = { columnId, index: column?.items.length ?? 0 };
      }
    }
  };

  const onColumnDragLeave = (columnId: string, event: DragEvent) => {
    const currentTarget = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as Node | null;

    if (!currentTarget.contains(relatedTarget)) {
      if (dragOverColumnId.value === columnId) {
        dragOverColumnId.value = null;
        dropTargetIndex.value = null;
      }
    }
  };

  const onItemDragOver = (columnId: string, index: number, event: DragEvent) => {
    event.stopPropagation();
    dragOverColumnId.value = columnId;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const borderMidpoint = rect.top + rect.height / 2;
    const insertIndex = event.clientY > borderMidpoint ? index + 1 : index;
    dropTargetIndex.value = { columnId, index: insertIndex };
  };

  const onDrop = (targetColumnId: string) => {
    if (!draggedItem.value) return;

    const { item, columnId: sourceColumnId } = draggedItem.value;
    if (sourceColumnId !== targetColumnId) {
      const newStatus = columnToStatusMap[targetColumnId];
      if (newStatus) {
        mutateLocal("update", item.id, pendingMutationsCount, localTasks, isOnline, triggerSync, {
          status: newStatus,
        });
      }
    }

    onDragEnd();
  };

  const initBoard = async () => {
    isOnline.value = navigator.onLine;
    await loadLocalState(pendingMutationsCount, localTasks);

    window.addEventListener("online", () => {
      isOnline.value = true;
      triggerSync();
      connectSocket();
    });

    window.addEventListener("offline", () => {
      isOnline.value = false;
      disconnectSocket();
    });

    if (isOnline.value) {
      triggerSync();
      connectSocket();
    }
  };

  onUnmounted(() => {
    disconnectSocket();
  });

  return {
    localTasks,
    isOnline,
    pendingMutationsCount,
    isCreateModalOpen,
    isPulling,
    pushMutation,
    columns,
    draggedItem,
    dragOverColumnId,
    dropTargetIndex,
    triggerSync,
    handleCreateTask,
    onDeleteTask,
    onDragStart,
    onDragEnd,
    onColumnDragOver,
    onColumnDragLeave,
    onItemDragOver,
    onDrop,
    initBoard,
  };
}
