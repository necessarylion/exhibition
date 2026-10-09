<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import Layout from "../Layout.vue";
</script>

<template>
  <Head title="Page not found" />
  <Layout title="Page not found" subtitle="This page does not exist, or it was moved.">
    <div><Link href="/dashboard" class="button">Go to Home</Link></div>
  </Layout>
</template>
