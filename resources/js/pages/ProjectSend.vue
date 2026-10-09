<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { Building2, Send, TriangleAlert } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { ApiError, api, type ProjectDetail } from "../api";
import { countText } from "../dates";
import { flashLater } from "../flash";
import { isMissing, messageOf, showError } from "../form-errors";
import ItemThumb from "../ItemThumb.vue";
import Layout from "../Layout.vue";
import { formatPrice } from "../money";
import PageState from "../PageState.vue";
import { groupNotSent, sumGroups } from "../project-lines";
import NotFound from "./NotFound.vue";

// `/projects/<id>/send`
const id = usePage().url.split("/")[2] ?? "";
const projectUrl = `/projects/${id}`;
const FORM_ID = "send-form";

const detail = ref<ProjectDetail | null>(null);
const note = ref("");
const loading = ref(true);
const missing = ref(false);
const loadError = ref("");
const error = ref("");
const busy = ref(false);
/** True after the server said that a price is not what this page showed. */
const pricesChanged = ref(false);
/** The unit price of each line, and the total, as the page showed them before they changed. */
const oldPrices = ref<Record<string, number>>({});
const oldTotalCents = ref(0);

const groups = computed(listGroups);
const total = computed(sumTotal);
const freeCount = computed(countFree);
/** The lines that cannot be sent: the item is hidden, or its company is off. */
const gone = computed(listGone);
/** What the empty page says. It depends on why there is nothing to send. */
const nothing = computed(describeNothing);

function listGone() {
  const lines = [];
  for (const group of groups.value) {
    for (const line of group.lines) {
      if (!line.inCatalog) {
        lines.push(line);
      }
    }
  }
  return lines;
}

function describeNothing(): { title: string; text: string; canAdd: boolean } {
  const found = detail.value;
  const status = found?.project.status;
  if (status === "done" || status === "cancelled") {
    return {
      title: `This project is ${status}`,
      text: "It cannot change any more, so nothing can be sent.",
      canAdd: false,
    };
  }
  if (found?.lines.length === 0) {
    return {
      title: "This project has no items yet",
      text: "Add items from the catalog first. Then send the request.",
      canAdd: true,
    };
  }
  return {
    title: "Nothing is waiting to be sent",
    text: "Every item of this project is in an order, or is free (your own or shared by your group).",
    canAdd: true,
  };
}

/** Takes a line that cannot be sent out of the project, so the rest can go. */
async function removeGone(line: { id: string; itemName: string }) {
  error.value = "";
  busy.value = true;
  try {
    detail.value = await api.removeProjectLine(id, line.id);
  } catch (caught) {
    error.value = messageOf(caught);
  } finally {
    busy.value = false;
  }
}

function listGroups() {
  return groupNotSent(detail.value?.lines ?? []);
}

function sumTotal() {
  return sumGroups(groups.value);
}

/** My own items and the items my group shares. They are free and are never sent. */
function countFree(): number {
  let count = 0;
  for (const line of detail.value?.lines ?? []) {
    if (line.state === "own" || line.state === "shared") {
      count += 1;
    }
  }
  return count;
}

async function load() {
  loadError.value = "";
  try {
    detail.value = await api.getProject(id);
  } catch (caught) {
    missing.value = isMissing(caught);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

async function send() {
  error.value = "";
  busy.value = true;
  try {
    // The total on this page goes along. The server sends nothing when it is not the same.
    const orders = countText(groups.value.length, "order");
    await api.sendProject(id, note.value.trim(), total.value.totalCents);
    flashLater(`Request sent: ${orders}. You get a notification when a supplier answers.`);
    router.visit(projectUrl);
  } catch (caught) {
    pricesChanged.value = caught instanceof ApiError && caught.code === "prices_changed";
    if (pricesChanged.value) {
      oldTotalCents.value = total.value.totalCents;
      oldPrices.value = {};
      for (const group of groups.value) {
        for (const line of group.lines) {
          oldPrices.value[line.id] = line.unitPriceCents;
        }
      }
    }
    // A price or the availability changed. Show what the project holds now.
    await load();
    error.value = showError(caught);
    busy.value = false;
  }
}

/** The price the line had before, when it is another price now. Else `undefined`. */
function oldPriceOf(line: { id: string; unitPriceCents: number }): number | undefined {
  const old = oldPrices.value[line.id];
  return pricesChanged.value && old !== undefined && old !== line.unitPriceCents ? old : undefined;
}

onMounted(load);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
    <Head :title="`Send request · ${detail?.project.name ?? 'Projects'}`" />
    <Layout
      title="Send request"
      subtitle="Check what you send. Each supplier gets one order."
      :back="{ href: projectUrl, label: `Back to ${detail?.project.name ?? 'the project'}` }"
      :roles="['customer']"
    >
      <template #actions>
        <Link :href="projectUrl" class="button secondary">Cancel</Link>
        <button
          v-if="groups.length > 0"
          type="submit"
          :form="FORM_ID"
          :disabled="busy || gone.length > 0"
        >
          <Send :size="16" aria-hidden="true" /> Send request
        </button>
      </template>

      <template #default>
        <PageState :loading="loading" :error="detail ? '' : loadError" @retry="load">
          <form v-if="detail" :id="FORM_ID" class="stack send-form" @submit.prevent="send">
            <p v-if="pricesChanged" class="notice" role="alert">
              <TriangleAlert :size="16" aria-hidden="true" />
              <span>Prices changed. Check the new total and send again.</span>
            </p>
            <p v-else-if="error" class="error" role="alert">{{ error }}</p>
            <div v-if="gone.length > 0" class="notice" role="alert">
              <TriangleAlert :size="16" aria-hidden="true" />
              <div class="stack">
                <span>
                  {{ gone.length === 1 ? "An item is" : "Some items are" }} not in the catalog
                  any more. Remove {{ gone.length === 1 ? "it" : "them" }} to send the rest.
                </span>
                <span v-for="line in gone" :key="line.id" class="inline">
                  <strong>{{ line.itemName }}</strong>
                  <button
                    type="button"
                    class="secondary"
                    :disabled="busy"
                    :aria-label="`Remove ${line.itemName} from the project`"
                    @click="removeGone(line)"
                  >
                    Remove
                  </button>
                </span>
              </div>
            </div>
            <div v-if="groups.length === 0" class="state">
              <strong>{{ nothing.title }}</strong>
              <span>{{ nothing.text }}</span>
              <Link v-if="nothing.canAdd" href="/catalog" class="button secondary">
                Add items from the catalog
              </Link>
              <Link v-else :href="projectUrl" class="button secondary">Back to the project</Link>
            </div>
            <template v-else>
              <section
                v-for="group in groups"
                :key="group.companyId"
                class="panel"
                :aria-label="`Order for ${group.companyName}`"
              >
                <div class="panel-header tinted">
                  <span class="inline">
                    <Building2 :size="16" class="muted" aria-hidden="true" />
                    <strong>{{ group.companyName }}</strong>
                    <small class="muted">{{ countText(group.lines.length, "item") }}</small>
                  </span>
                </div>
                <ul class="rows send-lines">
                  <li v-for="line in group.lines" :key="line.id">
                    <ItemThumb :url="line.photoUrl" />
                    <span class="two-lines grow">
                      <strong>{{ line.itemName }}</strong>
                      <small v-if="!line.inCatalog" class="error">
                        Not in the catalog any more. It cannot be sent.
                      </small>
                      <small class="muted">
                        {{ line.quantity }} × {{ formatPrice(line.unitPriceCents) }}
                        <template v-if="oldPriceOf(line) !== undefined">
                          <span class="sr-only">before:</span>
                          <s>{{ formatPrice(oldPriceOf(line) ?? 0) }}</s>
                          <span class="badge warn">New price</span>
                        </template>
                      </small>
                    </span>
                    <strong>{{ formatPrice(line.lineTotalCents) }}</strong>
                  </li>
                </ul>
                <div class="panel-footer">
                  <span class="muted">Order total</span>
                  <strong>{{ formatPrice(group.totalCents) }}</strong>
                </div>
              </section>

              <section class="panel pad">
                <label>
                  <span>Note for the suppliers <small class="muted">(optional)</small></span>
                  <textarea v-model="note" name="note" rows="3" maxlength="1000"></textarea>
                  <small class="muted">Every supplier in this request sees this note.</small>
                </label>
                <hr />
                <div class="sum-row request-total">
                  <span class="two-lines">
                    <strong>Total for this request</strong>
                    <small class="muted">
                      {{ countText(groups.length, "order") }} ·
                      {{ countText(total.count, "item") }}.
                      <template v-if="freeCount > 0">
                        {{ countText(freeCount, "free item") }} (your own or shared by your group)
                        {{ freeCount === 1 ? "is" : "are" }} not sent.
                      </template>
                      <template v-else>
                        Your own and shared items are free and are not sent.
                      </template>
                      A price is for one unit, for the whole event.
                    </small>
                  </span>
                  <span class="inline">
                    <s v-if="pricesChanged && oldTotalCents !== total.totalCents" class="muted">
                      <span class="sr-only">before:</span>
                      {{ formatPrice(oldTotalCents) }}
                    </s>
                    <strong class="big">{{ formatPrice(total.totalCents) }}</strong>
                  </span>
                </div>
                <div class="form-foot">
                  <Link :href="projectUrl" class="button secondary">Cancel</Link>
                  <button type="submit" :disabled="busy || gone.length > 0">
                    <Send :size="16" aria-hidden="true" /> Send request
                  </button>
                </div>
              </section>
            </template>
          </form>
        </PageState>
      </template>
    </Layout>
  </template>
</template>
