import { copyFileSync } from "node:fs";

// GitHub Pages serves 404.html for direct navigation to client-side routes.
copyFileSync(new URL("../dist/index.html", import.meta.url), new URL("../dist/404.html", import.meta.url));
