<script setup lang="ts">
import { Head, Link, usePage } from "@inertiajs/vue3";
import { LogIn, Plus } from "@lucide/vue";
import { computed, onMounted } from "vue";
import { actAsCustomer } from "../acting";
import { api, type Company, type PageQuery, type RegisterInput } from "../api";
import { vClip } from "../clip";
import { countText, formatDate, joinParts } from "../dates";
import { flashNow } from "../flash";
import { messageOf } from "../form-errors";
import Layout from "../Layout.vue";
import LoadMore from "../LoadMore.vue";
import { useList, useUrlParam } from "../list";
import PageState from "../PageState.vue";
import SearchInput from "../SearchInput.vue";

// One page for both lists. The URL says which one.
const page = usePage();
const type: RegisterInput["role"] = page.url.startsWith("/admin/suppliers")
  ? "supplier"
  : "customer";
const plural = type === "supplier" ? "Suppliers" : "Customers";
const subtitle =
  type === "supplier"
    ? "Companies that own items and take orders."
    : "Companies that plan exhibitions and order items.";

const search = useUrlParam("q", "");

/** The search runs in the API, so the count is of every company that matches. */
function fetchCompanies(page: PageQuery) {
  return api.listCompanies(type, { ...page, q: search.value });
}

const {
  rows: companies,
  total,
  counts,
  loading,
  loadingMore,
  error,
  failed,
  load,
  loadMore,
} = useList(fetchCompanies, [search]);

function resetSearch() {
  search.value = "";
}

const summary = computed(summarize);

async function approve(company: Company) {
  const text = `Approve ${company.name}? Customers can then see and order its items.`;
  if (!confirm(text)) {
    return;
  }
  error.value = "";
  try {
    await api.approveCompany(company.id);
    await load();
    flashNow(`${company.name} is approved.`);
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

/** What the confirm says about the orders of the company, before it is disabled. */
function ordersWarning(company: Company): string {
  const waiting = company.pendingOrderCount;
  const accepted = company.acceptedOrderCount;
  const other = type === "supplier" ? "customers" : "suppliers";
  const parts: string[] = [];
  if (waiting > 0) {
    parts.push(
      `${countText(waiting, "waiting order")} will be cancelled and the ${other} are told.`,
    );
  }
  if (accepted > 0) {
    const stay = accepted === 1 ? "stays as it is" : "stay as they are";
    const them = accepted === 1 ? "it" : "them";
    parts.push(
      `${countText(accepted, "accepted order")} ${stay}. Cancel ${them} from the project page if needed.`,
    );
  }
  return parts.length > 0 ? `\n\n${parts.join("\n")}` : "";
}

async function setDisabled(company: Company, disabled: boolean) {
  const text = `Disable ${company.name}? Its users are logged out and cannot log in.${ordersWarning(company)}`;
  if (disabled && !confirm(text)) {
    return;
  }
  error.value = "";
  try {
    await api.updateCompany(company.id, { disabled });
    await load();
    flashNow(`${company.name} is ${disabled ? "disabled" : "enabled"}.`);
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

async function actAs(company: Company) {
  error.value = "";
  try {
    await actAsCustomer(company);
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

/** Like "6 suppliers · 1 waiting for approval · 1 disabled". The numbers come from the API. */
function summarize(): string {
  const waiting = counts.value.waiting ?? 0;
  const disabled = counts.value.disabled ?? 0;
  return joinParts([
    countText(total.value, type),
    waiting > 0 ? `${waiting} waiting for approval` : "",
    disabled > 0 ? `${disabled} disabled` : "",
  ]);
}

onMounted(load);
</script>

<template>
  <Head :title="plural" />
  <Layout :title="plural" :subtitle="subtitle" :roles="['admin']">
    <template #actions>
      <Link :href="`/admin/${type}s/new`" class="button">
        <Plus :size="16" aria-hidden="true" /> New {{ type }}
      </Link>
    </template>

    <template #default>
      <div class="toolbar">
        <SearchInput v-model="search" label="Search by company or email" />
        <span v-if="!loading && !failed" class="muted" role="status">{{ summary }}</span>
      </div>
      <p v-if="error && !failed" class="error" role="alert">{{ error }}</p>

      <PageState
        :loading="loading"
        :error="failed ? error : ''"
        :empty="total === 0 && search.trim() === ''"
        :no-match="total === 0"
        @retry="load"
        @reset="resetSearch"
      >
        <template #empty>
          <strong>No {{ plural.toLowerCase() }} yet</strong>
          <span>Create the first one with "New {{ type }}".</span>
        </template>
        <div class="table-wrap">
          <table class="first-wide">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact email</th>
                <th>Joined</th>
                <th>Status</th>
                <th><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="company in companies" :key="company.id">
                <td v-clip class="card-title">
                  <span class="two-lines">
                    <strong>{{ company.name }}</strong>
                    <small v-if="company.organizationName" class="muted">
                      {{ company.organizationName }}
                    </small>
                  </span>
                </td>
                <td v-clip data-label="Contact email">
                  <span class="muted">{{ company.contactEmail ?? "No user" }}</span>
                </td>
                <td data-label="Joined">
                  <span class="muted">{{ formatDate(company.createdAt) }}</span>
                </td>
                <td class="card-badge">
                  <span v-if="company.disabledAt" class="badge">Disabled</span>
                  <span v-else-if="!company.approvedAt" class="badge warn">
                    Waiting for approval
                  </span>
                  <span v-else class="badge ok">Active</span>
                </td>
                <td class="actions">
                  <button
                    v-if="!company.approvedAt"
                    type="button"
                    class="outline"
                    :aria-label="`Approve ${company.name}`"
                    @click="approve(company)"
                  >
                    Approve
                  </button>
                  <button
                    v-if="type === 'customer'"
                    type="button"
                    class="ghost"
                    :disabled="Boolean(company.disabledAt)"
                    :title="company.disabledAt ? 'Enable the company first.' : undefined"
                    :aria-label="`Act as ${company.name}`"
                    @click="actAs(company)"
                  >
                    <LogIn :size="16" aria-hidden="true" /> Act as customer
                  </button>
                  <Link
                    :href="`/admin/${type}s/${company.id}/users`"
                    class="button ghost"
                    :aria-label="`Users of ${company.name}`"
                  >
                    Users
                  </Link>
                  <Link
                    :href="`/admin/${type}s/${company.id}/edit`"
                    class="button ghost"
                    :aria-label="`Edit ${company.name}`"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    class="ghost"
                    :aria-label="`${company.disabledAt ? 'Enable' : 'Disable'} ${company.name}`"
                    @click="setDisabled(company, !company.disabledAt)"
                  >
                    {{ company.disabledAt ? "Enable" : "Disable" }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageState>
      <LoadMore :shown="companies.length" :total="total" :busy="loadingMore" @more="loadMore" />
    </template>
  </Layout>
</template>
