<script setup lang="ts">
import { Head, Link, usePage } from "@inertiajs/vue3";
import { LogIn, Plus } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { actAsCustomer } from "../acting";
import { api, type Company, type PageQuery, type User } from "../api";
import { vClip } from "../clip";
import { countText, formatDate } from "../dates";
import { flashNow } from "../flash";
import { isMissing, messageOf } from "../form-errors";
import Layout from "../Layout.vue";
import LoadMore from "../LoadMore.vue";
import { useList, useUrlParam } from "../list";
import PageState from "../PageState.vue";
import SearchInput from "../SearchInput.vue";
import NotFound from "./NotFound.vue";

// Two URLs open this page:
// `/team` shows my own company. `/admin/customers/<id>/users` shows the company an admin picked.
const parts = usePage().url.split("/");
const adminView = parts[1] === "admin";
const companyId = adminView ? parts[3] : undefined;
const baseUrl = adminView ? `/admin/${parts[2]}/${companyId}/users` : "/team";
const backUrl = `/admin/${parts[2]}`;

const search = useUrlParam("q", "");

/** The search runs in the API, so the count is of every user that matches. */
function fetchUsers(page: PageQuery) {
  return api.listUsers(companyId, { ...page, q: search.value });
}

const {
  rows: users,
  total,
  loading,
  loadingMore,
  error,
  failed,
  load,
  loadMore,
} = useList(fetchUsers, [search]);
/** The company an admin picked. Its own page has the name from the logged-in user. */
const company = ref<Company | null>(null);
const myCompany = ref("");
/** The company of the URL does not exist. */
const missing = ref(false);

const title = computed(buildTitle);
const subtitle = computed(buildSubtitle);

function setUser(user: User) {
  myCompany.value = user.companyName;
}

/** Like "The people of Mya Events who can use this account." */
function buildSubtitle(): string {
  const name = adminView ? company.value?.name : myCompany.value;
  return `The people ${name ? `of ${name} ` : ""}who can use this account.`;
}

function resetSearch() {
  search.value = "";
}

function buildTitle(): string {
  if (!adminView) {
    return "Team";
  }
  return company.value ? `Users of ${company.value.name}` : "Users";
}

/** An admin page: the company comes first. A wrong id is the "not found" page. */
async function start() {
  if (adminView) {
    try {
      company.value = await api.getCompany(companyId ?? "");
    } catch (caught) {
      missing.value = isMissing(caught);
    }
  }
  if (!missing.value) {
    await load();
  }
}

async function actAs() {
  if (!company.value) {
    return;
  }
  error.value = "";
  try {
    await actAsCustomer(company.value);
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

// The owner manages their own company. An admin manages the company they picked.
function canManage(me: User): boolean {
  return adminView || (me.isOwner && !me.actingAdmin);
}

async function remove(user: User) {
  if (!confirm(`Remove ${user.name}? They cannot log in after this.`)) {
    return;
  }
  error.value = "";
  try {
    await api.removeUser(user.id);
    await load();
    flashNow(`${user.name} is removed.`);
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

onMounted(start);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
  <Head :title="title" />
  <Layout
    :title="title"
    :subtitle="subtitle"
    :roles="adminView ? ['admin'] : undefined"
    :back="adminView ? { href: backUrl, label: `Back to ${parts[2]}` } : undefined"
    @loaded="setUser"
  >
    <template #actions="{ user: me }">
      <button
        v-if="company?.type === 'customer'"
        type="button"
        class="secondary"
        :disabled="Boolean(company.disabledAt)"
        :title="company.disabledAt ? 'Enable the company first.' : undefined"
        @click="actAs"
      >
        <LogIn :size="16" aria-hidden="true" /> Act as this customer
      </button>
      <Link v-if="canManage(me)" :href="`${baseUrl}/new`" class="button">
        <Plus :size="16" aria-hidden="true" /> New user
      </Link>
    </template>

    <!-- A named slot is used above, so the default slot needs its own template. -->
    <template #default="{ user: me }">
      <div class="toolbar">
        <SearchInput v-model="search" label="Search by name or email" />
        <span v-if="!loading && !failed" class="muted" role="status">
          {{ countText(total, "user") }}
        </span>
      </div>
      <p v-if="me.actingAdmin" class="muted">
        You act as a customer, so you cannot add or remove users or set a password here.
      </p>
      <p v-else-if="!canManage(me)" class="muted">Only the owner can add or remove users.</p>
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
          <strong>No users yet</strong>
          <span>Add the first one with "New user".</span>
        </template>
        <div class="table-wrap">
          <table class="first-wide">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Joined</th>
                <th><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users" :key="user.id">
                <td v-clip class="card-title">
                  <span class="inline name-badges">
                    <strong>{{ user.name }}</strong>
                    <span v-if="user.isOwner" class="badge ok">Owner</span>
                    <span v-if="user.id === me.id" class="badge">You</span>
                  </span>
                </td>
                <td v-clip data-label="Email"><span class="muted">{{ user.email }}</span></td>
                <td data-label="Joined">
                  <span class="muted">{{ formatDate(user.createdAt) }}</span>
                </td>
                <td class="actions">
                  <Link
                    v-if="canManage(me) && user.id !== me.id"
                    :href="`${baseUrl}/${user.id}/password`"
                    class="button ghost"
                    :aria-label="`Reset the password of ${user.name}`"
                  >
                    Reset password
                  </Link>
                  <button
                    v-if="canManage(me) && !user.isOwner"
                    type="button"
                    class="ghost"
                    :aria-label="`Remove ${user.name}`"
                    @click="remove(user)"
                  >
                    Remove
                  </button>
                  <small v-if="canManage(me) && user.isOwner" class="muted phone-only">
                    The owner cannot be removed.
                  </small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageState>
      <LoadMore :shown="users.length" :total="total" :busy="loadingMore" @more="loadMore" />
    </template>
  </Layout>
  </template>
</template>
