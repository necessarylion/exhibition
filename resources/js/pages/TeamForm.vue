<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { ref } from "vue";
import { api, type User } from "../api";
import { flashLater } from "../flash";
import { showError } from "../form-errors";
import Layout from "../Layout.vue";
import PasswordInput from "../PasswordInput.vue";

// `/team/new` adds a user to my own company.
// `/admin/customers/<id>/users/new` adds one to the company an admin picked.
const parts = usePage().url.split("/");
const adminView = parts[1] === "admin";
const companyId = adminView ? parts[3] : undefined;
const listUrl = adminView ? `/admin/${parts[2]}/${companyId}/users` : "/team";

const form = ref({ name: "", email: "", password: "" });
const error = ref("");
const busy = ref(false);
// The name of my own company. An admin who adds a user to another company does not have it here.
const companyName = ref("the company");
/** Only the owner adds users to their own company. An admin does it for other companies. */
const allowed = ref(true);
/** An admin who acts as a customer cannot change who can log in to that account. */
const acting = ref(false);

function setUser(user: User) {
  acting.value = user.actingAdmin !== null;
  if (!adminView) {
    companyName.value = user.companyName;
    allowed.value = user.isOwner && !acting.value;
  }
}

function buildSubtitle(): string | undefined {
  if (!allowed.value) {
    return undefined;
  }
  const like = adminView ? "its other users can" : "you can";
  return `This person joins ${companyName.value} and can do everything ${like}.`;
}

async function create() {
  error.value = "";
  busy.value = true;
  try {
    await api.createUser({ ...form.value, companyId });
    flashLater(`${form.value.name} is added. Send the password yourself.`);
    router.visit(listUrl);
  } catch (caught) {
    error.value = showError(caught);
    // Only a failure gives the button back. After a success the next page is loading.
    busy.value = false;
  }
}
</script>

<template>
  <Head :title="`New user · ${adminView ? 'Users' : 'Team'}`" />
  <Layout
    title="New user"
    :subtitle="buildSubtitle()"
    :back="{ href: listUrl, label: adminView ? 'Back to users' : 'Back to team' }"
    :roles="adminView ? ['admin'] : undefined"
    @loaded="setUser"
  >
    <div v-if="!allowed" class="state">
      <strong>{{ acting ? "You cannot add users now." : "Only the owner can add users." }}</strong>
      <span v-if="acting">You act as a customer. Stop acting first: an admin cannot change who can log in to this account.</span>
      <span v-else>Ask the owner of your company.</span>
      <Link :href="listUrl" class="button secondary">Back to team</Link>
    </div>
    <form v-else class="card" @submit.prevent="create">
      <div class="two">
        <label>
          Name
          <input v-model="form.name" name="name" type="text" maxlength="100" required />
        </label>
        <label>
          Email
          <input v-model="form.email" name="email" type="email" maxlength="255" required />
        </label>
      </div>
      <label>
        Password
        <PasswordInput
          v-model="form.password"
          name="password"
          autocomplete="off"
          placeholder="At least 8 characters"
          :minlength="8"
          required
        />
        <small class="muted">
          Click the eye to read it. Send this password to the person yourself.
        </small>
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="buttons">
        <Link :href="listUrl" class="button secondary">Cancel</Link>
        <button type="submit" :disabled="busy">Create user</button>
      </div>
    </form>
  </Layout>
</template>
