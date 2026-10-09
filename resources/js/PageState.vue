<script setup lang="ts">
// The states of a list or a detail page, the same on every page:
// loading, could not load (with "Try again"), empty, and "nothing matches the filter".
// The default slot shows when none of them is true.
defineProps<{
  loading: boolean;
  /** The message of a failed load. "" when the load worked. */
  error?: string;
  /** True when there is nothing at all. The `empty` slot says what to do next. */
  empty?: boolean;
  /** True when there are rows, but the search or the filter hides them all. */
  noMatch?: boolean;
  /** Inside a panel the state has no box of its own. */
  plain?: boolean;
}>();
defineEmits<{ retry: []; reset: [] }>();
</script>

<template>
  <p v-if="loading" class="muted" role="status">Loading…</p>
  <div v-else-if="error" class="state" :class="{ plain }">
    <p class="error" role="alert">{{ error }}</p>
    <button type="button" class="secondary" @click="$emit('retry')">Try again</button>
  </div>
  <div v-else-if="empty" class="state" :class="{ plain }"><slot name="empty" /></div>
  <p v-else-if="noMatch" class="state" :class="{ plain }">
    <span>
      <slot name="no-match">Nothing matches your search or filter.</slot>
      {{ " " }}
      <button type="button" class="link" @click="$emit('reset')">Show all</button>
    </span>
  </p>
  <slot v-else />
</template>
