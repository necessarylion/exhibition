<script setup lang="ts">
import { Head, router } from "@inertiajs/vue3";
import { onMounted, ref } from "vue";
import { api, type User } from "../api";

const user = ref<User | null>(null);

// The server cannot see the Bearer token on a page load, so the page checks it here.
// The API is the real protection: without a valid token it returns no data.
async function loadUser() {
  if (!api.getToken()) {
    router.visit("/login");
    return;
  }
  try {
    user.value = await api.me();
  } catch {
    router.visit("/login");
  }
}

async function logout() {
  await api.logout();
  router.visit("/login");
}

onMounted(loadUser);
</script>

<template>
  <Head title="Dashboard" />
  <main>
    <h1>Dashboard</h1>
    <template v-if="user">
      <p>Hello, {{ user.name }}.</p>
      <p>{{ user.email }}</p>
      <button type="button" @click="logout">Log out</button>
    </template>
    <p v-else>Loading…</p>
  </main>
</template>
