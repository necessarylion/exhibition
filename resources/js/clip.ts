import type { ObjectDirective } from "vue";

function setTitle(cell: HTMLElement): void {
  cell.classList.add("clip");
  const text = cell.innerText.trim().replace(/\s*\n\s*/g, " · ");
  if (cell.title !== text) {
    cell.title = text;
  }
}

/**
 * `v-clip` on a table cell with free text: the text stays on one line and is cut with "…"
 * (class `clip` in app.css). The whole text is in `title`, so a hover shows it.
 */
export const vClip: ObjectDirective<HTMLElement> = {
  mounted: setTitle,
  updated: setTitle,
  getSSRProps: ssrProps,
};

function ssrProps() {
  return { class: "clip" };
}
