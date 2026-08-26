<script setup lang="ts">
import { reactive, watch } from "vue";
import type { FormError, FormSubmitEvent } from "#ui/types";

interface Schema {
  title: string;
  description?: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
}

const emit = defineEmits<{
  (e: "create", payload: Schema): void;
}>();

const isOpen = defineModel<boolean>("open", { default: false });

const state = reactive<Schema>({
  title: "",
  description: "",
  status: "open",
  priority: "medium",
});

const statusOptions = [
  { label: "Backlog", value: "open" },
  { label: "In Progress", value: "in_progress" },
  { label: "In Review", value: "resolved" },
  { label: "Done", value: "closed" },
];

const priorityOptions = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Urgent", value: "urgent" },
];

const validate = (formState: Schema): FormError[] => {
  const errors: FormError[] = [];
  if (!formState.title?.trim()) {
    errors.push({ path: "title", message: "Title is required" });
  } else if (formState.title.trim().length < 3) {
    errors.push({ path: "title", message: "Must be at least 3 characters" });
  }
  return errors;
};

const onSubmit = (event: FormSubmitEvent<Schema>) => {
  emit("create", { ...event.data });
  isOpen.value = false;
};

watch(isOpen, (val) => {
  if (!val) {
    state.title = "";
    state.description = "";
    state.status = "open";
    state.priority = "medium";
  }
});
</script>

<template>
  <UModal v-model="isOpen" class="sm:max-w-md">
    <UCard
      :ui="{
        ring: 'ring-1 ring-neutral-200 dark:ring-neutral-800',
        divide: 'divide-y divide-neutral-200 dark:divide-neutral-800',
        header: { padding: 'px-4 py-3' },
        body: { padding: 'p-4' },
        footer: { padding: 'px-4 py-3' },
      }"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-plus-circle" class="w-4 h-4 text-primary-500" />
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">Create New Issue</h3>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            size="xs"
            @click="isOpen = false"
          />
        </div>
      </template>

      <UForm
        id="create-task-form"
        :validate="validate"
        :state="state"
        class="flex flex-col gap-3.5"
        @submit="onSubmit"
      >
        <UFormGroup label="Title" name="title" required :ui="{ label: { wrapper: 'text-xs' } }">
          <UInput
            v-model="state.title"
            placeholder="Issue title..."
            autofocus
            size="sm"
            autocomplete="off"
          />
        </UFormGroup>

        <UFormGroup label="Description" name="description" :ui="{ label: { wrapper: 'text-xs' } }">
          <UTextarea
            v-model="state.description"
            placeholder="Add context or notes..."
            :rows="3"
            size="sm"
            autoresize
          />
        </UFormGroup>

        <div class="grid grid-cols-2 gap-3">
          <UFormGroup label="Status" name="status" :ui="{ label: { wrapper: 'text-xs' } }">
            <USelectMenu
              v-model="state.status"
              :options="statusOptions"
              value-attribute="value"
              option-attribute="label"
              size="sm"
            />
          </UFormGroup>

          <UFormGroup label="Priority" name="priority" :ui="{ label: { wrapper: 'text-xs' } }">
            <USelectMenu
              v-model="state.priority"
              :options="priorityOptions"
              value-attribute="value"
              option-attribute="label"
              size="sm"
            />
          </UFormGroup>
        </div>
      </UForm>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            label="Cancel"
            @click="isOpen = false"
          />
          <UButton
            type="submit"
            form="create-task-form"
            color="primary"
            size="sm"
            label="Create Issue"
          />
        </div>
      </template>
    </UCard>
  </UModal>
</template>
