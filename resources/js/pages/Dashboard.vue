<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import {
  ChevronRight,
  CircleCheck,
  FolderKanban,
  Hourglass,
  Plus,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
} from "@lucide/vue";
import { onMounted, ref } from "vue";
import { api, type Dashboard } from "../api";
import { vClip } from "../clip";
import { formatDate, formatDateRange, joinParts } from "../dates";
import { messageOf } from "../form-errors";
import Layout from "../Layout.vue";
import { formatPrice } from "../money";
import PageState from "../PageState.vue";
import StatTile from "../StatTile.vue";
import StatusBadge from "../StatusBadge.vue";
import SupplierStats from "../SupplierStats.vue";

// One page for the three roles. The API answers with the numbers of the role of the user.
const SUBTITLES = {
  customer: "Your projects and orders at a glance.",
  supplier: "Your orders and items at a glance.",
  admin: "Everything on the platform at a glance.",
};
const TYPE_LABELS = { admin: "Admin", supplier: "Supplier", customer: "Customer" };

const data = ref<Dashboard | null>(null);
const loading = ref(true);
const error = ref("");

async function load() {
  error.value = "";
  try {
    data.value = await api.getDashboard();
  } catch (caught) {
    error.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Head title="Home" />
  <Layout title="Home" :subtitle="SUBTITLES">
    <template #actions="{ user }">
      <Link v-if="user.role === 'customer'" href="/projects/new" class="button">
        <Plus :size="16" aria-hidden="true" /> New project
      </Link>
    </template>

    <template #default="{ user }">
      <PageState v-if="!data" :loading="loading" :error="error" @retry="load" />

      <template v-else-if="data.role === 'customer'">
        <div class="stats">
          <StatTile
            label="Projects in progress"
            :value="data.projectsInProgress"
            :note="
              joinParts([
                data.projectsWaiting > 0 ? `${data.projectsWaiting} waiting` : '',
                data.projectsConfirmed > 0 ? `${data.projectsConfirmed} confirmed` : '',
                data.projectsDraft > 0 ? `${data.projectsDraft} draft` : '',
              ]) || 'Not done and not cancelled'
            "
            :icon="FolderKanban"
          />
          <StatTile
            label="Orders waiting"
            :value="data.ordersWaiting"
            note="Suppliers have not answered yet"
            :icon="Hourglass"
          />
          <StatTile
            label="Orders confirmed"
            :value="data.ordersConfirmed"
            note="Accepted or completed"
            :icon="CircleCheck"
          />
          <StatTile
            label="Total spend"
            :value="formatPrice(data.totalSpendCents)"
            note="Accepted and completed orders"
            :icon="Wallet"
          />
        </div>

        <!-- A new account: no project and no order yet. -->
        <section
          v-if="data.upcomingProjects.length === 0 && data.recentOrders.length === 0"
          class="panel pad guide"
          aria-labelledby="start-here"
        >
          <h2 id="start-here">Start here</h2>
          <ol class="steps">
            <li>
              <strong>Create a project</strong>
              <small>Give it a name and the dates of the event.</small>
            </li>
            <li>
              <strong>Add items</strong>
              <small>Pick the booth, furniture and more from the catalog.</small>
            </li>
            <li>
              <strong>Send the request</strong>
              <small>Each supplier gets one order and accepts or rejects it.</small>
            </li>
          </ol>
          <div>
            <Link href="/projects/new" class="button">
              <Plus :size="16" aria-hidden="true" /> New project
            </Link>
          </div>
        </section>

        <div v-else class="halves">
          <section class="panel" aria-labelledby="upcoming">
            <div class="panel-header">
              <h2 id="upcoming">Upcoming events</h2>
              <Link href="/projects" class="more">
                All projects <ChevronRight :size="14" aria-hidden="true" />
              </Link>
            </div>
            <p v-if="data.upcomingProjects.length === 0" class="panel-note muted">
              No event is coming up.
            </p>
            <ul v-else class="rows">
              <li v-for="project in data.upcomingProjects" :key="project.id">
                <Link :href="`/projects/${project.id}`">
                  <span class="two-lines grow">
                    <strong>{{ project.name }}</strong>
                    <small class="muted">
                      {{ joinParts([project.venue, project.city], ", ") || "No venue yet" }}
                    </small>
                  </span>
                  <span class="cell-dates">
                    {{ formatDateRange(project.startsOn, project.endsOn) }}
                  </span>
                  <span class="cell-badge"><StatusBadge :status="project.status" /></span>
                </Link>
              </li>
            </ul>
          </section>

          <section class="panel" aria-labelledby="recent-orders">
            <div class="panel-header">
              <h2 id="recent-orders">Recent orders</h2>
              <Link href="/orders" class="more">
                All orders <ChevronRight :size="14" aria-hidden="true" />
              </Link>
            </div>
            <p v-if="data.recentOrders.length === 0" class="panel-note muted">
              No orders yet. Open a project and send the request.
            </p>
            <ul v-else class="rows">
              <li v-for="order in data.recentOrders" :key="order.id">
                <Link :href="`/orders/${order.id}`">
                  <span class="two-lines grow">
                    <strong>{{ order.supplierCompanyName }}</strong>
                    <small class="muted">{{ order.number }} · {{ order.projectName }}</small>
                  </span>
                  <strong class="cell-money">{{ formatPrice(order.totalCents) }}</strong>
                  <span class="cell-badge"><StatusBadge :status="order.status" /></span>
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </template>

      <template v-else-if="data.role === 'supplier'">
        <!-- A new account: no item yet. -->
        <section
          v-if="data.itemsListed + data.itemsHidden === 0 && user.companyApproved"
          class="panel pad guide"
          aria-labelledby="start-here"
        >
          <h2 id="start-here">Start here</h2>
          <ol class="steps">
            <li>
              <strong>Add your first item</strong>
              <small>A booth, furniture, lighting or a screen. Give it a price and photos.</small>
            </li>
            <li>
              <strong>Customers find it in the catalog</strong>
              <small>They add it to a project and send you an order.</small>
            </li>
            <li>
              <strong>Answer the order</strong>
              <small>Accept it or reject it with a reason.</small>
            </li>
          </ol>
          <div>
            <Link href="/items/new" class="button">
              <Plus :size="16" aria-hidden="true" /> New item
            </Link>
          </div>
        </section>
        <SupplierStats :stats="data" :waiting="!user.companyApproved" />
      </template>

      <template v-else>
        <div class="stats six">
          <StatTile
            label="Customers"
            :value="data.customers"
            :note="
              data.customersDisabled > 0 ? `${data.customersDisabled} disabled` : 'All active'
            "
            :icon="Users"
          />
          <StatTile
            label="Suppliers"
            :value="data.suppliers"
            :note="
              data.suppliersWaiting > 0
                ? `${data.suppliersWaiting} waiting for approval`
                : 'Companies that sell'
            "
            :icon="Truck"
          />
          <!-- The one tile that asks the admin to do something. It opens the list. -->
          <Link
            href="/admin/suppliers"
            class="stat plain"
            :class="{ attention: data.suppliersWaiting > 0 }"
          >
            <span class="label-row">
              To approve
              <ShieldCheck class="stat-icon" :size="18" aria-hidden="true" />
            </span>
            <strong>{{ data.suppliersWaiting }}</strong>
            <small>
              {{ data.suppliersWaiting === 1 ? "Supplier waiting" : "Suppliers waiting" }}
            </small>
          </Link>
          <StatTile
            label="Projects"
            :value="data.projects"
            :note="data.projectsWaiting > 0 ? `${data.projectsWaiting} waiting` : 'None waiting'"
            :icon="FolderKanban"
          />
          <StatTile
            label="Orders waiting"
            :value="data.ordersWaiting"
            note="Not answered yet"
            :icon="Hourglass"
          />
          <StatTile
            label="Order value"
            :value="formatPrice(data.orderValueCents)"
            note="Accepted and completed"
            :icon="Wallet"
          />
        </div>

        <div class="halves">
          <section class="panel" aria-labelledby="recent-projects">
            <div class="panel-header">
              <h2 id="recent-projects">Recent projects</h2>
              <Link href="/admin/projects" class="more">
                All projects <ChevronRight :size="14" aria-hidden="true" />
              </Link>
            </div>
            <p v-if="data.recentProjects.length === 0" class="panel-note muted">
              No customer has a project yet.
            </p>
            <ul v-else class="rows">
              <li v-for="project in data.recentProjects" :key="project.id">
                <Link :href="`/admin/projects/${project.id}`">
                  <span class="two-lines grow">
                    <strong>{{ project.name }}</strong>
                    <small class="muted">
                      {{ project.companyName }} ·
                      {{ formatDateRange(project.startsOn, project.endsOn) }}
                    </small>
                  </span>
                  <span class="cell-badge"><StatusBadge :status="project.status" /></span>
                </Link>
              </li>
            </ul>
          </section>

          <section class="panel" aria-labelledby="recent-orders">
            <div class="panel-header">
              <h2 id="recent-orders">Recent orders</h2>
              <Link href="/admin/projects" class="more">
                All projects <ChevronRight :size="14" aria-hidden="true" />
              </Link>
            </div>
            <p v-if="data.recentOrders.length === 0" class="panel-note muted">
              No customer sent an order yet.
            </p>
            <ul v-else class="rows">
              <li v-for="order in data.recentOrders" :key="order.id">
                <!-- On the admin side an order lives inside its project. -->
                <Link :href="`/admin/projects/${order.projectId}#order-${order.id}`">
                  <span class="two-lines grow">
                    <strong>{{ order.number }}</strong>
                    <small class="muted">
                      {{ order.customerCompanyName }} → {{ order.supplierCompanyName }}
                    </small>
                  </span>
                  <strong class="cell-money">{{ formatPrice(order.totalCents) }}</strong>
                  <span class="cell-badge"><StatusBadge :status="order.status" /></span>
                </Link>
              </li>
            </ul>
          </section>
        </div>

        <section class="panel" aria-labelledby="newest-companies">
          <div class="panel-header">
            <h2 id="newest-companies">Newest companies</h2>
          </div>
          <p v-if="data.newestCompanies.length === 0" class="panel-note muted">
            No company signed up yet.
          </p>
          <div v-else class="table-wrap">
            <table class="first-wide">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Owner</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="company in data.newestCompanies" :key="company.id">
                  <td v-clip class="card-title">
                    <Link :href="`/admin/${company.type}s/${company.id}/users`" class="plain">
                      {{ company.name }}
                    </Link>
                  </td>
                  <td class="card-badge">
                    <span class="badge">{{ TYPE_LABELS[company.type] }}</span>
                  </td>
                  <td v-clip data-label="Owner">{{ company.ownerName ?? "No user" }}</td>
                  <td data-label="Joined">
                    <span class="muted">{{ formatDate(company.createdAt) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- The admin company can sell items too. These numbers are only its own. -->
        <section class="own-section" aria-labelledby="own-numbers">
          <div>
            <h2 id="own-numbers">Items and orders of {{ user.companyName }}</h2>
            <p class="muted">
              Your company can sell items like a supplier. These numbers count only the orders for
              your own items.
            </p>
          </div>
          <SupplierStats :stats="data.asSupplier" />
        </section>
      </template>
    </template>
  </Layout>
</template>
