# Lua maintainability checks

Run the integrated check with:

```sh
pnpm lint:lua
```

`pnpm check` includes this command through `pnpm lint`. The checker reads only modules listed in `api/manifest.json` and their manifest-declared assets and Lua sources. It does not scan standalone Lexicon files that are not registered by those modules. Generated endpoint bundles remain the input to Luacheck; diagnostics with a generated-bundle location are mapped back to the ordered `sharedSourcePaths` and handler `sourcePath` that produced that line. Adding `lint-lua.js` to the TypeScript `checkJs` file set is deferred; this change does not extend that configuration.

## Findings and severity

- **Error:** a recognized literal `keys_only` allow-list differs from its registered query Lexicon parameter names, or a declared authored Lua source is missing. Parameter mismatches list both missing and extra names. Errors make `lint:lua` fail.
- **Unverified (nonblocking):** the checker cannot safely compare a query contract, such as when validation is delegated through an unsupported wrapper or uses dynamic/computed allow-list construction, or cannot prove a helper's local visibility/order. These are reported and are not counted as verified.
- **Warning (nonblocking):** a call appears to refer to a shared helper whose definition exists in another registered shared source but is absent from this handler's ordered bundle, or a direct request/cursor value appears in a `db.raw` SQL-text argument. Existing Luacheck findings retain their normal exit status.

The command prints a parameter-contract count split into verified and unverified registered queries. A verified mismatch is counted as verified and is separately reported as an error. The current manifest snapshot has 55 registered queries: 47 verified, 8 unverified, and 0 mismatches; helper diagnostics are 0 missing-dependency warnings and 1 availability-unverified result; SQL warnings are 0. These counts describe this checkout and will change with registered modules or source patterns.

## Coverage and limitations

The parameter comparison recognizes simple unqualified `keys_only(params, { name = true })` and `keys_only(request_params, { name = true })` calls, plus the explicit `collection_keys_only` and `collection_items_keys_only` wrappers, when their literal allow-list is uniquely identifiable in the declared source bundle. Dot- or colon-qualified custom methods such as `custom.keys_only(...)` are unsupported and reported as unverified. A named local literal table is resolved only when its declaration and call are in the same simple block, it is not reassigned, shadowed, or otherwise referenced before the check. Out-of-scope bindings, aliases, block transitions, dynamic flags, computed keys, multiple candidate calls, and unsupported validation patterns are unverified rather than inferred as matches.

Bundle helper diagnostics are deliberately narrow. A call is considered resolved only when a top-level `local function` declaration appears earlier in the same ordered shared-source-plus-handler bundle. Later declarations, block-local candidates, non-local declarations, or ambiguous candidates are reported as availability-unverified; a possible missing-dependency warning is emitted only for a unique top-level local declaration found in another registered shared source. Name matches alone never prove availability. Only identifier tokens affect the block walk; string and comment contents do not. This is not a full Lua scope engine; generated-bundle Luacheck remains authoritative for undefined globals. Source attribution follows the current builder composition order (shared sources, then handler) and blank-line separators; diagnostics that do not match Luacheck's plain `file:line:column` form are left unchanged.

SQL detection is advisory, not taint analysis or a SQL-injection proof. It checks only obvious direct references to `params`, `request_params`, or a variable named `cursor` in the SQL-text argument of `db.raw(...)` and `pcall(db.raw, ...)`. Values supplied separately as SQL bind arguments are allowed, as is structural SQL concatenation that does not directly reference those names. The detector does not follow SQL stored in locals, aliases, wrapper/helper calls, `string.format`, table-built fragments, or values renamed through arbitrary transformations; it can also warn on a structural identifier named `cursor`. Review SQL construction and binding manually when data flow is indirect.

Focused offline tests:

```sh
node --test tests/unit/tooling/lua-maintainability.test.js tests/unit/tooling/lint-lua.test.js
```
