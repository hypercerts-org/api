local LIKE = "app.certified.feed.like"
local REPOST = "app.certified.feed.repost"

local function reaction_count_valid_did_percent_escapes(authority)
  local index = 1
  while index <= #authority do
    if authority:sub(index, index) == "%" then
      if not authority:sub(index + 1, index + 2):match("^%x%x$") then return false end
      index = index + 3
    else
      index = index + 1
    end
  end
  return true
end

local function reaction_count_valid_nsid(value)
  if type(value) ~= "string" or #value > 317 then return false end
  local segments = {}
  for segment in value:gmatch("[^%.]+") do segments[#segments + 1] = segment end
  if #segments < 3 or table.concat(segments, ".") ~= value then return false end
  for index = 1, #segments - 1 do
    local segment = segments[index]
    if #segment > 63 or segment:find("[^A-Za-z0-9%-]") then return false end
    local first, last = segment:sub(1, 1), segment:sub(-1)
    if not first:match(index == 1 and "^[A-Za-z]$" or "^[A-Za-z0-9]$")
      or not last:match("^[A-Za-z0-9]$") then return false end
  end
  local name = segments[#segments]
  return #name <= 63 and name:match("^[A-Za-z][A-Za-z0-9]*$") ~= nil
end

local function reaction_count_subjects()
  local value = params.subjects
  if value == nil then invalid("subjects is required") end

  local supplied = {}
  if type(value) == "string" then
    supplied[1] = scalar(params, "subjects")
  elseif type(value) == "table" then
    local count = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid("subjects must use repeated query values")
      end
      count = count + 1
      if count > 100 then invalid("subjects must contain 1 through 100 AT-URIs") end
    end
    if count ~= #value then invalid("subjects must use repeated query values") end
    for index = 1, count do
      if type(value[index]) ~= "string" then invalid("subjects entries must be strings") end
      supplied[#supplied + 1] = value[index]
    end
  else
    invalid("subjects must be a string or repeated string parameter")
  end

  if #supplied < 1 or #supplied > 100 then
    invalid("subjects must contain 1 through 100 AT-URIs")
  end

  local unique, seen = {}, {}
  for _, subject in ipairs(supplied) do
    local valid, collection, authority = valid_record_uri(subject)
    if not valid or not reaction_count_valid_did_percent_escapes(authority)
      or not reaction_count_valid_nsid(collection) then
      invalid("each subjects value must be a full AT-URI with a valid DID authority and collection NSID")
    end
    if not seen[subject] then
      seen[subject] = true
      unique[#unique + 1] = subject
    end
  end
  return supplied, unique
end

local function reaction_count_query(subjects)
  local backend_ok, backend = pcall(db.backend)
  if not backend_ok or backend ~= "postgres" then
    error("ReactionCountQueryFailed: reaction counts require PostgreSQL", 0)
  end

  local values = { LIKE, REPOST }
  local placeholders = {}
  for _, subject in ipairs(subjects) do
    values[#values + 1] = subject
    placeholders[#placeholders + 1] = "$" .. #values
  end

  local subject_uri = "record::jsonb->'subject'->>'uri'"
  local sql = "SELECT " .. subject_uri .. " AS subject_uri, " ..
    "COUNT(DISTINCT did) FILTER (WHERE collection = $1) AS like_count, " ..
    "COUNT(DISTINCT did) FILTER (WHERE collection = $2) AS repost_count " ..
    "FROM happyview_records WHERE collection IN ($1, $2) AND " .. subject_uri ..
    " IN (" .. table.concat(placeholders, ", ") .. ") GROUP BY " .. subject_uri
  local ok, rows = pcall(db.raw, sql, values)
  if not ok or type(rows) ~= "table" then
    error("ReactionCountQueryFailed: indexed reaction count query failed", 0)
  end
  return rows
end

local function reaction_count_number(value)
  local count = tonumber(value)
  if not count or count < 0 or count % 1 ~= 0 then
    error("ReactionCountQueryFailed: indexed reaction count was unavailable", 0)
  end
  return count
end

local function get_reaction_counts(subjects, unique_subjects)
  local counts_by_subject = {}
  for _, row in ipairs(reaction_count_query(unique_subjects)) do
    if type(row) ~= "table" or type(row.subject_uri) ~= "string" then
      error("ReactionCountQueryFailed: indexed reaction count subject was unavailable", 0)
    end
    counts_by_subject[row.subject_uri] = {
      likeCount = reaction_count_number(row.like_count),
      repostCount = reaction_count_number(row.repost_count),
    }
  end

  local counts = {}
  for _, subject in ipairs(subjects) do
    local indexed = counts_by_subject[subject]
    counts[#counts + 1] = {
      subject = subject,
      likeCount = indexed and indexed.likeCount or 0,
      repostCount = indexed and indexed.repostCount or 0,
    }
  end
  return { counts = toarray(counts) }
end

function handle()
  keys_only(params, { subjects = true })
  local subjects, unique_subjects = reaction_count_subjects()
  return get_reaction_counts(subjects, unique_subjects)
end
