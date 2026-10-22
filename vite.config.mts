import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Ship styles.css as a separate asset so consumers import it explicitly:
//   import "@livelayer/react/styles.css";
// Vite lib mode emits only modules reachable from `entry`, so we copy the
// stylesheet in a closeBundle hook rather than wiring it into the JS graph.
const copyStyles = () => ({
  name: "ll-copy-styles",
  closeBundle() {
    mkdirSync(`${root}dist`, { recursive: true });
    copyFileSync(`${root}src/styles.css`, `${root}dist/styles.css`);
  },
});

export default defineConfig({
  plugins: [
    // bundleTypes rolls the declarations into one dist/index.d.ts through
    // @microsoft/api-extractor (vite-plugin-dts 5 renamed rollupTypes).
    dts({ bundleTypes: true }),
    copyStyles(),
  ],
  build: {
    lib: {
      entry: "src/index.ts",
      name: "LiveLayerReact",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.mjs" : "index.js"),
    },
    rolldownOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@livelayer/sdk",
        "livekit-client",
      ],
      // The bundler drops module-level "use client" directives and warns
      // once per file that has one. The banner below restores the
      // directive on the bundle, so those warnings are expected noise.
      onwarn(warning, defaultHandler) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes('"use client"')
        ) {
          return;
        }
        defaultHandler(warning);
      },
      output: {
        // Preserve "use client" so Next.js App Router consumers don't hit
        // server-side evaluation on this module. The bundler strips
        // module-level directives; the banner puts it back on the bundle.
        banner: '"use client";',
        // Rolldown's default ('auto') keeps only directives already in the
        // source, so the CJS bundle lost the "use strict" Rollup used to add.
        strict: true,
      },
    },
  },
});
