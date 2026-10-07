const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const reference = value => {
  if (typeof value === 'string') return value;
  const item = object(value);
  return typeof item.uri === 'string' ? item.uri : typeof item.did === 'string' ? item.did : undefined;
};
const values = value => (Array.isArray(value) ? value : [value]).map(reference).filter(value => value !== undefined);
export const view = row => {
  const item = object(row);
  if (item.follow && typeof item.follow === 'object') return view(item.follow);
  if (item.organization && typeof item.organization === 'object') return view(item.organization);
  return item;
};
export const identity = row => {
  const item = object(row);
  const source = view(item);
  return [source.uri, item.itemIdentifier?.uri, item.uri, item.did].find(value => typeof value === 'string');
};

/** Independently interpret returned records; these are not copied SQL predicates. */
export function filterValues(row, filter) {
  const item = object(row);
  const source = view(item);
  const record = object(source.record);
  switch (filter) {
    case 'authors': case 'actors': return values(source.did);
    case 'uris': return values(source.uri);
    case 'organizationTypes': return values(record.organizationType);
    case 'visibility': return values(record.visibility);
    case 'types': return values(record.type);
    case 'locationTypes': return values(record.locationType);
    case 'contentTypes': return values(record.contentType);
    case 'addresses': return values(record.address).map(value => value.toLowerCase());
    case 'badgeUris': return values(record.badge);
    case 'badgeTypes': return values(object(object(item.badge).record).badgeType ?? record.badgeType);
    case 'responses': return values(item.responseStatus);
    case 'badgeAward': return values(record.badgeAward);
    case 'subjects': return values(record.subjects ?? record.subject);
    case 'evaluators': return (Array.isArray(record.evaluators) ? record.evaluators : [])
      .map(entry => object(entry).did).filter(value => typeof value === 'string');
    case 'from': case 'to': return values(record[filter]).filter(value => value.startsWith('did:') || value.startsWith('at://'));
    case 'forUris': return values(record.for);
    case 'transactionIds': return values(record.transactionId);
    case 'tagUris': return values(record.tags);
    case 'itemUris': return values(Array.isArray(record.items) ? record.items.map(entry => object(entry).itemIdentifier) : []);
    case 'contributors': return [...new Set((Array.isArray(item.contributors) ? item.contributors : []).flatMap(entry => {
      const contributor = object(entry);
      const contributorIdentity = object(contributor.contributorIdentity);
      const information = object(contributor.contributorInformation);
      return values(contributorIdentity.identity ?? contributorIdentity.did ?? object(information.record).identifier).filter(value => value.startsWith('did:'));
    }))];
    case 'involvedActors': return [...new Set([...filterValues(item, 'authors'), ...filterValues(item, 'contributors')])];
    case 'hasOrganizationRecord': {
      const author = object(item.author);
      if (!Object.hasOwn(author, 'organization')) return [];
      if (author.organization === null) return [false];
      return author.organization && typeof author.organization === 'object' && !Array.isArray(author.organization) ? [true] : [];
    }
    case 'search': {
      const profile = object(object(item.profile).record);
      return [record.title, record.shortDescription, record.displayName, record.description, profile.displayName, profile.description]
        .filter(value => typeof value === 'string');
    }
    case 'before': return values(record.createdAt);
    default: throw new Error(`No semantic adapter for filter ${filter}; add one before enabling this endpoint.`);
  }
}

export function matches(row, filter, expected) {
  const actual = filterValues(row, filter);
  if (filter === 'search') return actual.some(value => value.toLowerCase().includes(String(expected).trim().toLowerCase())) || !String(expected).trim();
  if (filter === 'before') {
    const cutoff = Date.parse(expected);
    return Number.isFinite(cutoff) && actual.some(value => Date.parse(value) < cutoff);
  }
  const wanted = (Array.isArray(expected) ? expected : [expected])
    .filter(value => filter === 'hasOrganizationRecord' ? typeof value === 'boolean' : typeof value === 'string')
    .map(value => filter === 'addresses' ? value.toLowerCase() : value);
  if (!wanted.length) return false;
  return filter === 'tagUris' ? wanted.every(value => actual.includes(value)) : wanted.some(value => actual.includes(value));
}
