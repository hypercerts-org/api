import { buildOpenApi, DEFAULT_SERVER_URL } from "./openapi.mjs";

/** Repository-relative location of the OpenAPI copy bundled with the hypercerts-api skill. */
export const SKILL_OPENAPI_PATH = ".agents/skills/hypercerts-api/references/openapi.json";

const SKILL_OPENAPI_INFO = {
  title: "Hypercerts API",
  version: "contract-snapshot",
  description:
    "Public, read-only Hypercerts XRPC query endpoints. This static contract snapshot describes declared behavior, not availability on a particular deployment.",
};

function stripHypercertsExtensions(value) {
  if (Array.isArray(value)) return value.map(stripHypercertsExtensions);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith("x-hypercerts-"))
      .map(([key, child]) => [key, stripHypercertsExtensions(child)]),
  );
}

/** Derive the self-contained skill copy: no repository-specific `x-hypercerts-*` keys. */
export function buildSkillOpenApi(openapi) {
  return { ...stripHypercertsExtensions(openapi), info: SKILL_OPENAPI_INFO };
}

export function buildDocumentationArtifacts(sourceIndex, lexicons) {
  const lexiconsById = new Map();
  for (const lexicon of lexicons) {
    if (lexiconsById.has(lexicon.id)) {
      throw new Error(`Duplicate source Lexicon in docs/sources/index.json: ${lexicon.id}`);
    }
    lexiconsById.set(lexicon.id, lexicon);
  }

  const listedLexicons = sourceIndex.lexicons ?? sourceIndex.endpoints;
  const listedIds = listedLexicons.map(({ id }) => id).sort();
  const sourceIds = [...lexiconsById.keys()].sort();
  if (JSON.stringify(sourceIds) !== JSON.stringify(listedIds)) {
    throw new Error("Loaded Lexicon snapshots do not exactly match docs/sources/index.json.");
  }

  const coverage = {};
  const sources = {};
  for (const endpoint of sourceIndex.endpoints) {
    const lexicon = lexiconsById.get(endpoint.id);
    if (!lexicon || !["query", "procedure"].includes(lexicon.defs?.main?.type)) {
      throw new Error(
        `Manifest endpoint ${endpoint.id} is not a query/procedure Lexicon snapshot.`,
      );
    }
    if (lexicon.defs.main.type !== endpoint.type) {
      throw new Error(
        `Endpoint type drift for ${endpoint.id}: index says ${endpoint.type}, snapshot says ${lexicon.defs.main.type}`,
      );
    }
    coverage[endpoint.id] = "manifest-registered";
    sources[endpoint.id] = { module: endpoint.module };
  }

  const expectedEndpointIds = sourceIndex.endpoints.map(({ id }) => id).sort();
  const operationIds = lexicons
    .filter((lexicon) => ["query", "procedure"].includes(lexicon.defs?.main?.type))
    .map(({ id }) => id)
    .sort();
  if (JSON.stringify(operationIds) !== JSON.stringify(expectedEndpointIds)) {
    throw new Error("Operation snapshots do not exactly match the manifest-registered endpoints.");
  }

  const document = buildOpenApi(lexicons, {
    coverage,
    sources,
    serverUrl: DEFAULT_SERVER_URL,
    version: "manifest-snapshot",
    source: `${sourceIndex.apiManifest}; @hypercerts-org/lexicon@${sourceIndex.pinnedLexiconPackage}`,
  });
  if (document["x-hypercerts-unresolved-references"].length > 0) {
    const references = document["x-hypercerts-unresolved-references"]
      .map(({ component, reference }) => `${component} -> ${reference}`)
      .join("\n");
    throw new Error(`OpenAPI generation found unresolved Lexicon references:\n${references}`);
  }

  return { openapi: document, skillOpenapi: buildSkillOpenApi(document) };
}
