-- The hex prologue every list cursor shape shares: rejects empty, over-long (8192),
-- odd-length and non-lowercase-hex tokens with "cursor is malformed" and returns the
-- decoded JSON text. Shape and JSON checks stay with each cursor's own decoder.
local function decode_hex_cursor_token(token)
  if #token == 0 or #token > 8192 or #token % 2 ~= 0 or token:find("[^0-9a-f]") then
    invalid("cursor is malformed")
  end
  return (token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end))
end
