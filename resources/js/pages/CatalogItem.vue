<script setup lang="ts">
import { Head, Link, usePage } from "@inertiajs/vue3";
import { CalendarCheck, Package, Plus } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { api, type ItemDetail, type Project, type User } from "../api";
import { availabilityText, canAdd, ownershipOf } from "../availability";
import { formatDateRange, joinParts } from "../dates";
import { flashNow } from "../flash";
import { isMissing, messageOf } from "../form-errors";
import Layout from "../Layout.vue";
import { formatPrice, UNIT_LABELS } from "../money";
import PageState from "../PageState.vue";
import ProjectSelect from "../ProjectSelect.vue";
import QuantityStepper from "../QuantityStepper.vue";
import NotFound from "./NotFound.vue";

// `/catalog/<id>`
const id = usePage().url.split("/")[2]?.split("?")[0] ?? "";

const me = ref<User | null>(null);
const item = ref<ItemDetail | null>(null);
/** The project that gets the item. `null` when there is no open project. */
const project = ref<Project | null>(null);
const projectId = computed(findProjectId);
const quantity = ref(1);
const photoIndex = ref(0);
const loading = ref(true);
/** The item is not in my catalog, or it does not exist. */
const missing = ref(false);
const loadError = ref("");
/** How many of this item the chosen project already holds, in lines that are not sent. */
const inProject = computed(countInProject);
const error = ref("");
const busy = ref(false);
// The name of the project that just got the item.
const addedTo = ref("");

const own = computed(isOwn);
const shared = computed(isShared);
/** My own item, or one that my organization group shares. Both are free. */
const free = computed(isFree);
const specs = computed(listSpecs);
const stockText = computed(describeStock);
const addable = computed(isAddable);
/** A free item is not checked by date, so its quantity has no upper limit here. */
const most = computed(findMost);

function setUser(user: User) {
  me.value = user;
}

function isOwn(): boolean {
  return item.value !== null && ownershipOf(item.value, me.value?.companyId) === "own";
}

function isShared(): boolean {
  return item.value !== null && ownershipOf(item.value, me.value?.companyId) === "shared";
}

function isFree(): boolean {
  return own.value || shared.value;
}

/** Only the rows that have a value. */
function listSpecs(): [string, string][] {
  const found = item.value;
  if (!found) {
    return [];
  }
  const size = joinParts(
    [found.widthCm?.toString(), found.heightCm?.toString(), found.depthCm?.toString()],
    " × ",
  );
  const rows: [string, string | null][] = [
    ["SKU", found.sku],
    ["Size (W × H × D)", size && `${size} cm`],
    ["Weight", found.weightKg === null ? null : `${found.weightKg} kg`],
    ["Color", found.color],
    ["Material", found.material],
  ];
  const result: [string, string][] = [];
  for (const [label, value] of rows) {
    if (value) {
      result.push([label, value]);
    }
  }
  return result;
}

/** The total stock, like "15 in stock". What is free on the dates shows next to the project. */
function describeStock(): string {
  return item.value ? availabilityText(item.value, false, free.value) : "";
}

/** Like "12 available for your dates". Empty for a free item: it is not checked by date. */
const datesText = computed(describeDates);
const projectDates = computed(findProjectDates);

function describeDates(): string {
  if (!item.value || free.value || projectId.value === "") {
    return "";
  }
  return availabilityText(item.value, true, false);
}

function findProjectDates(): string {
  const open = project.value;
  return open ? formatDateRange(open.setupOn ?? open.startsOn, open.endsOn) : "";
}

function findProjectId(): string {
  return project.value?.id ?? "";
}

function countInProject(): number {
  return item.value?.inProject ?? 0;
}

function isAddable(): boolean {
  return item.value !== null && canAdd(item.value, free.value) && most.value !== 0;
}

/**
 * How many more fit: what is free on the dates, less what the project already holds.
 * The API adds the new quantity to the line that is there, so the page must not offer more.
 */
function findMost(): number | null {
  const found = item.value;
  if (free.value || !found || found.available === null) {
    return null;
  }
  return Math.max(0, found.available - found.inProject);
}

/** Loads the item again for the dates of the chosen project. */
async function loadItem() {
  try {
    item.value = await api.getItem(id, projectId.value);
    quantity.value = 1;
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

/**
 * The first load has no project yet: the project select is part of the form, and the form
 * shows when the item is there. The select then asks again for the dates of its project.
 */
async function load() {
  loadError.value = "";
  try {
    item.value = await api.getItem(id);
  } catch (caught) {
    missing.value = isMissing(caught);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

async function add() {
  if (!item.value) {
    return;
  }
  error.value = "";
  addedTo.value = "";
  busy.value = true;
  try {
    const added = quantity.value;
    const detail = await api.addProjectLine(projectId.value, item.value.id, added);
    addedTo.value = detail.project.name;
    flashNow(`Added ${added} × "${item.value.name}" to ${detail.project.name}.`);
    // The page now shows what is left, with the new count of the project.
    await loadItem();
  } catch (caught) {
    // Another order may have taken the item. Show what is free now.
    await loadItem();
    error.value = messageOf(caught);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
  <Head :title="item ? `${item.name} · Catalog` : 'Item'" />
  <Layout
    :title="item?.name ?? 'Item'"
    :subtitle="item ? `${item.category} · from ${item.companyName}` : undefined"
    :back="{ href: '/catalog', label: 'Back to catalog' }"
    :roles="['customer']"
    @loaded="setUser"
  >
    <template #badge>
      <span v-if="own" class="badge ok">Your item</span>
      <span v-else-if="shared" class="badge bad">Shared by your group</span>
    </template>

    <PageState :loading="loading" :error="loadError" @retry="load">
    <div v-if="item" class="split" style="--side: 360px">
      <section class="gallery">
        <img
          v-if="item.photos[photoIndex]"
          class="gallery-large"
          :src="item.photos[photoIndex]?.url"
          :alt="`Photo ${photoIndex + 1} of ${item.name}`"
        />
        <div v-else class="gallery-large"><Package :size="72" aria-hidden="true" /></div>
        <div v-if="item.photos.length > 1" class="thumbs" role="group" aria-label="Photos">
          <button
            v-for="(photo, index) in item.photos"
            :key="photo.id"
            type="button"
            :aria-pressed="index === photoIndex"
            :aria-label="`Show photo ${index + 1}`"
            @click="photoIndex = index"
          >
            <img :src="photo.url" alt="" />
          </button>
        </div>
        <div v-if="item.description" class="phone-hide">
          <h2 class="eyebrow">Description</h2>
          <p class="pre-line">{{ item.description }}</p>
        </div>
      </section>

      <aside>
        <section class="panel pad" aria-label="Price and specs">
          <div class="price-row">
            <span v-if="free"><strong class="free">Free</strong></span>
            <span v-else>
              <strong>{{ formatPrice(item.priceCents) }}</strong>
              <span class="muted"> per {{ UNIT_LABELS[item.unit] }}</span>
            </span>
            <span class="badge" :class="{ ok: item.stock !== 0 }">{{ stockText }}</span>
          </div>
          <template v-if="specs.length > 0">
            <hr />
            <h2 class="eyebrow">Specs</h2>
            <div v-for="[label, value] in specs" :key="label" class="sum-row spec">
              <span>{{ label }}</span>
              <span>{{ value }}</span>
            </div>
          </template>
        </section>

        <form class="panel pad" @submit.prevent="add">
          <h2 class="eyebrow">Add to project</h2>
          <ProjectSelect v-model="project" label="Project" @ready="loadItem" @change="loadItem" />
          <p v-if="!project && !loading" class="muted">
            You have no open project. <Link href="/projects/new">Create a project</Link>
          </p>
          <template v-if="project">
            <p v-if="datesText" class="avail-box" :class="{ no: !addable }" role="status">
              <CalendarCheck :size="16" aria-hidden="true" />
              <span class="two-lines">
                <strong>{{ datesText }}</strong>
                <small>{{ projectDates }}</small>
              </span>
            </p>
            <div class="sum-row">
              <strong>Quantity</strong>
              <QuantityStepper
                v-model="quantity"
                :label="item.name"
                :max="most"
                :disabled="busy"
              />
            </div>
            <small v-if="inProject > 0" class="muted">
              {{ inProject }} already in this project.
              <template v-if="most === null">The quantity is added to them.</template>
              <template v-else-if="most === 0">No more are free for your dates.</template>
              <template v-else>{{ most }} more fit.</template>
            </small>
            <div class="sum-row">
              <span>Line total</span>
              <span v-if="free" class="free">Free</span>
              <strong v-else>{{ formatPrice(item.priceCents * quantity) }}</strong>
            </div>
            <p v-if="error" class="error" role="alert">{{ error }}</p>
            <p v-if="addedTo">
              Added to {{ addedTo }}. <Link :href="`/projects/${projectId}`">View project</Link>
            </p>
            <button type="submit" :disabled="busy || !addable">
              <Plus :size="16" aria-hidden="true" /> Add to project
            </button>
          </template>
        </form>

        <section class="panel pad" aria-labelledby="item-supplier">
          <h2 id="item-supplier" class="eyebrow">{{ own ? "Your company" : shared ? "Shared by" : "Supplier" }}</h2>
          <strong>{{ item.companyName }}</strong>
          <p v-if="item.companyAbout" class="muted pre-line">{{ item.companyAbout }}</p>
          <div v-if="item.companyPhone" class="sum-row spec">
            <span>Phone</span>
            <a :href="`tel:${item.companyPhone}`" class="plain">{{ item.companyPhone }}</a>
          </div>
          <div v-if="item.companyWebsite" class="sum-row spec">
            <span>Website</span>
            <a :href="item.companyWebsite" class="plain" target="_blank" rel="noopener noreferrer">
              {{ item.companyWebsite.replace(/^https?:\/\//, "") }}
            </a>
          </div>
        </section>
        <!-- On a phone the description comes after the price and the Add button. -->
        <section v-if="item.description" class="panel pad phone-only-block">
          <h2 class="eyebrow">Description</h2>
          <p class="pre-line">{{ item.description }}</p>
        </section>
      </aside>
    </div>
    </PageState>
  </Layout>
  </template>
</template>
