import type { DefineComponent } from "vue";

// ponytail: all pages are loaded at once. Remove `eager` to split them when there are many.
const pages = import.meta.glob<DefineComponent>("./pages/*.vue", {
  eager: true,
  import: "default",
});

export function resolvePage(name: string): DefineComponent {
  const page = pages[`./pages/${name}.vue`];
  if (!page) {
    throw new Error(`Page not found: ${name}`);
  }
  return page;
}
