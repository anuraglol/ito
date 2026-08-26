<script setup lang="ts">
import type { MutationRecord, Task } from "@/typings";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, onMounted, ref } from "vue";
import { columnToStatusMap, initDB, loadLocalState, mutateLocal, statusToColumnMap } from "~/utils";
import CreateTaskModal from "./CreateTaskModal.vue";

const localTasks = ref<Task[]>([]);
const isOnline = ref(import.meta.client ? navigator.onLine : true);
const pendingMutationsCount = ref(0);
const isCreateModalOpen = ref(false);

const pushMutation = useMutation({
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

const { refetch: refetchPull, isFetching: isPulling } = useQuery({
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

const handleCreateTask = (payload: {
  title: string;
  description?: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
}) => {
  const newId = crypto.randomUUID();
  mutateLocal("create", newId, pendingMutationsCount, localTasks, isOnline, triggerSync, payload);
};

const columns = computed(() => {
  const cols = [
    { id: "backlog", title: "Backlog", icon: "i-lucide-archive", items: [] as Task[] },
    { id: "in-progress", title: "In Progress", icon: "i-lucide-clock", items: [] as Task[] },
    { id: "in-review", title: "In Review", icon: "i-lucide-eye", items: [] as Task[] },
    { id: "done", title: "Done", icon: "i-lucide-check-circle", items: [] as Task[] },
  ];

  for (const task of localTasks.value) {
    const colId = statusToColumnMap[task.status] || "backlog";
    const targetCol = cols.find((c) => c.id === colId);
    if (targetCol) targetCol.items.push(task);
  }

  return cols;
});

const draggedItem = ref<{ columnId: string; item: Task } | null>(null);
const dragOverColumnId = ref<string | null>(null);
const dropTargetIndex = ref<{ columnId: string; index: number } | null>(null);

const onDeleteTask = (columnId: string, id: string) => {
  mutateLocal("delete", id, pendingMutationsCount, localTasks, isOnline, triggerSync);
};

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

onMounted(async () => {
  isOnline.value = navigator.onLine;
  await loadLocalState(pendingMutationsCount, localTasks);

  window.addEventListener("online", () => {
    isOnline.value = true;
    triggerSync();
  });

  window.addEventListener("offline", () => {
    isOnline.value = false;
  });

  if (isOnline.value) {
    triggerSync();
  }
});
</script>

<template>
  <div class="flex flex-col gap-4 w-full">
    <div
      class="flex w-full items-center justify-between px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg"
    >
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <div
            class="w-2.5 h-2.5 rounded-full"
            :class="isOnline ? 'bg-emerald-500' : 'bg-amber-500'"
          />
          <span class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {{ isOnline ? "Online" : "Offline Mode" }}
          </span>
        </div>

        <UButton
          icon="i-lucide-plus"
          size="xs"
          color="primary"
          variant="solid"
          label="New Issue"
          @click="isCreateModalOpen = true"
        />
      </div>

      <div class="flex items-center gap-3">
        <div v-if="pendingMutationsCount > 0" class="flex items-center gap-1.5">
          <UIcon name="i-lucide-cloud-upload" class="w-4 h-4 text-amber-500 animate-pulse" />
          <span class="text-xs text-amber-600 dark:text-amber-400 font-medium">
            {{ pendingMutationsCount }} pending
          </span>
        </div>
        <div v-else-if="isPulling" class="flex items-center gap-1.5">
          <UIcon name="i-lucide-refresh-cw" class="w-3.5 h-3.5 text-neutral-400 animate-spin" />
          <span class="text-xs text-neutral-400">Syncing...</span>
        </div>
        <div v-else class="flex items-center gap-1.5">
          <UIcon name="i-lucide-check-check" class="w-4 h-4 text-emerald-500" />
          <span class="text-xs text-neutral-400">Synced</span>
        </div>

        <UButton
          icon="i-lucide-refresh-cw"
          size="xs"
          variant="ghost"
          color="neutral"
          :loading="pushMutation.isPending.value || isPulling"
          @click="triggerSync"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full items-start">
      <div
        v-for="column in columns"
        :key="column.id"
        class="bg-neutral-100/80 dark:bg-neutral-900/80 rounded-xl p-3 flex flex-col gap-3 min-h-[460px] transition-colors duration-150 ring-1"
        :class="[
          dragOverColumnId === column.id
            ? 'ring-primary-500/40 bg-neutral-100 dark:bg-neutral-900'
            : 'ring-neutral-200/60 dark:ring-neutral-800/60',
        ]"
        @dragover.prevent="(e: DragEvent) => onColumnDragOver(column.id, e)"
        @dragleave="(e: DragEvent) => onColumnDragLeave(column.id, e)"
        @drop="onDrop(column.id)"
      >
        <div class="flex items-center justify-between px-1 pointer-events-none">
          <div class="flex items-center gap-2">
            <UIcon :name="column.icon" class="w-4 h-4 text-neutral-500 shrink-0" />
            <span class="font-medium text-sm text-neutral-900 dark:text-white truncate">
              {{ column.title }}
            </span>
          </div>
          <UBadge
            :label="column.items.length.toString()"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </div>

        <div class="flex flex-col flex-1 relative gap-1 min-h-[380px]">
          <template v-for="(item, index) in column.items" :key="item.id">
            <div
              v-if="
                dropTargetIndex?.columnId === column.id &&
                dropTargetIndex?.index === index &&
                draggedItem?.item.id !== item.id
              "
              class="h-1 w-full bg-primary-500/70 rounded-full my-1 shadow-sm shadow-primary-500/20"
            />

            <div
              class="py-1"
              @dragover.prevent="(e: DragEvent) => onItemDragOver(column.id, index, e)"
            >
              <UCard
                draggable="true"
                class="cursor-grab active:cursor-grabbing transition-all duration-150 hover:ring-1 hover:ring-neutral-300 dark:hover:ring-neutral-700 select-none"
                :class="[
                  draggedItem?.item.id === item.id ? 'opacity-30 scale-[0.98]' : 'opacity-100',
                ]"
                :ui="{ body: 'p-3 space-y-2' }"
                @dragstart="onDragStart(column.id, item)"
                @dragend="onDragEnd"
              >
                <div class="flex flex-col gap-1 w-full">
                  <div class="flex items-center justify-between gap-2 mb-1">
                    <div class="flex items-center gap-1 min-w-0">
                      <span
                        class="text-xs font-medium text-neutral-500 dark:text-neutral-300 leading-snug truncate"
                      >
                        {{ item.id.slice(0, 5) }}
                      </span>
                      <UBadge
                        v-if="item.tag"
                        :label="item.tag"
                        :color="item.tagColor"
                        variant="subtle"
                        size="xs"
                      />
                      <UIcon
                        v-if="item._syncStatus === 'pending'"
                        name="i-lucide-cloud-off"
                        class="w-3.5 h-3.5 text-amber-500 shrink-0 ml-1"
                      />
                    </div>
                    <UTooltip text="delete the issue">
                      <UButton
                        icon="i-lucide-trash"
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        @click.stop="onDeleteTask(column.id, item.id)"
                      />
                    </UTooltip>
                  </div>
                  <span class="text-sm font-medium text-neutral-900 dark:text-white leading-snug">
                    {{ item.title }}
                  </span>
                  <p
                    v-if="item.description"
                    class="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed break-words"
                  >
                    {{ item.description }}
                  </p>
                </div>
              </UCard>
            </div>
          </template>

          <div
            v-if="
              dropTargetIndex?.columnId === column.id &&
              dropTargetIndex?.index === column.items.length
            "
            class="h-1 w-full bg-primary-500/70 rounded-full my-1 shadow-sm shadow-primary-500/20"
          />

          <div
            class="flex-1 w-full min-h-[80px]"
            @dragover.prevent="
              dropTargetIndex = { columnId: column.id, index: column.items.length }
            "
          />

          <div
            v-if="column.items.length === 0 && dragOverColumnId === column.id"
            class="absolute inset-0 flex items-center justify-center border border-dashed border-primary-500/40 rounded-lg p-4 pointer-events-none"
          >
            <span class="text-xs text-neutral-400">Drop here</span>
          </div>
        </div>
      </div>
    </div>

    <CreateTaskModal v-model:open="isCreateModalOpen" @create="handleCreateTask" />
  </div>
</template>
