<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import { ArrowRight, Package, Plus } from "@lucide/vue";
import { computed, ref } from "vue";
import { api, type Item, type PageQuery, type Project, type User } from "../api";
import { availabilityText, canAdd, ownershipOf } from "../availability";
import FilterChips from "../FilterChips.vue";
import { flashNow } from "../flash";
import { messageOf } from "../form-errors";
import Layout from "../Layout.vue";
import LoadMore from "../LoadMore.vue";
import { useList, useUrlParam } from "../list";
import { formatPrice, UNIT_LABELS } from "../money";
import PageState from "../PageState.vue";
import ProjectSelect from "../ProjectSelect.vue";
import SearchInput from "../SearchInput.vue";

type Owner = "all" | "supplier" | "shared" | "own";

const OWNERS: Record<Owner, string> = {
  all: "All",
  supplier: "Suppliers",
  shared: "My group",
  own: "My own",
};

const me = ref<User | null>(null);
/** The project that gets the items. `null` when there is no open project. */
const project = ref<Project | null>(null);
const projectsLoaded = ref(false);
const search = useUrlParam("q", "");
const category = useUrlParam("category", "");
// A value of the URL that is no owner counts as "All".
const owner = useUrlParam<Owner>("owner", "all", Object.keys(OWNERS));
// The id of the item that is being added now.
const addingId = ref("");
/** True when my company is in an organization group. Only then "My group" is a filter. */
const inGroup = ref(false);
/** The categories of my whole catalog, not only of the rows that are loaded. */
const categoryNames = ref<string[]>([]);

/**
 * The search and the filters run in the API. With a project, what is free is for the dates
 * of that project, and each item says how many of it are in the project already.
 */
function fetchCatalog(page: PageQuery) {
  return api.listCatalog({
    ...page,
    q: search.value,
    category: category.value,
    owner: owner.value === "all" ? "" : owner.value,
    projectId: project.value?.id,
  });
}

const {
  rows: items,
  total,
  loading,
  loadingMore,
  error,
  failed,
  load: loadItems,
  loadMore,
} = useList(fetchCatalog, [search, category, owner]);

const categories = computed(listCategories);
const owners = computed(listOwners);
const filtered = computed(isFiltered);

function setUser(user: User) {
  me.value = user;
}

function isOwn(item: Item): boolean {
  return ownershipOf(item, me.value?.companyId) === "own";
}

/** An item of another company of my organization group. */
function isShared(item: Item): boolean {
  return ownershipOf(item, me.value?.companyId) === "shared";
}

/** My own items and the shared ones are free and are not checked by date. */
function isFree(item: Item): boolean {
  return ownershipOf(item, me.value?.companyId) !== "supplier";
}

/** How many more of the item fit in the project: what is free, less what is in it already. */
function room(item: Item): number | null {
  return item.available === null ? null : Math.max(0, item.available - item.inProject);
}

/** True when one more can be added. A free item can always be added. */
function addable(item: Item): boolean {
  return canAdd(item, isFree(item)) && (isFree(item) || room(item) !== 0);
}

/** Green when it is free on the dates of the project, amber when it is not, grey for a stock. */
function availabilityClass(item: Item): string {
  if (!canAdd(item, isFree(item))) {
    return "avail-no";
  }
  return project.value && !isFree(item) ? "avail-yes" : "muted";
}

function listOwners(): [Owner, string][] {
  const result: [Owner, string][] = [];
  for (const [key, label] of Object.entries(OWNERS) as [Owner, string][]) {
    if (key !== "shared" || inGroup.value) {
      result.push([key, label]);
    }
  }
  return result;
}

/** The filter needs my group and the category names. The catalog works without them. */
async function loadFilters() {
  try {
    categoryNames.value = await api.listCategories("catalog");
    inGroup.value = (await api.getMyCompany()).organization !== null;
  } catch {
    // Only the "My group" filter and the category chips are missing.
  }
}

function listCategories() {
  const options = [{ value: "", label: "All" }];
  for (const name of categoryNames.value) {
    options.push({ value: name, label: name });
  }
  // A category of the URL that is not in the list still shows, so it can be taken away.
  if (category.value !== "" && !categoryNames.value.includes(category.value)) {
    options.push({ value: category.value, label: category.value });
  }
  return options;
}

function isFiltered(): boolean {
  return search.value.trim() !== "" || category.value !== "" || owner.value !== "all";
}

function resetFilters() {
  search.value = "";
  category.value = "";
  owner.value = "all";
}

/** The project select is ready: the items are asked for the dates of its project. */
function start() {
  projectsLoaded.value = true;
  return Promise.all([loadItems(), loadFilters()]);
}

async function add(item: Item) {
  const target = project.value;
  if (!target) {
    return;
  }
  error.value = "";
  addingId.value = item.id;
  try {
    const detail = await api.addProjectLine(target.id, item.id, 1);
    target.lineCount = detail.project.lineCount;
    item.inProject += 1;
    flashNow(`Added "${item.name}" to ${target.name}.`);
  } catch (caught) {
    // Another order may have taken the item. Show what is free now.
    await loadItems();
    error.value = messageOf(caught);
  } finally {
    addingId.value = "";
  }
}
</script>

<template>
  <Head title="Catalog" />
  <Layout
    title="Catalog"
    subtitle="Pick the items you need for your booth."
    :roles="['customer']"
    @loaded="setUser"
  >
    <template #actions>
      <!-- Another project has other dates, so the items are loaded again. -->
      <ProjectSelect v-model="project" label="Adding to" @ready="start" @change="loadItems" />
      <Link v-if="project" :href="`/projects/${project.id}`" class="button">
        <ArrowRight :size="16" aria-hidden="true" /> View project
      </Link>
    </template>

    <template #default>
      <p v-if="projectsLoaded && !failed && !project" class="notice">
        <span>
          You have no open project, so you cannot add items yet.
          <Link href="/projects/new">Create a project</Link>
        </span>
      </p>
      <div class="toolbar">
        <div class="inline" style="flex-wrap: wrap">
          <SearchInput v-model="search" label="Search items" />
          <FilterChips v-model="category" label="Category" :options="categories" />
        </div>
        <div class="segmented" role="group" aria-label="Owner of the item">
          <button
            v-for="[key, label] in owners"
            :key="key"
            type="button"
            :aria-pressed="owner === key"
            @click="owner = key"
          >
            {{ label }}
          </button>
        </div>
      </div>
      <p v-if="error && !failed" class="error" role="alert">{{ error }}</p>

      <PageState
        :loading="loading"
        :error="failed ? error : ''"
        :empty="total === 0 && !filtered"
        :no-match="total === 0"
        @retry="loadItems"
        @reset="resetFilters"
      >
        <template #empty>
          <strong>The catalog is empty</strong>
          <span>No supplier has listed an item yet. Come back later.</span>
        </template>
        <template #no-match>
          <template v-if="owner === 'own' && search.trim() === '' && category === ''">
            You have no own items yet. <Link href="/items/new">Add one in My items</Link>.
          </template>
          <template v-else-if="owner === 'shared' && search.trim() === '' && category === ''">
            The companies of your group share no items yet.
          </template>
          <template v-else>Nothing matches your search or filter.</template>
        </template>
        <ul class="item-grid">
          <li v-for="item in items" :key="item.id" class="item-card">
            <img v-if="item.photoUrl" :src="item.photoUrl" alt="" />
            <div v-else class="no-photo"><Package :size="40" aria-hidden="true" /></div>
            <div class="item-card-body">
              <span class="chips">
                <span class="badge">{{ item.category }}</span>
                <span v-if="isOwn(item)" class="badge ok">Your item</span>
                <span v-else-if="isShared(item)" class="badge bad">Shared</span>
              </span>
              <Link :href="`/catalog/${item.id}`">{{ item.name }}</Link>
              <span class="muted">
                {{ isShared(item) ? `Shared by ${item.companyName}` : item.companyName }}
              </span>
              <small :class="availabilityClass(item)">
                {{ availabilityText(item, project !== null, isFree(item)) }}
              </small>
              <small v-if="item.inProject > 0" class="in-project">
                {{ item.inProject }} in this project
              </small>
              <div class="card-footer">
                <span v-if="isFree(item)" class="price free">Free</span>
                <span v-else class="price">
                  {{ formatPrice(item.priceCents) }}
                  <small class="muted">/ {{ UNIT_LABELS[item.unit] }}</small>
                </span>
                <button
                  type="button"
                  class="dark"
                  :disabled="!project || addingId !== '' || !addable(item)"
                  :title="
                    project && canAdd(item, isFree(item)) && !addable(item)
                      ? 'All that are free are in your project already.'
                      : undefined
                  "
                  :aria-label="`Add ${item.name}`"
                  @click="add(item)"
                >
                  <Plus :size="16" aria-hidden="true" /> Add
                </button>
              </div>
            </div>
          </li>
        </ul>
      </PageState>
      <LoadMore :shown="items.length" :total="total" :busy="loadingMore" @more="loadMore" />
    </template>
  </Layout>
</template>
