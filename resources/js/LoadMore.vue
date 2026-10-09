<script setup lang="ts">
// The foot of a list that is not loaded in full: "Showing 100 of 2,400" and "Load more".
defineProps<{ shown: number; total: number; busy: boolean }>();
defineEmits<{ more: [] }>();
</script>

<template>
  <div v-if="shown < total" class="load-more">
    <span class="muted" role="status">
      Showing {{ shown.toLocaleString("en-US") }} of {{ total.toLocaleString("en-US") }}.
    </span>
    <button type="button" class="secondary" :disabled="busy" @click="$emit('more')">
      {{ busy ? "Loading…" : "Load more" }}
    </button>
  </div>
</template>
