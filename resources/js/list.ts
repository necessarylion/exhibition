import { onBeforeUnmount, onMounted, type Ref, ref, type WatchSource, watch } from "vue";
import type { Page, PageQuery } from "./api";
import { messageOf } from "./form-errors";

/** How many rows a list page asks for in one call. "Load more" asks for the next ones. */
export const PAGE_SIZE = 100;
/** The list waits this long after the last key before it asks the API. */
const TYPING_MS = 250;

type FetchPage<T> = (page: PageQuery) => Promise<Page<T>>;

/**
 * Every row of a list that is short by its nature, like the users of one company.
 * Never use it for a list that can grow without end: use `useList` there.
 */
// ponytail: it asks call after call until the list ends. Fine for a few hundred rows.
export async function fetchAll<T>(fetchPage: FetchPage<T>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await fetchPage({ limit: 200, offset: rows.length });
    rows.push(...page.rows);
    if (page.rows.length === 0 || rows.length >= page.total) {
      return rows;
    }
  }
}

/**
 * The state of a list page. The search and the filters run in the API, so the rows, the
 * count and the money total are right for a list of any size.
 *
 * `fetchPage` builds the call: it adds the search text and the filters of the page to the
 * `limit` and `offset` it gets. `filters` are the values it reads: when one of them changes,
 * the list loads again from the start.
 */
export function useList<T>(fetchPage: FetchPage<T>, filters: WatchSource[] = []) {
  const rows = ref([]) as Ref<T[]>;
  /** How many rows match the search and the filters. */
  const total = ref(0);
  /** More numbers of the whole list, like the rows per status. */
  const counts = ref<Record<string, number>>({});
  /** True until the first answer is there. */
  const loading = ref(true);
  const loadingMore = ref(false);
  const error = ref("");
  /** True when the list itself could not be loaded. The page then shows "Try again". */
  const failed = ref(false);
  // Each load gets a number. An answer of an older load is thrown away, so a slow answer
  // never puts old rows under a newer filter.
  let turn = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Loads the list from the start. */
  async function load() {
    const mine = ++turn;
    error.value = "";
    try {
      const page = await fetchPage({ limit: PAGE_SIZE, offset: 0 });
      if (mine !== turn) {
        return;
      }
      rows.value = page.rows;
      total.value = page.total;
      counts.value = page.counts;
      failed.value = false;
    } catch (caught) {
      if (mine !== turn) {
        return;
      }
      error.value = messageOf(caught);
      failed.value = true;
    } finally {
      if (mine === turn) {
        loading.value = false;
      }
    }
  }

  async function loadMore() {
    const mine = turn;
    error.value = "";
    loadingMore.value = true;
    try {
      const page = await fetchPage({ limit: PAGE_SIZE, offset: rows.value.length });
      if (mine === turn) {
        rows.value.push(...page.rows);
        total.value = page.total;
        counts.value = page.counts;
      }
    } catch (caught) {
      error.value = messageOf(caught);
    } finally {
      loadingMore.value = false;
    }
  }

  /** A filter changed. The list waits a moment, so typing does not ask for every key. */
  function loadSoon() {
    clearTimeout(timer);
    timer = setTimeout(load, TYPING_MS);
  }

  function stop() {
    clearTimeout(timer);
  }

  if (filters.length > 0) {
    watch(filters, loadSoon);
  }
  onBeforeUnmount(stop);

  return { rows, total, counts, loading, loadingMore, error, failed, load, loadMore };
}

/**
 * A search text or a filter that is kept in the URL (`?status=done`), so a reload and the
 * Back button keep it. It starts as `fallback` and reads the URL when the page is mounted.
 * With `allowed`, a value of the URL that is not in the list counts as `fallback`.
 */
export function useUrlParam<T extends string>(
  name: string,
  fallback: T,
  allowed?: readonly string[],
): Ref<T> {
  const value = ref(fallback) as Ref<T>;

  function read() {
    const found = new URLSearchParams(window.location.search).get(name);
    if (found !== null && (!allowed || allowed.includes(found))) {
      value.value = found as T;
    }
    watch(value, write);
  }

  function write() {
    const url = new URL(window.location.href);
    if (value.value === fallback) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value.value);
    }
    // The state of the history entry stays as it is. Only its URL changes.
    window.history.replaceState(window.history.state, "", url);
  }

  onMounted(read);
  return value;
}
