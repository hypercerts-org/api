function handle()
  local workscope_tags, cursor = workscope_tag_list()
  local response = { workscopeTags = toarray(workscope_tags) }
  if cursor then response.cursor = cursor end
  return response
end
