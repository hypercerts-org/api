import assert from "node:assert/strict";
import test from "node:test";
import { applyAssets } from "../../../tooling/installer.js";

const profileHandlerId = "xrpc.query:app.certified.actor.getProfile";

// The admin client has no script-variable methods: any attempt to inspect or create the handle
// resolver setting would throw, so a passing install proves it does not touch the setting.
test("profile install needs no resolver setting and writes the handler even when one is set in the environment", async () => {
  const writes = [];
  const result = await applyAssets(
    [
      {
        id: profileHandlerId,
        kind: "script",
        config: { script_type: "lua" },
        body: "handler",
      },
    ],
    {
      async read() {
        return null;
      },
      async write(asset) {
        writes.push(asset.id);
      },
    },
    {
      env: { HYPERCERTS_HANDLE_RESOLVER_URL: "not a url" },
      isTTY: false,
    },
  );

  assert.deepEqual(writes, [profileHandlerId]);
  assert.deepEqual(result.changed, [profileHandlerId]);
});
