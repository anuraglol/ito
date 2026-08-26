<script setup lang="ts">
import { useTaskBoard } from "~/composables/useTaskBoard";
import CreateTaskModal from "./CreateTaskModal.vue";

const {
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
} = useTaskBoard();

onMounted(async () => {
  await initBoard();
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

    <div
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full items-start"
      v-if="columns.some((column) => column.items.length > 0)"
    >
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
    <div class="w-full py-32 text-center" v-else>Nothing to see here, yet.</div>
  </div>
</template>
