<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import { Plus } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, type Organization } from "../api";
import { vClip } from "../clip";
import { countText, formatDate } from "../dates";
import { messageOf } from "../form-errors";
import Layout from "../Layout.vue";
import PageState from "../PageState.vue";
import SearchInput from "../SearchInput.vue";

const groups = ref<Organization[]>([]);
const loading = ref(true);
const error = ref("");
const search = ref("");

function resetSearch() {
  search.value = "";
}

// Each load gets a number. An answer of an older search is thrown away.
let turn = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** The search runs in the API: the name of the group, or the name of one of its companies. */
async function load() {
  const mine = ++turn;
  error.value = "";
  try {
    const found = await api.listOrganizations(search.value);
    if (mine === turn) {
      groups.value = found;
    }
  } catch (caught) {
    if (mine === turn) {
      error.value = messageOf(caught);
    }
  } finally {
    loading.value = false;
  }
}

function loadSoon() {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
}

function stop() {
  clearTimeout(timer);
}

watch(search, loadSoon);
onBeforeUnmount(stop);
onMounted(load);
</script>

<template>
  <Head title="Groups" />
  <Layout
    title="Groups"
    subtitle="Customer companies in one group share their items with each other for free."
    :roles="['admin']"
  >
    <template #actions>
      <Link href="/admin/groups/new" class="button">
        <Plus :size="16" aria-hidden="true" /> New group
      </Link>
    </template>

    <template #default>
      <div class="toolbar">
        <SearchInput v-model="search" label="Search by group or company" />
        <span v-if="!loading && !error" class="muted">{{ countText(groups.length, "group") }}</span>
      </div>

      <PageState
        :loading="loading"
        :error="error"
        :empty="groups.length === 0 && search.trim() === ''"
        :no-match="groups.length === 0"
        @retry="load"
        @reset="resetSearch"
      >
        <template #empty>
          <strong>No groups yet</strong>
          <span>Create the first one with "New group".</span>
        </template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Companies</th>
                <th>Created</th>
                <th><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="group in groups" :key="group.id">
                <td v-clip class="card-title">
                  <strong>{{ group.name }}</strong>
                </td>
                <td data-label="Companies" class="wrap">
                  <span v-if="group.companies.length === 0" class="muted">No companies yet</span>
                  <span v-else class="chips">
                    <span
                      v-for="company in group.companies"
                      :key="company.id"
                      class="badge"
                      :title="company.name"
                    >
                      {{ company.name }}
                    </span>
                  </span>
                </td>
                <td data-label="Created">
                  <span class="muted">{{ formatDate(group.createdAt) }}</span>
                </td>
                <td class="actions">
                  <Link
                    :href="`/admin/groups/${group.id}`"
                    class="button ghost"
                    :aria-label="`Open ${group.name}`"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageState>
    </template>
  </Layout>
</template>
