import { makeDateCaseRows } from './bad-dates.js';
import { locationRecords } from './records.js';

const [locationRecord] = locationRecords;
if (!locationRecord) throw new Error('Bad-date fixture generation requires a location record in records.js');

export const badDateLocations = await makeDateCaseRows(locationRecord, {
  did: 'did:plc:baddatefixturesexamplexx',
  decorateRecord: (record, rkey) => ({
    ...record, locationType: 'date-test', name: `Date test ${rkey}`, description: 'Synthetic timestamp fixture',
  }),
});
