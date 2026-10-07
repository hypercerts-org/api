# Request construction, filters, and pagination

## Build one public XRPC GET

Every query is `GET /xrpc/<full NSID>` on either base URL in the parent [`SKILL.md`](../SKILL.md). Encode every argument in the query string. Do not send a request body or credentials.

```ts
const apiBase = "https://api.hypercerts.dev"; // choose the approved target for your app
const params = new URLSearchParams();
params.set("search", "forest restoration");
params.set("sortDirection", "desc");
params.set("limit", "25");

const authors = ["did:plc:author-one", "did:plc:author-two"];
for (const author of authors) params.append("authors", author);

const url = new URL(
  `/xrpc/org.hypercerts.claim.searchActivities?${params.toString()}`,
  apiBase,
);
// When the application runs this URL, use GET and no Authorization header.
```

`URL` and `URLSearchParams` handle percent-encoding of spaces, colons, slashes, and other reserved characters. Do not concatenate raw user input into a URL. Do not add `Authorization`, OAuth, API-key, or login parameters: queries are public and read-only.

## Encode arrays only as their endpoint contract specifies

For array query parameters documented with form/explode in the bundled OpenAPI operation, append the same **unbracketed** key once per value:

```ts
params.append("authors", authorDid1);
params.append("authors", authorDid2);
// Result includes authors=...&authors=..., URL-encoded by URLSearchParams.
```

Do not use `authors[]=` or comma-joined values unless that exact endpoint contract says to. Omit an optional array when it has no values rather than sending a guessed encoding. Some queries have no array parameters, and not every endpoint accepts the same arrays. Check the operation's parameters and schemas in the [bundled OpenAPI contract](openapi.json) for item formats, requiredness, maximum array size, and semantics.

A useful starting distinction: arrays often mean “any of these” for a filter, while separate filters may combine with AND, but this is **not a universal rule**. For example, the bundled collection contract says `tagUris` requires every supplied tag URI, while `itemUris` matches URI without CID. Confirm the exact operation before relying on filter logic.

## Keep page requests cursor-consistent

For a list/search operation whose output has a cursor, keep a base set of all non-cursor parameters and replace only the cursor on continuation. Preserve repeated array values, filters, `search`, `limit`, and `sortDirection` exactly. The example below is illustrative; verify the chosen endpoint's cursor binding and response-array name.

```ts
const baseParams = new URLSearchParams();
baseParams.append("authors", authorDid1);
baseParams.append("authors", authorDid2);
baseParams.set("sortDirection", "desc");
baseParams.set("limit", "25");

let cursor: string | undefined;
for (;;) {
  const pageParams = new URLSearchParams(baseParams);
  if (cursor !== undefined) pageParams.set("cursor", cursor);

  const url = new URL(
    `/xrpc/org.hypercerts.claim.listActivities?${pageParams.toString()}`,
    apiBase,
  );
  // Fetch/decode the page in the application; each call remains a GET.
  const page = await fetchActivityPage(url);
  consume(page.activities);

  if (page.cursor === undefined) break;
  cursor = page.cursor;
}
```

Treat cursors as opaque. Do not decode, synthesize, or reuse one after changing a filter/sort. A changed query begins at page one. Use a bounded `limit`; the bundled contract shows many list queries allow 1–100 and default to 25, but check the exact schema instead of assuming those bounds apply universally. Page stability is endpoint-specific; a cursor does not imply snapshot isolation.

## Interpret filters per operation

- Check whether a parameter is required. Search endpoints often require `search`; list endpoints may omit all filters.
- Check the type/format: a `DID`, handle, AT-URI, boolean, enum, and arbitrary string are not interchangeable.
- Check sort defaults and which values bind the cursor. Preserve the chosen direction on subsequent pages.
- Read the exact endpoint's prose for trimming, literal vs token search, case sensitivity, duplicate handling, and AND/OR behavior. Never transfer these assumptions from a neighboring endpoint.

The compact [endpoint map](endpoint-map.md) helps choose an operation; exact query parameters and response schemas are in the [bundled OpenAPI contract](openapi.json).

## Handle HTTP and XRPC errors

Keep the HTTP status even when the response body is missing or not JSON. Parse a JSON body when available and surface the XRPC `error` code and `message` if present; do not treat every failure as an empty result or assume all endpoint errors map to the same status.

```ts
const response = await fetch(url, {
  method: "GET",
  headers: { Accept: "application/json" },
});
const text = await response.text();
let payload: unknown;
try {
  payload = text ? JSON.parse(text) : undefined;
} catch {
  payload = undefined; // retain HTTP status; body was not usable JSON
}

if (!response.ok) {
  const body = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const code = typeof body.error === "string" ? body.error : "XrpcError";
  const message = typeof body.message === "string" ? body.message : "";
  throw new Error(
    `GET ${url.pathname} failed: HTTP ${response.status}, ${code}${message ? `: ${message}` : ""}`,
  );
}
```

On failure, use that endpoint's declared errors in the bundled OpenAPI operation to decide whether the request is invalid, a record is absent from the index, handle resolution failed, or an indexed query/hydration failed. Do not map a query failure to “no results.” For null and not-found distinctions, see [reliability.md](reliability.md).
