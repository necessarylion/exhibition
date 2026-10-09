<script setup lang="ts">
import { STATUS_CLASSES, STATUS_LABELS, type Status } from "./status";

defineProps<{ status: Status }>();
</script>

<template>
  <span class="badge" :class="STATUS_CLASSES[status]">{{ STATUS_LABELS[status] }}</span>
</template>
