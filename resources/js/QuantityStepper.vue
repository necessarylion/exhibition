<script setup lang="ts">
import { Minus, Plus } from "@lucide/vue";
import { ref } from "vue";

const props = defineProps<{
  /** What the quantity is for, like the item name. Screen readers read it. */
  label: string;
  /** The stock. `null` means no limit. */
  max?: number | null;
  disabled?: boolean;
}>();
const quantity = defineModel<number>({ required: true });

const HIGHEST = 10_000;
/** Says why the typed number was changed, like "The most is 12." */
const note = ref("");

function highest(): number {
  return Math.min(props.max ?? HIGHEST, HIGHEST);
}

function set(value: number) {
  // A wrong or empty text goes back to a number that is allowed.
  const safe = Number.isFinite(value) ? Math.round(value) : 1;
  quantity.value = Math.max(1, Math.min(highest(), safe));
}

function typed(event: Event) {
  const input = event.target as HTMLInputElement;
  const asked = Number(input.value);
  set(asked);
  note.value = "";
  if (asked > highest()) {
    note.value = `The most is ${highest()}.`;
  } else if (asked < 1) {
    note.value = "The least is 1.";
  }
  // When the value did not change, Vue does not write it back. Do it here.
  input.value = String(quantity.value);
}
</script>

<template>
  <span class="stepper-box">
  <span class="stepper" role="group" :aria-label="`Quantity of ${label}`">
    <button
      type="button"
      :aria-label="`One less of ${label}`"
      :disabled="disabled || quantity <= 1"
      @click="set(quantity - 1)"
    >
      <Minus :size="14" aria-hidden="true" />
    </button>
    <input
      type="number"
      min="1"
      :max="highest()"
      step="1"
      :value="quantity"
      :disabled="disabled"
      :aria-label="`Quantity of ${label}`"
      @change="typed"
    />
    <button
      type="button"
      :aria-label="`One more of ${label}`"
      :disabled="disabled || quantity >= highest()"
      @click="set(quantity + 1)"
    >
      <Plus :size="14" aria-hidden="true" />
    </button>
  </span>
  <small v-if="note" class="muted" role="status">{{ note }}</small>
  </span>
</template>
