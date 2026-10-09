import { ref } from "vue";

const KEY = "flash_message";
const SHOW_MS = 6000;

/** The message that `Layout.vue` shows in its status region. "" means none. */
export const flashMessage = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;

export function hideFlash(): void {
  clearTimeout(timer);
  flashMessage.value = "";
}

/** Shows a message on this page now, like "Saved." */
export function flashNow(text: string): void {
  clearTimeout(timer);
  flashMessage.value = text;
  timer = setTimeout(hideFlash, SHOW_MS);
}

/**
 * Keeps a message for the next page, like "Item saved." before the move to the list.
 * The browser can block the storage (private window). Then the message is lost, nothing more.
 */
export function flashLater(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // No message this time.
  }
}

/** Called by the layout of each new page: shows the kept message once. */
export function showKeptFlash(): void {
  try {
    const text = sessionStorage.getItem(KEY);
    if (text) {
      sessionStorage.removeItem(KEY);
      flashNow(text);
    }
  } catch {
    // Nothing was kept.
  }
}

let pagesShown = 0;

/** True from the second page on. The first page comes from a full load of the browser. */
export function isLaterPage(): boolean {
  pagesShown += 1;
  return pagesShown > 1;
}
