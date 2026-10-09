<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import { ArrowLeft } from "@lucide/vue";
import AuthLayout from "../AuthLayout.vue";

// The app sends no email. So a new password comes from a person, not from a link.
</script>

<template>
  <Head title="Forgot password" />
  <AuthLayout
    title="Forgot your password?"
    subtitle="Ask the owner of your company to set a new password for you (Team → Reset password). If you are the owner, ask the platform admin."
  >
    <p>
      <Link href="/login" class="inline">
        <ArrowLeft :size="14" aria-hidden="true" /> Back to log in
      </Link>
    </p>
  </AuthLayout>
</template>
