// Type-level tests for the built package: compiled by `pnpm test`
// (tsconfig.test.json), never run. Each @ts-expect-error must stay an error.
import { Client } from "@atproto/lex";
import {
  type ActivityView,
  type ApiDefs,
  type GetActivity,
  type GetBadgeDefinition,
  getActivity,
  listBadgeAwards,
} from "@hypercerts-org/api";
import type { Activity } from "@hypercerts-org/lexicon/records";

const api = new Client("https://api.example");
const uri = "at://did:plc:abc123/org.hypercerts.claim.activity/3k2abc" as const;

export async function views(): Promise<ActivityView> {
  const { activity } = await api.call(getActivity, { uri });
  return activity;
}

// Embedded records are the record types from @hypercerts-org/lexicon/records.
export const record = (view: ActivityView): Activity => view.record;

export const params: GetActivity.$Params = { uri };
export const profile = (view: ApiDefs.ProfileView): string => view.did;
export type NamespaceOnly = GetBadgeDefinition.BadgeDefinitionView;

export async function awards() {
  const { badgeAwards } = await api.call(listBadgeAwards, { limit: 5 });
  return badgeAwards;
}

// @ts-expect-error unknown parameter
export const unknownParam = () => api.call(getActivity, { uri, nope: 1 });

// @ts-expect-error uri is required
export const missingUri = () => api.call(getActivity, {});
