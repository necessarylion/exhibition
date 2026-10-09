import { createInertiaApp } from "@inertiajs/vue3";
import { renderToString } from "vue/server-renderer";
import { resolvePage } from "./resolve-page";

type Page = Parameters<RenderPage>[0];
type RenderPage = Extract<
  Awaited<ReturnType<typeof createInertiaApp>>,
  (...args: never[]) => unknown
>;

// On the server, `createInertiaApp` returns a render function.
const renderPage = (await createInertiaApp({ resolve: resolvePage })) as RenderPage;

/** Called by the Inertia middleware when `INERTIA_SSR=true`. */
export default function render(page: Page) {
  return renderPage(page, renderToString);
}
