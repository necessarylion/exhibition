<script setup lang="ts">
import { Head, Link, router } from "@inertiajs/vue3";
import { ref } from "vue";
import { api } from "../api";

const name = ref("");
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    await api.register({ name: name.value, email: email.value, password: password.value });
    router.visit("/dashboard");
  } catch (caught) {
    error.value = (caught as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Head title="Register" />
  <main>
    <h1>Register</h1>
    <form @submit.prevent="submit">
      <label>
        Name
        <input v-model="name" type="text" autocomplete="name" required />
      </label>
      <label>
        Email
        <input v-model="email" type="email" autocomplete="email" required />
      </label>
      <label>
        Password
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          minlength="8"
          required
        />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy">Register</button>
    </form>
    <p>Already have an account? <Link href="/login">Log in</Link></p>
  </main>
</template>
