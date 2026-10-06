import assert from 'node:assert/strict';
import test from 'node:test';

const generator = await import('../scripts/openapi.mjs').catch(() => null);

const searchLexicon = {
  lexicon: 1,
  id: 'app.certified.demo.search',
  defs: {
    main: {
      type: 'query',
      description: 'Search demo records.',
      parameters: {
        type: 'params',
        required: ['search'],
        properties: {
          search: {
            type: 'string',
            description: 'Literal search text.',
            maxLength: 40,
            examples: ['river bank'],
          },
          emptyExample: {
            type: 'string',
            example: '',
            examples: ['fallback'],
          },
          tags: {
            type: 'array',
            description: 'Repeated tag filters.',
            minLength: 1,
            maxLength: 3,
            items: { type: 'string', enum: ['place', 'person'] },
          },
        },
      },
      output: {
        encoding: 'application/json',
        schema: { type: 'ref', ref: '#output' },
      },
    },
    output: {
      type: 'object',
      required: ['records'],
      properties: {
        title: { type: 'string', maxGraphemes: 80 },
        records: {
          type: 'array',
          items: { type: 'ref', ref: 'org.hypercerts.api.defs#recordView' },
        },
      },
    },
  },
};

test('OpenAPI generation preserves query contract and marks unresolved refs', () => {
  assert.equal(typeof generator?.buildOpenApi, 'function', 'openapi.mjs exports buildOpenApi');

  const document = generator.buildOpenApi([searchLexicon], {
    coverage: { 'app.certified.demo.search': 'manifest-registered' },
    sources: { 'app.certified.demo.search': { branch: 'api/demo', commit: 'abc123' } },
  });
  const operation = document.paths['/xrpc/app.certified.demo.search'].get;
  const search = operation.parameters.find((parameter) => parameter.name === 'search');
  const emptyExample = operation.parameters.find((parameter) => parameter.name === 'emptyExample');
  const tags = operation.parameters.find((parameter) => parameter.name === 'tags');

  assert.equal(document.openapi, '3.1.0');
  assert.deepEqual(document.servers, [
    { url: 'https://api.test.hypercerts.dev', description: 'API test server (default)' },
  ]);
  assert.equal(operation.description, 'Search demo records.');
  assert.equal(operation['x-hypercerts-coverage'], 'manifest-registered');
  assert.deepEqual(operation['x-hypercerts-source'], { branch: 'api/demo', commit: 'abc123' });
  assert.equal(search.required, true);
  assert.equal(search.description, 'Literal search text.');
  assert.equal(Object.hasOwn(search.schema, 'description'), false);
  assert.equal(search.schema.maxLength, 40);
  assert.equal(search.example, 'river bank');
  assert.equal(emptyExample.example, '');
  assert.equal(tags.description, 'Repeated tag filters.');
  assert.deepEqual(tags.schema, {
    type: 'array',
    minItems: 1,
    maxItems: 3,
    items: { type: 'string', enum: ['place', 'person'] },
  });
  assert.equal(tags.style, 'form');
  assert.equal(tags.explode, true);
  assert.deepEqual(operation.responses['200'].content['application/json'].schema, {
    $ref: '#/components/schemas/app.certified.demo.search.output',
  });
  const output = document.components.schemas['app.certified.demo.search.output'];
  assert.equal(output.properties.title['x-lexicon-maxGraphemes'], 80);
  assert.equal(Object.hasOwn(output.properties.title, 'maxGraphemes'), false);
  assert.equal(
    document.components.schemas['org.hypercerts.api.defs.recordView']['x-lexicon-ref'],
    'org.hypercerts.api.defs#recordView',
  );
});

test('OpenAPI conversion resolves cyclic and union refs and preserves object-schema fallbacks', () => {
  const lexiconId = 'app.certified.demo.schemaCases';
  const document = generator.buildOpenApi([{
    lexicon: 1,
    id: lexiconId,
    defs: {
      main: {
        type: 'query',
        output: { encoding: 'application/json', schema: { type: 'ref', ref: '#node' } },
      },
      node: {
        type: 'object',
        closed: true,
        required: ['next', 'choice'],
        nullable: ['optional'],
        properties: {
          next: { type: 'ref', ref: '#node' },
          choice: {
            type: 'union',
            description: 'A known variant.',
            refs: ['#textVariant', '#countVariant'],
          },
          optional: { type: 'string' },
          unknownUnion: { type: 'union' },
        },
      },
      textVariant: { type: 'object', properties: { value: { type: 'string' } } },
      countVariant: { type: 'object', properties: { value: { type: 'integer' } } },
    },
  }]);
  const schemas = document.components.schemas;

  assert.deepEqual(schemas[`${lexiconId}.node`], {
    type: 'object',
    required: ['next', 'choice'],
    properties: {
      next: { $ref: `#/components/schemas/${lexiconId}.node` },
      choice: {
        anyOf: [
          { $ref: `#/components/schemas/${lexiconId}.textVariant` },
          { $ref: `#/components/schemas/${lexiconId}.countVariant` },
        ],
        description: 'A known variant.',
      },
      optional: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      unknownUnion: { type: 'object' },
    },
    additionalProperties: false,
  });
  assert.deepEqual(schemas[`${lexiconId}.textVariant`], {
    type: 'object',
    properties: { value: { type: 'string' } },
  });
  assert.deepEqual(schemas[`${lexiconId}.countVariant`], {
    type: 'object',
    properties: { value: { type: 'integer' } },
  });
});
