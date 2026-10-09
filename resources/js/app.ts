import { createInertiaApp } from "@inertiajs/vue3";
import "@fontsource-variable/manrope";
import "./app.css";
import { pageTitle, resolvePage } from "./resolve-page";

createInertiaApp({ resolve: resolvePage, title: pageTitle });
