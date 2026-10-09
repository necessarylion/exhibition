<script setup lang="ts">
import { X } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { flashMessage, hideFlash, isLaterPage, showKeptFlash } from "./flash";

defineProps<{ title: string; subtitle: string }>();

const heading = ref<HTMLElement | null>(null);

/** After a move inside the app the title gets the focus, so a screen reader reads the new page. */
function focusTitle() {
  if (isLaterPage()) {
    heading.value?.focus();
  }
  showKeptFlash();
}

onMounted(focusTitle);
</script>

<template>
  <div class="auth">
    <aside class="auth-brand">
      <span class="brand">Exhibition</span>
      <div>
        <p class="headline">Plan the booth. <br />Order the parts. <br />One place.</p>
        <p>
          Customers plan their exhibition. Suppliers provide the booth and the items. Everyone works
          in the same system.
        </p>
      </div>
      <small>No third party needed. Your data stays here.</small>
    </aside>
    <main class="auth-form">
      <div>
        <h1 ref="heading" tabindex="-1">{{ title }}</h1>
        <p class="muted">{{ subtitle }}</p>
      </div>
      <slot />
    </main>
    <!-- The message of the page before, like "You are logged out." -->
    <div class="toast" role="status">
      <template v-if="flashMessage">
        <span>{{ flashMessage }}</span>
        <button type="button" aria-label="Close the message" @click="hideFlash">
          <X :size="16" aria-hidden="true" />
        </button>
      </template>
    </div>
  </div>
</template>
