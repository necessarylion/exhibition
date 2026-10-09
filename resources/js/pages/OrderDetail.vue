<script setup lang="ts">
import { Head, Link, usePage } from "@inertiajs/vue3";
import { Check, CheckCheck, MessageSquareText, Printer, TriangleAlert, X } from "@lucide/vue";
import { computed, nextTick, onMounted, ref } from "vue";
import { ApiError, api, type OrderDetail, type User } from "../api";
import { vClip } from "../clip";
import {
  countText,
  formatBoothSize,
  formatDate,
  formatDateRange,
  itemNote,
  joinParts,
} from "../dates";
import { flashNow } from "../flash";
import { messageOf } from "../form-errors";
import ItemThumb from "../ItemThumb.vue";
import Layout from "../Layout.vue";
import { formatPrice, UNIT_LABELS } from "../money";
import PageState from "../PageState.vue";
import StatusBadge from "../StatusBadge.vue";
import { STATUS_LABELS } from "../status";
import NotFound from "./NotFound.vue";

// `/orders/<id>`. The supplier answers the order here. The customer and an admin can read it.
const id = usePage().url.split("/")[2]?.split("?")[0] ?? "";

const me = ref<User | null>(null);
const order = ref<OrderDetail | null>(null);
const loading = ref(true);
/** The order is not mine, or it does not exist. */
const missing = ref(false);
const loadError = ref("");
const error = ref("");
const busy = ref(false);

/** My company gets this order. */
const supplierSide = computed(isSupplierSide);
/** My company sent this order. */
const customerSide = computed(isCustomerSide);
const back = computed(buildBack);
const subtitle = computed(buildSubtitle);
/** An admin who is not the supplier of this order. They see it inside its project. */
const adminSide = computed(isAdminSide);
/** Why "Accept" cannot work now. Empty when every line fits. */
const shortText = computed(describeShort);

function setUser(user: User) {
  me.value = user;
}

function isSupplierSide(): boolean {
  return order.value !== null && order.value.supplierCompanyId === me.value?.companyId;
}

function isCustomerSide(): boolean {
  return order.value !== null && order.value.customerCompanyId === me.value?.companyId;
}

function isAdminSide(): boolean {
  return me.value?.role === "admin" && !supplierSide.value;
}

function buildBack() {
  if (customerSide.value && order.value) {
    return { href: `/projects/${order.value.projectId}`, label: "Back to the project" };
  }
  if (adminSide.value && order.value) {
    return {
      href: `/admin/projects/${order.value.projectId}#order-${order.value.id}`,
      label: `Back to project ${order.value.project.name}`,
    };
  }
  return { href: "/orders", label: "Back to orders" };
}

type Line = OrderDetail["lines"][number];

/** True when the line asks for more than is free on the dates of the order. */
function isShort(line: Line): boolean {
  return line.available !== null && line.quantity > line.available;
}

/** The answer side of a waiting order sees what is free, before the click on "Accept". */
function showsFree(): boolean {
  return order.value?.status === "pending" && !customerSide.value;
}

/** Like "24 free for these dates" or "Only 1 free. The order asks for 2." */
function freeText(line: Line): string {
  if (line.available === null) {
    return "No stock limit";
  }
  if (!isShort(line)) {
    return `${line.available.toLocaleString("en-US")} free for these dates`;
  }
  return line.available === 0
    ? `None free for these dates. The order asks for ${line.quantity}.`
    : `Only ${line.available} free. The order asks for ${line.quantity}.`;
}

function describeShort(): string {
  if (!showsFree()) {
    return "";
  }
  const names: string[] = [];
  for (const line of order.value?.lines ?? []) {
    if (isShort(line)) {
      names.push(line.itemName);
    }
  }
  return names.length > 0
    ? `You cannot accept. Not enough ${names.join(", ")} for these dates. Reject the order with a reason, or raise the stock of the item.`
    : "";
}

/** Who ended the order, for the title of the reason box. */
function reasonTitle(found: OrderDetail): string {
  if (found.status !== "cancelled") {
    return `Reason from ${found.supplierCompanyName}`;
  }
  return found.cancelledBy === "admin"
    ? "Cancelled by the platform admin"
    : `Cancelled by ${found.supplierCompanyName}`;
}

function print() {
  window.print();
}

/** Like "Booth · SKU BM-SB-63 · per piece". The unit says what one of the quantity is. */
function lineNote(line: OrderDetail["lines"][number]): string {
  return joinParts([itemNote(line), `per ${UNIT_LABELS[line.unit]}`]);
}

/** Like "Sent 6 Oct 2026 by Mya Events · accepted 7 Oct 2026". */
function buildSubtitle(): string | undefined {
  const found = order.value;
  if (!found) {
    return undefined;
  }
  const sent = customerSide.value
    ? `Sent ${formatDate(found.createdAt)} to ${found.supplierCompanyName}`
    : `Sent ${formatDate(found.createdAt)} by ${found.customerCompanyName}`;
  let answer = "";
  if (found.completedAt) {
    answer = `completed ${formatDate(found.completedAt)}`;
  } else if (found.decidedAt) {
    answer = `${STATUS_LABELS[found.status].toLowerCase()} ${formatDate(found.decidedAt)}`;
  }
  return joinParts([sent, answer]);
}

function hallAndBooth(): string {
  const project = order.value?.project;
  return joinParts([project?.hall, project?.boothNumber && `Booth ${project.boothNumber}`]);
}

async function load() {
  loadError.value = "";
  try {
    order.value = await api.getOrder(id);
  } catch (caught) {
    // 422: the id in the URL is not an id at all.
    missing.value = caught instanceof ApiError && (caught.status === 404 || caught.status === 422);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

const DONE = { accept: "accepted", complete: "completed", cancel: "cancelled" };

async function change(action: "accept" | "complete" | "cancel") {
  error.value = "";
  busy.value = true;
  try {
    order.value = await api.changeOrder(id, action);
    flashNow(`Order ${order.value.number} is ${DONE[action]}.`);
    // The buttons of the old status are gone. The title gets the focus, so a keyboard
    // user goes on from the top of the page and not from nowhere.
    await nextTick();
    document.querySelector<HTMLElement>("main h1")?.focus();
  } catch (caught) {
    error.value = messageOf(caught);
    // 409: someone else already answered, or an item is not free on these dates. Show the order as it is now.
    if (caught instanceof ApiError && caught.status === 409) {
      await reloadQuietly();
    }
  } finally {
    busy.value = false;
  }
}

/** Keeps the error message of the action on the page. */
async function reloadQuietly() {
  try {
    order.value = await api.getOrder(id);
  } catch {
    // The old order stays on the page.
  }
}

function cancel() {
  if (confirm(`Cancel order ${order.value?.number}? The supplier will see it as cancelled.`)) {
    return change("cancel");
  }
}

function accept() {
  const text = `Accept order ${order.value?.number}? The items are then held for the dates of this event.`;
  if (confirm(text)) {
    return change("accept");
  }
}

function complete() {
  if (confirm(`Mark order ${order.value?.number} as completed? You cannot undo this.`)) {
    return change("complete");
  }
}

onMounted(load);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
    <Head :title="order ? `${order.number} · Orders` : 'Order'" />
    <Layout :title="order?.number ?? 'Order'" :subtitle="subtitle" :back="back" @loaded="setUser">
      <template #badge>
        <StatusBadge v-if="order" :status="order.status" />
      </template>
      <template #actions>
        <template v-if="order && supplierSide && order.status === 'pending'">
          <Link :href="`/orders/${id}/reject`" class="button secondary">
            <X :size="16" aria-hidden="true" /> Reject
          </Link>
          <button
            type="button"
            :disabled="busy || shortText !== ''"
            :aria-describedby="shortText ? 'cannot-accept' : undefined"
            @click="accept"
          >
            <Check :size="16" aria-hidden="true" /> Accept order
          </button>
        </template>
        <template v-else-if="order && supplierSide && order.status === 'accepted'">
          <!-- The reason is asked on its own page. -->
          <Link :href="`/orders/${id}/cancel`" class="button secondary">
            <X :size="16" aria-hidden="true" /> Cancel order
          </Link>
          <button type="button" :disabled="busy" @click="complete">
            <CheckCheck :size="16" aria-hidden="true" /> Mark as completed
          </button>
        </template>
        <button
          v-else-if="order && customerSide && order.status === 'pending'"
          type="button"
          class="secondary"
          :disabled="busy"
          @click="cancel"
        >
          Cancel order
        </button>
        <Link
          v-else-if="
            order && adminSide && (order.status === 'pending' || order.status === 'accepted')
          "
          :href="`/admin/projects/${order.projectId}/orders/${order.id}/cancel`"
          class="button secondary"
        >
          <X :size="16" aria-hidden="true" /> Cancel order
        </Link>
        <button v-if="order" type="button" class="ghost" @click="print">
          <Printer :size="16" aria-hidden="true" /> Print
        </button>
      </template>

      <template #default>
        <PageState :loading="loading" :error="loadError" @retry="load">
          <div v-if="order" class="split" style="--side: 340px">
            <div>
              <p v-if="error" class="error" role="alert">{{ error }}</p>
              <p v-if="shortText && supplierSide" id="cannot-accept" class="notice" role="status">
                <TriangleAlert :size="16" aria-hidden="true" />
                <span>{{ shortText }}</span>
              </p>
              <p v-if="order.createdByAdminName" class="created-by">
                Created by {{ order.createdByAdminName }} (platform admin) for
                {{ order.customerCompanyName }}
              </p>
              <section class="panel" aria-labelledby="order-lines">
                <div class="panel-header">
                  <h2 id="order-lines">Items in this order</h2>
                  <span class="muted">{{ countText(order.lines.length, "item") }}</span>
                </div>
                <div class="table-wrap">
                  <table class="lines">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th class="num">Qty</th>
                        <th class="num">Unit price</th>
                        <th class="num">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="line in order.lines" :key="line.id">
                        <td v-clip class="line-item">
                          <div class="inline">
                            <ItemThumb :url="line.photoUrl" />
                            <span class="two-lines">
                              <strong>{{ line.itemName }}</strong>
                              <small class="muted">
                                {{ lineNote(line) }}
                                <span class="phone-only">
                                  · {{ line.quantity }} × {{ formatPrice(line.unitPriceCents) }}
                                </span>
                              </small>
                              <small
                                v-if="showsFree()"
                                :class="isShort(line) ? 'stock-warning' : 'avail-yes'"
                              >
                                <TriangleAlert v-if="isShort(line)" :size="14" aria-hidden="true" />
                                {{ freeText(line) }}
                              </small>
                            </span>
                          </div>
                        </td>
                        <td class="num phone-hide">{{ line.quantity }}</td>
                        <td class="num phone-hide">{{ formatPrice(line.unitPriceCents) }}</td>
                        <td class="num line-total">
                          <strong>{{ formatPrice(line.lineTotalCents) }}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <!-- A rejected order, or an accepted order that the supplier cancelled. -->
                <div v-if="order.rejectReason" class="notice reason">
                  <MessageSquareText :size="16" aria-hidden="true" />
                  <div>
                    <strong>{{ reasonTitle(order) }}</strong>
                    <p>{{ order.rejectReason }}</p>
                  </div>
                </div>
                <div class="panel-footer">
                  <span class="muted">Order total</span>
                  <strong class="big">{{ formatPrice(order.totalCents) }}</strong>
                </div>
              </section>

              <section v-if="order.note" class="panel pad" aria-labelledby="order-note">
                <h2 id="order-note" class="eyebrow">Note from the customer</h2>
                <p class="pre-line">{{ order.note }}</p>
              </section>
            </div>

            <aside>
              <section v-if="!customerSide" class="panel pad" aria-labelledby="order-customer">
                <h2 id="order-customer" class="eyebrow">Customer</h2>
                <dl class="details">
                  <div>
                    <dt>Company</dt>
                    <dd>{{ order.customerCompanyName }}</dd>
                  </div>
                  <div v-if="order.customerContactName">
                    <dt>Contact person</dt>
                    <dd>{{ order.customerContactName }}</dd>
                  </div>
                  <div v-if="order.customerContactEmail">
                    <dt>Email</dt>
                    <dd>
                      <a :href="`mailto:${order.customerContactEmail}`" class="plain">
                        {{ order.customerContactEmail }}
                      </a>
                    </dd>
                  </div>
                  <div v-if="order.customerPhone">
                    <dt>Phone</dt>
                    <dd>
                      <a :href="`tel:${order.customerPhone}`" class="plain">{{ order.customerPhone }}</a>
                    </dd>
                  </div>
                </dl>
              </section>
              <section v-if="!supplierSide" class="panel pad" aria-labelledby="order-supplier">
                <h2 id="order-supplier" class="eyebrow">Supplier</h2>
                <dl class="details">
                  <div>
                    <dt>Company</dt>
                    <dd>{{ order.supplierCompanyName }}</dd>
                  </div>
                  <div v-if="order.supplierContactName">
                    <dt>Contact person</dt>
                    <dd>{{ order.supplierContactName }}</dd>
                  </div>
                  <div v-if="order.supplierContactEmail">
                    <dt>Email</dt>
                    <dd>
                      <a :href="`mailto:${order.supplierContactEmail}`" class="plain">
                        {{ order.supplierContactEmail }}
                      </a>
                    </dd>
                  </div>
                  <div v-if="order.supplierPhone">
                    <dt>Phone</dt>
                    <dd>
                      <a :href="`tel:${order.supplierPhone}`" class="plain">{{ order.supplierPhone }}</a>
                    </dd>
                  </div>
                </dl>
              </section>

              <section class="panel pad" aria-labelledby="order-event">
                <h2 id="order-event" class="eyebrow">Event</h2>
                <dl class="details">
                  <div>
                    <dt>Project</dt>
                    <dd>
                      <Link v-if="customerSide" :href="`/projects/${order.projectId}`" class="plain">
                        {{ order.project.name }}
                      </Link>
                      <Link
                        v-else-if="adminSide"
                        :href="`/admin/projects/${order.projectId}`"
                        class="plain"
                      >
                        {{ order.project.name }}
                      </Link>
                      <template v-else>{{ order.project.name }}</template>
                    </dd>
                  </div>
                  <div>
                    <dt>Dates</dt>
                    <dd>{{ formatDateRange(order.project.startsOn, order.project.endsOn) }}</dd>
                  </div>
                  <div v-if="order.project.setupOn">
                    <dt>Setup date</dt>
                    <dd>{{ formatDate(order.project.setupOn) }}</dd>
                  </div>
                  <div v-if="order.project.venue || order.project.city">
                    <dt>Venue</dt>
                    <dd>{{ joinParts([order.project.venue, order.project.city], ", ") }}</dd>
                  </div>
                  <div v-if="hallAndBooth()">
                    <dt>Hall and booth</dt>
                    <dd>{{ hallAndBooth() }}</dd>
                  </div>
                  <div v-if="formatBoothSize(order.project.boothWidthCm, order.project.boothDepthCm)">
                    <dt>Booth size</dt>
                    <dd>
                      {{ formatBoothSize(order.project.boothWidthCm, order.project.boothDepthCm) }}
                    </dd>
                  </div>
                  <div v-if="order.project.notes" class="long">
                    <dt>Notes</dt>
                    <dd>{{ order.project.notes }}</dd>
                  </div>
                </dl>
              </section>
            </aside>
          </div>
        </PageState>
      </template>
    </Layout>
  </template>
</template>
