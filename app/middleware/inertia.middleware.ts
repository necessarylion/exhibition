import { Edge } from "edge.js";
import type { Context, Next } from "hono";
import { singleton } from "tsyringe";
import { AppConfig } from "../config/app.config";
import {
  SSR_BUNDLE_PATH,
  VIEWS_DIR,
  VITE_ENTRY,
  VITE_MANIFEST_PATH,
} from "../constants/paths.constants";

interface InertiaPage {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string;
}

interface Assets {
  version: string;
  scripts: string[];
  styles: string[];
}

interface SsrResult {
  head: string[];
  body: string;
}

type SsrRender = (page: InertiaPage) => Promise<SsrResult>;

/**
 * A small Inertia adapter for Hono. It follows the Inertia protocol:
 * the first visit gets HTML, later visits (with the `X-Inertia` header) get JSON.
 */
@singleton()
export class InertiaMiddleware {
  private readonly edge: Edge;
  private assets?: Promise<Assets>;
  private ssrRender?: Promise<SsrRender>;

  constructor(private readonly config: AppConfig) {
    this.edge = Edge.create({ cache: config.isProduction });
    this.edge.mount(VIEWS_DIR);
  }

  async handle(c: Context, next: Next): Promise<Response | undefined> {
    const assets = await this.getAssets();
    const clientVersion = c.req.header("X-Inertia-Version");
    // The browser has old assets. Tell it to do a full page load.
    if (c.req.header("X-Inertia") && c.req.method === "GET" && clientVersion !== assets.version) {
      c.header("X-Inertia-Location", c.req.url);
      return c.body(null, 409);
    }
    await next();
    c.header("Vary", "X-Inertia");
  }

  /** Renders one page component. Pages get no data props; they call the JSON API. */
  async render(c: Context, component: string): Promise<Response> {
    const assets = await this.getAssets();
    const url = new URL(c.req.url);
    const page: InertiaPage = {
      component,
      props: { errors: {} },
      url: url.pathname + url.search,
      version: assets.version,
    };

    if (c.req.header("X-Inertia")) {
      c.header("X-Inertia", "true");
      return c.json(page);
    }

    const ssr = await this.renderOnServer(page);
    const html = await this.edge.render("app", {
      title: this.config.appName,
      head: ssr.head.join("\n"),
      body: ssr.body,
      scripts: assets.scripts,
      styles: assets.styles,
    });
    return c.html(html);
  }

  private async renderOnServer(page: InertiaPage): Promise<SsrResult> {
    if (this.config.inertiaSsr) {
      try {
        const render = await this.getSsrRender();
        return await render(page);
      } catch (error) {
        // SSR is an extra. When it fails, the browser renders the page.
        console.error("Inertia SSR failed. Falling back to client rendering.", error);
      }
    }
    // `<` is escaped so the JSON cannot close the script tag.
    const json = JSON.stringify(page).replace(/</g, "\\u003c");
    return {
      head: [],
      body: `<script data-page="app" type="application/json">${json}</script><div id="app"></div>`,
    };
  }

  private getSsrRender(): Promise<SsrRender> {
    this.ssrRender ??= this.loadSsrRender();
    return this.ssrRender;
  }

  private async loadSsrRender(): Promise<SsrRender> {
    const bundle = await import(SSR_BUNDLE_PATH);
    return bundle.default;
  }

  private getAssets(): Promise<Assets> {
    this.assets ??= this.loadAssets();
    return this.assets;
  }

  private async loadAssets(): Promise<Assets> {
    if (!this.config.isProduction) {
      const devServer = this.config.viteDevServerUrl;
      return {
        version: "dev",
        scripts: [`${devServer}/@vite/client`, `${devServer}/${VITE_ENTRY}`],
        styles: [],
      };
    }
    const text = await Bun.file(VITE_MANIFEST_PATH).text();
    const entry = JSON.parse(text)[VITE_ENTRY];
    const styles: string[] = [];
    for (const file of entry.css ?? []) {
      styles.push(`/${file}`);
    }
    return { version: Bun.hash(text).toString(36), scripts: [`/${entry.file}`], styles };
  }
}
