import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default [
  {
    input: "src/index.ts",
    output: {
      file: "dist/esm/index.js",
      format: "es",
      sourcemap: true,
    },
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false,
      }),
      typescript({
        tsconfig: "./tsconfig.json",
      }),
    ],
  },

  // ✅ IIFE build (for CDN / script tag)
  {
    input: "src/index.ts",
    output: {
      file: "dist/browser/kwespay.js",
      format: "iife",
      name: "KwesPay",
      sourcemap: true,
      inlineDynamicImports: true,
    },
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false,
      }),
      typescript({
        tsconfig: "./tsconfig.json",
      }),
    ],
  },
];
"module": "dist/esm/index.js"