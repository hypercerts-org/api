local EVALUATION = "org.hypercerts.context.evaluation"
local EVALUATOR_HYDRATION_LIMIT = 100
local EVALUATION_NULL = json.decode("null")

local function evaluation_query(sql, values)
  if db.backend() ~= "postgres" then
    error("EvaluationQueryFailed: evaluation API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("EvaluationQueryFailed: evaluation lookup failed", 0)
  end
  return result
end

local function evaluation_evaluator_array(value)
  if type(value) ~= "table" then return nil end
  local count = 0
  for key in pairs(value) do
    if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then return nil end
    count = count + 1
  end
  if count ~= #value then return nil end
  return value
end

local function evaluation_view(row, skip_invalid)
  local view = record_view(row)
  if type(view.record) ~= "table" then
    if skip_invalid then return nil end
    error("EvaluationQueryFailed: indexed evaluation has no evaluator array", 0)
  end
  local evaluators = evaluation_evaluator_array(view.record.evaluators)
  if evaluators and #evaluators > 1000 then
    if skip_invalid then return nil end
    error("EvaluationQueryFailed: indexed evaluation exceeds the evaluator limit", 0)
  end
  view.author = { did = row.did }
  return view
end

local function hydrate_evaluation_views(views)
  local actors = {}
  local evaluator_projections = {}
  local evaluator_actors = {}

  for view_index, view in ipairs(views) do
    actors[#actors + 1] = view.author
    local projections, hydrated_actors = {}, {}
    local sources = evaluation_evaluator_array(view.record.evaluators) or {}
    for _, source in ipairs(sources) do
      if type(source) == "table" and valid_did(source.did) then
        local projection_position = #projections + 1
        local evaluator = { did = source.did }
        -- Only the first 100 response entries are looked up; later ones carry just the DID.
        if projection_position <= EVALUATOR_HYDRATION_LIMIT then
          local actor = { did = source.did }
          actors[#actors + 1] = actor
          hydrated_actors[projection_position] = actor
        end
        projections[projection_position] = evaluator
      end
    end
    evaluator_projections[view_index] = projections
    evaluator_actors[view_index] = hydrated_actors
  end

  hydrate_actor_views(actors, evaluation_query)

  for view_index, view in ipairs(views) do
    local projections = evaluator_projections[view_index]
    for position, actor in pairs(evaluator_actors[view_index]) do
      if actor.profile ~= EVALUATION_NULL then projections[position].profile = actor.profile end
      if actor.organization ~= EVALUATION_NULL then projections[position].organization = actor.organization end
    end
    view.evaluators = toarray(projections)
  end
end
