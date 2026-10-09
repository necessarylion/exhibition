<script setup lang="ts">
// Every password field of the app: the text is hidden, and an eye button shows it.
import { Eye, EyeOff } from "@lucide/vue";
import { ref } from "vue";

defineProps<{
  name: string;
  /** What the browser may fill in: `current-password`, `new-password` or `off`. */
  autocomplete: string;
  placeholder?: string;
  minlength?: number;
  required?: boolean;
}>();
const password = defineModel<string>({ required: true });
const visible = ref(false);
</script>

<template>
  <span class="locked">
    <input
      v-model="password"
      :name="name"
      :type="visible ? 'text' : 'password'"
      :autocomplete="autocomplete"
      :placeholder="placeholder"
      :minlength="minlength"
      :required="required"
    />
    <button
      type="button"
      class="ghost icon"
      :aria-label="visible ? 'Hide the password' : 'Show the password'"
      :aria-pressed="visible"
      @click="visible = !visible"
    >
      <component :is="visible ? EyeOff : Eye" :size="16" aria-hidden="true" />
    </button>
  </span>
</template>
