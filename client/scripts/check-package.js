// Checks the packed package the way a consumer installs it: `pnpm pack`
// (which builds), then install the tarball with @hypercerts-org/lexicon and
// @atproto/lex in an empty project outside this repository, import it in
// Node and typecheck a TypeScript consumer. Needs network access for
// `npm install`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(clientRoot, "package.json"), "utf8"));
const require = createRequire(path.join(clientRoot, "package.json"));
const lexVersion = packageJson.devDependencies["@atproto/lex"];
const typescriptVersion = JSON.parse(
  readFileSync(require.resolve("typescript/package.json"), "utf8"),
).version;
// The lexicon dependency as declared: a version, or a tarball path until
// @hypercerts-org/lexicon/records is on npm.
const lexiconSpec = packageJson.devDependencies["@hypercerts-org/lexicon"].replace(
  /^file:/,
  `${clientRoot}/`,
);

// Child processes must not inherit the parent's npm and pnpm settings.
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
);

/** @param {string} command @param {string[]} args @param {string} cwd */
const run = (command, args, cwd, timeout = 300_000) =>
  execFileSync(command, args, { cwd, env: childEnv, encoding: "utf8", stdio: "pipe", timeout });

const workDir = mkdtempSync(path.join(tmpdir(), "hypercerts-api-package-"));
try {
  run("pnpm", ["pack", "--pack-destination", workDir], clientRoot);
  const tarball = path.join(workDir, `hypercerts-org-api-${packageJson.version}.tgz`);
  const consumerDir = path.join(workDir, "consumer");
  mkdirSync(consumerDir);
  writeFileSync(
    path.join(consumerDir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  run(
    "npm",
    [
      "install",
      "--silent",
      "--no-audit",
      "--no-fund",
      tarball,
      lexiconSpec,
      `@atproto/lex@${lexVersion}`,
      `typescript@${typescriptVersion}`,
    ],
    consumerDir,
  );

  writeFileSync(
    path.join(consumerDir, "runtime.js"),
    `import { LEXICON_VERSION, org } from "@hypercerts-org/api";
import { org as records } from "@hypercerts-org/lexicon/records";
if (org.hypercerts.claim.getActivity.main.nsid !== "org.hypercerts.claim.getActivity") throw new Error("query");
if (org.hypercerts.claim.activity.main !== records.hypercerts.claim.activity.main) throw new Error("records are not shared");
if (LEXICON_VERSION !== ${JSON.stringify(packageJson.hypercerts.lexiconVersion)}) throw new Error("LEXICON_VERSION");
`,
  );
  run("node", ["runtime.js"], consumerDir, 120_000);
  console.log("✅ The packed package imports in Node (ESM) and shares record modules");

  writeFileSync(
    path.join(consumerDir, "types.ts"),
    `import { Client } from "@atproto/lex";
import { org } from "@hypercerts-org/api";
import { org as records } from "@hypercerts-org/lexicon/records";
const api = new Client("https://api.example");
const uri = "at://did:plc:abc123/org.hypercerts.claim.activity/3k2abc" as const;
export async function record(): Promise<records.hypercerts.claim.activity.Main> {
  const { activity } = await api.call(org.hypercerts.claim.getActivity, { uri });
  return activity.record;
}
// @ts-expect-error uri is required
export const missing = () => api.call(org.hypercerts.claim.getActivity, {});
`,
  );
  run(
    path.join(consumerDir, "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--target",
      "es2022",
      "types.ts",
    ],
    consumerDir,
    120_000,
  );
  console.log("✅ A TypeScript consumer typechecks against the installed declarations");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
