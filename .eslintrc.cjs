export default {
  root: true,
  parserOptions: { ecmaVersion: "latest", sourceType: "module", project: false },
  env: { es2022: true, worker: true },
  extends: ["eslint:recommended"],
  rules: { "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }] }
};
