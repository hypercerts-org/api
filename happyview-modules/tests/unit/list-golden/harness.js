import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssets } from "../../../tooling/installer.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** Encodes a JS value as a Lua table/literal for the runner program. */
export function lua(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(",")}}`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`)
      .join(",")}}`;
  }
  throw new TypeError(`Cannot encode ${typeof value} as a Lua literal`);
}

/** Hex-encodes JSON, the cursor wire format every list endpoint decodes. */
export function hexCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("hex");
}

/**
 * Every manifest-declared Lua query whose lexicon takes `cursor`, with its
 * bundle path and lexicon parameter schema. Derived, never hardcoded.
 */
export async function listCursorEndpoints() {
  const manifestPath = path.join(root, "manifest.json");
  const { assets } = await loadAssets(manifestPath);
  const lexicons = new Map(assets.filter((a) => a.kind === "lexicon").map((a) => [a.id, a]));
  const endpoints = [];
  for (const asset of assets) {
    if (asset.kind !== "script" || !asset.id.startsWith("xrpc.query:")) continue;
    const id = asset.id.slice("xrpc.query:".length);
    const parameters = lexicons.get(id)?.lexicon_json?.defs?.main?.parameters;
    const properties = parameters?.properties ?? {};
    if (!properties.cursor) continue;
    endpoints.push({
      id,
      source: asset.body,
      required: parameters.required ?? [],
      properties,
    });
  }
  return endpoints.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Runs each case against a fresh copy of the bundle with a fake db that
// records every db.raw call and answers each with `case.rows` (default: none). Output is one JSON line per case.
const RUNNER = String.raw`
local NULL = setmetatable({}, { __tostring = function() return "null" end })
local function enc(v)
  local t = type(v)
  if t == "string" then
    return '"' .. v:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end) .. '"'
  elseif t == "number" then
    if math.type(v) == "float" then return '"<float ' .. string.format("%.17g", v) .. '>"' end
    return tostring(v)
  elseif t == "boolean" then return tostring(v)
  elseif v == NULL then return "null"
  elseif t == "table" then
    local n = 0
    for _ in pairs(v) do n = n + 1 end
    local out = {}
    if n > 0 and n == #v then
      for _, x in ipairs(v) do out[#out + 1] = enc(x) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    for _, k in ipairs(keys) do out[#out + 1] = enc(tostring(k)) .. ":" .. enc(v[k]) end
    return "{" .. table.concat(out, ",") .. "}"
  end
  return '"<' .. t .. '>"'
end
local function dec(s)
  local i = 1
  local function ws() i = s:find("%S", i) or #s + 1 end
  local val
  local function str()
    local j, out = i + 1, {}
    while true do
      local c = s:sub(j, j)
      if c == "" then error("json.decode: eof") end
      if c == '"' then i = j + 1; return table.concat(out) end
      if c == "\\" then
        local n = s:sub(j + 1, j + 1)
        if n == "u" then out[#out + 1] = utf8.char(tonumber(s:sub(j + 2, j + 5), 16)); j = j + 6
        else out[#out + 1] = ({ n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" })[n] or n; j = j + 2 end
      else out[#out + 1] = c; j = j + 1 end
    end
  end
  function val()
    ws()
    local c = s:sub(i, i)
    if c == "{" then
      local o = {}
      i = i + 1; ws()
      if s:sub(i, i) == "}" then i = i + 1; return o end
      while true do
        ws(); local k = str(); ws()
        if s:sub(i, i) ~= ":" then error("json.decode: colon") end
        i = i + 1; o[k] = val(); ws()
        local d = s:sub(i, i); i = i + 1
        if d == "}" then return o elseif d ~= "," then error("json.decode: obj") end
      end
    elseif c == "[" then
      local a = {}
      i = i + 1; ws()
      if s:sub(i, i) == "]" then i = i + 1; return a end
      while true do
        a[#a + 1] = val(); ws()
        local d = s:sub(i, i); i = i + 1
        if d == "]" then return a elseif d ~= "," then error("json.decode: arr") end
      end
    elseif c == '"' then return str()
    elseif s:sub(i, i + 3) == "true" then i = i + 4; return true
    elseif s:sub(i, i + 4) == "false" then i = i + 5; return false
    elseif s:sub(i, i + 3) == "null" then i = i + 4; return NULL
    else
      local num = s:match("^-?%d+%.?%d*[eE]?[+-]?%d*", i)
      if not num or num == "" then error("json.decode: bad") end
      i = i + #num
      return tonumber(num)
    end
  end
  local r = val(); ws()
  if i <= #s then error("json.decode: trailing") end
  return r
end
local source = io.open(BUNDLE, "rb"):read("a")
for _, case in ipairs(CASES) do
  local calls = {}
  local env = setmetatable({}, { __index = _G })
  env.json = { encode = enc, decode = dec }
  env.toarray = function(t) return t end
  env.params = case.params
  env.db = {
    backend = function() return "postgres" end,
    raw = function(sql, values)
      calls[#calls + 1] = { sql = sql, binds = values }
      return case.rows or {}
    end,
  }
  local chunk = assert(load(source, "=bundle", "t", env))
  chunk()
  local ok, res = pcall(env.handle)
  local outcome
  if ok then outcome = { result = res }
  else outcome = { error = (tostring(res):gsub("^bundle:%d+: ", "")) } end
  print(enc({ name = case.name, calls = calls, outcome = outcome }))
end
`;

/** Runs every case against one bundle source; returns parsed per-case records. */
export function runCases(source, cases) {
  const dir = mkdtempSync(path.join(tmpdir(), "list-golden-"));
  const bundle = path.join(dir, "bundle.lua");
  writeFileSync(bundle, source);
  try {
    return execute(bundle, cases);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function execute(bundle, cases) {
  const program = `BUNDLE=${JSON.stringify(bundle)}\nCASES=${lua(cases.map(({ name, params, rows }) => ({ name, params, rows })))}\n${RUNNER}`;
  const run = spawnSync("lua5.4", ["-"], { input: program, encoding: "utf8", maxBuffer: 64 << 20 });
  if (run.error || run.status !== 0) {
    throw new Error(`lua5.4 failed for ${bundle}: ${run.error ?? run.stderr}`);
  }
  return run.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
