/**
 * Build the status-UI frontend into the `public/` directory.
 *
 * There is no bundler (yet): the app is a Vue 3 + Vuetify 3 single-page app that
 * loads the libraries as global browser builds. "Building" therefore means
 * assembling everything the browser needs into `public/`:
 *
 *   public/index.html
 *   public/assets/app.js
 *   public/assets/vue.global.prod.js
 *   public/assets/vuetify.min.js
 *   public/assets/vuetify.min.css
 *
 * The HTML/app sources come from `src/web/`; the Vue/Vuetify browser builds are
 * copied from the installed packages in `node_modules` (resolved via the package
 * `main`/exports, so hoisting layout does not matter).
 *
 * The server serves this directory as-is and requires it to exist, so run
 * `npm run build:fe` before `npm start` (and the Docker image runs it at build
 * time).
 */

import { createRequire } from "node:module";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "src", "web");
const publicDir = join(root, "public");
const assetsDir = join(publicDir, "assets");

const vueDir = dirname(require.resolve("vue/package.json"));
const vuetifyDir = dirname(require.resolve("vuetify/package.json"));

/** [source, destination] pairs to copy into `public/`. */
const files = [
  [join(webDir, "index.html"), join(publicDir, "index.html")],
  [join(webDir, "app.js"), join(assetsDir, "app.js")],
  [
    join(vueDir, "dist", "vue.global.prod.js"),
    join(assetsDir, "vue.global.prod.js"),
  ],
  [
    join(vuetifyDir, "dist", "vuetify.min.js"),
    join(assetsDir, "vuetify.min.js"),
  ],
  [
    join(vuetifyDir, "dist", "vuetify.min.css"),
    join(assetsDir, "vuetify.min.css"),
  ],
];

// Start from a clean directory so removed assets do not linger.
await rm(publicDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

for (const [from, to] of files) {
  await cp(from, to);
}

console.log(
  `Built status-UI frontend into ${publicDir} (${files.length} files).`,
);
