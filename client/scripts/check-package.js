// Packs @hypercerts-org/api and installs the tarball, with @hypercerts-org/lexicon
// and @atproto/lex, into a consumer project outside the workspace, then checks
// it the way the SDK repository checks its packages: Node imports it, a
// TypeScript consumer typechecks, and Vite bundles it for the browser. This
// catches packaging errors (bad exports, missing files, workspace: specifiers)
// that the workspace hides. Needs network access for `pnpm install`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = readJson(path.join(clientRoot, "package.json"));
/** @param {string} name */
const pinned = (name) => {
  const version = packageJson.devDependencies?.[name];
  if (!version) throw new Error(`check-package: ${name} must be a devDependency`);
  return version.replace(/^file:/, `file:${clientRoot}/`);
};

// Child processes must not inherit the parent's npm and pnpm settings.
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
);

const work = mkdtempSync(path.join(tmpdir(), "hypercerts-api-consumer-"));
try {
  const tarball = packPackage(work);
  const consumer = createConsumer(work, tarball);
  checkNode(consumer);
  checkTypes(consumer);
  checkBrowserBuild(consumer);
  console.log("check-package: all consumer checks passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** @param {string} dest */
function packPackage(dest) {
  run("pnpm", ["pack", "--pack-destination", dest], clientRoot);
  const tarball = readdirSync(dest).find((file) => /^hypercerts-org-api-.*\.tgz$/.test(file));
  if (!tarball) throw new Error("check-package: no tarball produced for @hypercerts-org/api");

  const extracted = path.join(dest, "extracted");
  mkdirSync(extracted);
  run("tar", ["-xzf", path.join(dest, tarball), "-C", extracted], dest);
  const packedManifest = readFileSync(path.join(extracted, "package", "package.json"), "utf8");
  if (packedManifest.includes("workspace:")) {
    throw new Error("check-package: packed package still contains workspace: specifiers");
  }
  const licenses = readdirSync(path.join(extracted, "package")).filter((f) =>
    /^LICEN[CS]E/i.test(f),
  );
  if (licenses.join(",") !== "LICENSE-APACHE,LICENSE-MIT") {
    throw new Error(`check-package: expected LICENSE-APACHE and LICENSE-MIT, got ${licenses}`);
  }
  return path.join(dest, tarball);
}

/** @param {string} dir @param {string} tarball */
function createConsumer(dir, tarball) {
  const consumer = path.join(dir, "consumer");
  mkdirSync(path.join(consumer, "src"), { recursive: true });
  writeJson(path.join(consumer, "package.json"), {
    name: "consumer",
    private: true,
    type: "module",
    dependencies: {
      "@hypercerts-org/api": `file:${tarball}`,
      "@hypercerts-org/lexicon": pinned("@hypercerts-org/lexicon"),
      "@atproto/lex": pinned("@atproto/lex"),
    },
    devDependencies: { typescript: pinned("typescript"), vite: pinned("vite") },
  });
  writeJson(path.join(consumer, "tsconfig.json"), {
    compilerOptions: {
      target: "es2024",
      module: "nodenext",
      moduleResolution: "nodenext",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      lib: ["es2024", "dom"],
    },
    include: ["src"],
  });
  // --ignore-workspace keeps pnpm from treating the temp dir as part of this
  // repo. @atproto/lex depends on core-js, whose only install script prints a
  // banner; pnpm 11 and later fail on unapproved scripts unless told not to.
  run(
    "pnpm",
    ["install", "--ignore-workspace", "--no-frozen-lockfile", "--config.strict-dep-builds=false"],
    consumer,
  );
  return consumer;
}

/** @param {string} consumer */
function checkNode(consumer) {
  const script = `import { LEXICON_VERSION, org } from "@hypercerts-org/api";
import { org as records } from "@hypercerts-org/lexicon/records";
if (org.hypercerts.claim.getActivity.main.nsid !== "org.hypercerts.claim.getActivity") throw new Error("query");
if (org.hypercerts.claim.activity.main !== records.hypercerts.claim.activity.main) throw new Error("records are not shared");
if (LEXICON_VERSION !== ${JSON.stringify(packageJson.hypercerts.lexiconVersion)}) throw new Error("LEXICON_VERSION");`;
  run("node", ["--input-type=module", "-e", script], consumer);
  console.log("check-package: Node imports the package and shares record modules");
}

/** @param {string} consumer */
function checkTypes(consumer) {
  writeFileSync(
    path.join(consumer, "src", "types.ts"),
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
  run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], consumer);
  console.log("check-package: a TypeScript consumer typechecks against the declarations");
}

/** @param {string} consumer */
function checkBrowserBuild(consumer) {
  writeFileSync(
    path.join(consumer, "src", "main.ts"),
    `import { Client } from "@atproto/lex";
import { org } from "@hypercerts-org/api";
const api = new Client("https://api.example");
api.call(org.hypercerts.claim.getActivity, { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2abc" })
  .then(({ activity }) => console.log(activity.record.title), console.error);
`,
  );
  writeFileSync(
    path.join(consumer, "index.html"),
    '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n',
  );
  run("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], consumer);
  const assets = path.join(consumer, "dist", "assets");
  const bundle = readdirSync(assets)
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(path.join(assets, file), "utf8"))
    .join("\n");
  // The query and the record schema its view embeds are bundled; queries and
  // records it does not use are tree-shaken.
  for (const expected of ["org.hypercerts.claim.getActivity", "shortDescription"]) {
    if (!bundle.includes(expected)) throw new Error(`check-package: bundle lacks ${expected}`);
  }
  for (const unused of [
    "app.certified.graph.listActorFollowers",
    "org.hypercerts.funding.listReceipts",
  ]) {
    if (bundle.includes(unused)) throw new Error(`check-package: bundle includes ${unused}`);
  }
  const kib = Math.round(Buffer.byteLength(bundle) / 1024);
  console.log(
    `check-package: Vite bundles one query for the browser (${kib} KiB), unused ones left out`,
  );
}

/** @param {string} command @param {string[]} args @param {string} cwd */
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env: childEnv, stdio: "inherit", timeout: 300_000 });
}

/** @param {string} file */
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** @param {string} file @param {unknown} value */
function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
