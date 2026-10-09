<script setup lang="ts">
import { Package } from "@lucide/vue";

defineProps<{ url: string | null }>();
</script>

<template>
  <img v-if="url" class="thumb" :src="url" alt="" />
  <span v-else class="thumb"><Package :size="20" aria-hidden="true" /></span>
</template>
