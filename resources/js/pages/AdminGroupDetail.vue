<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { Plus, Trash2 } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { ApiError, api, type Organization } from "../api";
import { vClip } from "../clip";
import { countText } from "../dates";
import { flashLater, flashNow } from "../flash";
import { messageOf, showError } from "../form-errors";
import Layout from "../Layout.vue";
import PageState from "../PageState.vue";
import NotFound from "./NotFound.vue";

// `/admin/groups/<id>`
const id = usePage().url.split("?")[0]?.split("/")[3] ?? "";

const group = ref<Organization | null>(null);
const name = ref("");
const loading = ref(true);
const missing = ref(false);
/** The group could not be loaded. */
const loadError = ref("");
const error = ref("");
const busy = ref(false);

const companyCount = computed(countCompanies);

/** Like "2 companies" or "1 company". */
function countCompanies(): string {
  const count = group.value?.companies.length ?? 0;
  return count === 1 ? "1 company" : `${count} companies`;
}

function show(loaded: Organization) {
  group.value = loaded;
  name.value = loaded.name;
}

async function load() {
  loadError.value = "";
  try {
    show(await api.getOrganization(id));
  } catch (caught) {
    missing.value = caught instanceof ApiError && (caught.status === 404 || caught.status === 422);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

/** Runs one action at a time. `done` is true when it worked. */
async function run(action: () => Promise<void>): Promise<boolean> {
  error.value = "";
  busy.value = true;
  try {
    await action();
    return true;
  } catch (caught) {
    error.value = showError(caught);
    return false;
  } finally {
    busy.value = false;
  }
}

async function rename() {
  const done = await run(async function saveName() {
    show(await api.renameOrganization(id, name.value));
  });
  if (done) {
    flashNow("The group name is saved.");
  }
}

function removeCompany(company: Organization["companies"][number]) {
  const text = `Remove ${company.name} from ${group.value?.name}? It stops sharing items with the group. Items that are already in projects stay there.`;
  if (!confirm(text)) {
    return;
  }
  return run(async function remove() {
    show(await api.removeOrganizationCompany(id, company.id));
    flashNow(`${company.name} left the group.`);
  });
}

async function removeGroup() {
  const text = `Delete ${group.value?.name}? Its companies stay. They only stop sharing items.`;
  if (!confirm(text)) {
    return;
  }
  const done = await run(api.deleteOrganization.bind(api, id));
  if (done) {
    flashLater("The group is deleted.");
    router.visit("/admin/groups");
  }
}

onMounted(load);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
    <Head :title="group ? `${group.name} · Groups` : 'Group'" />
    <Layout
      :title="group?.name ?? 'Group'"
      subtitle="Companies in this group share their items with each other for free."
      :back="{ href: '/admin/groups', label: 'Back to groups' }"
      :roles="['admin']"
    >
      <template #actions>
        <Link v-if="group" :href="`/admin/groups/${id}/add`" class="button">
          <Plus :size="16" aria-hidden="true" /> Add company
        </Link>
      </template>

      <template #default>
        <PageState :loading="loading" :error="loadError" @retry="load">
          <div v-if="group" class="stack">
            <form class="panel pad" @submit.prevent="rename">
              <div class="field-row">
                <label>
                  Group name
                  <input v-model="name" name="name" type="text" maxlength="100" required />
                </label>
                <button type="submit" class="secondary" :disabled="busy">Save</button>
              </div>
            </form>
            <p v-if="error" class="error" role="alert">{{ error }}</p>

            <section class="stack" aria-labelledby="group-companies">
              <div class="toolbar">
                <h2 id="group-companies">Companies in this group</h2>
                <span class="muted">{{ companyCount }}</span>
              </div>
              <div v-if="group.companies.length === 0" class="state">
                <strong>No companies yet</strong>
                <span>Add the first one with "Add company".</span>
              </div>
              <div v-else class="table-wrap">
                <table class="first-wide">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Contact email</th>
                      <th>Items shared</th>
                      <th><span class="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="company in group.companies" :key="company.id">
                      <td v-clip class="card-title">
                        <strong>{{ company.name }}</strong>
                      </td>
                      <td v-clip data-label="Contact email">
                        <span class="muted">{{ company.contactEmail ?? "No user" }}</span>
                      </td>
                      <td data-label="Items shared">{{ countText(company.itemCount, "item") }}</td>
                      <td class="actions">
                        <button
                          type="button"
                          class="ghost"
                          :disabled="busy"
                          :aria-label="`Remove ${company.name} from group`"
                          @click="removeCompany(company)"
                        >
                          Remove from group
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <div class="danger-row">
              <span class="two-lines">
                <strong>Delete this group</strong>
                <small class="muted">Companies stay, they only leave the group.</small>
              </span>
              <button type="button" class="ghost" :disabled="busy" @click="removeGroup">
                <Trash2 :size="16" aria-hidden="true" /> Delete group
              </button>
            </div>
          </div>
        </PageState>
      </template>
    </Layout>
  </template>
</template>
