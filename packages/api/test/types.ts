// Type-level tests for the built package: compiled by `pnpm test`
// (tsconfig.test.json), never run. Each @ts-expect-error must stay an error.
import { Client, type l } from "@atproto/lex";
import { app, org } from "@hypercerts-org/api";
import type { org as records } from "@hypercerts-org/lexicon";

const api = new Client("https://api.example");
const uri = "at://did:plc:abc123/org.hypercerts.claim.activity/3k2abc" as const;

type ActivityView = org.hypercerts.claim.getActivity.ActivityView;

export async function views(): Promise<ActivityView> {
  const { activity } = await api.call(org.hypercerts.claim.getActivity, { uri });
  return activity;
}

// Records in the API tree are the modules of @hypercerts-org/lexicon.
export const record = (view: ActivityView): records.hypercerts.claim.activity.Main => view.record;
export const sameRecord = (
  activity: records.hypercerts.claim.activity.Main,
): org.hypercerts.claim.activity.Main => activity;

export const params: org.hypercerts.claim.getActivity.$Params = { uri };
export const profile = (view: org.hypercerts.api.defs.ProfileView): string => view.did;
export type BadgeDefinitionView = app.certified.badge.getBadgeDefinition.BadgeDefinitionView;

export async function awards() {
  const { badgeAwards } = await api.call(app.certified.badge.listBadgeAwards, { limit: 5 });
  return badgeAwards;
}

export async function actorViews(did: l.DidString): Promise<org.hypercerts.api.defs.ActorView[]> {
  const { actor } = await api.call(app.certified.actor.getActor, { actor: did });
  const { actors } = await api.call(app.certified.actor.getActors, { actors: [did, did] });
  return [actor, ...actors];
}

export async function organizationRecordFromActor(did: l.DidString) {
  const { actor } = await api.call(app.certified.actor.getOrganization, { actor: did });
  return actor.organization?.record;
}

export function uncheckedOrganizationUri(actor: org.hypercerts.api.defs.ActorView) {
  // @ts-expect-error shared ActorView types require narrowing the nullable sidecar
  return actor.organization.uri;
}

// @ts-expect-error unknown parameter
export const unknownParam = () => api.call(org.hypercerts.claim.getActivity, { uri, nope: 1 });

// @ts-expect-error uri is required
export const missingUri = () => api.call(org.hypercerts.claim.getActivity, {});
