<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { ChevronRight, Plus } from "@lucide/vue";
import { computed, onMounted } from "vue";
import { api, type PageQuery, type Project, type ProjectStatus } from "../api";
import { vClip } from "../clip";
import { countText, formatDateRange, joinParts } from "../dates";
import FilterChips from "../FilterChips.vue";
import Layout from "../Layout.vue";
import LoadMore from "../LoadMore.vue";
import { useList, useUrlParam } from "../list";
import { formatPrice } from "../money";
import PageState from "../PageState.vue";
import SearchInput from "../SearchInput.vue";
import StatusBadge from "../StatusBadge.vue";
import { PROJECT_STATUSES, STATUS_LABELS } from "../status";

// Two URLs open this page: `/projects` shows my projects (customer).
// `/admin/projects` shows every project (admin). An admin sees the orders inside a project.
const adminView = usePage().url.startsWith("/admin");
const baseUrl = adminView ? "/admin/projects" : "/projects";
const subtitle = adminView
  ? "All customer projects. Open a project to see its orders."
  : "Your exhibition projects and their status.";

/** The filter of the admin list that is no status: the projects with an order to answer. */
const HAS_WAITING = "has-waiting-orders";
type Filter = ProjectStatus | typeof HAS_WAITING | "";

const STATUS_OPTIONS = [{ value: "", label: "All" }];
for (const name of PROJECT_STATUSES) {
  STATUS_OPTIONS.push({ value: name, label: STATUS_LABELS[name] });
}
if (adminView) {
  STATUS_OPTIONS.push({ value: HAS_WAITING, label: "Has waiting orders" });
}
const ALLOWED: string[] = [];
for (const option of STATUS_OPTIONS) {
  ALLOWED.push(option.value);
}

const search = useUrlParam("q", "");
// A value of the URL that is no filter counts as "All".
const status = useUrlParam<Filter>("status", "", ALLOWED);

/** The search and the filter run in the API, so the count and the total are of every row. */
function fetchProjects(page: PageQuery) {
  const waiting = status.value === HAS_WAITING;
  return api.listProjects({
    ...page,
    q: search.value,
    status: waiting ? "" : status.value,
    hasWaitingOrders: waiting,
  });
}

const {
  rows: projects,
  total,
  counts,
  loading,
  loadingMore,
  error,
  failed,
  load,
  loadMore,
} = useList(fetchProjects, [search, status]);

const filtered = computed(isFiltered);
const summary = computed(summarize);

function isFiltered(): boolean {
  return search.value.trim() !== "" || status.value !== "";
}

function resetFilters() {
  search.value = "";
  status.value = "";
}

/** Like "1,051 projects", and for an admin the sum of their orders. Both come from the API. */
function summarize(): string {
  const count = countText(total.value, "project");
  return adminView ? `${count} · ${formatPrice(counts.value.totalCents ?? 0)}` : count;
}

function emptyText(): string {
  if (status.value === HAS_WAITING) {
    return "No project has an order that waits for an answer.";
  }
  return `No ${STATUS_LABELS[status.value as ProjectStatus].toLowerCase()} projects.`;
}

/** Like "3 orders · 1 waiting". */
function ordersText(project: Project): string {
  if (project.orderCount === 0) {
    return "No orders";
  }
  const waiting = project.pendingOrderCount > 0 ? `${project.pendingOrderCount} waiting` : "";
  return joinParts([countText(project.orderCount, "order"), waiting]);
}

function open(project: Project) {
  router.visit(`${baseUrl}/${project.id}`);
}

onMounted(load);
</script>

<template>
  <Head title="Projects" />
  <Layout title="Projects" :subtitle="subtitle" :roles="[adminView ? 'admin' : 'customer']">
    <template #actions>
      <Link v-if="!adminView" href="/projects/new" class="button">
        <Plus :size="16" aria-hidden="true" /> New project
      </Link>
    </template>

    <template #default>
      <div class="toolbar">
        <div class="inline" style="flex-wrap: wrap">
          <SearchInput
            v-model="search"
            :label="adminView ? 'Search projects or customers' : 'Search projects'"
          />
          <FilterChips v-model="status" label="Status" :options="STATUS_OPTIONS" />
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
          <template v-if="adminView">No customer has a project yet.</template>
          <template v-else>
            <strong>No projects yet</strong>
            <span>A project is one exhibition. Create it, then add items from the catalog.</span>
            <Link href="/projects/new" class="button">
              <Plus :size="16" aria-hidden="true" /> New project
            </Link>
          </template>
        </template>
        <template #no-match>
          <template v-if="status !== '' && search.trim() === ''">{{ emptyText() }}</template>
          <template v-else>Nothing matches your search.</template>
        </template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th v-if="adminView">Customer</th>
                <th>Dates</th>
                <th v-if="!adminView">Place</th>
                <th v-if="!adminView" class="num">Items</th>
                <th>Orders</th>
                <th class="num">Total</th>
                <th>Status</th>
                <th><span class="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="project in projects"
                :key="project.id"
                class="clickable"
                @click="open(project)"
              >
                <td v-clip class="card-title">
                  <span class="two-lines">
                    <strong>{{ project.name }}</strong>
                    <small class="muted">
                      {{
                        adminView
                          ? joinParts([project.venue, project.city], ", ")
                          : joinParts([
                              project.hall,
                              project.boothNumber && `Booth ${project.boothNumber}`,
                            ])
                      }}
                    </small>
                  </span>
                </td>
                <td v-if="adminView" v-clip data-label="Customer">{{ project.companyName }}</td>
                <td data-label="Dates">{{ formatDateRange(project.startsOn, project.endsOn) }}</td>
                <td v-if="!adminView" v-clip data-label="Place">
                  {{ joinParts([project.venue, project.city], ", ") || "Not set" }}
                </td>
                <td v-if="!adminView" class="num" data-label="Items">{{ project.lineCount }}</td>
                <td data-label="Orders" :class="{ muted: project.orderCount === 0 }">
                  {{ ordersText(project) }}
                </td>
                <td class="num" data-label="Total">
                  <strong>{{ formatPrice(project.totalCents) }}</strong>
                </td>
                <td class="card-badge"><StatusBadge :status="project.status" /></td>
                <td class="actions">
                  <!-- The row opens on a click. This link is for the keyboard, screen readers
                       and the phone. -->
                  <Link
                    :href="`${baseUrl}/${project.id}`"
                    class="button ghost"
                    :aria-label="`Open ${project.name}`"
                    @click.stop
                  >
                    <template v-if="adminView">View</template>
                    <template v-else>
                      <ChevronRight class="phone-hide" :size="18" aria-hidden="true" />
                      <span class="phone-only">Open project</span>
                    </template>
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageState>
      <LoadMore :shown="projects.length" :total="total" :busy="loadingMore" @more="loadMore" />
    </template>
  </Layout>
</template>
