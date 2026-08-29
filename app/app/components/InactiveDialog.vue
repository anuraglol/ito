<script setup lang="ts">
const isOnline = useNetwork().isOnline;
const visibility = useDocumentVisibility();

const isSyncing = ref(false);
const wasDisconnectedDueToInactivity = ref(false);

const { currentUser } = useTaskBoard();

const triggerSync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
};

const { connect, disconnect, presences } = useSyncSocket(isOnline, triggerSync, currentUser);

const backgroundTimer = useTimeoutFn(
  () => {
    disconnect();
    wasDisconnectedDueToInactivity.value = true;
  },
  15000,
  { immediate: false },
);

watch(visibility, async (currentStatus, prevStatus) => {
  if (currentStatus === "hidden") {
    backgroundTimer.start();
  } else if (currentStatus === "visible") {
    backgroundTimer.stop();

    if (wasDisconnectedDueToInactivity.value) {
      isSyncing.value = true;
      try {
        connect();
        await triggerSync();
      } finally {
        isSyncing.value = false;
        wasDisconnectedDueToInactivity.value = false;
      }
    }
  }
});

onMounted(() => {
  connect();
});
</script>

<template>
  <UModal v-model:open="isSyncing" :prevent-close="true">
    <template #content>
      <div class="p-6 flex flex-col items-center justify-center space-y-4">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
        <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
          Syncing latest updates...
        </p>
      </div>
    </template>
  </UModal>
</template>
