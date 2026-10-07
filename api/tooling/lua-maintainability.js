import { readFile } from 'node:fs/promises';
import path from 'node:path';

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function mapConcurrentInOrder(items, mapItem) {
  const results = await Promise.all(items.map(async (item, index) => {
    try {
      return { ok: true, value: await mapItem(item, index) };
    } catch (error) {
      return { ok: false, error };
    }
  }));
  const firstFailure = results.find(({ ok }) => !ok);
  if (firstFailure) throw firstFailure.error;
  return results.map(({ value }) => value);
}

function resolveInside(root, base, relativePath, description) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`${description} must be a nonempty path in the API manifests`);
  }
  const resolved = path.resolve(base, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${description} resolves outside the API package: ${relativePath}`);
  }
  return resolved;
}

async function readJson(file, description) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${description} at ${file}: ${error.message}`, { cause: error });
  }
}

async function loadRegisteredApi(root) {
  const packageRoot = path.resolve(root);
  const manifestFile = path.join(packageRoot, 'manifest.json');
  const rootManifest = await readJson(manifestFile, 'root API manifest');
  if (!Array.isArray(rootManifest.modules)) throw new Error(`Root API manifest ${manifestFile} must declare a modules array`);

  const manifestEntries = await mapConcurrentInOrder(rootManifest.modules, async (modulePath) => {
    const moduleFile = resolveInside(packageRoot, packageRoot, modulePath, 'Module manifest path');
    const module = await readJson(moduleFile, 'module manifest');
    if (!Array.isArray(module.assets)) throw new Error(`Lua module manifest ${moduleFile} must declare an assets array`);
    return { moduleFile, module };
  });
  const modules = [];
  const handlers = [];
  const lexicons = new Map();
  for (const { moduleFile, module } of manifestEntries) {
    modules.push({ file: moduleFile, assets: module.assets });
    for (const asset of module.assets) {
      if (asset.kind === 'lexicon' && typeof asset.id === 'string') {
        const records = lexicons.get(asset.id) ?? [];
        records.push({ asset, moduleFile });
        lexicons.set(asset.id, records);
      }
      if (asset.kind === 'script' && asset.config?.script_type === 'lua') {
        handlers.push({ asset, moduleFile });
      }
    }
  }
  return { packageRoot, modules, handlers, lexicons };
}

function declaredSharedSources(handler) {
  const declaration = handler.sharedSourcePaths
    ?? (handler.sharedSourcePath ? [handler.sharedSourcePath] : []);
  if (!Array.isArray(declaration) || declaration.some((source) => typeof source !== 'string' || !source.trim())) {
    throw new Error(`${handler.id ?? '(unnamed Lua handler)'} must declare sharedSourcePaths as nonempty paths`);
  }
  return declaration;
}

async function authoredSources(api, handlerRecord) {
  const { asset, moduleFile } = handlerRecord;
  const moduleDirectory = path.dirname(moduleFile);
  const endpoint = asset.id ?? '(unnamed Lua handler)';
  const declarations = [
    ...declaredSharedSources(asset).map((source) => ({ path: source, kind: 'shared' })),
    { path: asset.sourcePath, kind: 'handler' },
  ];
  const results = await mapConcurrentInOrder(declarations, async (declaration) => {
    if (!declaration.path) {
      return {
        diagnostic: {
          status: 'error',
          code: 'lua-source-missing',
          endpoint,
          message: `${endpoint}: no authored ${declaration.kind} source is declared in ${path.relative(api.packageRoot, moduleFile)}; add ${declaration.kind === 'handler' ? 'sourcePath' : 'sharedSourcePaths'} to the module manifest.`,
        },
      };
    }
    const file = resolveInside(api.packageRoot, moduleDirectory, declaration.path, `${endpoint} ${declaration.kind} source`);
    const relativeFile = path.relative(api.packageRoot, file);
    try {
      const source = await readFile(file, 'utf8');
      return { source: { file, relativeFile, kind: declaration.kind, source } };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return {
        diagnostic: {
          status: 'error',
          code: 'lua-source-missing',
          endpoint,
          file: relativeFile,
          message: `${endpoint}: declared ${declaration.kind} Lua source ${relativeFile} is missing (from ${path.relative(api.packageRoot, moduleFile)}); restore it or correct the manifest source path.`,
        },
      };
    }
  });
  return {
    sources: results.flatMap(({ source }) => source ? [source] : []),
    diagnostics: results.flatMap(({ diagnostic }) => diagnostic ? [diagnostic] : []),
  };
}

function longBracketEnd(source, start) {
  const open = source.slice(start).match(/^\[(=*)\[/);
  if (!open) return null;
  const close = `]${open[1]}]`;
  const end = source.indexOf(close, start + open[0].length);
  return end < 0 ? source.length : end + close.length;
}

function countLineBreaks(source) {
  return (source.match(/\n/g) ?? []).length;
}

function consumeLuaWhitespace(source, index, line) {
  if (!/\s/.test(source[index])) return null;
  return { index: index + 1, line: line + (source[index] === '\n' ? 1 : 0) };
}

function consumeLuaComment(source, index, line) {
  if (!source.startsWith('--', index)) return null;
  const longEnd = longBracketEnd(source, index + 2);
  if (longEnd !== null) {
    const comment = source.slice(index, longEnd);
    return { index: longEnd, line: line + countLineBreaks(comment) };
  }
  const newline = source.indexOf('\n', index);
  return { index: newline < 0 ? source.length : newline, line };
}

function consumeQuotedLuaString(source, index, line, tokens) {
  const startLine = line;
  const quote = source[index];
  let value = '';
  let staticValue = true;
  let nextIndex = index + 1;
  let nextLine = line;
  while (nextIndex < source.length && source[nextIndex] !== quote) {
    if (source[nextIndex] === '\n') nextLine += 1;
    if (source[nextIndex] === '\\') {
      staticValue = false;
      nextIndex += Math.min(2, source.length - nextIndex);
    } else {
      value += source[nextIndex];
      nextIndex += 1;
    }
  }
  if (source[nextIndex] === quote) nextIndex += 1;
  tokens.push({ type: 'string', value: staticValue ? value : null, line: startLine });
  return { index: nextIndex, line: nextLine };
}

function consumeLongLuaString(source, index, line, tokens) {
  const longEnd = source[index] === '[' ? longBracketEnd(source, index) : null;
  if (longEnd === null) return null;
  const raw = source.slice(index, longEnd);
  tokens.push({ type: 'string', value: null, line });
  return { index: longEnd, line: line + countLineBreaks(raw) };
}

function consumeLuaWord(source, index, line, tokens, pattern, type) {
  const match = source.slice(index).match(pattern);
  if (!match) return null;
  tokens.push({ type, value: match[0], line });
  return index + match[0].length;
}

function consumeLuaSymbol(source, index, line, tokens) {
  const operator = ['...', '..', '==', '~=', '<=', '>=', '//', '::']
    .find((candidate) => source.startsWith(candidate, index));
  const value = operator ?? source[index];
  tokens.push({ type: 'symbol', value, line });
  return index + value.length;
}

function tokenizeLua(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const whitespace = consumeLuaWhitespace(source, index, line);
    if (whitespace !== null) {
      index = whitespace.index;
      line = whitespace.line;
      continue;
    }
    const comment = consumeLuaComment(source, index, line);
    if (comment !== null) {
      index = comment.index;
      line = comment.line;
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'") {
      const string = consumeQuotedLuaString(source, index, line, tokens);
      index = string.index;
      line = string.line;
      continue;
    }
    const longString = consumeLongLuaString(source, index, line, tokens);
    if (longString !== null) {
      index = longString.index;
      line = longString.line;
      continue;
    }
    const identifierEnd = consumeLuaWord(source, index, line, tokens, /^[A-Za-z_]\w*/, 'identifier');
    if (identifierEnd !== null) {
      index = identifierEnd;
      continue;
    }
    const numberEnd = consumeLuaWord(source, index, line, tokens, /^\d+(?:\.\d+)?/, 'number');
    if (numberEnd !== null) {
      index = numberEnd;
      continue;
    }
    index = consumeLuaSymbol(source, index, line, tokens);
  }
  return tokens;
}

function matchingClose(tokens, start, open, close) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    else if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(tokens, separator) {
  const parts = [];
  let start = 0;
  const stack = [];
  const closing = { '(': ')', '{': '}', '[': ']' };
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (closing[value]) stack.push(closing[value]);
    else if (stack.at(-1) === value) stack.pop();
    else if (value === separator && stack.length === 0) {
      parts.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(tokens.slice(start));
  return parts;
}

function literalTableKeys(tokens) {
  if (tokens[0]?.value !== '{' || matchingClose(tokens, 0, '{', '}') !== tokens.length - 1) {
    return { status: 'unverified', reason: 'the keys_only allow-list is dynamic or is not a literal table' };
  }
  const keys = [];
  const fields = splitTopLevel(tokens.slice(1, -1), ',').filter((field) => field.length > 0);
  for (const field of fields) {
    let key;
    let valueIndex;
    if (field.length === 3 && field[0].type === 'identifier' && field[1].value === '=') {
      key = field[0].value;
      valueIndex = 2;
    } else if (field.length === 5 && field[0].value === '[' && field[1].type === 'string'
      && field[1].value !== null && field[2].value === ']' && field[3].value === '=') {
      key = field[1].value;
      valueIndex = 4;
    } else {
      return { status: 'unverified', reason: 'the keys_only table contains a computed or unsupported field' };
    }
    if (field[valueIndex].value !== 'true' || field[valueIndex].type !== 'identifier') {
      return { status: 'unverified', reason: 'the keys_only table does not use literal true values' };
    }
    keys.push(key);
  }
  return { status: 'verified', keys };
}

const LOCAL_BINDING_BOUNDARIES = new Set(['function', 'end', 'if', 'for', 'while', 'do', 'repeat', 'until', 'else', 'elseif']);

function localLiteralTable(tokens, name, callIndex) {
  const declarations = [];
  for (let index = 0; index + 3 < callIndex; index += 1) {
    if (tokens[index].value !== 'local' || tokens[index + 1].value !== name || tokens[index + 2].value !== '=') continue;
    const start = index + 3;
    if (tokens[start]?.value !== '{') return null;
    const end = matchingClose(tokens, start, '{', '}');
    if (end < 0 || end >= callIndex) return null;
    declarations.push({ index, end, expression: tokens.slice(start, end + 1) });
  }
  if (declarations.length !== 1) return null;
  const declaration = declarations[0];
  for (let index = declaration.end + 1; index < callIndex; index += 1) {
    if (LOCAL_BINDING_BOUNDARIES.has(tokens[index].value)) return null;
    if (tokens[index].value === name) return null;
  }
  return declaration.expression;
}

const PARAMETER_ALLOWLIST_CALLS = new Set(['keys_only', 'collection_keys_only', 'collection_items_keys_only']);

function keysOnlyCalls(tokens) {
  const calls = [];
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const name = tokens[index].value;
    const previous = tokens[index - 1]?.value;
    const isFunctionDeclaration = previous === 'function'
      || ((previous === '.' || previous === ':') && tokens[index - 3]?.value === 'function');
    if (tokens[index].type !== 'identifier' || !PARAMETER_ALLOWLIST_CALLS.has(name)
      || tokens[index + 1].value !== '(' || isFunctionDeclaration) continue;
    const close = matchingClose(tokens, index + 1, '(', ')');
    if (close < 0) continue;
    const args = splitTopLevel(tokens.slice(index + 2, close), ',');
    if (args.length < 2) continue;
    calls.push({ index, name, args, line: tokens[index].line, qualified: previous === '.' || previous === ':' });
  }
  return calls;
}

function inspectParameterSources(sources) {
  const calls = sources.flatMap((source) => {
    const tokens = tokenizeLua(source.source);
    return keysOnlyCalls(tokens).map((call) => ({ ...call, tokens, source }));
  });
  const qualifiedCall = calls.find(({ qualified }) => qualified);
  if (qualifiedCall) {
    return {
      status: 'unverified',
      reason: 'qualified keys_only methods are unsupported and are not treated as query allow-list checks',
      file: qualifiedCall.source.relativeFile,
      line: qualifiedCall.line,
    };
  }
  const queryCalls = calls.filter(({ args }) => args[0]?.length === 1
    && ['params', 'request_params'].includes(args[0][0].value));
  if (calls.length > 0 && queryCalls.length === 0) {
    return { status: 'unverified', reason: 'keys_only does not receive a recognizable params or request_params value in this bundle' };
  }
  const candidates = queryCalls;
  if (candidates.length !== 1) {
    return {
      status: 'unverified',
      reason: candidates.length === 0
        ? 'no recognizable keys_only allow-list appears in the ordered handler bundle; validation may be delegated or use another pattern'
        : 'the ordered handler bundle contains multiple keys_only calls, so the query-specific allow-list is ambiguous',
    };
  }
  const call = candidates[0];
  const [values, expression] = call.args;
  if (values.length !== 1 || values[0].type !== 'identifier') {
    return { status: 'unverified', reason: 'the keys_only values argument is dynamic or unsupported', file: call.source.relativeFile, line: call.line };
  }
  let allowList = expression;
  if (expression.length === 1 && expression[0].type === 'identifier') {
    allowList = localLiteralTable(call.tokens, expression[0].value, call.index);
  }
  if (!allowList) return { status: 'unverified', reason: 'the keys_only allow-list is dynamic or unsupported', file: call.source.relativeFile, line: call.line };
  return { ...literalTableKeys(allowList), file: call.source.relativeFile, line: call.line };
}

function queryParameters(lexicon) {
  const main = lexicon?.defs?.main;
  if (main?.type !== 'query') return { status: 'unverified', reason: 'the registered Lexicon is not a recognizable query' };
  const parameters = main.parameters;
  if (parameters === undefined) return { status: 'verified', names: [] };
  if (parameters?.type !== 'params' || !parameters.properties || typeof parameters.properties !== 'object' || Array.isArray(parameters.properties)) {
    return { status: 'unverified', reason: 'the Lexicon parameter schema is not a recognizable params object' };
  }
  return { status: 'verified', names: Object.keys(parameters.properties).sort(compareCodeUnits) };
}

function unverifiedParameter(id, file, reason, line) {
  let location = '';
  if (file) {
    location = ` in ${file}`;
    if (line) location += `:${line}`;
  }
  return {
    status: 'unverified',
    code: 'parameter-contract-unverified',
    endpoint: id,
    file,
    line,
    message: `${id}: parameter contract unverified${location}: ${reason}`,
  };
}

function lexiconPath(api, records, id) {
  if (records.length !== 1) return null;
  const { asset, moduleFile } = records[0];
  if (asset.path) return resolveInside(api.packageRoot, path.dirname(moduleFile), asset.path, `Lexicon ${id} path`);
  if (asset.packagePath) return resolveInside(api.packageRoot, api.packageRoot, asset.packagePath, `Lexicon ${id} package path`);
  return null;
}

function parameterDiagnosticsForHandler(api, handlerRecord, sources) {
  const { asset } = handlerRecord;
  if (typeof asset.id !== 'string' || !asset.id.startsWith('xrpc.query:')) return { diagnostics: [], verified: false, query: false };
  const id = asset.id.slice('xrpc.query:'.length);
  const records = api.lexicons.get(id) ?? [];
  if (records.length !== 1) {
    return {
      diagnostics: [unverifiedParameter(asset.id, asset.sourcePath, records.length ? 'multiple registered Lexicon assets use this query id' : 'no Lexicon asset with this id appears in the root manifest registered modules')],
      verified: false,
      query: true,
    };
  }
  const file = lexiconPath(api, records, id);
  if (!file) return { diagnostics: [unverifiedParameter(asset.id, asset.sourcePath, 'the registered Lexicon asset has no path')], verified: false, query: true };
  return { id, file, sources, query: true };
}

async function compareParameterContracts(api, handlerRecord, sources) {
  const prep = parameterDiagnosticsForHandler(api, handlerRecord, sources);
  if (prep.diagnostics) return { diagnostics: prep.diagnostics, verified: prep.verified, query: prep.query };
  const { asset } = handlerRecord;
  const lexicon = await readJson(prep.file, `registered Lexicon ${prep.id}`);
  const contract = queryParameters(lexicon);
  if (contract.status !== 'verified') {
    return { diagnostics: [unverifiedParameter(asset.id, asset.sourcePath, contract.reason)], verified: false, query: true };
  }
  const inspection = inspectParameterSources(sources);
  if (inspection.status !== 'verified') {
    return {
      diagnostics: [unverifiedParameter(asset.id, inspection.file ?? asset.sourcePath, inspection.reason, inspection.line)],
      verified: false,
      query: true,
    };
  }
  const actual = [...new Set(inspection.keys)].sort(compareCodeUnits);
  const missing = contract.names.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !contract.names.includes(name));
  if (!missing.length && !extra.length) return { diagnostics: [], verified: true, query: true };
  const file = inspection.file;
  const mismatchDetails = [];
  if (missing.length) mismatchDetails.push(`missing: ${missing.join(', ')}`);
  if (extra.length) mismatchDetails.push(`extra: ${extra.join(', ')}`);
  const mismatchSuffix = mismatchDetails.length > 0 ? `; ${mismatchDetails.join('; ')}` : '';
  return {
    diagnostics: [{
      status: 'error',
      code: 'parameter-contract-mismatch',
      endpoint: asset.id,
      file,
      line: inspection.line,
      expected: contract.names,
      actual,
      missing,
      extra,
      message: `${asset.id}: Lua parameter allow-list in ${file}:${inspection.line} differs from its Lexicon${mismatchSuffix}`,
    }],
    verified: true,
    query: true,
  };
}

const LUA_GLOBALS = new Set([
  '_G', '_VERSION', 'assert', 'collectgarbage', 'coroutine', 'debug', 'dofile', 'error', 'getmetatable', 'io', 'ipairs',
  'load', 'loadfile', 'math', 'next', 'os', 'package', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset',
  'select', 'setmetatable', 'string', 'table', 'tonumber', 'tostring', 'type', 'utf8', 'warn', 'xpcall',
]);

async function luacheckGlobals(root) {
  const globals = new Set(LUA_GLOBALS);
  let source;
  try {
    source = await readFile(path.join(root, '.luacheckrc'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return globals;
    throw error;
  }
  const tokens = tokenizeLua(source);
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (!['globals', 'read_globals'].includes(tokens[index].value) || tokens[index + 1].value !== '=' || tokens[index + 2].value !== '{') continue;
    const close = matchingClose(tokens, index + 2, '{', '}');
    if (close < 0) continue;
    for (const token of tokens.slice(index + 3, close)) {
      if (token.type === 'string' && token.value !== null) globals.add(token.value);
    }
  }
  return globals;
}

function addFunctionDeclaration(tokens, index, blocks, declarations) {
  if (tokens[index + 1]?.type !== 'identifier' || tokens[index + 2]?.value !== '(') return;
  declarations.push({
    name: tokens[index + 1].value,
    line: tokens[index].line,
    index,
    topLevel: blocks.length === 0,
    local: tokens[index - 1]?.value === 'local',
  });
}

function updateFunctionBlocks(value, blocks, loopsAwaitingDo) {
  if (value === 'function' || value === 'if' || value === 'repeat') {
    blocks.push(value);
    return loopsAwaitingDo;
  }
  if (value === 'for' || value === 'while') {
    blocks.push('loop');
    return loopsAwaitingDo + 1;
  }
  if (value === 'do') {
    if (loopsAwaitingDo > 0) return loopsAwaitingDo - 1;
    blocks.push('do');
    return loopsAwaitingDo;
  }
  if (value === 'end' && blocks.length > 0 && blocks.at(-1) !== 'repeat') {
    blocks.pop();
    return loopsAwaitingDo;
  }
  if (value === 'until' && blocks.at(-1) === 'repeat') blocks.pop();
  return loopsAwaitingDo;
}

function functionDeclarations(tokens) {
  const declarations = [];
  const blocks = [];
  let loopsAwaitingDo = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'identifier') continue;
    const { value } = tokens[index];
    if (value === 'function') addFunctionDeclaration(tokens, index, blocks, declarations);
    loopsAwaitingDo = updateFunctionBlocks(value, blocks, loopsAwaitingDo);
  }
  return declarations;
}

function functionCalls(tokens) {
  const calls = [];
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (tokens[index].type !== 'identifier' || tokens[index].value === 'function' || tokens[index + 1].value !== '('
      || tokens[index - 1]?.value === 'function' || tokens[index - 1]?.value === '.' || tokens[index - 1]?.value === ':') continue;
    calls.push({ name: tokens[index].value, line: tokens[index].line, index });
  }
  return calls;
}

function helperCatalog(sources) {
  const catalog = new Map();
  for (const source of sources) {
    const tokens = tokenizeLua(source.source);
    for (const declaration of functionDeclarations(tokens)) {
      const definitions = catalog.get(declaration.name) ?? [];
      definitions.push({ ...declaration, file: source.file, relativeFile: source.relativeFile });
      catalog.set(declaration.name, definitions);
    }
  }
  return catalog;
}

function helperAvailabilityDiagnostic(endpoint, source, call, definitions) {
  const candidates = [...new Set(definitions.map(({ relativeFile }) => relativeFile))].sort(compareCodeUnits);
  const candidateDetails = candidates.length > 0
    ? `; same-name declarations exist in ${candidates.join(', ')}`
    : '';
  return {
    status: 'unverified',
    code: 'helper-availability-unverified',
    endpoint,
    file: source.relativeFile,
    line: call.line,
    message: `${endpoint}: cannot prove that shared helper ${call.name} at ${source.relativeFile}:${call.line} resolves to a top-level local declared earlier in this ordered bundle${candidateDetails}. Luacheck remains authoritative for undefined globals.`,
  };
}

function bundleFunctionDeclarations(tokenized) {
  const declarations = new Map();
  for (const { source, sourceIndex, tokens } of tokenized) {
    for (const declaration of functionDeclarations(tokens)) {
      const definitions = declarations.get(declaration.name) ?? [];
      definitions.push({ ...declaration, sourceIndex, file: source.file, relativeFile: source.relativeFile });
      declarations.set(declaration.name, definitions);
    }
  }
  return declarations;
}

function helperIsVisible(declarations, name, sourceIndex, callIndex) {
  return (declarations.get(name) ?? []).some((definition) => definition.local && definition.topLevel
    && (definition.sourceIndex < sourceIndex || (definition.sourceIndex === sourceIndex && definition.index < callIndex)));
}

function missingHelperDiagnostic(endpoint, source, call, bundleFiles, catalog) {
  const candidates = catalog.get(call.name) ?? [];
  if (candidates.length === 0) return null;
  const bundled = candidates.filter(({ file }) => bundleFiles.has(file));
  if (bundled.length > 0) return helperAvailabilityDiagnostic(endpoint, source, call, bundled);
  if (candidates.length !== 1 || !candidates[0].local || !candidates[0].topLevel) {
    return helperAvailabilityDiagnostic(endpoint, source, call, candidates);
  }
  return {
    status: 'warning',
    code: 'missing-helper-dependency',
    endpoint,
    file: source.relativeFile,
    line: call.line,
    message: `${endpoint}: possible missing shared dependency for ${call.name} at ${source.relativeFile}:${call.line}; the only registered top-level local declaration is in ${candidates[0].relativeFile}. Add it to sharedSourcePaths if intended. Luacheck remains authoritative for undefined globals.`,
  };
}

function missingHelperDiagnostics(endpoint, sources, catalog, globals) {
  const tokenized = sources.map((source, sourceIndex) => ({ source, sourceIndex, tokens: tokenizeLua(source.source) }));
  const declarations = bundleFunctionDeclarations(tokenized);
  const bundleFiles = new Set(tokenized.map(({ source }) => source.file));
  const diagnostics = [];
  const reported = new Set();
  for (const { source, sourceIndex, tokens } of tokenized) {
    for (const call of functionCalls(tokens)) {
      if (globals.has(call.name) || helperIsVisible(declarations, call.name, sourceIndex, call.index)) continue;
      const diagnostic = missingHelperDiagnostic(endpoint, source, call, bundleFiles, catalog);
      if (!diagnostic) continue;
      const key = `${source.file}:${call.line}:${call.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

function callArguments(tokens, openIndex) {
  const close = matchingClose(tokens, openIndex, '(', ')');
  return close < 0 ? null : splitTopLevel(tokens.slice(openIndex + 1, close), ',');
}

function directDbRawExpression(tokens, index) {
  const isDbRaw = tokens[index].value === 'db' && tokens[index + 1].value === '.'
    && tokens[index + 2].value === 'raw' && tokens[index + 3].value === '(';
  if (!isDbRaw) return null;
  const args = callArguments(tokens, index + 3);
  return args?.[0]?.length ? { expression: args[0], line: tokens[index].line } : null;
}

function protectedDbRawExpression(tokens, index) {
  if (tokens[index].value !== 'pcall' || tokens[index + 1].value !== '(') return null;
  const args = callArguments(tokens, index + 1);
  if (args?.[0]?.length !== 3 || args[0][0].value !== 'db' || args[0][1].value !== '.'
    || args[0][2].value !== 'raw' || !args[1]?.length) return null;
  return { expression: args[1], line: tokens[index].line };
}

function rawSqlExpressions(tokens) {
  const expressions = [];
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const directExpression = directDbRawExpression(tokens, index);
    if (directExpression) expressions.push(directExpression);
    const protectedExpression = protectedDbRawExpression(tokens, index);
    if (protectedExpression) expressions.push(protectedExpression);
  }
  return expressions;
}

function requestValueReferences(expression) {
  const references = new Set();
  for (const token of expression) {
    if (token.type !== 'identifier') continue;
    if (token.value === 'params' || token.value === 'request_params') references.add(token.value);
    if (token.value === 'cursor') references.add(token.value);
  }
  return [...references];
}

function sqlInterpolationDiagnostics(endpoint, sources) {
  const diagnostics = [];
  const reported = new Set();
  for (const source of sources) {
    const tokens = tokenizeLua(source.source);
    for (const { expression, line } of rawSqlExpressions(tokens)) {
      const references = requestValueReferences(expression);
      if (!references.length) continue;
      const key = `${source.file}:${line}:${references.join(',')}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push({
        status: 'warning',
        code: 'possible-sql-interpolation',
        endpoint,
        file: source.relativeFile,
        line,
        message: `${endpoint}: db.raw SQL text at ${source.relativeFile}:${line} directly references ${references.join(', ')}; bind request values instead. This advisory is not a taint analysis.`,
      });
    }
  }
  return diagnostics;
}

async function parameterCheck(api, handlersAndSources) {
  const results = await mapConcurrentInOrder(handlersAndSources, ({ handler, sources }) => (
    compareParameterContracts(api, handler, sources)
  ));
  const queries = results.filter(({ query }) => query);
  const verifiedCount = queries.filter(({ verified }) => verified).length;
  return {
    diagnostics: results.flatMap(({ diagnostics }) => diagnostics),
    queryCount: queries.length,
    verifiedCount,
    unverifiedCount: queries.length - verifiedCount,
  };
}

async function loadHandlerSources(api) {
  const results = await mapConcurrentInOrder(api.handlers, async (handler) => ({
    handler,
    ...await authoredSources(api, handler),
  }));
  return {
    loaded: results.map(({ handler, sources }) => ({ handler, sources })),
    diagnostics: results.flatMap(({ diagnostics }) => diagnostics),
  };
}

async function allDeclaredSharedSources(api) {
  const sourceDeclarations = new Map();
  for (const { asset, moduleFile } of api.handlers) {
    for (const sourcePath of declaredSharedSources(asset)) {
      const file = resolveInside(api.packageRoot, path.dirname(moduleFile), sourcePath, `${asset.id ?? 'Lua handler'} shared source`);
      sourceDeclarations.set(file, path.relative(api.packageRoot, file));
    }
  }
  const declarations = [...sourceDeclarations];
  const sources = await mapConcurrentInOrder(declarations, async ([file, relativeFile]) => {
    try {
      return { file, relativeFile, source: await readFile(file, 'utf8') };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }
  });
  return sources.filter((source) => source !== null);
}

export async function checkLuaParameterContracts({ root }) {
  const api = await loadRegisteredApi(root);
  const { loaded } = await loadHandlerSources(api);
  const result = await parameterCheck(api, loaded);
  return result.diagnostics;
}

export async function checkLuaMaintainability({ root }) {
  const api = await loadRegisteredApi(root);
  const { loaded, diagnostics: sourceDiagnostics } = await loadHandlerSources(api);
  const parameters = await parameterCheck(api, loaded);
  const catalog = helperCatalog(await allDeclaredSharedSources(api));
  const globals = await luacheckGlobals(api.packageRoot);
  const helperDiagnostics = [];
  const sqlDiagnostics = [];
  for (const { handler, sources } of loaded) {
    const endpoint = handler.asset.id ?? '(unnamed Lua handler)';
    helperDiagnostics.push(...missingHelperDiagnostics(endpoint, sources, catalog, globals));
    sqlDiagnostics.push(...sqlInterpolationDiagnostics(endpoint, sources));
  }
  const diagnostics = [...sourceDiagnostics, ...parameters.diagnostics, ...helperDiagnostics, ...sqlDiagnostics];
  return {
    diagnostics,
    stats: {
      registeredQueries: parameters.queryCount,
      parameterContractsVerified: parameters.verifiedCount,
      parameterContractsUnverified: parameters.unverifiedCount,
      parameterMismatches: diagnostics.filter(({ code }) => code === 'parameter-contract-mismatch').length,
      helperWarnings: helperDiagnostics.filter(({ status }) => status === 'warning').length,
      helperAvailabilityUnverified: helperDiagnostics.filter(({ status }) => status === 'unverified').length,
      sqlWarnings: sqlDiagnostics.length,
    },
  };
}
