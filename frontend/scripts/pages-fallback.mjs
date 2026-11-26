import { copyFileSync, mkdirSync } from "node:fs";

// GitHub Pages serves 404.html for direct navigation to client-side routes.
const index = new URL("../dist/index.html", import.meta.url);
copyFileSync(index, new URL("../dist/404.html", import.meta.url));
// The diagnostic route is a public entry point; give it a 200 response on Pages.
mkdirSync(new URL("../dist/network-test/", import.meta.url), { recursive: true });
copyFileSync(index, new URL("../dist/network-test/index.html", import.meta.url));
