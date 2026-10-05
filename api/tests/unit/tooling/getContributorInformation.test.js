import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative) => readFile(path.resolve(root, relative), 'utf8');

test('getContributorInformation preserves the exact record and hydrates its publisher sidecars', async () => {
  const sources = await Promise.all([
    read('lua/shared/query.lua'),
    read('lua/shared/recordIdentifier.lua'),
    read('lua/shared/recordView.lua'),
    read('lua/shared/actorView.lua'),
    read('lua/src/getContributorInformation.lua'),
  ]);
  const program = `JSON_NULL = {}
json = { decode = function(value)
  if value == "null" then return JSON_NULL end
  error("unexpected JSON decode before test fixtures")
end }
${sources.join('\n\n')}

local null = JSON_NULL
local decoded = {
  original = { ["$type"] = "org.hypercerts.claim.contributorInformation", identifier = "manual:ada", displayName = "Ada", image = { ref = "blob" }, extension = "preserved" },
  profile = { ["$type"] = "app.certified.actor.profile", displayName = "Publisher" },
}
json = { decode = function(value)
  if value == "null" then return null end
  assert(decoded[value], "unexpected JSON fixture: " .. tostring(value))
  return decoded[value]
end }

local uri = "at://did:plc:publisher/org.hypercerts.claim.contributorInformation/tid"
local recordRow = { uri = uri, did = "did:plc:publisher", cid = "bafyreirecord", indexed_at = "2026-01-02T03:04:05Z", record = "original" }
local profileRow = { uri = "at://did:plc:publisher/app.certified.actor.profile/self", did = "did:plc:publisher", cid = "bafyreiprofile", indexed_at = nil, record = "profile" }
local calls = {}
local record_missing = false
local fail_profile_lookup = false
db = {
  backend = function() return "postgres" end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    if values[1] == "org.hypercerts.claim.contributorInformation" then
      if record_missing then return {} end
      return { recordRow }
    end
    if values[1] == "app.certified.actor.profile" then
      if fail_profile_lookup then error("database unavailable") end
      return { profileRow }
    end
    if values[1] == "app.certified.actor.organization" then return {} end
    error("unexpected query collection: " .. tostring(values[1]))
  end,
}
params = { uri = uri }
local result = handle()
local view = result.contributorInformation
assert(view.uri == uri and view.cid == "bafyreirecord" and view.did == "did:plc:publisher")
assert(view.record["$type"] == "org.hypercerts.claim.contributorInformation")
assert(view.record.identifier == "manual:ada" and view.record.displayName == "Ada")
assert(view.record.image.ref == "blob" and view.record.extension == "preserved")
assert(view.author.did == "did:plc:publisher")
assert(view.author.profile.record.displayName == "Publisher")
assert(view.author.profile.indexedAt == JSON_NULL, "a missing profile indexed_at must serialize as JSON null")
assert(view.author.organization == null)
assert(#calls == 3)
assert(calls[1].sql:find("collection = %$1 AND uri = %$2", 1) ~= nil)
assert(calls[1].values[1] == "org.hypercerts.claim.contributorInformation" and calls[1].values[2] == uri)
local bad_uri_ok, bad_uri_error = pcall(function()
  params = { uri = "at://did:plc:publisher%GG/org.hypercerts.claim.contributorInformation/tid" }
  return handle()
end)
assert(not bad_uri_ok and tostring(bad_uri_error):find("InvalidRequest:", 1, true) ~= nil)
assert(#calls == 3, "invalid DID authority must be rejected before querying")
recordRow.indexed_at = nil
params = { uri = uri }
local null_timestamp = handle().contributorInformation.indexedAt
assert(null_timestamp == JSON_NULL, "a missing indexed_at must serialize as JSON null")
record_missing = true
local missing_ok, missing_error = pcall(function() return handle() end)
assert(not missing_ok and tostring(missing_error):find("RecordNotFound:", 1, true) ~= nil)
record_missing = false
fail_profile_lookup = true
local lookup_ok, lookup_error = pcall(function() return handle() end)
assert(not lookup_ok and tostring(lookup_error):find("ContributorInformationQueryFailed:", 1, true) ~= nil)
`;
  const result = spawnSync('lua', ['-e', program], { encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
