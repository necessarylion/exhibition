<script setup lang="ts">
import { Search } from "@lucide/vue";

defineProps<{ label: string }>();
const text = defineModel<string>({ required: true });
</script>

<template>
  <label class="search">
    <Search :size="16" aria-hidden="true" />
    <input v-model="text" type="search" :placeholder="label" :aria-label="label" />
  </label>
</template>
