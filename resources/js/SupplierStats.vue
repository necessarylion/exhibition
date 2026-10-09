<script setup lang="ts">
import { Link } from "@inertiajs/vue3";
import {
  ChevronRight,
  CircleCheck,
  Hourglass,
  Package,
  PackagePlus,
  Plus,
  Wallet,
} from "@lucide/vue";
import { computed } from "vue";
import type { SupplierStats } from "./api";
import { countText, formatDate, formatDateRange, formatMonth } from "./dates";
import ItemThumb from "./ItemThumb.vue";
import { formatPrice } from "./money";
import StatTile from "./StatTile.vue";

// What a company sees of the orders for its own items. The supplier home page shows it,
// and the admin home page shows it for the admin company.
// `waiting`: the company is not approved yet, so none of its items is in the catalog.
const props = defineProps<{ stats: SupplierStats; waiting?: boolean }>();

const listedNote = computed(describeListed);

function describeListed(): string {
  if (props.waiting) {
    return "Not in the catalog yet";
  }
  return props.stats.itemsHidden > 0 ? `${props.stats.itemsHidden} hidden` : "All in the catalog";
}

/** A company that waits for approval and has no order: one calm box, not three empty lists. */
const nothingYet = computed(hasNothingYet);

function hasNothingYet(): boolean {
  const stats = props.stats;
  return Boolean(props.waiting) && stats.ordersWaiting + stats.ordersAccepted === 0;
}

/** The small text of a tile. A new company reads "Nothing yet" under a zero. */
function noteOf(value: number, note: string): string {
  return nothingYet.value && value === 0 ? "Nothing yet" : note;
}

const BAR_MAX_PX = 140;

const highest = computed(findHighest);

function findHighest(): number {
  let max = 1;
  for (const month of props.stats.ordersPerMonth) {
    max = Math.max(max, month.count);
  }
  return max;
}

/** The tallest month fills the chart. A month with orders is at least a thin line. */
function barHeight(count: number): string {
  return `${count === 0 ? 0 : Math.max(4, Math.round((count / highest.value) * BAR_MAX_PX))}px`;
}
</script>

<template>
  <div class="stats">
    <StatTile
      label="Orders waiting"
      :value="stats.ordersWaiting"
:note="noteOf(stats.ordersWaiting, 'Need your answer')"
      :icon="Hourglass"
    />
    <StatTile
      label="Orders accepted"
      :value="stats.ordersAccepted"
:note="noteOf(stats.ordersAccepted, 'Not completed yet')"
      :icon="CircleCheck"
    />
    <StatTile
      label="Revenue"
      :value="formatPrice(stats.revenueCents)"
:note="noteOf(stats.revenueCents, 'Accepted and completed orders')"
      :icon="Wallet"
    />
    <StatTile
      label="Items listed"
      :value="stats.itemsListed"
:note="noteOf(stats.itemsListed, listedNote)"
      :icon="Package"
    />
  </div>

  <section v-if="nothingYet" class="panel pad calm" aria-labelledby="no-orders">
    <PackagePlus :size="24" class="muted" aria-hidden="true" />
    <h2 id="no-orders">No orders yet</h2>
    <p class="muted">Add your items now. Then you are ready when the admin approves you.</p>
    <Link href="/items/new" class="button"><Plus :size="16" aria-hidden="true" /> Add item</Link>
  </section>

  <template v-else>
  <section class="panel" aria-labelledby="to-answer">
    <div class="panel-header">
      <h2 id="to-answer">Orders that need your answer</h2>
      <Link href="/orders" class="more">
        All orders <ChevronRight :size="14" aria-hidden="true" />
      </Link>
    </div>
    <p v-if="stats.ordersToAnswer.length === 0" class="panel-note muted">
      No order is waiting for your answer.
    </p>
    <ul v-else class="rows">
      <li v-for="order in stats.ordersToAnswer" :key="order.id">
        <Link :href="`/orders/${order.id}`">
          <span class="two-lines cell-number">
            <strong>{{ order.number }}</strong>
            <small class="muted">Sent {{ formatDate(order.createdAt) }}</small>
          </span>
          <span class="two-lines grow">
            <strong>{{ order.projectName }}</strong>
            <small class="muted">{{ order.customerCompanyName }}</small>
          </span>
          <span class="cell-dates">{{ formatDateRange(order.startsOn, order.endsOn) }}</span>
          <strong class="cell-money">{{ formatPrice(order.totalCents) }}</strong>
          <strong class="inline">Open <ChevronRight :size="16" aria-hidden="true" /></strong>
        </Link>
      </li>
    </ul>
  </section>

  <div class="halves">
    <section class="panel" aria-labelledby="per-month">
      <div class="panel-header">
        <h2 id="per-month">Orders per month</h2>
        <span class="muted">Last 6 months, without rejected and cancelled orders</span>
      </div>
      <!-- Every bar has its number and its month as text, so it reads without colour. -->
      <ol class="bars">
        <li v-for="month in stats.ordersPerMonth" :key="month.month">
          <strong>{{ month.count }}</strong>
          <span class="bar" :style="{ height: barHeight(month.count) }"></span>
          <span class="muted">
            {{ formatMonth(month.month) }}
            <span class="sr-only">: {{ countText(month.count, "order") }}</span>
          </span>
        </li>
      </ol>
    </section>

    <section class="panel" aria-labelledby="top-items">
      <div class="panel-header">
        <h2 id="top-items">Top items</h2>
        <Link href="/items" class="more">
          My items <ChevronRight :size="14" aria-hidden="true" />
        </Link>
      </div>
      <p v-if="stats.topItems.length === 0" class="panel-note muted">
        No accepted order yet. Your most ordered items show here.
      </p>
      <ul v-else class="rows">
        <li v-for="item in stats.topItems" :key="item.itemId">
          <Link :href="`/items/${item.itemId}/edit`">
            <ItemThumb :url="item.photoUrl" />
            <span class="two-lines grow">
              <strong>{{ item.itemName }}</strong>
              <small class="muted">{{ item.category }}</small>
            </span>
            <span class="muted">{{ countText(item.orderCount, "order") }}</span>
            <strong class="cell-money">{{ formatPrice(item.revenueCents) }}</strong>
          </Link>
        </li>
      </ul>
    </section>
  </div>
  </template>
</template>
