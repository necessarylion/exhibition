<script setup lang="ts">
import { Head, Link, router } from "@inertiajs/vue3";
import { ChevronRight } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { api, type Order, type OrderStatus, type PageQuery, type User } from "../api";
import { vClip } from "../clip";
import { countText, formatDate, formatDateRange, joinParts } from "../dates";
import FilterChips from "../FilterChips.vue";
import Layout from "../Layout.vue";
import LoadMore from "../LoadMore.vue";
import { useList, useUrlParam } from "../list";
import { formatPrice } from "../money";
import PageState from "../PageState.vue";
import SearchInput from "../SearchInput.vue";
import StatusBadge from "../StatusBadge.vue";
import { ORDER_STATUSES, STATUS_LABELS } from "../status";

// The orders of my company: for my items (supplier, admin), or the ones I sent (customer).
// There is no list of every order: an admin sees the orders of others inside their project.
const ALL = "all";
type Tab = OrderStatus | typeof ALL;

const search = useUrlParam("q", "");
// The page opens on "Waiting". A value of the URL that is no tab counts as "All".
const status = useUrlParam<Tab>("status", "pending", [...ORDER_STATUSES, ALL]);
const me = ref<User | null>(null);

/** The search and the status run in the API, so the counts and the total are of every row. */
function fetchOrders(page: PageQuery) {
  return api.listOrders({
    ...page,
    q: search.value,
    status: status.value === ALL ? "" : status.value,
  });
}

const {
  rows: orders,
  total,
  counts,
  loading,
  loadingMore,
  error,
  failed,
  load,
  loadMore,
} = useList(fetchOrders, [search, status]);

/** A customer sees the orders they sent. The other company is then the supplier. */
const customerView = computed(isCustomerView);
const options = computed(listOptions);
const summary = computed(summarize);
const everyOrder = computed(countAll);
const SUBTITLES = {
  customer: "The orders you sent to suppliers. Open an order to see its answer.",
  supplier: "Orders from customers for your items. Open an order to answer it.",
  admin: "Orders from customers for the items of your company. Open an order to answer it.",
};

function setUser(user: User) {
  me.value = user;
}

function isCustomerView(): boolean {
  return me.value?.role === "customer";
}

/** How many orders match the search, in every status together. */
function countAll(): number {
  let sum = 0;
  for (const name of ORDER_STATUSES) {
    sum += counts.value[name] ?? 0;
  }
  return sum;
}

/** Every status has its count. "All" is the last tab. */
function listOptions() {
  const result: { value: string; label: string; count?: number }[] = [];
  for (const name of ORDER_STATUSES) {
    result.push({ value: name, label: STATUS_LABELS[name], count: counts.value[name] ?? 0 });
  }
  result.push({ value: ALL, label: "All", count: everyOrder.value });
  return result;
}

/** "Show all": every status, no search. */
function resetFilters() {
  search.value = "";
  status.value = ALL;
}

/** Like "3 orders are waiting for your answer · $1,200.00". The numbers come from the API. */
function summarize(): string {
  const count = countText(total.value, "order");
  const money = counts.value.totalCents ?? 0;
  if (status.value === "pending") {
    const verb = total.value === 1 ? "is" : "are";
    const whose = customerView.value ? "an answer" : "your answer";
    return `${count} ${verb} waiting for ${whose} · ${formatPrice(money)}`;
  }
  if (status.value === "rejected" || status.value === "cancelled") {
    return count;
  }
  const note = status.value === ALL ? " without rejected and cancelled" : "";
  return `${count} · ${formatPrice(money)}${note}`;
}

function open(order: Order) {
  router.visit(`/orders/${order.id}`);
}

onMounted(load);
</script>

<template>
  <Head title="Orders" />
  <Layout
    :title="me?.role === 'admin' ? 'Orders for our items' : 'Orders'"
    :subtitle="SUBTITLES"
    @loaded="setUser"
  >
    <template #default="{ user }">
      <div class="toolbar">
        <FilterChips v-model="status" label="Status" :options="options" tabs />
        <SearchInput
          v-model="search"
          :label="customerView ? 'Search orders or suppliers' : 'Search orders or customers'"
        />
      </div>
      <p v-if="user.role === 'admin'" class="muted">
        The orders of other suppliers are inside their project.
        <Link href="/admin/projects">Go to Projects</Link>
      </p>
      <p v-if="error && !failed" class="error" role="alert">{{ error }}</p>

      <PageState
        :loading="loading"
        :error="failed ? error : ''"
        :empty="everyOrder === 0 && search.trim() === ''"
        :no-match="total === 0"
        @retry="load"
        @reset="resetFilters"
      >
        <template #empty>
          <template v-if="customerView">
            <strong>No orders yet</strong>
            <span>Open a project, add items and send the request. Each supplier gets one order.</span>
            <Link href="/projects" class="button secondary">Go to projects</Link>
          </template>
          <template v-else>
            <strong>No orders yet</strong>
            <span>An order comes in when a customer asks for your items.</span>
          </template>
        </template>
        <template #no-match>
          <template v-if="search.trim() !== ''">Nothing matches your search.</template>
          <template v-else>No {{ STATUS_LABELS[status as OrderStatus].toLowerCase() }} orders.</template>
        </template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Project</th>
                <th>{{ customerView ? "Supplier" : "Customer" }}</th>
                <th>Event dates</th>
                <th class="num">Items</th>
                <th class="num">Total</th>
                <th>Status</th>
                <th><span class="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in orders" :key="order.id" class="clickable" @click="open(order)">
                <td class="card-title">
                  <span class="two-lines">
                    <strong>{{ order.number }}</strong>
                    <small class="muted">Sent {{ formatDate(order.createdAt) }}</small>
                  </span>
                </td>
                <td v-clip data-label="Project">
                  <span class="two-lines">
                    <strong>{{ order.projectName }}</strong>
                    <small class="muted">{{ joinParts([order.venue, order.city], ", ") }}</small>
                  </span>
                </td>
                <td v-clip :data-label="customerView ? 'Supplier' : 'Customer'">
                  {{ customerView ? order.supplierCompanyName : order.customerCompanyName }}
                </td>
                <td data-label="Event dates">
                  {{ formatDateRange(order.startsOn, order.endsOn) }}
                </td>
                <td class="num" data-label="Items">{{ order.lineCount }}</td>
                <td class="num" data-label="Total">
                  <strong>{{ formatPrice(order.totalCents) }}</strong>
                </td>
                <td class="card-badge"><StatusBadge :status="order.status" /></td>
                <td class="actions">
                  <!-- The row opens on a click. This link is for the keyboard, screen readers
                       and the phone. -->
                  <Link
                    :href="`/orders/${order.id}`"
                    class="button ghost"
                    :aria-label="`Open order ${order.number}`"
                    @click.stop
                  >
                    <ChevronRight class="phone-hide" :size="18" aria-hidden="true" />
                    <span class="phone-only">Open order</span>
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted" role="status">{{ summary }}</p>
      </PageState>
      <LoadMore :shown="orders.length" :total="total" :busy="loadingMore" @more="loadMore" />
    </template>
  </Layout>
</template>
