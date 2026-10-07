local EVALUATION = "org.hypercerts.context.evaluation"
local EVALUATOR_HYDRATION_LIMIT = 100

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
    for source_position, source in ipairs(sources) do
      if type(source) == "table" and valid_did(source.did) then
        local projection_position = #projections + 1
        local evaluator = {}
        for key, value in pairs(source) do evaluator[key] = value end
        if source_position <= EVALUATOR_HYDRATION_LIMIT then
          evaluator.hydrationStatus = "hydrated"
          local actor = { did = source.did }
          actors[#actors + 1] = actor
          hydrated_actors[projection_position] = actor
        else
          evaluator.hydrationStatus = "omitted"
          evaluator.profile = nil
          evaluator.organization = nil
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
      projections[position].profile = actor.profile
      projections[position].organization = actor.organization
    end
    view.evaluators = toarray(projections)
  end
end
