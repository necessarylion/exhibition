<script setup lang="ts">
import { Head, router } from "@inertiajs/vue3";
import {
  Ban,
  Bell,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  CircleX,
  PackageCheck,
} from "@lucide/vue";
import { type Component, computed, onMounted } from "vue";
import { api, type Notification, type PageQuery } from "../api";
import { timeAgo } from "../dates";
import { flashNow } from "../flash";
import { messageOf } from "../form-errors";
import Layout from "../Layout.vue";
import LoadMore from "../LoadMore.vue";
import { useList } from "../list";
import PageState from "../PageState.vue";
import { refreshUnread, unreadCount } from "../unread";

const {
  rows: notifications,
  total,
  loading,
  loadingMore,
  error,
  failed,
  load,
  loadMore,
} = useList(fetchNotifications);

const subtitle = computed(buildSubtitle);

function fetchNotifications(page: PageQuery) {
  return api.listNotifications(page);
}

function buildSubtitle(): string {
  if (!loading.value && total.value === 0) {
    return "Messages about your orders and your company show up here.";
  }
  return unreadCount.value > 0
    ? `${unreadCount.value} new. Open one to see what it is about.`
    : "Nothing new. Open one to see what it is about.";
}

// ponytail: a notification has only a text, so the icon is picked by a word of the text.
// Store a kind on the row if the texts ever get translated.
const ICONS: [string, Component][] = [
  [" accepted ", CircleCheck],
  [" rejected ", CircleX],
  [" cancelled ", Ban],
  [" completed ", PackageCheck],
  [" approved", CircleCheck],
];

function iconOf(notification: Notification): Component {
  for (const [word, icon] of ICONS) {
    if (notification.text.includes(word)) {
      return icon;
    }
  }
  return Bell;
}

/** Marks it as read and opens its page. The page opens also when the mark fails. */
async function open(notification: Notification) {
  if (!notification.readAt) {
    try {
      await api.readNotification(notification.id);
    } catch {
      // It stays new. The user still gets to the page.
    }
  }
  router.visit(notification.link);
}

async function readAll() {
  error.value = "";
  try {
    await api.readAllNotifications();
    await Promise.all([load(), refreshUnread()]);
    flashNow("All notifications are marked as read.");
  } catch (caught) {
    error.value = messageOf(caught);
  }
}

onMounted(load);
</script>

<template>
  <Head title="Notifications" />
  <Layout title="Notifications" :subtitle="subtitle">
    <template #actions>
      <button v-if="unreadCount > 0" type="button" @click="readAll">
        <CheckCheck :size="16" aria-hidden="true" /> Mark all as read
      </button>
    </template>

    <template #default>
      <p v-if="error && !failed" class="error" role="alert">{{ error }}</p>
      <PageState
        :loading="loading"
        :error="failed ? error : ''"
        :empty="notifications.length === 0"
        @retry="load"
      >
        <template #empty>
          <strong>No notifications yet</strong>
          <span>You get one when something happens with your orders.</span>
        </template>
        <section class="panel" aria-label="Notifications">
          <ul class="notification-list">
            <li v-for="notification in notifications" :key="notification.id">
              <button
                type="button"
                class="notification-row"
                :class="{ 'is-new': !notification.readAt }"
                @click="open(notification)"
              >
                <span :class="{ dot: !notification.readAt }" aria-hidden="true"></span>
                <component :is="iconOf(notification)" :size="18" aria-hidden="true" />
                <span class="two-lines">
                  <span class="text">{{ notification.text }}</span>
                  <small class="muted">{{ timeAgo(notification.createdAt) }}</small>
                </span>
                <span v-if="!notification.readAt" class="badge new">New</span>
                <span v-else></span>
                <ChevronRight :size="16" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </section>
        <small class="muted">Notifications older than 90 days are removed.</small>
      </PageState>
      <LoadMore
        :shown="notifications.length"
        :total="total"
        :busy="loadingMore"
        @more="loadMore"
      />
    </template>
  </Layout>
</template>
