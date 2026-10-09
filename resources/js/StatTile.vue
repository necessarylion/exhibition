<script setup lang="ts">
import type { Component } from "vue";

// One number of the home page, like "Orders waiting 4".
defineProps<{ label: string; value: string | number; note: string; icon: Component }>();
</script>

<template>
  <div class="stat">
    <span class="label-row">
      {{ label }}
      <component :is="icon" class="stat-icon" :size="18" aria-hidden="true" />
    </span>
    <strong>{{ value }}</strong>
    <small>{{ note }}</small>
  </div>
</template>
