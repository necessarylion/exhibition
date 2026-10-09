<script setup lang="ts">
import { Head, Link, usePage } from "@inertiajs/vue3";
import {
  Building2,
  Info,
  Lock,
  MessageSquareText,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
} from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import {
  ApiError,
  api,
  type OrderStatus,
  type OrderWithLines,
  type ProjectDetail,
  type ProjectLine,
} from "../api";
import { setChosenProjectId } from "../chosen-project";
import { vClip } from "../clip";
import { countText, formatBoothSize, formatDate, formatDateRange, joinParts } from "../dates";
import { flashNow } from "../flash";
import { messageOf } from "../form-errors";
import ItemThumb from "../ItemThumb.vue";
import Layout from "../Layout.vue";
import { formatPrice, UNIT_LABELS } from "../money";
import PageState from "../PageState.vue";
import { groupNotSent, sumGroups } from "../project-lines";
import QuantityStepper from "../QuantityStepper.vue";
import StatusBadge from "../StatusBadge.vue";
import NotFound from "./NotFound.vue";

// Two URLs open this page: `/projects/<id>` is the project of a customer.
// `/admin/projects/<id>` shows the same to an admin. An admin sees every order of the
// platform here, inside its project, and can cancel a waiting or accepted one.
const parts = usePage().url.split("?")[0]?.split("/") ?? [];
const adminView = parts[1] === "admin";
const id = (adminView ? parts[3] : parts[2]) ?? "";

const detail = ref<ProjectDetail | null>(null);
const loading = ref(true);
/** The project is not mine, or it does not exist. */
const missing = ref(false);
const loadError = ref("");
const error = ref("");
const busy = ref(false);
/** The items that "Add these items again" could not add. One sentence each. */
const notAdded = ref<string[]>([]);

const groups = computed(listGroups);
const notSent = computed(sumNotSent);
const ownLines = computed(listOwnLines);
const sharedLines = computed(listSharedLines);
const freeSections = computed(listFreeSections);
const ended = computed(listEnded);
const orders = computed(sortOrders);
const subtitle = computed(buildSubtitle);
/** A done or cancelled project cannot change. An admin only looks. */
const editable = computed(isEditable);
const canCancel = computed(isCancellable);
const canFinish = computed(isFinishable);

function listGroups() {
  return groupNotSent(detail.value?.lines ?? []);
}

function sumNotSent() {
  return sumGroups(groups.value);
}

function linesIn(state: ProjectLine["state"]): ProjectLine[] {
  const result: ProjectLine[] = [];
  for (const line of detail.value?.lines ?? []) {
    if (line.state === state) {
      result.push(line);
    }
  }
  return result;
}

function listOwnLines(): ProjectLine[] {
  return linesIn("own");
}

/** Items of the other companies of my organization group. Free, like my own items. */
function listSharedLines(): ProjectLine[] {
  return linesIn("shared");
}

/** The free lines: no price, no order, no approval. A section with no line is not shown. */
function listFreeSections() {
  // An admin reads the project of a customer, so the words name the customer.
  const company = detail.value?.project.companyName ?? "The customer";
  const sections = [
    {
      id: "own-items",
      title: adminView ? `${company}’s own items` : "My own items",
      note: adminView
        ? "Free. No order is needed. You can only read these lines."
        : "Your own items are free and need no approval.",
      lines: ownLines.value,
    },
    {
      id: "shared-items",
      title: adminView ? `Shared by the group of ${company}` : "Shared by my group",
      note: adminView
        ? "Items from other companies of its group. Free, no order is needed."
        : "Items from companies in your group are free and need no approval.",
      lines: sharedLines.value,
    },
  ];
  const shown = [];
  for (const section of sections) {
    if (section.lines.length > 0) {
      shown.push(section);
    }
  }
  return shown;
}

/** The small line under the name. A shared item also says which company owns it. */
function freeLineNote(line: ProjectLine): string {
  return joinParts([line.category, line.state === "shared" ? line.companyName : ""]);
}

/**
 * The orders that somebody else ended: a supplier rejected or cancelled it, or the platform
 * admin cancelled it. The customer sees a line about each one at the top.
 */
function listEnded(): OrderWithLines[] {
  const result: OrderWithLines[] = [];
  for (const order of detail.value?.orders ?? []) {
    const byOther = order.cancelledBy === "supplier" || order.cancelledBy === "admin";
    if (order.status === "rejected" || (order.status === "cancelled" && byOther)) {
      result.push(order);
    }
  }
  return result;
}

/** Like "Golden Stand Builders rejected" or "The platform admin cancelled". */
function whoEnded(order: OrderWithLines): string {
  if (order.status === "rejected") {
    return `${order.supplierCompanyName} rejected`;
  }
  return order.cancelledBy === "admin"
    ? "The platform admin cancelled"
    : `${order.supplierCompanyName} cancelled`;
}

/** The title of the reason box of an order. */
function reasonTitle(order: OrderWithLines): string {
  if (order.status !== "cancelled") {
    return `Reason from ${order.supplierCompanyName}`;
  }
  return order.cancelledBy === "admin"
    ? "Cancelled by the platform admin"
    : `Cancelled by ${order.supplierCompanyName}`;
}

const ORDER_RANK: Record<OrderStatus, number> = {
  accepted: 0,
  pending: 1,
  completed: 2,
  rejected: 3,
  cancelled: 4,
};

/** Accepted orders first, then waiting, completed, rejected and cancelled. */
function sortOrders(): OrderWithLines[] {
  return [...(detail.value?.orders ?? [])].sort(byRank);
}

function byRank(a: OrderWithLines, b: OrderWithLines): number {
  return ORDER_RANK[a.status] - ORDER_RANK[b.status];
}

/** A rejected or cancelled order: its items can go back to "Not sent yet". */
function isDead(order: OrderWithLines): boolean {
  return order.status === "rejected" || order.status === "cancelled";
}

/** An admin can cancel an order that waits or is accepted. */
function adminCanCancel(order: OrderWithLines): boolean {
  return adminView && (order.status === "pending" || order.status === "accepted");
}

function ordersIn(statuses: OrderStatus[]): OrderWithLines[] {
  const result: OrderWithLines[] = [];
  for (const order of detail.value?.orders ?? []) {
    if (statuses.includes(order.status)) {
      result.push(order);
    }
  }
  return result;
}

function sumOrders(orders: OrderWithLines[]): number {
  let total = 0;
  for (const order of orders) {
    total += order.totalCents;
  }
  return total;
}

function buildSubtitle(): string | undefined {
  const project = detail.value?.project;
  if (!project) {
    return undefined;
  }
  return joinParts([
    formatDateRange(project.startsOn, project.endsOn),
    joinParts([project.venue, project.city], ", "),
    hallAndBooth(", "),
  ]);
}

function hallAndBooth(separator: string): string {
  const project = detail.value?.project;
  return joinParts(
    [project?.hall, project?.boothNumber && `Booth ${project.boothNumber}`],
    separator,
  );
}

function isEditable(): boolean {
  const status = detail.value?.project.status;
  return !adminView && status !== undefined && status !== "done" && status !== "cancelled";
}

/**
 * The same rule as the API: the project has an item, no order waits and nothing is left
 * to send. So a project with only own and shared items can be done too.
 */
function isFinishable(): boolean {
  const found = detail.value;
  return (
    editable.value &&
    found !== null &&
    found.lines.length > 0 &&
    found.project.pendingOrderCount === 0 &&
    notSent.value.count === 0
  );
}

/** Like "Only 2 available for your dates". Empty when the line fits. */
function shortage(line: ProjectLine): string {
  if (line.available === null || line.available >= line.quantity) {
    return "";
  }
  return line.available === 0
    ? "Not available for your dates"
    : `Only ${line.available} available for your dates`;
}

/** The API refuses to cancel a project when a supplier already accepted an order. */
function isCancellable(): boolean {
  return editable.value && ordersIn(["accepted", "completed"]).length === 0;
}

/** A rejected or cancelled order is not counted in the total. */
function counts(order: OrderWithLines): boolean {
  return order.status !== "rejected" && order.status !== "cancelled";
}

async function load() {
  loadError.value = "";
  try {
    detail.value = await api.getProject(id);
  } catch (caught) {
    // 422: the id in the URL is not an id at all.
    missing.value = caught instanceof ApiError && (caught.status === 404 || caught.status === 422);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

/**
 * Runs one action at a time. Every action answers with the whole project.
 * `done` is the message the user sees when it worked.
 */
async function run(action: () => Promise<ProjectDetail>, done = "") {
  error.value = "";
  busy.value = true;
  try {
    detail.value = await action();
    if (done) {
      flashNow(done);
    }
  } catch (caught) {
    error.value = messageOf(caught);
    // Another order may have taken the item. Show what the project holds now.
    await reloadQuietly();
  } finally {
    busy.value = false;
  }
}

/** Keeps the error message of the action on the page. */
async function reloadQuietly() {
  try {
    detail.value = await api.getProject(id);
  } catch {
    // The old data stays on the page.
  }
}

function changeQuantity(line: ProjectLine, quantity: number) {
  return run(api.updateProjectLine.bind(api, id, line.id, quantity));
}

function removeLine(line: ProjectLine) {
  if (confirm(`Remove "${line.itemName}" from this project?`)) {
    return run(api.removeProjectLine.bind(api, id, line.id), `"${line.itemName}" is removed.`);
  }
}

async function cancelOrder(order: OrderWithLines) {
  const text = `Cancel order ${order.number}? ${order.supplierCompanyName} will see it as cancelled.`;
  if (!confirm(text)) {
    return;
  }
  await run(async function cancelAndReload() {
    await api.changeOrder(order.id, "cancel");
    return api.getProject(id);
  }, `Order ${order.number} is cancelled.`);
}

/** Puts the items of a rejected or cancelled order back as lines that are not sent. */
async function addAgain(order: OrderWithLines) {
  notAdded.value = [];
  await run(async function addAndKeepNotes() {
    const result = await api.addOrderItemsAgain(id, order.id);
    notAdded.value = result.notAdded;
    const added = order.lines.length - result.notAdded.length;
    flashNow(
      added > 0
        ? `${countText(added, "item")} of order ${order.number} ${added === 1 ? "is" : "are"} back in "Not sent yet".`
        : "No item could be added again.",
    );
    return result;
  });
  document.getElementById("not-sent")?.scrollIntoView({ block: "center" });
}

function cancelProject() {
  if (confirm("Cancel this project? The waiting orders are cancelled too. You cannot undo this.")) {
    return run(api.cancelProject.bind(api, id), "The project is cancelled.");
  }
}

function finishProject() {
  if (confirm("Mark this project as done? It cannot change after this.")) {
    return run(api.finishProject.bind(api, id), "The project is marked as done.");
  }
}

/** Like "Furniture · per square meter". The unit says what one of the quantity is. */
function lineNote(line: { category: string | null; unit: ProjectLine["unit"] }): string {
  return joinParts([line.category, `per ${UNIT_LABELS[line.unit]}`]);
}

/** True when a line of the request cannot be sent, because its item left the catalog. */
const hasGone = computed(findGone);

function findGone(): boolean {
  for (const group of groups.value) {
    for (const line of group.lines) {
      if (!line.inCatalog) {
        return true;
      }
    }
  }
  return false;
}

function chooseForCatalog() {
  setChosenProjectId(id);
}

onMounted(load);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
    <Head :title="detail ? `${detail.project.name} · Projects` : 'Project'" />
    <Layout
      :title="detail?.project.name ?? 'Project'"
      :subtitle="subtitle"
      :back="{ href: adminView ? '/admin/projects' : '/projects', label: 'Back to projects' }"
      :roles="[adminView ? 'admin' : 'customer']"
    >
      <template #badge>
        <StatusBadge v-if="detail" :status="detail.project.status" />
      </template>
      <template #actions>
        <template v-if="editable">
          <Link href="/catalog" class="button secondary" @click="chooseForCatalog">
            <Plus :size="16" aria-hidden="true" /> Add items
          </Link>
          <Link v-if="notSent.count > 0" :href="`/projects/${id}/send`" class="button">
            <Send :size="16" aria-hidden="true" /> Send request
          </Link>
          <button
            v-else
            type="button"
            disabled
            title="Nothing is waiting to be sent. Add items first."
            aria-describedby="nothing-to-send"
          >
            <Send :size="16" aria-hidden="true" /> Send request
          </button>
        </template>
      </template>

      <template #default>
        <PageState :loading="loading" :error="loadError" @retry="load">
          <div v-if="detail" class="split">
            <div>
              <p v-if="detail.project.createdByAdminName" class="created-by">
                <UserRound :size="15" aria-hidden="true" />
                Created by {{ detail.project.createdByAdminName }} (platform admin) for
                {{ detail.project.companyName }}
              </p>
              <p v-if="error" class="error" role="alert">{{ error }}</p>
              <div v-if="notAdded.length > 0" class="notice" role="status">
                <TriangleAlert :size="16" aria-hidden="true" />
                <span>
                  Not every item could be added again:
                  <template v-for="text in notAdded" :key="text"><br />{{ text }}</template>
                </span>
              </div>
              <template v-if="editable">
                <p v-for="order in ended" :key="order.id" class="notice">
                  <TriangleAlert :size="16" aria-hidden="true" />
                  <span>
                    {{ whoEnded(order) }} order {{ order.number }}. Read the reason below. You
                    can add its items again, or pick other items, and send a new request.
                  </span>
                </p>
                <p v-if="hasGone" class="notice">
                  <TriangleAlert :size="16" aria-hidden="true" />
                  <span>
                    An item below is not in the catalog any more. Remove it before you send the
                    request.
                  </span>
                </p>
              </template>

              <section
                v-if="editable || notSent.count > 0"
                class="panel"
                aria-labelledby="not-sent"
              >
                <div class="panel-header">
                  <div>
                    <h2 id="not-sent">Not sent yet</h2>
                    <p class="muted">
                      {{ countText(notSent.count, "item") }} ·
                      {{ formatPrice(notSent.totalCents) }}
                    </p>
                  </div>
                  <span class="inline muted">
                    <Info :size="16" aria-hidden="true" />
                    <template v-if="adminView">The customer did not send these yet.</template>
                    <template v-else>Send request creates one order per supplier.</template>
                  </span>
                </div>
                <div v-if="notSent.count === 0" id="nothing-to-send" class="panel-note muted">
                  Nothing is waiting to be sent.
                  <template v-if="editable">
                    <Link href="/catalog" @click="chooseForCatalog">
                      Add items from the catalog
                    </Link>
                  </template>
                </div>
                <div v-else class="table-wrap">
                  <table class="lines">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Quantity</th>
                        <th class="num">Price</th>
                        <th class="num">Line total</th>
                        <th><span class="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody v-for="group in groups" :key="group.companyId">
                      <tr class="group-row">
                        <td v-clip colspan="5">
                          <span class="inline">
                            <Building2 :size="15" class="muted" aria-hidden="true" />
                            <strong>{{ group.companyName }}</strong>
                            <small>
                              {{ countText(group.lines.length, "item") }} ·
                              {{ formatPrice(group.totalCents) }}
                            </small>
                          </span>
                        </td>
                      </tr>
                      <tr v-for="line in group.lines" :key="line.id">
                        <td v-clip class="line-item">
                          <div class="inline">
                            <ItemThumb :url="line.photoUrl" />
                            <span class="two-lines">
                              <strong v-if="adminView">{{ line.itemName }}</strong>
                              <Link v-else :href="`/catalog/${line.itemId}`" class="plain">
                                {{ line.itemName }}
                              </Link>
                              <small class="muted">
                                {{ lineNote(line) }}
                                <span class="phone-only">
                                  · {{ formatPrice(line.unitPriceCents) }} each
                                </span>
                              </small>
                            </span>
                          </div>
                        </td>
                        <td class="line-qty" :data-label="editable ? undefined : 'Quantity'">
                          <QuantityStepper
                            v-if="editable"
                            :model-value="line.quantity"
                            :label="line.itemName"
                            :max="line.available"
                            :disabled="busy"
                            @update:model-value="changeQuantity(line, $event)"
                          />
                          <template v-else>{{ line.quantity }}</template>
                          <small v-if="!line.inCatalog" class="error">
                            Not in the catalog any more
                          </small>
                          <small v-else-if="shortage(line)" class="error">
                            {{ shortage(line) }}
                          </small>
                        </td>
                        <td class="num phone-hide">{{ formatPrice(line.unitPriceCents) }}</td>
                        <td class="num line-total">
                          <strong>{{ formatPrice(line.lineTotalCents) }}</strong>
                        </td>
                        <td class="actions">
                          <button
                            v-if="editable"
                            type="button"
                            class="ghost icon"
                            :disabled="busy"
                            :aria-label="`Remove ${line.itemName}`"
                            title="Remove"
                            @click="removeLine(line)"
                          >
                            <Trash2 :size="18" aria-hidden="true" />
                            <span class="phone-only" aria-hidden="true">Remove</span>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section
                v-for="order in orders"
                :id="`order-${order.id}`"
                :key="order.id"
                class="panel"
                :aria-label="`Order ${order.number}`"
              >
                <div class="panel-header">
                  <div>
                    <h2 class="title-row">
                      <Link :href="`/orders/${order.id}`" class="plain">{{ order.number }}</Link>
                      <StatusBadge :status="order.status" />
                    </h2>
                    <p class="muted">
                      {{ order.supplierCompanyName }} · sent {{ formatDate(order.createdAt) }}
                    </p>
                    <small v-if="order.createdByAdminName" class="muted">
                      Created by {{ order.createdByAdminName }} (platform admin) for
                      {{ order.customerCompanyName }}
                    </small>
                  </div>
                  <span class="inline order-actions">
                    <template v-if="adminView">
                      <Link
                        :href="`/orders/${order.id}`"
                        class="button ghost"
                        :aria-label="`Open order ${order.number}`"
                      >
                        Open order
                      </Link>
                      <Link
                        v-if="adminCanCancel(order)"
                        :href="`/admin/projects/${id}/orders/${order.id}/cancel`"
                        class="button ghost"
                        :aria-label="`Cancel order ${order.number}`"
                      >
                        <X :size="16" aria-hidden="true" /> Cancel order
                      </Link>
                    </template>
                    <button
                      v-if="editable && order.status === 'pending'"
                      type="button"
                      class="ghost"
                      :disabled="busy"
                      :aria-label="`Cancel order ${order.number}`"
                      @click="cancelOrder(order)"
                    >
                      Cancel order
                    </button>
                    <button
                      v-if="editable && isDead(order)"
                      type="button"
                      class="secondary"
                      :disabled="busy"
                      :aria-label="`Add the items of order ${order.number} again`"
                      @click="addAgain(order)"
                    >
                      <RotateCcw :size="16" aria-hidden="true" /> Add these items again
                    </button>
                  </span>
                </div>
                <div class="table-wrap">
                  <table class="lines">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th class="num">Qty</th>
                        <th class="num">Price</th>
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
                <div v-if="order.rejectReason" class="notice reason">
                  <MessageSquareText :size="16" aria-hidden="true" />
                  <div>
                    <strong>{{ reasonTitle(order) }}</strong>
                    <p>{{ order.rejectReason }}</p>
                  </div>
                </div>
                <div class="panel-footer">
                  <span class="muted">Order total</span>
                  <strong :class="{ muted: !counts(order) }">
                    {{ formatPrice(order.totalCents) }}
                  </strong>
                </div>
              </section>

              <section
                v-for="section in freeSections"
                :key="section.id"
                class="panel"
                :aria-labelledby="section.id"
              >
                <div class="panel-header">
                  <div>
                    <h2 :id="section.id">{{ section.title }}</h2>
                    <p class="muted">{{ section.note }}</p>
                  </div>
                </div>
                <div class="table-wrap">
                  <table class="lines">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Quantity</th>
                        <th class="num">Price</th>
                        <th><span class="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="line in section.lines" :key="line.id">
                        <td v-clip class="line-item">
                          <div class="inline">
                            <ItemThumb :url="line.photoUrl" />
                            <span class="two-lines">
                              <strong>{{ line.itemName }}</strong>
                              <small class="muted">{{ freeLineNote(line) }}</small>
                            </span>
                          </div>
                        </td>
                        <td class="line-qty" :data-label="editable ? undefined : 'Quantity'">
                          <QuantityStepper
                            v-if="editable"
                            :model-value="line.quantity"
                            :label="line.itemName"
                            :max="line.stock"
                            :disabled="busy"
                            @update:model-value="changeQuantity(line, $event)"
                          />
                          <template v-else>{{ line.quantity }}</template>
                        </td>
                        <td class="num line-total"><span class="free">Free</span></td>
                        <td class="actions">
                          <button
                            v-if="editable"
                            type="button"
                            class="ghost icon"
                            :disabled="busy"
                            :aria-label="`Remove ${line.itemName}`"
                            title="Remove"
                            @click="removeLine(line)"
                          >
                            <Trash2 :size="18" aria-hidden="true" />
                            <span class="phone-only" aria-hidden="true">Remove</span>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <div v-if="detail.lines.length === 0 && !editable" class="state">
                This project has no items.
              </div>
            </div>

            <aside>
              <section class="panel pad" aria-labelledby="event-details">
                <div class="label-row">
                  <h2 id="event-details" class="eyebrow">Event details</h2>
                  <Link v-if="editable" :href="`/projects/${id}/edit`" class="inline plain-link">
                    <Pencil :size="13" aria-hidden="true" /> Edit
                  </Link>
                </div>
                <p v-if="editable && detail.project.eventLocked" class="notice small">
                  <Lock :size="14" aria-hidden="true" />
                  <span>You cannot change the dates while an order is waiting or accepted.</span>
                </p>
                <dl class="details">
                  <div v-if="adminView">
                    <dt>Customer</dt>
                    <dd>{{ detail.project.companyName }}</dd>
                  </div>
                  <div>
                    <dt>Dates</dt>
                    <dd>{{ formatDateRange(detail.project.startsOn, detail.project.endsOn) }}</dd>
                  </div>
                  <div v-if="detail.project.setupOn">
                    <dt>Setup date</dt>
                    <dd>{{ formatDate(detail.project.setupOn) }}</dd>
                  </div>
                  <div v-if="detail.project.venue || detail.project.city">
                    <dt>Venue</dt>
                    <dd>{{ joinParts([detail.project.venue, detail.project.city], ", ") }}</dd>
                  </div>
                  <div v-if="hallAndBooth(' · ')">
                    <dt>Hall and booth</dt>
                    <dd>{{ hallAndBooth(" · ") }}</dd>
                  </div>
                  <div
                    v-if="formatBoothSize(detail.project.boothWidthCm, detail.project.boothDepthCm)"
                  >
                    <dt>Booth size</dt>
                    <dd>
                      {{
                        formatBoothSize(detail.project.boothWidthCm, detail.project.boothDepthCm)
                      }}
                    </dd>
                  </div>
                  <div v-if="detail.project.notes" class="long">
                    <dt>Notes</dt>
                    <dd>{{ detail.project.notes }}</dd>
                  </div>
                </dl>
              </section>

              <section class="panel pad" aria-labelledby="totals">
                <h2 id="totals" class="eyebrow">Totals</h2>
                <div class="sum-row">
                  <span>Accepted orders ({{ ordersIn(["accepted"]).length }})</span>
                  <span>{{ formatPrice(sumOrders(ordersIn(["accepted"]))) }}</span>
                </div>
                <div class="sum-row">
                  <span>Waiting orders ({{ ordersIn(["pending"]).length }})</span>
                  <span>{{ formatPrice(sumOrders(ordersIn(["pending"]))) }}</span>
                </div>
                <div v-if="ordersIn(['completed']).length > 0" class="sum-row">
                  <span>Completed orders ({{ ordersIn(["completed"]).length }})</span>
                  <span>{{ formatPrice(sumOrders(ordersIn(["completed"]))) }}</span>
                </div>
                <div v-if="ownLines.length > 0" class="sum-row">
                  <span>{{ adminView ? "Own items" : "My own items" }} ({{ ownLines.length }})</span>
                  <span class="free">Free</span>
                </div>
                <div v-if="sharedLines.length > 0" class="sum-row">
                  <span>
                    {{ adminView ? "Shared by its group" : "Shared by my group" }}
                    ({{ sharedLines.length }})
                  </span>
                  <span class="free">Free</span>
                </div>
                <div class="sum-row total">
                  <span>Orders total</span>
                  <strong class="big">{{ formatPrice(detail.project.totalCents) }}</strong>
                </div>
                <small class="muted">
                  Not sent yet: {{ formatPrice(notSent.totalCents) }}. Rejected and cancelled
                  orders are not counted.
                </small>
              </section>

              <div v-if="editable && (canFinish || canCancel)" class="buttons project-ends">
                <button
                  v-if="canFinish"
                  type="button"
                  class="secondary"
                  :disabled="busy"
                  @click="finishProject"
                >
                  Mark as done
                </button>
                <button
                  v-if="canCancel"
                  type="button"
                  class="ghost"
                  :disabled="busy"
                  @click="cancelProject"
                >
                  Cancel project
                </button>
              </div>
            </aside>
          </div>
        </PageState>
      </template>
    </Layout>
  </template>
</template>
