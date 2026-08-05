import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import esbuild from "rollup-plugin-esbuild";

// @mysten/sui and @stellar/stellar-sdk are regular dependencies — installing
// @kwespay/client pulls them in automatically, so EVM, Sui, and Stellar all
// work out of the box. They're kept external from these bundles purely to
// avoid inlining two large SDKs into every consumer's bundle; ESM/CJS
// consumers resolve them from node_modules as usual.
const SUI_EXTERNALS = ["@mysten/sui", "@mysten/sui/transactions"];
const STELLAR_EXTERNALS = ["@stellar/stellar-sdk"];
const CHAIN_SDK_EXTERNALS = [...SUI_EXTERNALS, ...STELLAR_EXTERNALS];

const plugins = [
  resolve({
    browser: true,
    preferBuiltins: false,
    extensions: [".js", ".ts"],
  }),

  commonjs(),

  esbuild({
    target: "es2020",
    sourceMap: true,
    loaders: { ".ts": "ts" },
  }),
];

export default [

  {
    input: "src/index.ts",

    external: CHAIN_SDK_EXTERNALS,

    output: {
      file: "dist/esm/index.js",
      format: "es",
      sourcemap: true,
      inlineDynamicImports: true,
    },

    plugins,
  },

  // ── IIFE (browser CDN / script tag) ──────────────────────────────────────
  // Sui and Stellar are excluded here too — a CDN consumer that needs Sui or
  // Stellar support must load the relevant SDK separately and pass the wallet
  // adapter in manually.
  {
    input: "src/index.ts",

    external: CHAIN_SDK_EXTERNALS,

    output: {
      file: "dist/browser/kwespay.js",
      format: "iife",
      name: "KwesPay",
      sourcemap: true,
      inlineDynamicImports: true,
      // Teach Rollup what the global names are for the externals so the IIFE
      // can reference them if ever a Sui/Stellar import leaks through.
      globals: {
        "@mysten/sui": "MystenSui",
        "@mysten/sui/transactions": "MystenSuiTransactions",
        "@stellar/stellar-sdk": "StellarSdk",
      },
    },

    plugins,
  },
];
