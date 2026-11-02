import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-console": "error",
      "no-implicit-coercion": "error",
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "node:child_process",
            importNames: ["exec", "execSync"],
            message: "Use spawn or spawnSync with an argument array instead of shell-based command execution.",
          },
          {
            name: "child_process",
            importNames: ["exec", "execSync"],
            message: "Use spawn or spawnSync with an argument array instead of shell-based command execution.",
          },
        ],
      }],
      "no-restricted-properties": ["error", {
        object: "process",
        property: "exit",
        message: "Set process.exitCode so pending cleanup and asynchronous work can finish.",
      }],
      "no-restricted-syntax": ["error",
        {
          selector: "CallExpression[callee.name=/^(spawn|spawnSync)$/] > ObjectExpression.arguments > Property[key.name='shell'][value.value=true]",
          message: "Do not enable shell execution for subprocess calls; pass an executable and argument array.",
        },
        {
          selector: "CallExpression[callee.name=/^(spawn|spawnSync)$/] > ObjectExpression.arguments > Property[key.value='shell'][value.value=true]",
          message: "Do not enable shell execution for subprocess calls; pass an executable and argument array.",
        },
        {
          selector: "CallExpression[callee.property.name=/^(spawn|spawnSync)$/] > ObjectExpression.arguments > Property[key.name='shell'][value.value=true]",
          message: "Do not enable shell execution for subprocess calls; pass an executable and argument array.",
        },
        {
          selector: "CallExpression[callee.property.name=/^(spawn|spawnSync)$/] > ObjectExpression.arguments > Property[key.value='shell'][value.value=true]",
          message: "Do not enable shell execution for subprocess calls; pass an executable and argument array.",
        },
      ],
      "no-param-reassign": ["error", { props: true }],
      "no-shadow": "error",
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },
  {
    files: ["tooling/installer.js", "tooling/seed.js", "tooling/lint-lua.js"],
    rules: {
      "no-console": "off",
    },
  },
];
