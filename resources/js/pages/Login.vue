<script setup lang="ts">
import { Head, Link, router } from "@inertiajs/vue3";
import { onMounted, ref } from "vue";
import AuthLayout from "../AuthLayout.vue";
import { api } from "../api";
import { showError } from "../form-errors";
import PasswordInput from "../PasswordInput.vue";

const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);
/** Why the user is on this page again, when the app sent them here. */
const notice = ref("");
/** The page the user wanted. It opens after the login. */
let next = "/dashboard";

function readReason() {
  const query = new URLSearchParams(window.location.search);
  // Somebody who is logged in has no use for this page.
  if (api.getToken()) {
    router.visit("/dashboard");
    return;
  }
  // `/login?reason=session`: the token stopped working (removed user, disabled company, old token).
  if (query.get("reason") === "session") {
    notice.value = "Your session ended. Log in again.";
  }
  // Only a path of this app. Never a link to another site.
  const wanted = query.get("next") ?? "";
  if (/^\/[a-z]/.test(wanted)) {
    next = wanted;
  }
}

async function submit() {
  error.value = "";
  // "Your session ended" is old news after the first try.
  notice.value = "";
  busy.value = true;
  try {
    await api.login({ email: email.value, password: password.value });
    router.visit(next);
  } catch (caught) {
    error.value = showError(caught);
    // Only a failure gives the button back. After a success the next page is loading.
    busy.value = false;
  }
}

onMounted(readReason);
</script>

<template>
  <Head title="Log in" />
  <AuthLayout title="Log in" subtitle="Use the email and password of your account.">
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <form @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" name="email" type="email" autocomplete="email" required />
      </label>
      <label>
        Password
        <PasswordInput
          v-model="password"
          name="password"
          autocomplete="current-password"
          required
        />
      </label>
      <p class="field-link"><Link href="/forgot-password">Forgot password?</Link></p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy">Log in</button>
    </form>
    <p class="muted">No account yet? <Link href="/register">Sign up</Link></p>
  </AuthLayout>
</template>
