<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import { Building2, Lock, Network } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { api, type CompanyProfile, type User } from "../api";
import { flashNow } from "../flash";
import { clearFieldErrors, messageOf, showError } from "../form-errors";
import Layout from "../Layout.vue";
import { fetchAll } from "../list";
import PageState from "../PageState.vue";

const FORM_ID = "company-form";
const SUBTITLES = {
  customer: "The details of your company. Suppliers see them on your orders.",
  supplier: "The details of your company. Customers see them on your items and orders.",
  admin: "The details of your company. Customers see them on your items and orders.",
};

const form = ref({ name: "", phone: "", address: "", website: "", about: "" });
const owner = ref<User | null>(null);
/** My organization group, when an admin put my company in one. */
const group = ref<CompanyProfile["organization"]>(null);
const myCompanyId = ref("");

const groupMates = computed(listGroupMates);

/** The other companies of my group. */
function listGroupMates() {
  const mates = [];
  for (const company of group.value?.companies ?? []) {
    if (company.id !== myCompanyId.value) {
      mates.push(company);
    }
  }
  return mates;
}
const loading = ref(true);
const found = ref(false);
const loadError = ref("");
const error = ref("");
const busy = ref(false);

async function load() {
  loadError.value = "";
  try {
    const [company, users] = await Promise.all([
      api.getMyCompany(),
      fetchAll(api.listUsers.bind(api, undefined)),
    ]);
    fill(company);
    group.value = company.organization;
    myCompanyId.value = company.id;
    found.value = true;
    for (const user of users) {
      if (user.isOwner) {
        owner.value = user;
      }
    }
  } catch (caught) {
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

function fill(company: typeof form.value) {
  form.value = {
    name: company.name,
    phone: company.phone,
    address: company.address,
    website: company.website,
    about: company.about,
  };
}

/** People type "www.example.com". The API wants a full link, so "https://" is put in front. */
function fullLink(website: string): string {
  const text = website.trim();
  return text === "" || /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

async function save() {
  error.value = "";
  busy.value = true;
  try {
    fill(await api.updateMyCompany({ ...form.value, website: fullLink(form.value.website) }));
    clearFieldErrors();
    flashNow("The company details are saved.");
  } catch (caught) {
    error.value = showError(caught);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Head title="Company" />
  <Layout title="Company" :subtitle="SUBTITLES">
    <template #actions="{ user }">
      <button v-if="user.isOwner && found" type="submit" :form="FORM_ID" :disabled="busy">
        Save
      </button>
    </template>

    <template #default="{ user }">
      <PageState :loading="loading" :error="loadError" @retry="load">
      <div class="split" style="--side: 320px">
        <form :id="FORM_ID" class="card wide" @submit.prevent="save" @input="error = ''">
          <p v-if="!user.isOwner" class="notice">
            <Lock :size="16" aria-hidden="true" /> Only the owner can change this.
          </p>
          <label>
            Company name
            <input
              v-model="form.name"
              name="name"
              type="text"
              maxlength="100"
              autocomplete="organization"
              required
              :readonly="!user.isOwner"
            />
          </label>
          <div class="two">
            <label>
              Phone
              <input
                v-model="form.phone"
              name="phone"
                type="tel"
                maxlength="50"
                autocomplete="tel"
                :readonly="!user.isOwner"
              />
            </label>
            <label>
              Website
              <input
                v-model="form.website"
              name="website"
                type="text"
                inputmode="url"
                maxlength="200"
                placeholder="www.example.com"
                :readonly="!user.isOwner"
              />
            </label>
          </div>
          <label>
            Address
            <input v-model="form.address"
              name="address" type="text" maxlength="300" :readonly="!user.isOwner" />
          </label>
          <label>
            About
            <textarea
              v-model="form.about"
              name="about"
              rows="5"
              maxlength="2000"
              :readonly="!user.isOwner"
            ></textarea>
          </label>
          <div class="form-foot">
            <p v-if="error" class="error" role="alert">{{ error }}</p>
            <button v-if="user.isOwner" type="submit" :disabled="busy">Save</button>
          </div>
        </form>

        <aside aria-labelledby="who-can-change">
          <h2 id="who-can-change" class="eyebrow">Who can change this</h2>
          <section class="panel pad">
            <div v-if="owner" class="label-row">
              <span class="two-lines">
                <strong>{{ owner.name }}</strong>
                <small class="muted">{{ owner.email }}</small>
              </span>
              <span class="badge ok">Owner</span>
            </div>
            <hr v-if="owner" />
            <div class="lock-note">
              <Lock :size="16" aria-hidden="true" />
              <span class="two-lines">
                <strong>Only the owner can change this.</strong>
                <small class="muted">
                  Other people in the team can read these details. They cannot change them.
                </small>
              </span>
            </div>
          </section>

          <template v-if="group">
            <h2 id="your-group" class="eyebrow">Your group</h2>
            <section class="panel pad" aria-labelledby="your-group">
              <div class="lock-note">
                <Network :size="16" aria-hidden="true" />
                <strong>Part of {{ group.name }}</strong>
              </div>
              <hr />
              <small class="muted">Other companies in your group</small>
              <p v-if="groupMates.length === 0" class="muted">No other company yet.</p>
              <div v-for="company in groupMates" :key="company.id" class="lock-note">
                <Building2 :size="16" aria-hidden="true" />
                <strong>{{ company.name }}</strong>
              </div>
              <small class="muted">
                Companies in your group share their items with you for free. The platform admin
                sets up the groups.
              </small>
            </section>
          </template>
        </aside>
      </div>
      </PageState>
    </template>
  </Layout>
</template>
