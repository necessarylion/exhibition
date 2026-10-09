<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, type Company, type Organization } from "../api";
import { flashLater } from "../flash";
import { isMissing, messageOf, showError } from "../form-errors";
import Layout from "../Layout.vue";
import PageState from "../PageState.vue";
import NotFound from "./NotFound.vue";

// `/admin/groups/<id>/add`
const id = usePage().url.split("?")[0]?.split("/")[3] ?? "";
const groupUrl = `/admin/groups/${id}`;

const group = ref<Organization | null>(null);
/** The first customer companies with no group that match the search. */
const companies = ref<Company[]>([]);
/** How many such companies match. More than are shown when the list is long. */
const total = ref(0);
const search = ref("");
// Nothing is chosen at the start, so a fast click cannot add the wrong company.
const companyId = ref("");
const SHOWN = 100;
let timer: ReturnType<typeof setTimeout> | undefined;
const loading = ref(true);
const missing = ref(false);
const loadError = ref("");
const error = ref("");
const busy = ref(false);

async function load() {
  loadError.value = "";
  try {
    group.value = await api.getOrganization(id);
    await loadCompanies();
  } catch (caught) {
    missing.value = isMissing(caught);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

/** The search runs in the API, so a company is found also when there are thousands. */
async function loadCompanies() {
  const page = await api.listUngroupedCustomers({ q: search.value, limit: SHOWN });
  companies.value = page.rows;
  total.value = page.total;
  // A choice that is not in the new list is no choice any more.
  if (!page.rows.some(isChosen)) {
    companyId.value = "";
  }
}

function isChosen(company: Company): boolean {
  return company.id === companyId.value;
}

async function searchNow() {
  try {
    await loadCompanies();
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

function searchSoon() {
  clearTimeout(timer);
  timer = setTimeout(searchNow, 250);
}

function stop() {
  clearTimeout(timer);
}

async function save() {
  error.value = "";
  busy.value = true;
  try {
    await api.addOrganizationCompany(id, companyId.value);
    flashLater("The company is added to the group.");
    router.visit(groupUrl);
  } catch (caught) {
    error.value = showError(caught);
    // Only a failure gives the button back. After a success the next page is loading.
    busy.value = false;
  }
}

watch(search, searchSoon);
onMounted(load);
onBeforeUnmount(stop);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
    <Head :title="`Add company · ${group?.name ?? 'Group'} · Groups`" />
    <Layout
      :title="group ? `Add company to ${group.name}` : 'Add company to group'"
      subtitle="The company will share its items with the other companies in this group."
      :back="{ href: groupUrl, label: `Back to ${group?.name ?? 'the group'}` }"
      :roles="['admin']"
    >
      <PageState :loading="loading" :error="loadError" @retry="load">
      <form class="card" @submit.prevent="save">
        <p v-if="total === 0 && search.trim() === ''" class="muted">
          Every customer company is in a group already.
          <Link href="/admin/customers/new">Create a customer</Link>
        </p>
        <template v-else>
          <label>
            Find a company
            <input v-model="search" type="search" placeholder="Type a name or an email" />
          </label>
          <label>
            Company
            <select v-model="companyId" name="companyId" required>
              <option value="" disabled>
                {{ companies.length === 0 ? "No company matches" : "Choose a company" }}
              </option>
              <option v-for="company in companies" :key="company.id" :value="company.id">
                {{ company.name }}
              </option>
            </select>
            <small class="muted">
              You only see customer companies that are not in a group yet.
              <template v-if="total > companies.length">
                Showing {{ companies.length }} of {{ total }}. Type to find the others.
              </template>
            </small>
          </label>
        </template>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="buttons">
          <Link :href="groupUrl" class="button secondary">Cancel</Link>
          <button type="submit" :disabled="busy || companyId === ''">Add to group</button>
        </div>
      </form>
      </PageState>
    </Layout>
  </template>
</template>
