<script setup lang="ts">
import type { FormError, FormSubmitEvent } from "@nuxt/ui";
import * as v from "valibot";
import { useCreateTask } from "~/composables/useCreateTask";

const open = ref(false);

const schema = v.object({
  title: v.pipe(
    v.string(),
    v.nonEmpty("Title is required"),
    v.maxLength(200, "Title must be 200 characters or less"),
  ),
  description: v.optional(
    v.pipe(v.string(), v.maxLength(2000, "Description must be 2000 characters or less")),
  ),
  priority: v.picklist(["low", "medium", "high", "urgent"]),
  tags: v.optional(v.string()),
});

type Schema = v.InferOutput<typeof schema>;

const state = reactive<Schema>({
  title: "",
  description: "",
  priority: "medium",
  tags: "",
});

const priorityOptions = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Urgent", value: "urgent" },
];

const createTask = useCreateTask();

const validate = (state: Partial<Schema>): FormError[] => {
  const result = v.safeParse(schema, state);
  if (result.success) return [];

  return result.issues.map((issue) => ({
    name: issue.path?.map((p) => p.key).join(".") ?? "",
    message: issue.message,
  }));
};

const reset = () => {
  state.title = "";
  state.description = "";
  state.priority = "medium";
  state.tags = "";
};

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  const tags = event.data.tags
    ? event.data.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  await createTask.mutateAsync({
    title: event.data.title,
    description: event.data.description || null,
    tags,
    priority: event.data.priority,
    status: "open",
  });

  reset();
  open.value = false;
};
</script>

<template>
  <UModal v-model:open="open">
    <UButton label="Create Task" icon="i-lucide-plus" color="primary" size="sm" class="mr-4" />

    <template #content>
      <UForm
        :schema="schema"
        :state="state"
        :validate="validate"
        class="space-y-5 p-6"
        @submit="onSubmit"
      >
        <div>
          <h2 class="text-lg font-semibold">Create issue</h2>
          <p class="text-sm text-muted">Add a new issue to your project.</p>
        </div>

        <UFormField label="Title" name="title" required>
          <UInput v-model="state.title" placeholder="What needs to be done?" class="w-full" />
        </UFormField>

        <UFormField label="Description" name="description">
          <UTextarea
            v-model="state.description"
            placeholder="Describe the issue..."
            :rows="4"
            class="w-full"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Priority" name="priority" required>
            <USelect v-model="state.priority" :items="priorityOptions" class="w-full" />
          </UFormField>

          <UFormField label="Tags" name="tags" hint="Comma separated">
            <UInput v-model="state.tags" placeholder="frontend, bug" class="w-full" />
          </UFormField>
        </div>

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="createTask.isPending.value"
            @click="open = false"
          />

          <UButton type="submit" label="Create issue" :loading="createTask.isPending.value" />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
