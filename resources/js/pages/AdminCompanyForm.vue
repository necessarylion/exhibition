<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { onMounted, ref } from "vue";
import { api, type RegisterInput } from "../api";
import { flashLater } from "../flash";
import { isMissing, messageOf, showError } from "../form-errors";
import Layout from "../Layout.vue";
import PageState from "../PageState.vue";
import NotFound from "./NotFound.vue";

// One page for both types, and for create and edit. The URL says which one:
// `/admin/customers/new` or `/admin/suppliers/<id>/edit`.
const parts = usePage().url.split("/");
const type: RegisterInput["role"] = parts[2] === "suppliers" ? "supplier" : "customer";
const id = parts[3] ?? "";
const editing = id !== "new";
const listUrl = `/admin/${type}s`;
const title = editing ? `Edit ${type}` : `New ${type}`;
const subtitle = editing
  ? "Change the name of the company."
  : "This creates the company and its first user.";

const form = ref({ companyName: "", name: "", email: "", password: "" });
const loading = ref(editing);
const missing = ref(false);
const loadError = ref("");
const error = ref("");
const busy = ref(false);

async function load() {
  if (!editing) {
    return;
  }
  loadError.value = "";
  try {
    const company = await api.getCompany(id);
    form.value.companyName = company.name;
    form.value.email = company.contactEmail ?? "";
    // A customer under the suppliers URL is not this page.
    missing.value = company.type !== type;
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
    if (editing) {
      await api.updateCompany(id, { name: form.value.companyName });
    } else {
      await api.createCompany({ role: type, ...form.value });
    }
    flashLater(`${form.value.companyName} is ${editing ? "saved" : "created"}.`);
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
  <Head :title="`${title} · ${type === 'supplier' ? 'Suppliers' : 'Customers'}`" />
  <Layout
    :title="title"
    :subtitle="subtitle"
    :back="{ href: listUrl, label: `Back to ${type}s` }"
    :roles="['admin']"
  >
    <PageState :loading="loading" :error="loadError" @retry="load">
    <form class="card" @submit.prevent="save">
      <label>
        Company name
        <input v-model="form.companyName" name="companyName" type="text" maxlength="100" required />
      </label>
      <p v-if="editing" class="muted">Contact email: {{ form.email || "No user" }}</p>
      <template v-else>
        <div class="two">
          <label>
            Contact name
            <input v-model="form.name" name="name" type="text" maxlength="100" required />
          </label>
          <label>
            Email
            <input v-model="form.email" name="email" type="email" maxlength="255" required />
          </label>
        </div>
        <label>
          Password
          <input
            v-model="form.password"
            name="password"
            type="text"
            minlength="8"
            placeholder="At least 8 characters"
            autocomplete="off"
            required
          />
          <small class="muted">Send this password to the contact yourself.</small>
        </label>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="buttons">
        <Link :href="listUrl" class="button secondary">Cancel</Link>
        <button type="submit" :disabled="busy">
          {{ editing ? "Save changes" : `Create ${type}` }}
        </button>
      </div>
    </form>
    </PageState>
  </Layout>
  </template>
</template>
