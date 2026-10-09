import { ref } from "vue";
import { api } from "./api";

/** How many of my notifications are new. The sidebar shows it next to the bell. */
export const unreadCount = ref(0);

/** Asks the API. A failure keeps the old number: the count is not worth an error on the page. */
export async function refreshUnread(): Promise<void> {
  try {
    unreadCount.value = (await api.listNotifications({ limit: 1 })).unread;
  } catch {
    // Keep the old number.
  }
}
