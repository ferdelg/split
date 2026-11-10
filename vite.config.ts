import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained dist/index.html: Flinsh serves the entrypoint file from the
// repo into a sandboxed iframe with connect-src 'none', so nothing may be split
// into separate chunks or fetched at runtime.
export default defineConfig({
  plugins: [preact(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: "es2020",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: false,
  },
});
