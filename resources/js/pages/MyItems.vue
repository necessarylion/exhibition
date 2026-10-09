<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import { Plus, TriangleAlert } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { api, type MyItem, type PageQuery } from "../api";
import { vClip } from "../clip";
import { countText, formatDateRange } from "../dates";
import FilterChips from "../FilterChips.vue";
import { flashNow } from "../flash";
import { messageOf } from "../form-errors";
import ItemThumb from "../ItemThumb.vue";
import Layout from "../Layout.vue";
import LoadMore from "../LoadMore.vue";
import { useList, useUrlParam } from "../list";
import { formatPrice } from "../money";
import PageState from "../PageState.vue";
import SearchInput from "../SearchInput.vue";

const search = useUrlParam("q", "");
const category = useUrlParam("category", "");
/** The categories of all my items, not only of the rows that are loaded. */
const categoryNames = ref<string[]>([]);

/** The search and the category run in the API, so the counts are of every item that matches. */
function fetchItems(page: PageQuery) {
  return api.listMyItems({ ...page, q: search.value, category: category.value });
}

const {
  rows: items,
  total,
  counts,
  loading,
  loadingMore,
  error,
  failed,
  load,
  loadMore,
} = useList(fetchItems, [search, category]);

const categories = computed(listCategories);
const summary = computed(summarize);
const filtered = computed(isFiltered);

/** Like "7 items · 1 hidden". Both numbers come from the API. */
function summarize(): string {
  const hidden = counts.value.hidden ?? 0;
  const count = countText(total.value, "item");
  return hidden > 0 ? `${count} · ${hidden} hidden` : count;
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
  return search.value.trim() !== "" || category.value !== "";
}

function resetFilters() {
  search.value = "";
  category.value = "";
}

/** The chips of the filter. The list works without them. */
async function loadCategories() {
  try {
    categoryNames.value = await api.listCategories("mine");
  } catch {
    // No chips this time.
  }
}

function start() {
  return Promise.all([load(), loadCategories()]);
}

/** Like "12 – 14 Mar 2027 needs 6". One part per range of days that is over-booked. */
function overbookedText(item: MyItem): string {
  const parts: string[] = [];
  for (const range of item.overbooked) {
    parts.push(`${formatDateRange(range.from, range.to)} needs ${range.booked}`);
  }
  return parts.join(", ");
}

const subtitle = {
  admin: "The items customers can order from you.",
  supplier: "The items customers can order from you.",
  customer: "Your own items. You can use them in your projects for free.",
};

async function setHidden(item: MyItem, hidden: boolean) {
  error.value = "";
  try {
    await api.updateItem(item.id, { hidden });
    await load();
    flashNow(hidden ? `"${item.name}" is hidden.` : `"${item.name}" is listed again.`);
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

onMounted(start);
</script>

<template>
  <Head title="My items" />
  <Layout title="My items" :subtitle="subtitle">
    <template #actions>
      <Link href="/items/new" class="button">
        <Plus :size="16" aria-hidden="true" /> New item
      </Link>
    </template>

    <template #default="{ user }">
      <div class="toolbar">
        <div class="inline" style="flex-wrap: wrap">
          <SearchInput v-model="search" label="Search items" />
          <FilterChips v-model="category" label="Category" :options="categories" />
        </div>
        <span v-if="!loading && !failed" class="muted" role="status">{{ summary }}</span>
      </div>
      <p v-if="error && !failed" class="error" role="alert">{{ error }}</p>

      <PageState
        :loading="loading"
        :error="failed ? error : ''"
        :empty="total === 0 && !filtered"
        :no-match="total === 0"
        @retry="load"
        @reset="resetFilters"
      >
        <template #empty>
          <strong>No items yet</strong>
          <span v-if="user.role === 'customer'">
            Add the things you already own, like your own counter. They are free in your projects.
          </span>
          <span v-else>Add a booth, furniture or a screen. Customers find it in the catalog.</span>
          <Link href="/items/new" class="button">
            <Plus :size="16" aria-hidden="true" /> New item
          </Link>
        </template>
        <div class="table-wrap">
          <table class="first-wide">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>{{ user.role === "customer" ? "Value" : "Price" }}</th>
                <th>Stock</th>
                <!-- Nobody orders the own items of a customer. -->
                <th v-if="user.role !== 'customer'">Orders</th>
                <th>Status</th>
                <th><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="item.id">
                <td v-clip class="card-title">
                  <div class="inline">
                    <ItemThumb :url="item.photoUrl" />
                    <span class="two-lines">
                      <strong>{{ item.name }}</strong>
                      <small class="muted">{{ item.sku ? `SKU ${item.sku}` : "No SKU" }}</small>
                      <small v-if="item.overbooked.length > 0" class="stock-warning">
                        <TriangleAlert :size="14" aria-hidden="true" />
                        You have less than what is booked: {{ overbookedText(item) }}.
                      </small>
                    </span>
                  </div>
                </td>
                <td v-clip data-label="Category">{{ item.category }}</td>
                <td :data-label="user.role === 'customer' ? 'Value' : 'Price'">
                  <strong>{{ formatPrice(item.priceCents) }}</strong>
                </td>
                <td data-label="Stock">
                  <span :class="{ muted: item.stock === null }">
                    {{ item.stock === null ? "No limit" : item.stock.toLocaleString("en-US") }}
                  </span>
                </td>
                <td v-if="user.role !== 'customer'" data-label="Orders">{{ item.orderCount }}</td>
                <td class="card-badge">
                  <span v-if="item.hiddenAt" class="badge">Hidden</span>
                  <!-- Customers see nothing of a supplier that waits for an admin. -->
                  <span v-else-if="!user.companyApproved" class="badge warn">
                    Waiting for approval
                  </span>
                  <span v-else class="badge ok">Listed</span>
                </td>
                <td class="actions">
                  <Link
                    :href="`/items/${item.id}/edit`"
                    class="button ghost"
                    :aria-label="`Edit ${item.name}`"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    class="ghost"
                    :aria-label="`${item.hiddenAt ? 'Show' : 'Hide'} ${item.name}`"
                    @click="setHidden(item, !item.hiddenAt)"
                  >
                    {{ item.hiddenAt ? "Show" : "Hide" }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageState>
      <LoadMore :shown="items.length" :total="total" :busy="loadingMore" @more="loadMore" />
    </template>
  </Layout>
</template>
