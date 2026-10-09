<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { computed, onMounted, ref } from "vue";
import { ApiError, api, type OrderDetail, type OrderStatus } from "../api";
import { countText, formatDateRange, joinParts } from "../dates";
import { flashLater } from "../flash";
import { isMissing, messageOf, showError } from "../form-errors";
import Layout from "../Layout.vue";
import { formatPrice } from "../money";
import PageState from "../PageState.vue";
import { STATUS_LABELS } from "../status";
import NotFound from "./NotFound.vue";

// Three URLs open this page. Each one asks for a reason:
// `/orders/<id>/reject`: the supplier says no to an order that waits.
// `/orders/<id>/cancel`: the supplier cancels an order they already accepted.
// `/admin/projects/<projectId>/orders/<id>/cancel`: an admin cancels an order of other companies.
const parts = usePage().url.split("?")[0]?.split("/") ?? [];
const adminView = parts[1] === "admin";
const id = (adminView ? parts[5] : parts[2]) ?? "";
const action = adminView ? "admin" : parts[3] === "cancel" ? "cancel" : "reject";
const FORM_ID = "reason-form";

interface Mode {
  title: string;
  done: string;
  subtitle: string;
  /** The button that leaves the page and changes nothing. */
  keep: string;
  /** The order must be in one of these statuses. */
  from: OrderStatus[];
  label: string;
  confirm: string;
}

const MODES: Record<string, Mode> = {
  reject: {
    title: "Reject order",
    done: "rejected",
    subtitle: "Tell the customer why you cannot take this order.",
    keep: "Cancel",
    from: ["pending"],
    label: "Reason for the customer",
    confirm: "Reject this order? The customer is told your reason. You cannot undo this.",
  },
  cancel: {
    title: "Cancel order",
    done: "cancelled",
    subtitle: "Tell the customer why you cancel this accepted order.",
    keep: "Keep order",
    from: ["accepted"],
    label: "Reason for the customer",
    confirm:
      "Cancel this accepted order? The customer is told your reason and the items are free again for these dates. You cannot undo this.",
  },
  admin: {
    title: "Cancel order",
    done: "cancelled",
    subtitle: "You cancel this order for the customer and the supplier. Both get a notification.",
    keep: "Keep order",
    from: ["pending", "accepted"],
    label: "Reason for the customer and the supplier",
    confirm:
      "Cancel this order? The customer and the supplier are told your reason. You cannot undo this.",
  },
};
const mode = MODES[action] as Mode;

const order = ref<OrderDetail | null>(null);
const reason = ref("");
const loading = ref(true);
const missing = ref(false);
const loadError = ref("");
const error = ref("");
const busy = ref(false);

/** Where the page came from, and where it goes after the work. */
const backUrl = computed(findBackUrl);
const backLabel = computed(findBackLabel);
/** False when the order is in a status this page cannot change, like a completed one. */
const open = computed(isOpen);
const title = computed(buildTitle);
const hint = computed(buildHint);

function findBackUrl(): string {
  return adminView ? `/admin/projects/${parts[3]}#order-${id}` : `/orders/${id}`;
}

function findBackLabel(): string {
  if (adminView) {
    return `Back to project ${order.value?.project.name ?? ""}`;
  }
  return `Back to order ${order.value?.number ?? ""}`;
}

function isOpen(): boolean {
  return order.value !== null && mode.from.includes(order.value.status);
}

/** A page for an order that cannot be changed here says so in its title too. */
function buildTitle(): string {
  if (!order.value || open.value) {
    return mode.title;
  }
  return `Order ${order.value.number} is ${STATUS_LABELS[order.value.status].toLowerCase()}`;
}

/** Why nothing can be done here, in the words of the status badges. */
function closedText(): string {
  const allowed: string[] = [];
  for (const status of mode.from) {
    allowed.push(STATUS_LABELS[status].toLowerCase());
  }
  const what = mode.done === "rejected" ? "rejected" : "cancelled here";
  return `Only an order that is ${allowed.join(" or ")} can be ${what}. Nothing was changed.`;
}

function buildHint(): string {
  const found = order.value;
  if (!found) {
    return "";
  }
  const who = adminView
    ? `${found.customerCompanyName} and ${found.supplierCompanyName} both see this reason.`
    : "The customer sees this reason on the project page.";
  return mode.done === "rejected"
    ? `${who} The whole order is rejected.`
    : `${who} The whole order is cancelled and the items are free again for these dates.`;
}

/** Like "True Money → Bright Stage Co. · 12 – 15 Mar 2027 · 1 item · Waiting". */
function summaryOf(found: OrderDetail): string {
  return joinParts([
    adminView
      ? `${found.customerCompanyName} → ${found.supplierCompanyName}`
      : found.customerCompanyName,
    formatDateRange(found.startsOn, found.endsOn),
    countText(found.lines.length, "item"),
    adminView ? STATUS_LABELS[found.status] : "",
  ]);
}

async function load() {
  loadError.value = "";
  try {
    const found = await api.getOrder(id);
    // The project in the URL of an admin must be the project of the order.
    missing.value = adminView && found.projectId !== parts[3];
    order.value = found;
  } catch (caught) {
    missing.value = isMissing(caught);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

async function submit() {
  // Spaces only are no reason. The browser check for "required" lets them through.
  if (reason.value.trim() === "") {
    error.value = showError(
      new ApiError(422, "Write a reason.", "", [{ path: "reason", message: "Write a reason." }]),
    );
    return;
  }
  if (!confirm(mode.confirm)) {
    return;
  }
  error.value = "";
  busy.value = true;
  try {
    const text = reason.value.trim();
    await (action === "reject" ? api.rejectOrder(id, text) : api.cancelAcceptedOrder(id, text));
    flashLater(`Order ${order.value?.number} is ${mode.done}.`);
    router.visit(backUrl.value);
  } catch (caught) {
    // The order may be answered already. Show its status now.
    await load();
    error.value = showError(caught);
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
  <Head :title="`${mode.title} · ${order?.number ?? 'Orders'}`" />
  <Layout
    :title="title"
    :subtitle="open ? mode.subtitle : undefined"
    :back="{ href: backUrl, label: backLabel }"
    :roles="adminView ? ['admin'] : ['supplier', 'admin']"
  >
    <template #actions>
      <template v-if="open">
        <Link :href="backUrl" class="button secondary">{{ mode.keep }}</Link>
        <button type="submit" :form="FORM_ID" :disabled="busy">{{ mode.title }}</button>
      </template>
    </template>

    <template #default>
      <PageState :loading="loading" :error="order ? '' : loadError" @retry="load">
      <form v-if="order" :id="FORM_ID" class="card wide" @submit.prevent="submit">
        <div class="summary">
          <span>
            <strong>{{ order.number }} · {{ order.projectName }}</strong>
            <small>{{ summaryOf(order) }}</small>
          </span>
          <strong>{{ formatPrice(order.totalCents) }}</strong>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <template v-if="!open">
          <p class="muted">{{ closedText() }}</p>
          <div><Link :href="backUrl" class="button secondary">{{ backLabel }}</Link></div>
        </template>
        <template v-else>
          <label>
            <span>{{ mode.label }} <small class="muted">(required)</small></span>
            <textarea v-model="reason" name="reason" rows="6" maxlength="1000" required></textarea>
            <small class="muted">{{ hint }}</small>
          </label>
          <div class="form-foot">
            <Link :href="backUrl" class="button secondary">{{ mode.keep }}</Link>
            <button type="submit" :disabled="busy">{{ mode.title }}</button>
          </div>
        </template>
      </form>
      </PageState>
    </template>
  </Layout>
  </template>
</template>
