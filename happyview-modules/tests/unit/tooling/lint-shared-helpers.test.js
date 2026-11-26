import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkSharedHelpers } from "../../../tooling/lint-shared-helpers.js";

const registry = (overrides = {}) => ({
  families: [
    {
      id: "did-validation",
      description: "DID syntax check",
      owners: ["lua/shared/didValidation.lua"],
      names: ["valid_did"],
      lookalikes: ["^valid_[a-z_]*did$"],
      inline: [{ id: "did-pattern", pattern: "\\^did:\\(", description: "the DID pattern" }],
    },
    {
      id: "repeated-query-array",
      description: "array parsing",
      owners: [],
      unowned: "add a shared parser first",
      lookalikes: ["^([a-z_]+_)?array$"],
    },
  ],
  allowlist: [],
  ...overrides,
});

async function check(files, registryOverrides) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hypercerts-shared-helpers-"));
  try {
    await mkdir(path.join(root, "lua/shared"), { recursive: true });
    await mkdir(path.join(root, "lua/src"), { recursive: true });
    await mkdir(path.join(root, "lua/endpoints"), { recursive: true });
    for (const [file, source] of Object.entries(files)) {
      await writeFile(path.join(root, file), source);
    }
    return (await checkSharedHelpers({ root, registry: registry(registryOverrides) })).errors;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const owner = {
  "lua/shared/didValidation.lua": "local function valid_did(value)\n  return true\nend\n",
};

test("passes when only the owner defines the helper", async () => {
  assert.deepEqual(await check(owner), []);
});

test("flags a redefinition outside the owner and says how to fix or allowlist it", async () => {
  const [error, ...rest] = await check({
    ...owner,
    "lua/src/getThing.lua": "local function valid_did(value)\n  return false\nend\n",
  });
  assert.equal(rest.length, 0);
  assert.match(error, /^lua\/src\/getThing\.lua:1: defines "valid_did"/);
  assert.match(error, /lua\/shared\/didValidation\.lua/);
  assert.match(error, /sharedSourcePaths/);
  assert.match(error, /"allowlist" in tooling\/shared-helpers\.registry\.json/);
  assert.match(error, /"reason":"<why this copy must stay>"/);
});

test("flags lookalike names and inline re-implementations", async () => {
  const errors = await check({
    ...owner,
    "lua/src/getThing.lua":
      'local function valid_actor_did(v)\n  return v:match("^did:([a-z]+):(.+)$")\nend\n',
  });
  assert.equal(errors.length, 2);
  assert.match(
    errors.find((e) => e.includes(":1:")),
    /looks like a new copy/,
  );
  assert.match(
    errors.find((e) => e.includes(":2:")),
    /re-implements the DID pattern inline/,
  );
});

test("ignores commented code and generated endpoint bundles", async () => {
  assert.deepEqual(
    await check({
      ...owner,
      "lua/src/getThing.lua": "-- local function valid_did(value)\nlocal x = 1 -- ^did:(\n",
      "lua/endpoints/getThing.lua": "local function valid_did(value)\nend\n",
    }),
    [],
  );
});

test("unowned families tell the author to add a shared helper first", async () => {
  const [error] = await check({
    ...owner,
    "lua/src/listThings.lua": "local function array(params, key)\nend\n",
  });
  assert.match(error, /No shared helper exists yet \(add a shared parser first\)/);
});

test("an allowlist entry silences exactly its file, family and symbol", async () => {
  const files = {
    ...owner,
    "lua/src/a.lua": "local function valid_did(v)\nend\n",
    "lua/src/b.lua": "local function valid_did(v)\nend\n",
  };
  const errors = await check(files, {
    allowlist: [
      { file: "lua/src/a.lua", family: "did-validation", symbol: "valid_did", reason: "kept" },
    ],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^lua\/src\/b\.lua/);
});

test("a stale allowlist entry fails so the list cannot rot", async () => {
  const [error] = await check(owner, {
    allowlist: [
      { file: "lua/src/gone.lua", family: "did-validation", symbol: "valid_did", reason: "kept" },
    ],
  });
  assert.match(error, /matches nothing.*delete the entry/);
});

test("rejects allowlist entries without a reason and owners that do not define the name", async () => {
  await assert.rejects(
    check(owner, { allowlist: [{ file: "x", family: "y", symbol: "z", reason: " " }] }),
    /needs a nonempty "reason"/,
  );
  const errors = await check({ "lua/shared/didValidation.lua": "local x = 1\n" });
  assert.match(errors[0], /protects "valid_did" but no owner file defines it/);
});
