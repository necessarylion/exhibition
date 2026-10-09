<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import { onMounted } from "vue";
import { type AdminAction, api, type PageQuery } from "../api";
import { formatDateTime } from "../dates";
import Layout from "../Layout.vue";
import LoadMore from "../LoadMore.vue";
import { useList } from "../list";
import PageState from "../PageState.vue";

const { rows, total, loading, loadingMore, error, failed, load, loadMore } = useList(fetchActions);

function fetchActions(page: PageQuery) {
  return api.listAdminActions(page);
}

/** The start of an acting session has its own word. Every other row is a request. */
function whatOf(action: AdminAction): string {
  if (action.action === "impersonate") {
    return "Started to act as the customer";
  }
  return action.action.endsWith("/auth/stop-impersonating") ? "Stopped acting" : action.action;
}

onMounted(load);
</script>

<template>
  <Head title="Admin activity" />
  <Layout
    title="Admin activity"
    subtitle="What admins changed while they acted as a customer. The newest is first."
    :roles="['admin']"
  >
    <p v-if="error && !failed" class="error" role="alert">{{ error }}</p>
    <PageState
      :loading="loading"
      :error="failed ? error : ''"
      :empty="rows.length === 0"
      @retry="load"
    >
      <template #empty>
        <strong>No activity yet</strong>
        <span>A row shows up here when an admin acts as a customer.</span>
      </template>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Admin</th>
              <th>Company</th>
              <th>What</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="action in rows" :key="action.id">
              <td class="card-title">{{ formatDateTime(action.createdAt) }}</td>
              <td data-label="Admin">{{ action.adminName }}</td>
              <td data-label="Company">{{ action.companyName }}</td>
              <td data-label="What" class="wrap">{{ whatOf(action) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <small class="muted">Rows older than one year are removed.</small>
    </PageState>
    <LoadMore :shown="rows.length" :total="total" :busy="loadingMore" @more="loadMore" />
  </Layout>
</template>
