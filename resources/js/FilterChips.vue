<script setup lang="ts">
// One filter with a few choices. A wide screen shows chips (or tabs with a count).
// A phone shows one select, because a row of chips does not fit there.
defineProps<{
  /** What the filter is for, like "Status". */
  label: string;
  /** `value` "" is the choice "all". */
  options: { value: string; label: string; count?: number }[];
  tabs?: boolean;
}>();
const chosen = defineModel<string>({ required: true });
</script>

<template>
  <div class="filter">
    <label>
      {{ label }}
      <select v-model="chosen">
        <option v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}{{ option.count === undefined ? "" : ` (${option.count})` }}
        </option>
      </select>
    </label>
    <span :class="tabs ? 'tabs' : 'chips'" role="group" :aria-label="label">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        :class="{ inline: tabs }"
        :aria-pressed="chosen === option.value"
        @click="chosen = option.value"
      >
        {{ option.label }}
        <span v-if="option.count !== undefined" class="count">{{ option.count }}</span>
      </button>
    </span>
  </div>
</template>
