import { router } from "@inertiajs/vue3";
import { nextTick, onBeforeUnmount, onMounted } from "vue";
import { ApiError } from "./api";
import { hideFlash } from "./flash";

const FALLBACK = "Something went wrong. Try again.";
let listening = false;
/** Errors that name no field, but are about one. The first name that is on the page is marked. */
const FIELDS_OF_CODE: Record<string, string[]> = {
  sku_taken: ["sku"],
  email_taken: ["email"],
  company_name_taken: ["companyName", "name"],
  group_name_taken: ["name"],
  wrong_password: ["currentPassword"],
  same_password: ["newPassword"],
};

/** A plain sentence for anything that was thrown. A code error never shows its own text. */
export function messageOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : FALLBACK;
}

/** Takes the marks of `showError` away from every field of the page. */
export function clearFieldErrors(): void {
  for (const field of document.querySelectorAll("[data-field-error]")) {
    unmark(field);
  }
}

function unmark(field: Element): void {
  const id = field.getAttribute("data-field-error") ?? "";
  document.getElementById(id)?.remove();
  field.removeAttribute("data-field-error");
  field.removeAttribute("aria-invalid");
  field.removeAttribute("aria-describedby");
}

/** A field loses its mark when the user changes it. */
function onInput(event: Event): void {
  const field = event.target as Element | null;
  if (field?.hasAttribute?.("data-field-error")) {
    unmark(field);
  }
}

function mark(field: HTMLElement, name: string, message: string): void {
  const note = document.createElement("small");
  note.id = `error-${name}`;
  note.className = "field-error";
  note.textContent = message;
  // Inside the label when there is one, so it sits right under the field.
  (field.closest("label") ?? field.parentElement)?.append(note);
  field.setAttribute("data-field-error", note.id);
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", note.id);
}

/**
 * Shows the error of a failed save and gives back the text for the summary.
 * When the API names the wrong fields (422 `details`), each field with that `name` is
 * marked, gets its message below it, and the first one gets the focus.
 * Else the summary message is moved into view.
 */
export function showError(caught: unknown): string {
  // A "Saved." of a moment ago must not stand next to the error of now.
  hideFlash();
  clearFieldErrors();
  if (!listening) {
    document.addEventListener("input", onInput);
    listening = true;
  }
  let first: HTMLElement | null = null;
  for (const detail of detailsOf(caught)) {
    const field = document.querySelector<HTMLElement>(`main [name="${CSS.escape(detail.path)}"]`);
    if (field && !field.hasAttribute("data-field-error")) {
      mark(field, detail.path, detail.message);
      first ??= field;
    }
  }
  if (first) {
    first.focus();
  } else {
    nextTick(revealAlert);
  }
  return messageOf(caught);
}

/** The wrong fields: the ones the API names, or the one that the error code is about. */
function detailsOf(caught: unknown): { path: string; message: string }[] {
  if (!(caught instanceof ApiError)) {
    return [];
  }
  if (caught.details.length > 0) {
    return caught.details;
  }
  for (const name of FIELDS_OF_CODE[caught.code] ?? []) {
    if (document.querySelector(`main [name="${name}"]`)) {
      return [{ path: name, message: caught.message }];
    }
  }
  return [];
}

function revealAlert(): void {
  document.querySelector("main [role=alert]")?.scrollIntoView({ block: "nearest" });
}

/** True for "not found", and for an id in the URL that is not an id at all (422). */
export function isMissing(caught: unknown): boolean {
  return caught instanceof ApiError && (caught.status === 404 || caught.status === 422);
}

/**
 * Asks before the user leaves a form with changes that are not saved: a menu link, Cancel,
 * the Back button of the app, a reload or a closed tab.
 * `isDirty` says if the form holds such changes now.
 */
export function useLeaveGuard(isDirty: () => boolean): void {
  let stop: (() => void) | undefined;

  function beforeVisit(): boolean {
    return !isDirty() || confirm("Leave this page? Your changes are not saved.");
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (isDirty()) {
      event.preventDefault();
    }
  }

  // True while this guard itself moves in the history. That move asks nothing.
  let returning = false;

  /**
   * The Back (or Forward) button of the browser. The URL has changed already when this
   * runs, so "stay" means: go back to the form. This listener runs before the one of
   * Inertia and stops it, so the form and its text are never taken off the page.
   */
  function onHistoryMove(event: Event) {
    if (returning) {
      returning = false;
      event.stopImmediatePropagation();
      return;
    }
    if (!isDirty()) {
      return;
    }
    if (confirm("Leave this page? Your changes are not saved.")) {
      return;
    }
    event.stopImmediatePropagation();
    returning = true;
    // ponytail: this takes the move for "Back", so it goes one step forward again. A form
    // is the newest page of its tab nearly always. Track the position if "Forward" matters.
    history.go(1);
  }

  function start() {
    stop = router.on("before", beforeVisit);
    window.addEventListener("beforeunload", beforeUnload);
    // `capture`: before the listener of Inertia.
    window.addEventListener("popstate", onHistoryMove, true);
  }

  function end() {
    stop?.();
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("popstate", onHistoryMove, true);
  }

  onMounted(start);
  onBeforeUnmount(end);
}
