-- Some clients wrote account follows whose `via` points at the followed
-- account's own org.hypercerts.collection, using the account follow as a
-- project follow. Those records stay indexed but are not account follows, so
-- every account-follow query applies this predicate in its WHERE clause, before
-- any per-relationship deduplication, so a user's genuine follow of the same
-- account is still found.
--
-- The rule is deliberately narrow: only a collection owned by the subject
-- matches. A starter pack, list, or collection owned by another DID is a real
-- mediating record and is kept. COALESCE keeps records with no usable `via`.
-- The expression only reads the row's own `record`, so it adds a per-row filter
-- on rows already selected by collection, subject, or publisher.
local function account_follow_filter_sql()
  return "NOT COALESCE(starts_with(record::jsonb->'via'->>'uri', 'at://' || (record::jsonb->>'subject') || '/org.hypercerts.collection/'), FALSE)"
end
