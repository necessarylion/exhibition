<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { User as UserIcon } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { api, type PageQuery, type User } from "../api";
import { flashLater } from "../flash";
import { isMissing, messageOf, showError } from "../form-errors";
import Layout from "../Layout.vue";
import { fetchAll } from "../list";
import PageState from "../PageState.vue";
import PasswordInput from "../PasswordInput.vue";
import NotFound from "./NotFound.vue";

// `/team/<id>/password` is for a user of my own company.
// `/admin/customers/<companyId>/users/<id>/password` is for the company an admin picked.
const parts = usePage().url.split("?")[0]?.split("/") ?? [];
const adminView = parts[1] === "admin";
const companyId = adminView ? parts[3] : undefined;
const userId = (adminView ? parts[5] : parts[2]) ?? "";
const listUrl = adminView ? `/admin/${parts[2]}/${companyId}/users` : "/team";
const FORM_ID = "password-form";

const target = ref<User | null>(null);
const password = ref("");
const loading = ref(true);
const missing = ref(false);
const loadError = ref("");
/** Only the owner sets a password in their own company. An admin does it for other companies. */
const allowed = ref(true);
const error = ref("");

/** An admin who acts as a customer cannot change who can log in to that account. */
const acting = ref(false);

function setUser(user: User) {
  acting.value = user.actingAdmin !== null;
  allowed.value = adminView || (user.isOwner && !acting.value);
}
const busy = ref(false);

function fetchUsers(page: PageQuery) {
  return api.listUsers(companyId, page);
}

async function load() {
  loadError.value = "";
  try {
    // ponytail: there is no "get one user" endpoint, so the page reads the users of the
    // company. A company has few users. Add the endpoint if one ever has thousands.
    for (const user of await fetchAll(fetchUsers)) {
      if (user.id === userId) {
        target.value = user;
      }
    }
    missing.value = !target.value;
  } catch (caught) {
    missing.value = isMissing(caught);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

async function save() {
  error.value = "";
  busy.value = true;
  try {
    await api.setUserPassword(userId, password.value);
    flashLater(`The new password of ${target.value?.name} is set. Send it yourself.`);
    router.visit(listUrl);
  } catch (caught) {
    error.value = showError(caught);
    // Only a failure gives the button back. After a success the next page is loading.
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
    <Head :title="`Reset password · ${adminView ? 'Users' : 'Team'}`" />
    <Layout
      title="Reset password"
      :subtitle="target ? `Set a new password for ${target.name}.` : undefined"
      :back="{ href: listUrl, label: adminView ? 'Back to users' : 'Back to team' }"
      :roles="adminView ? ['admin'] : undefined"
      @loaded="setUser"
    >
      <template #actions>
        <template v-if="allowed">
          <Link :href="listUrl" class="button secondary">Cancel</Link>
          <button v-if="target" type="submit" :form="FORM_ID" :disabled="busy">Set password</button>
        </template>
      </template>

      <template #default>
        <div v-if="!allowed" class="state">
          <strong>
            {{ acting ? "You cannot set a password now." : "Only the owner can set a password." }}
          </strong>
          <span v-if="acting">You act as a customer. Stop acting first: an admin cannot change who can log in to this account.</span>
          <span v-else>Ask the owner of your company.</span>
          <Link :href="listUrl" class="button secondary">Back to team</Link>
        </div>
        <PageState v-else :loading="loading" :error="loadError" @retry="load">
          <form v-if="target" :id="FORM_ID" class="card" @submit.prevent="save">
            <div class="summary person">
              <UserIcon :size="18" aria-hidden="true" />
              <span>
                <strong>{{ target.name }}</strong>
                <small>{{ target.email }}</small>
              </span>
            </div>
            <label>
              New password
              <PasswordInput
                v-model="password"
                name="newPassword"
                autocomplete="off"
                placeholder="At least 8 characters"
                :minlength="8"
                required
              />
              <small class="muted">
                Click the eye to read it. Send this password to the person yourself.
              </small>
            </label>
            <div class="form-foot">
              <p v-if="error" class="error" role="alert">{{ error }}</p>
              <Link :href="listUrl" class="button secondary">Cancel</Link>
              <button type="submit" :disabled="busy">Set password</button>
            </div>
          </form>
        </PageState>
      </template>
    </Layout>
  </template>
</template>
