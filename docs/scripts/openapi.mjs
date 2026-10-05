export const DEFAULT_SERVER_URL = 'https://api.test.hypercerts.dev';

const SCHEMA_FIELDS = [
  'type',
  'description',
  'format',
  'enum',
  'const',
  'default',
  'examples',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'uniqueItems',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
];

function componentKey(lexiconId, definitionName) {
  return `${lexiconId}.${definitionName}`.replaceAll('~', '~0').replaceAll('/', '~1');
}

function referenceParts(reference, currentLexiconId) {
  if (reference.startsWith('#')) {
    return { lexiconId: currentLexiconId, definitionName: reference.slice(1) || 'main' };
  }

  const [lexiconId, fragment] = reference.split('#', 2);
  return { lexiconId, definitionName: fragment || 'main' };
}

function referenceSchema(reference, currentLexiconId, lexicons, schemas, active) {
  const { lexiconId, definitionName } = referenceParts(reference, currentLexiconId);
  const target = lexicons.get(lexiconId)?.defs?.[definitionName];
  const key = componentKey(lexiconId, definitionName);
  if (!target && !schemas[key]) {
    schemas[key] = {
      description: `Schema reference ${reference} is outside the committed local Lexicon snapshot.`,
      'x-lexicon-ref': reference,
    };
  } else if (target && !schemas[key] && !active.has(key)) {
    active.add(key);
    schemas[key] = toSchema(target, lexiconId, lexicons, schemas, active);
    active.delete(key);
  }
  return { $ref: `#/components/schemas/${key}` };
}

function unionSchema(source, currentLexiconId, lexicons, schemas, active) {
  return {
    anyOf: source.refs.map((reference) =>
      referenceSchema(reference, currentLexiconId, lexicons, schemas, active),
    ),
    ...(source.description ? { description: source.description } : {}),
  };
}

function arraySchema(source, result, currentLexiconId, lexicons, schemas, active) {
  if (Object.hasOwn(source, 'minLength')) {
    result.minItems = source.minLength;
    delete result.minLength;
  }
  if (Object.hasOwn(source, 'maxLength')) {
    result.maxItems = source.maxLength;
    delete result.maxLength;
  }
  if (source.items) result.items = toSchema(source.items, currentLexiconId, lexicons, schemas, active);
}

function objectSchema(source, result, currentLexiconId, lexicons, schemas, active) {
  if (Array.isArray(source.required)) result.required = [...source.required];
  if (source.properties) {
    result.properties = {};
    for (const [name, property] of Object.entries(source.properties)) {
      const converted = toSchema(property, currentLexiconId, lexicons, schemas, active);
      if (Array.isArray(source.nullable) && source.nullable.includes(name)) {
        result.properties[name] = { anyOf: [converted, { type: 'null' }] };
      } else {
        result.properties[name] = converted;
      }
    }
  }
  if (source.closed === true) result.additionalProperties = false;
}

function toSchema(source, currentLexiconId, lexicons, schemas, active = new Set()) {
  if (!source || typeof source !== 'object') return {};
  if (source.type === 'ref') {
    return referenceSchema(source.ref, currentLexiconId, lexicons, schemas, active);
  }
  if (source.type === 'union' && Array.isArray(source.refs)) {
    return unionSchema(source, currentLexiconId, lexicons, schemas, active);
  }

  const result = {};
  for (const field of SCHEMA_FIELDS) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  if (Object.hasOwn(source, 'maxGraphemes')) {
    result['x-lexicon-maxGraphemes'] = source.maxGraphemes;
  }
  if (source.type === 'array') {
    arraySchema(source, result, currentLexiconId, lexicons, schemas, active);
  }
  if (source.type === 'object') {
    objectSchema(source, result, currentLexiconId, lexicons, schemas, active);
  }
  if (source.type === 'union' && !Array.isArray(source.refs)) result.type = 'object';
  return result;
}

function getParameterSchema(property, lexiconId, lexicons, schemas) {
  const schema = toSchema(property, lexiconId, lexicons, schemas);
  delete schema.description;
  return schema;
}

function namespaceTag(lexiconId) {
  const parts = lexiconId.split('.');
  return parts.length > 3 ? parts.slice(0, 3).join('.') : parts.slice(0, -1).join('.');
}

function operationParameters(parametersDef, id, lexicons, schemas) {
  const requiredNames = new Set(parametersDef?.required ?? []);
  const parameters = [];

  for (const [name, property] of Object.entries(parametersDef?.properties ?? {})) {
    const parameter = {
      name,
      in: 'query',
      required: requiredNames.has(name),
      description: property.description,
      schema: getParameterSchema(property, id, lexicons, schemas),
    };
    if (property.type === 'array') {
      parameter.style = 'form';
      parameter.explode = true;
    }
    let example;
    if (Object.hasOwn(property, 'example')) {
      example = property.example;
    } else if (Array.isArray(property.examples) && property.examples.length > 0) {
      example = property.examples[0];
    }
    if (example !== undefined) parameter.example = example;
    parameters.push(parameter);
  }

  return parameters;
}

function operationFor(lexicon, lexicons, schemas, coverage, sources) {
  const { id } = lexicon;
  const main = lexicon.defs.main;
  const isQuery = main.type === 'query';
  const parameters = operationParameters(main.parameters, id, lexicons, schemas);

  const output = main.output?.schema
    ? toSchema(main.output.schema, id, lexicons, schemas)
    : {};
  const operation = {
    operationId: id.replaceAll('.', '_'),
    tags: [namespaceTag(id)],
    description: main.description ?? `XRPC ${main.type} ${id}`,
    parameters,
    responses: {
      '200': {
        description: 'Successful response.',
        ...(main.output?.encoding
          ? { content: { [main.output.encoding]: { schema: output } } }
          : {}),
      },
    },
    'x-lexicon-id': id,
    'x-hypercerts-coverage': coverage[id] ?? 'unclassified',
    ...(sources[id] ? { 'x-hypercerts-source': sources[id] } : {}),
  };
  if (Array.isArray(main.errors) && main.errors.length > 0) operation['x-lexicon-errors'] = main.errors;
  if (main.type === 'procedure' && main.input?.schema) {
    operation.requestBody = {
      required: true,
      content: { [main.input.encoding ?? 'application/json']: { schema: toSchema(main.input.schema, id, lexicons, schemas) } },
    };
  }
  return { method: isQuery ? 'get' : 'post', operation };
}

export function buildOpenApi(lexicons, metadata = {}) {
  const sorted = [...lexicons].sort((left, right) => left.id.localeCompare(right.id));
  const lexiconMap = new Map(sorted.map((lexicon) => [lexicon.id, lexicon]));
  const schemas = {};
  const paths = {};
  const tags = new Set();

  for (const lexicon of sorted) {
    if (!lexicon?.id || !['query', 'procedure'].includes(lexicon.defs?.main?.type)) continue;
    const { method, operation } = operationFor(
      lexicon,
      lexiconMap,
      schemas,
      metadata.coverage ?? {},
      metadata.sources ?? {},
    );
    const path = `/xrpc/${lexicon.id}`;
    paths[path] ??= {};
    paths[path][method] = operation;
    tags.add(operation.tags[0]);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Hypercerts API',
      version: metadata.version ?? 'source-snapshot',
      description: 'Public Hypercerts XRPC endpoints. Coverage labels describe local source manifests, not deployment or runtime verification.',
    },
    servers: [{ url: metadata.serverUrl ?? DEFAULT_SERVER_URL, description: 'API test server (default)' }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: { schemas },
    'x-hypercerts-source': metadata.source ?? 'Committed Lexicon snapshots in sources/lexicons.',
    'x-hypercerts-unresolved-references': Object.entries(schemas)
      .filter(([, schema]) => Object.hasOwn(schema, 'x-lexicon-ref'))
      .map(([name, schema]) => ({ component: name, reference: schema['x-lexicon-ref'] }))
      .sort((left, right) => left.reference.localeCompare(right.reference)),
  };
}
