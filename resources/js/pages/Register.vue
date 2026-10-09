<script setup lang="ts">
import { Head, Link, router } from "@inertiajs/vue3";
import { Circle, CircleCheck, Info, Package, Store } from "@lucide/vue";
import { onMounted, ref } from "vue";
import AuthLayout from "../AuthLayout.vue";
import { api, type RegisterInput } from "../api";
import { flashLater } from "../flash";
import { showError } from "../form-errors";
import PasswordInput from "../PasswordInput.vue";

const role = ref<RegisterInput["role"]>("customer");
const companyName = ref("");
const name = ref("");
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    await api.register({
      role: role.value,
      companyName: companyName.value,
      name: name.value,
      email: email.value,
      password: password.value,
    });
    flashLater(
      role.value === "supplier"
        ? "Welcome! Add your items now. Customers see them after an admin approves your company."
        : "Welcome! Your account is ready.",
    );
    router.visit("/dashboard");
  } catch (caught) {
    error.value = showError(caught);
    // Only a failure gives the button back. After a success the next page is loading.
    busy.value = false;
  }
}

/** Somebody who is logged in has no use for this page. */
function skipWhenLoggedIn() {
  if (api.getToken()) {
    router.visit("/dashboard");
  }
}

onMounted(skipWhenLoggedIn);
</script>

<template>
  <Head title="Sign up" />
  <AuthLayout
    title="Create your account"
    :subtitle="
      role === 'supplier'
        ? 'Tell us who you are. You can add your items right after.'
        : 'Tell us who you are. You can start right after.'
    "
  >
    <form @submit.prevent="submit">
      <fieldset class="roles">
        <legend>I am a</legend>
        <label>
          <input v-model="role" type="radio" value="customer" />
          <span class="label-row">
            <Store :size="20" aria-hidden="true" />
            <component :is="role === 'customer' ? CircleCheck : Circle" :size="18" aria-hidden="true" />
          </span>
          Customer
          <small>I plan an exhibition and order items.</small>
        </label>
        <label>
          <input v-model="role" type="radio" value="supplier" />
          <span class="label-row">
            <Package :size="20" aria-hidden="true" />
            <component :is="role === 'supplier' ? CircleCheck : Circle" :size="18" aria-hidden="true" />
          </span>
          Supplier
          <small>I provide booths and items.</small>
        </label>
      </fieldset>
      <!-- A supplier must know this before the account exists, not after. -->
      <p v-if="role === 'supplier'" class="field-note" role="status">
        <Info :size="16" aria-hidden="true" />
        <span>An admin checks new suppliers. Customers see your items after approval.</span>
      </p>
      <label>
        Company name
        <input v-model="companyName" name="companyName" type="text" maxlength="100" autocomplete="organization" required />
      </label>
      <div class="two">
        <label>
          Your name
          <input v-model="name" name="name" type="text" maxlength="100" autocomplete="name" required />
        </label>
        <label>
          Email
          <input v-model="email" name="email" type="email" maxlength="255" autocomplete="email" required />
        </label>
      </div>
      <label>
        Password
        <PasswordInput
          v-model="password"
          name="password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
          :minlength="8"
          required
        />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy">Create account</button>
    </form>
    <p class="muted">Already have an account? <Link href="/login">Log in</Link></p>
  </AuthLayout>
</template>
