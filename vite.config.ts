import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Ship styles.css as a separate asset so consumers import it explicitly:
//   import "@livelayer/react/styles.css";
// Vite lib mode emits only modules reachable from `entry`, so we copy the
// stylesheet in a closeBundle hook rather than wiring it into the JS graph.
const copyStyles = () => ({
  name: "ll-copy-styles",
  closeBundle() {
    const src = resolve(__dirname, "src/styles.css");
    const dest = resolve(__dirname, "dist/styles.css");
    mkdirSync(resolve(__dirname, "dist"), { recursive: true });
    copyFileSync(src, dest);
  },
});

export default defineConfig({
  plugins: [
    dts({ rollupTypes: true }),
    copyStyles(),
  ],
  build: {
    lib: {
      entry: "src/index.ts",
      name: "LiveLayerReact",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.mjs" : "index.js"),
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@livelayer/sdk",
        "livekit-client",
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
        // Preserve "use client" so Next.js App Router consumers don't hit
        // server-side evaluation on this module. Rollup strips module-level
        // directives during tree-shake; banner puts it back on the bundle.
        banner: '"use client";',
      },
    },
  },
});
