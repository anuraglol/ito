import type { Task } from "@/typings";
import { useOnline } from "@vueuse/core";
import { getIssuesQuery, pushMut } from "~/composables/queries";
import { useSyncSocket } from "~/composables/useSyncSocket";
import { columnToStatusMap, initDB, loadLocalState, mutateLocal, statusToColumnMap } from "~/utils";

export function useTaskBoard() {
  const isOnline = useOnline();

  const currentUser = useState("current-user", () => ({
    userId: "",
    name: "Anonymous",
    color: "#3b82f6",
  }));

  const setupUser = () => {
    if (!import.meta.client) return;
    const cached = localStorage.getItem("kanban_user");
    if (cached) {
      currentUser.value = JSON.parse(cached);
      return;
    }
    const newUser = {
      userId: crypto.randomUUID(),
      name: `User-${Math.floor(100 + Math.random() * 900)}`,
      color: `#${Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, "0")}`,
    };
    localStorage.setItem("kanban_user", JSON.stringify(newUser));
    currentUser.value = newUser;
  };

  const pendingMutationsCount = useState<number>("pending-mutations-count", () => 0);
  const isCreateModalOpen = useState<boolean>("is-create-modal-open", () => false);
  const draggedItem = useState<{ columnId: string; item: Task } | null>("dragged-item", () => null);
  const dragOverColumnId = useState<string | null>("drag-over-column-id", () => null);
  const dropTargetIndex = useState<{ columnId: string; index: number } | null>(
    "drop-target-index",
    () => null,
  );
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

  const {
    connect: connectSocket,
    disconnect: disconnectSocket,
    emitCursor,
    presences,
  } = useSyncSocket(isOnline, triggerSync, currentUser);

  const handleCreateTask = (payload: Partial<Task>) => {
    const newId = crypto.randomUUID();
    const tasksInStatus = localTasks.value.filter((t) => t.status === (payload.status ?? "open"));
    const maxPos = tasksInStatus.reduce((max, t) => Math.max(max, t.position || 0), 0);

    mutateLocal(
      "create",
      "issue",
      newId,
      1,
      currentUser.value.userId,
      pendingMutationsCount,
      localTasks,
      isOnline,
      triggerSync,
      {
        ...payload,
        position: maxPos + 1000,
      },
    );
  };

  const onDeleteTask = (id: string, version: number) => {
    mutateLocal(
      "delete",
      "issue",
      id,
      version,
      currentUser.value.userId,
      pendingMutationsCount,
      localTasks,
      isOnline,
      triggerSync,
    );
  };

  const columns = computed(() => {
    const cols = [
      { id: "backlog", title: "Backlog", icon: "i-lucide-archive", items: [] as Task[] },
      { id: "in-progress", title: "In Progress", icon: "i-lucide-clock", items: [] as Task[] },
      { id: "in-review", title: "In Review", icon: "i-lucide-eye", items: [] as Task[] },
      { id: "done", title: "Done", icon: "i-lucide-check-circle", items: [] as Task[] },
    ];

    for (const task of localTasks.value) {
      if (task.deletedAt) continue;
      const colId = statusToColumnMap[task.status] || "backlog";
      const targetCol = cols.find((c) => c.id === colId);
      if (targetCol) targetCol.items.push(task);
    }

    cols.forEach((col) => col.items.sort((a, b) => a.position - b.position));
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

    const { item } = draggedItem.value;
    const targetStatus = columnToStatusMap[targetColumnId] || "open";
    const targetCol = columns.value.find((c) => c.id === targetColumnId);
    const colItems = targetCol ? targetCol.items.filter((t) => t.id !== item.id) : [];

    const targetIdx = dropTargetIndex.value?.index ?? colItems.length;
    const prev = colItems[targetIdx - 1]?.position;
    const next = colItems[targetIdx]?.position;

    let newPos: number;
    if (prev !== undefined && next !== undefined) {
      newPos = (prev + next) / 2;
    } else if (prev !== undefined) {
      newPos = prev + 1000;
    } else if (next !== undefined) {
      newPos = next / 2;
    } else {
      newPos = 1000;
    }

    mutateLocal(
      "update",
      "issue",
      item.id,
      item.version,
      currentUser.value.userId,
      pendingMutationsCount,
      localTasks,
      isOnline,
      triggerSync,
      {
        status: targetStatus,
        position: newPos,
      },
    );

    onDragEnd();
  };

  const handlePointerMove = (e: MouseEvent) => {
    emitCursor(e.clientX, e.clientY);
  };

  watch(isOnline, (online) => {
    if (!import.meta.client) return;
    if (online) {
      triggerSync();
      connectSocket();
    } else {
      disconnectSocket();
    }
  });

  const initBoard = async () => {
    setupUser();
    await loadLocalState(pendingMutationsCount, localTasks);

    if (isOnline.value) {
      triggerSync();
      connectSocket();
    }
  };

  onUnmounted(() => {
    disconnectSocket();
  });

  return {
    currentUser,
    presences,
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
    handlePointerMove,
    initBoard,
  };
}
