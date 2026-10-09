import { createInertiaApp } from "@inertiajs/vue3";
import "./app.css";
import { resolvePage } from "./resolve-page";

createInertiaApp({ resolve: resolvePage });
