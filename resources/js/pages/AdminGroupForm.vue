<script setup lang="ts">
import { Head, Link, router } from "@inertiajs/vue3";
import { ref } from "vue";
import { api } from "../api";
import { flashLater } from "../flash";
import { showError } from "../form-errors";
import Layout from "../Layout.vue";

// `/admin/groups/new`. The companies are added on the page of the group.
const name = ref("");
const error = ref("");
const busy = ref(false);

async function save() {
  error.value = "";
  busy.value = true;
  try {
    const group = await api.createOrganization(name.value);
    flashLater("The group is created. Now add its companies.");
    router.visit(`/admin/groups/${group.id}`);
  } catch (caught) {
    error.value = showError(caught);
    // Only a failure gives the button back. After a success the next page is loading.
    busy.value = false;
  }
}
</script>

<template>
  <Head title="New group · Groups" />
  <Layout
    title="New group"
    subtitle="A group is a set of customer companies that share their items for free."
    :back="{ href: '/admin/groups', label: 'Back to groups' }"
    :roles="['admin']"
  >
    <form class="card" @submit.prevent="save">
      <label>
        Group name
        <input v-model="name" name="name" type="text" maxlength="100" required />
        <small class="muted">You add the companies after you create the group.</small>
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="buttons">
        <Link href="/admin/groups" class="button secondary">Cancel</Link>
        <button type="submit" :disabled="busy">Create group</button>
      </div>
    </form>
  </Layout>
</template>
