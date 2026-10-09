<script setup lang="ts">
// The project that the catalog adds items to. Only projects that can still get items.
// It asks the API for the first projects (the next events). When the customer has more
// than fit in the select, a search field narrows them, so every project can be reached.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, type Project } from "./api";
import { getChosenProjectId, setChosenProjectId } from "./chosen-project";
import { countText, formatDateRange } from "./dates";

const SHOWN = 50;

defineProps<{ label: string }>();
/** The chosen project. `null` when the customer has no open project. */
const project = defineModel<Project | null>({ required: true });
/** `ready` comes once, after the first load. `change` comes when the user picks another one. */
const emit = defineEmits<{ ready: []; change: [] }>();

const projects = ref<Project[]>([]);
/** How many open projects the customer has. */
const total = ref(0);
const search = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;

/** The first open projects that match the search. The chosen one is always in the list. */
async function load(): Promise<void> {
  const page = await api.listProjects({ open: true, q: search.value, limit: SHOWN });
  const rows = page.rows;
  const chosen = project.value;
  if (chosen && !rows.some(isChosen)) {
    rows.unshift(chosen);
  }
  projects.value = rows;
  if (search.value.trim() === "") {
    total.value = page.total;
  }
}

function isChosen(candidate: Project): boolean {
  return candidate.id === project.value?.id;
}

/** The project of the last visit when it is still open. Else the next event. */
async function start() {
  try {
    project.value = await remembered();
    await load();
    project.value ??= projects.value[0] ?? null;
  } catch {
    // The catalog still shows, with the stock in place of the availability.
    project.value = null;
  }
  emit("ready");
}

async function remembered(): Promise<Project | null> {
  const id = getChosenProjectId();
  if (!id) {
    return null;
  }
  try {
    const found = (await api.getProject(id)).project;
    return found.status === "done" || found.status === "cancelled" ? null : found;
  } catch {
    // The project is gone, or it belongs to another account that used this browser.
    return null;
  }
}

function choose(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  for (const candidate of projects.value) {
    if (candidate.id === id) {
      project.value = candidate;
      setChosenProjectId(id);
      emit("change");
    }
  }
}

function searchSoon() {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
}

function stop() {
  clearTimeout(timer);
}

watch(search, searchSoon);
onMounted(start);
onBeforeUnmount(stop);
</script>

<template>
  <span v-if="project" class="project-select">
    <label class="adding-to">
      {{ label }}
      <select name="projectId" :value="project.id" @change="choose">
        <option v-for="open in projects" :key="open.id" :value="open.id">
          {{ open.name }} · {{ formatDateRange(open.startsOn, open.endsOn) }} ·
          {{ countText(open.lineCount, "item") }}
        </option>
      </select>
    </label>
    <label v-if="total > SHOWN" class="adding-to">
      Find a project ({{ total }} open)
      <input v-model="search" type="search" placeholder="Type a name" />
    </label>
  </span>
</template>
