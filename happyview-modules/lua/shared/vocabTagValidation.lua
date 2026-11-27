local VOCAB_TAG = "org.hypercerts.vocab.tag"

local function valid_vocab_tag_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= VOCAB_TAG then return false end
  return valid_did(authority)
end

