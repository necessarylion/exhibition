<script setup lang="ts">
import { Head, Link, router } from "@inertiajs/vue3";
import { Lock, LogOut } from "@lucide/vue";
import { computed, ref } from "vue";
import { ApiError, api, type User } from "../api";
import { flashLater, flashNow } from "../flash";
import { clearFieldErrors, showError } from "../form-errors";
import Layout from "../Layout.vue";
import PasswordInput from "../PasswordInput.vue";

const FORM_ID = "profile-form";

const me = ref<User | null>(null);
const name = ref("");
const currentPassword = ref("");
const newPassword = ref("");
const repeatPassword = ref("");
const error = ref("");
const busy = ref(false);

/** The password part is used only when the user typed in one of its fields. */
const wantsPassword = computed(hasPasswordText);

function hasPasswordText(): boolean {
  return (currentPassword.value + newPassword.value + repeatPassword.value).length > 0;
}

function setUser(user: User) {
  me.value = user;
  name.value = user.name;
}

async function save() {
  error.value = "";
  clearFieldErrors();
  if (wantsPassword.value && newPassword.value !== repeatPassword.value) {
    error.value = showError(
      new ApiError(422, "The new password and its repeat are not the same.", "", [
        { path: "repeatPassword", message: "Type the same new password again." },
      ]),
    );
    return;
  }
  busy.value = true;
  try {
    const done: string[] = [];
    if (me.value && name.value.trim() !== me.value.name) {
      // The sidebar shows the same user object, so the new name shows there too.
      me.value.name = (await api.updateMe(name.value.trim())).name;
      done.push("Your name is saved.");
    }
    if (wantsPassword.value) {
      await api.changeMyPassword(currentPassword.value, newPassword.value);
      currentPassword.value = "";
      newPassword.value = "";
      repeatPassword.value = "";
      done.push("Your password is changed.");
    }
    flashNow(done.join(" ") || "Nothing changed.");
  } catch (caught) {
    error.value = showError(caught);
  } finally {
    busy.value = false;
  }
}

async function logoutEverywhere() {
  if (!confirm("Log out on every device? You must log in again, also on this one.")) {
    return;
  }
  error.value = "";
  try {
    await api.logoutAll();
    flashLater("You are logged out on every device.");
    router.visit("/login");
  } catch (caught) {
    error.value = showError(caught);
  }
}
</script>

<template>
  <Head title="Profile" />
  <Layout title="Profile" subtitle="Your own details and password." @loaded="setUser">
    <template #actions="{ user }">
      <button v-if="!user.actingAdmin" type="submit" :form="FORM_ID" :disabled="busy">
        Save profile
      </button>
    </template>

    <template #default="{ user }">
      <div v-if="user.actingAdmin" class="state">
        <strong>This is the profile of {{ user.name }}.</strong>
        <span>
          You act as {{ user.companyName }}. An admin cannot change the name or the password of
          a customer here, and cannot log them out. Click "Stop" at the top to go back to your
          own account.
        </span>
      </div>
      <template v-else>
      <form :id="FORM_ID" class="narrow" @submit.prevent="save" @input="error = ''">
        <section class="card" aria-labelledby="your-details">
          <h2 id="your-details" class="eyebrow">Your details</h2>
          <label>
            Name
            <input v-model="name" name="name" type="text" maxlength="100" autocomplete="name" required />
          </label>
          <label>
            Email
            <span class="locked">
              <input :value="user.email" type="email" readonly />
              <Lock :size="16" aria-hidden="true" />
            </span>
            <small class="muted">You cannot change your email.</small>
          </label>
        </section>

        <section class="card" aria-labelledby="change-password">
          <h2 id="change-password" class="eyebrow">Change password</h2>
          <label>
            Current password
            <PasswordInput
              v-model="currentPassword"
              name="currentPassword"
              autocomplete="current-password"
              :required="wantsPassword"
            />
          </label>
          <div class="two">
            <label>
              New password
              <PasswordInput
                v-model="newPassword"
                name="newPassword"
                autocomplete="new-password"
                placeholder="At least 8 characters"
                :minlength="8"
                :required="wantsPassword"
              />
            </label>
            <label>
              Repeat new password
              <PasswordInput
                v-model="repeatPassword"
                name="repeatPassword"
                autocomplete="new-password"
                placeholder="Type it again"
                :minlength="8"
                :required="wantsPassword"
              />
            </label>
          </div>
        </section>
        <div class="form-foot">
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button type="submit" :disabled="busy">Save profile</button>
        </div>
      </form>

      <div class="narrow quiet-rows">
        <!-- The admin menu has no "Company" entry, so the page is linked from here. -->
        <div v-if="user.role === 'admin'" class="quiet-row">
          <span class="two-lines">
            <strong>Company</strong>
            <small class="muted">The name, phone and address of {{ user.companyName }}.</small>
          </span>
          <Link href="/company" class="button ghost">Open company details</Link>
        </div>
        <div class="quiet-row">
          <span class="two-lines">
            <strong>Log out everywhere</strong>
            <small class="muted">This ends your session on every device, also this one.</small>
          </span>
          <button type="button" class="ghost" @click="logoutEverywhere">
            <LogOut :size="16" aria-hidden="true" /> Log out everywhere
          </button>
        </div>
      </div>
      </template>
    </template>
  </Layout>
</template>
