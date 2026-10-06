import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { locationRecords, profileRecords, organizationRecords } from '../../fixtures/records.js';
import { seedRows as activityHttpFixtureRows } from '../../http/fixtures/activity.fixture.js';
import { validatePackageLexicons } from '../../../tooling/validate-lexicons.js';
import { readLexiconSource } from '../../../tooling/lexicon-source.js';
import { loadAssets } from '../../../tooling/installer.js';
import { fileURLToPath } from 'node:url';

const rootManifest = JSON.parse(await readFile(new URL('../../../manifest.json', import.meta.url), 'utf8'));
const hasModule = (modulePath) => rootManifest.modules.includes(modulePath);

test('the full validation Lexicon closure resolves locally while only selected package Lexicons deploy', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../../manifest.json', import.meta.url), 'utf8'));
  const { assets } = await loadAssets(fileURLToPath(new URL('../../../manifest.json', import.meta.url)));
  const { documents } = await validatePackageLexicons();
  const validatedIds = documents.map((document) => document.id);
  assert.deepEqual(validatedIds.sort(), manifest.validationLexicons.map(({ id }) => id).sort());

  const validationSources = new Map(manifest.validationLexicons.map((source) => [source.id, source]));
  const deployedPackageAssets = assets.filter(({ kind, packagePath }) => kind === 'lexicon' && packagePath);
  assert.deepEqual(deployedPackageAssets.map(({ id }) => id).sort(), [
    'app.certified.actor.organization',
    'app.certified.actor.profile',
    'app.certified.badge.award',
    'app.certified.badge.definition',
    'app.certified.badge.response',
    'app.certified.defs',
    'app.certified.graph.entityFollow',
    'app.certified.graph.follow',
    'app.certified.location',
    'app.certified.signature.defs',
    'com.atproto.repo.strongRef',
    'org.hypercerts.claim.activity',
    'org.hypercerts.claim.contribution',
    'org.hypercerts.claim.contributorInformation',
    'org.hypercerts.collection',
    'org.hypercerts.context.acknowledgement',
    'org.hypercerts.context.attachment',
    'org.hypercerts.context.evaluation',
    'org.hypercerts.context.measurement',
    'org.hypercerts.defs',
    'org.hypercerts.entity.feature',
    'org.hypercerts.funding.receipt',
    'org.hypercerts.vocab.tag',
    'org.hypercerts.workscope.tag',
  ]);
  for (const asset of deployedPackageAssets) {
    const source = validationSources.get(asset.id);
    assert.equal(asset.packagePath, source.packagePath);
    const document = await readLexiconSource(source);
    assert.equal(document.id, asset.id);
    assert.deepEqual(asset.lexicon_json, document);
  }
});

if (hasModule('modules/location/manifest.json')) test('location query result refs resolve to shared actor views and getLocation-owned locationView', async () => {
  const { lexicons, documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  const shared = byId.get('org.hypercerts.api.defs');
  const getLocation = byId.get('app.certified.location.getLocation');
  const listLocations = byId.get('app.certified.location.listLocations');
  assert.ok(shared, 'validation sources include the shared API definitions');
  assert.ok(getLocation, 'validation sources include getLocation');
  assert.ok(listLocations, 'validation sources include listLocations');
  assert.equal(Object.hasOwn(listLocations.defs.main.parameters.properties, 'search'), false, 'listLocations must not expose a search parameter');

  assert.equal(lexicons.getDefOrThrow('org.hypercerts.api.defs#profileView').type, 'object');
  assert.equal(lexicons.getDefOrThrow('org.hypercerts.api.defs#organizationView').type, 'object');
  assert.equal(lexicons.getDefOrThrow('org.hypercerts.api.defs#actorView').type, 'object');
  assert.deepEqual(shared.defs.profileView.required, ['uri', 'cid', 'indexedAt', 'did', 'record']);
  assert.equal(shared.defs.profileView.properties.record.ref, 'lex:app.certified.actor.profile');
  assert.deepEqual(shared.defs.organizationView.required, ['uri', 'cid', 'indexedAt', 'did', 'record']);
  assert.equal(shared.defs.organizationView.properties.record.ref, 'lex:app.certified.actor.organization');
  assert.deepEqual(shared.defs.actorView.required, ['did', 'profile', 'organization']);
  assert.deepEqual(shared.defs.actorView.nullable, ['profile', 'organization']);
  assert.equal(shared.defs.actorView.properties.profile.ref, 'lex:org.hypercerts.api.defs#profileView');
  assert.equal(shared.defs.actorView.properties.organization.ref, 'lex:org.hypercerts.api.defs#organizationView');
  assert.equal(shared.defs.locationView, undefined);

  assert.equal(getLocation.defs.locationView.type, 'object');
  assert.equal(getLocation.defs.locationView.properties.author.ref, 'lex:org.hypercerts.api.defs#actorView');
  assert.equal(getLocation.defs.locationView.properties.record.ref, 'lex:app.certified.location');
  assert.equal(getLocation.defs.output.properties.location.ref, 'lex:app.certified.location.getLocation#locationView');
  assert.equal(listLocations.defs.output.properties.locations.items.ref, 'lex:app.certified.location.getLocation#locationView');
  assert.equal(lexicons.getDefOrThrow('app.certified.location.getLocation#locationView').type, 'object');
});

if (hasModule('modules/organization/manifest.json')) test('organization query Lexicons keep the shared defs unchanged and reuse the required nullable actor view', async () => {
  const { lexicons, documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  const shared = byId.get('org.hypercerts.api.defs');
  const getOrganization = byId.get('app.certified.actor.getOrganization');
  const getOrganizations = byId.get('app.certified.actor.getOrganizations');
  const listOrganizations = byId.get('app.certified.actor.listOrganizations');
  const searchOrganizations = byId.get('app.certified.actor.searchOrganizations');
  assert.ok(shared && getOrganization && getOrganizations && listOrganizations && searchOrganizations);
  assert.equal(shared.defs.organizationActorView, undefined, 'avoid changing the installed shared defs Lexicon');

  const actorView = lexicons.getDefOrThrow('app.certified.actor.getOrganization#organizationActorView');
  assert.deepEqual(actorView.required, ['did', 'profile', 'organization']);
  assert.deepEqual(actorView.nullable, ['profile']);
  assert.equal(actorView.properties.profile.ref, 'lex:org.hypercerts.api.defs#profileView');
  assert.equal(actorView.properties.organization.ref, 'lex:org.hypercerts.api.defs#organizationView');
  assert.equal(getOrganization.defs.output.properties.actor.ref, 'lex:app.certified.actor.getOrganization#organizationActorView');
  const organizationQueryFailed = {
    name: 'OrganizationQueryFailed',
    description: 'The indexed organization sidecar or associated profile could not be queried.',
  };
  assert.deepEqual(getOrganization.defs.main.errors.map(({ name }) => name), [
    'InvalidRequest', 'RecordNotFound', 'OrganizationQueryFailed',
  ]);
  assert.deepEqual(
    getOrganization.defs.main.errors.find(({ name }) => name === 'OrganizationQueryFailed'),
    organizationQueryFailed,
  );

  assert.equal(lexicons.getDefOrThrow(getOrganizations.defs.output.properties.organizations.items.ref).type, 'object');
  assert.equal(lexicons.getDefOrThrow(getOrganizations.defs.organizationResult.properties.organization.ref).type, 'object');

  for (const query of [listOrganizations, searchOrganizations]) {
    assert.deepEqual(query.defs.main.errors.map(({ name }) => name), ['InvalidRequest', 'OrganizationQueryFailed']);
    assert.deepEqual(
      query.defs.main.errors.find(({ name }) => name === 'OrganizationQueryFailed'),
      organizationQueryFailed,
    );
    assert.equal(query.defs.main.parameters.properties.organizationTypes.maxLength, 100);
    assert.equal(query.defs.output.properties.actors.items.ref, 'lex:app.certified.actor.getOrganization#organizationActorView');
  }
  assert.equal(lexicons.getDefOrThrow(listOrganizations.defs.output.properties.actors.items.ref).type, 'object');
  assert.equal(lexicons.getDefOrThrow(searchOrganizations.defs.output.properties.actors.items.ref).type, 'object');
});

if (hasModule('modules/workscope-tags/manifest.json')) test('work-scope tag queries keep their result view with getWorkscopeTag and declare pagination bounds', async () => {
  const { lexicons, documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  const shared = byId.get('org.hypercerts.api.defs');
  const tag = byId.get('org.hypercerts.workscope.tag');
  const get = byId.get('org.hypercerts.workscope.getWorkscopeTag');
  const list = byId.get('org.hypercerts.workscope.listWorkscopeTags');
  assert.ok(shared && tag && get && list);
  assert.equal(shared.defs.workscopeTagView, undefined, 'the workscope-specific view is not part of shared API defs');

  const view = lexicons.getDefOrThrow('org.hypercerts.workscope.getWorkscopeTag#workscopeTagView');
  assert.deepEqual(view.required, ['uri', 'cid', 'indexedAt', 'did', 'author', 'record']);
  assert.deepEqual(view.nullable, ['indexedAt']);
  assert.equal(view.properties.author.ref, 'lex:org.hypercerts.api.defs#actorView');
  assert.equal(view.properties.record.ref, 'lex:org.hypercerts.workscope.tag');
  assert.deepEqual(get.defs.main.parameters.required, ['uri']);
  assert.equal(get.defs.main.parameters.properties.uri.format, 'at-uri');
  assert.equal(get.defs.output.properties.workscopeTag.ref, 'lex:org.hypercerts.workscope.getWorkscopeTag#workscopeTagView');
  assert.equal(list.defs.main.parameters.properties.authors.maxLength, 100);
  assert.equal(list.defs.main.parameters.properties.authors.items.format, 'did');
  assert.equal(list.defs.main.parameters.properties.sortDirection.default, 'desc');
  assert.equal(list.defs.main.parameters.properties.limit.default, 25);
  assert.equal(list.defs.main.parameters.properties.limit.minimum, 1);
  assert.equal(list.defs.main.parameters.properties.limit.maximum, 100);
  assert.equal(list.defs.output.properties.workscopeTags.items.ref, 'lex:org.hypercerts.workscope.getWorkscopeTag#workscopeTagView');
  assert.deepEqual(get.defs.main.errors.map(({ name }) => name), ['InvalidRequest', 'RecordNotFound', 'WorkscopeTagQueryFailed']);
  assert.deepEqual(list.defs.main.errors.map(({ name }) => name), ['InvalidRequest', 'WorkscopeTagQueryFailed']);
});

if (hasModule('modules/actor-follow/manifest.json')) test('follow query Lexicons declare all required DID parameters', async () => {
  const { documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  assert.deepEqual({
    getFollow: byId.get('app.certified.graph.getFollow').defs.main.parameters.required,
    listActorFollowers: byId.get('app.certified.graph.listActorFollowers').defs.main.parameters.required,
    listActorFollowing: byId.get('app.certified.graph.listActorFollowing').defs.main.parameters.required,
  }, {
    getFollow: ['actor', 'subject'],
    listActorFollowers: ['actor'],
    listActorFollowing: ['actor'],
  });
});

if (hasModule('modules/context-measurements/manifest.json')) test('measurement query Lexicons preserve the typed publisher and full-record contract', async () => {
  const { lexicons, documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  const getMeasurement = byId.get('org.hypercerts.context.getMeasurement');
  const listMeasurements = byId.get('org.hypercerts.context.listMeasurements');
  const view = lexicons.getDefOrThrow('org.hypercerts.context.getMeasurement#measurementView');
  assert.ok(getMeasurement && listMeasurements);
  assert.deepEqual(getMeasurement.defs.main.parameters.required, ['uri']);
  assert.equal(getMeasurement.defs.main.parameters.properties.uri.format, 'at-uri');
  assert.deepEqual(getMeasurement.defs.main.errors.map(({ name }) => name), ['InvalidRequest', 'RecordNotFound']);
  assert.equal(getMeasurement.defs.output.properties.measurement.ref, 'lex:org.hypercerts.context.getMeasurement#measurementView');
  assert.equal(view.properties.author.ref, 'lex:org.hypercerts.api.defs#actorView');
  assert.equal(view.properties.record.ref, 'lex:org.hypercerts.context.measurement');
  assert.deepEqual(view.required, ['uri', 'cid', 'indexedAt', 'did', 'author', 'record']);
  assert.deepEqual(view.nullable, ['indexedAt']);

  const properties = listMeasurements.defs.main.parameters.properties;
  assert.equal(properties.authors.maxLength, 100);
  assert.equal(properties.authors.items.format, 'did');
  assert.equal(properties.subjects.maxLength, 100);
  assert.equal(properties.subjects.items.format, 'at-uri');
  assert.deepEqual(properties.sortDirection.enum, ['asc', 'desc']);
  assert.equal(properties.sortDirection.default, 'desc');
  assert.deepEqual([properties.limit.minimum, properties.limit.maximum, properties.limit.default], [1, 100, 25]);
  assert.equal(listMeasurements.defs.output.properties.measurements.items.ref, 'lex:org.hypercerts.context.getMeasurement#measurementView');
  assert.deepEqual(listMeasurements.defs.main.errors.map(({ name }) => name), ['InvalidRequest']);
});

test('contributor-information view is owned by getContributorInformation and keeps nullable indexedAt required', async () => {
  const { lexicons, documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  const shared = byId.get('org.hypercerts.api.defs');
  const getContributorInformation = byId.get('org.hypercerts.claim.getContributorInformation');
  const listContributorInformation = byId.get('org.hypercerts.claim.listContributorInformation');
  assert.ok(shared && getContributorInformation && listContributorInformation);
  assert.equal(Object.hasOwn(shared.defs, 'contributorInformationView'), false);
  assert.equal(
    getContributorInformation.defs.output.properties.contributorInformation.ref,
    'lex:org.hypercerts.claim.getContributorInformation#contributorInformationView',
  );
  assert.equal(
    listContributorInformation.defs.output.properties.contributorInformation.items.ref,
    'lex:org.hypercerts.claim.getContributorInformation#contributorInformationView',
  );

  const view = lexicons.getDefOrThrow('org.hypercerts.claim.getContributorInformation#contributorInformationView');
  assert.ok(view.required.includes('indexedAt'));
  assert.ok(view.nullable.includes('indexedAt'));
  assert.equal(view.properties.author.ref, 'lex:org.hypercerts.api.defs#actorView');
  assert.equal(view.properties.record.ref, 'lex:org.hypercerts.claim.contributorInformation');
});

test('contribution query Lexicons expose exact lookup and publisher-based paging contracts', async () => {
  const { lexicons, documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  const getContribution = byId.get('org.hypercerts.claim.getContribution');
  const listContributions = byId.get('org.hypercerts.claim.listContributions');
  const shared = byId.get('org.hypercerts.api.defs');
  assert.ok(getContribution && listContributions && shared);

  const getParams = getContribution.defs.main.parameters;
  assert.deepEqual(getParams.required, ['uri']);
  assert.deepEqual(Object.keys(getParams.properties), ['uri']);
  assert.equal(getParams.properties.uri.format, 'at-uri');
  assert.equal(getContribution.defs.output.properties.contribution.ref, 'lex:org.hypercerts.claim.getContribution#contributionView');

  const listParams = listContributions.defs.main.parameters.properties;
  assert.deepEqual(Object.keys(listParams).sort(), ['authors', 'cursor', 'limit', 'sortDirection']);
  assert.equal(listParams.authors.maxLength, 100);
  assert.equal(listParams.authors.items.format, 'did');
  assert.deepEqual(listParams.sortDirection.enum, ['asc', 'desc']);
  assert.equal(listParams.sortDirection.default, 'desc');
  assert.equal(listParams.limit.minimum, 1);
  assert.equal(listParams.limit.maximum, 100);
  assert.equal(listParams.limit.default, 25);
  assert.equal(listContributions.defs.output.properties.contributions.items.ref, 'lex:org.hypercerts.claim.getContribution#contributionView');

  assert.equal(shared.defs.contributionView, undefined, 'contribution views belong to the owning query Lexicon');
  const view = getContribution.defs.contributionView;
  assert.deepEqual(view.required, ['uri', 'cid', 'indexedAt', 'did', 'author', 'record']);
  assert.deepEqual(view.nullable, ['indexedAt']);
  assert.equal(view.properties.author.ref, 'lex:org.hypercerts.api.defs#actorView');
  assert.equal(lexicons.getDefOrThrow('org.hypercerts.claim.getContribution#contributionView').properties.record.ref,
    'lex:org.hypercerts.claim.contribution');
  assert.deepEqual(shared.defs.actorView.nullable, ['profile', 'organization']);
});

if (hasModule('modules/entity-follow/manifest.json')) test('entity-follow view refs resolve from their endpoint-owned Lexicons', async () => {
  const { lexicons, documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  const shared = byId.get('org.hypercerts.api.defs');
  const get = byId.get('app.certified.graph.getEntityFollow');
  const followers = byId.get('app.certified.graph.listEntityFollowers');
  const following = byId.get('app.certified.graph.listEntityFollowing');

  for (const name of ['entityFollowRecordView', 'entityFollowerView', 'entityFollowingItem']) {
    assert.equal(shared.defs[name], undefined, `${name} is owned by its endpoint Lexicon`);
  }
  for (const [owner, name] of [
    ['app.certified.graph.getEntityFollow', 'entityFollowRecordView'],
    ['app.certified.graph.listEntityFollowers', 'entityFollowerView'],
    ['app.certified.graph.listEntityFollowing', 'entityFollowingItem'],
  ]) assert.equal(lexicons.getDefOrThrow(`${owner}#${name}`).type, 'object');

  assert.equal(get.defs.output.properties.follow.ref, 'lex:app.certified.graph.getEntityFollow#entityFollowRecordView');
  assert.equal(followers.defs.output.properties.followers.items.ref, 'lex:app.certified.graph.listEntityFollowers#entityFollowerView');
  assert.equal(followers.defs.entityFollowerView.properties.follow.ref, 'lex:app.certified.graph.getEntityFollow#entityFollowRecordView');
  assert.equal(following.defs.output.properties.entities.items.ref, 'lex:app.certified.graph.listEntityFollowing#entityFollowingItem');
  assert.equal(following.defs.entityFollowingItem.properties.follow.ref, 'lex:app.certified.graph.getEntityFollow#entityFollowRecordView');
});

test('installed ATProto validator accepts package language, transitive refs, and real fixture records', async () => {
  const { lexicons, isValidDid, isValidTid } = await validatePackageLexicons();
  const { jsonToLex, lexToJson } = await import('@atproto/lexicon');
  for (const record of [...locationRecords, ...profileRecords, ...organizationRecords, ...activityHttpFixtureRows]) {
    const decoded = jsonToLex(record.record);
    lexicons.assertValidRecord(record.collection, decoded);
    assert.deepEqual(lexToJson(decoded), record.record);
    assert.equal(isValidDid(record.did), true);
    if (['app.certified.location', 'org.hypercerts.claim.activity'].includes(record.collection)) assert.equal(isValidTid(record.rkey), true);
  }
});

test('fixture CIDs match their DAG-CBOR record contents', async () => {
  const { encode } = await import('@atcute/cbor');
  const CID = await import('@atcute/cid');
  for (const record of [...locationRecords, ...profileRecords, ...organizationRecords, ...activityHttpFixtureRows]) {
    assert.equal(CID.toString(await CID.create(0x71, encode(record.record))), record.cid);
  }
});

test('record validator rejects malformed embedded location payloads', async () => {
  const { lexicons } = await validatePackageLexicons();
  const { jsonToLex } = await import('@atproto/lexicon');
  const invalidRecord = { ...locationRecords[0].record };
  delete invalidRecord.locationType;
  assert.throws(() => lexicons.assertValidRecord('app.certified.location', jsonToLex(invalidRecord)), /locationType|property/);

  const invalidBlobRecord = structuredClone(locationRecords[2].record);
  invalidBlobRecord.location.blob.ref.$link = 'not-a-cid';
  assert.throws(() => lexicons.assertValidRecord('app.certified.location', jsonToLex(invalidBlobRecord)), /blob ref/);
});

if (hasModule('modules/vocab/manifest.json')) test('vocabulary-tag responses share the view owned by getVocabTag', async () => {
  const { lexicons, documents } = await validatePackageLexicons();
  const byId = new Map(documents.map((document) => [document.id, document]));
  const shared = byId.get('org.hypercerts.api.defs');
  const get = byId.get('org.hypercerts.vocab.getVocabTag');
  const list = byId.get('org.hypercerts.vocab.listVocabTags');
  assert.ok(shared && get && list);
  assert.equal(shared.defs.vocabTagView, undefined);
  assert.equal(get.defs.output.properties.vocabTag.ref, `lex:${get.id}#vocabTagView`);
  assert.equal(list.defs.output.properties.vocabTags.items.ref, `lex:${get.id}#vocabTagView`);
  assert.deepEqual(get.defs.vocabTagView.required, ['uri', 'cid', 'indexedAt', 'did', 'author', 'record']);
  assert.equal(get.defs.vocabTagView.properties.author.ref, 'lex:org.hypercerts.api.defs#actorView');
  assert.equal(lexicons.getDefOrThrow(`${get.id}#vocabTagView`).type, 'object');
});
