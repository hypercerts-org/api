import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

  const modules = [];
  const handlers = [];
  const lexicons = new Map();
  for (const modulePath of rootManifest.modules) {
    const moduleFile = resolveInside(packageRoot, packageRoot, modulePath, 'Module manifest path');
    const module = await readJson(moduleFile, 'module manifest');
    if (!Array.isArray(module.assets)) throw new Error(`Lua module manifest ${moduleFile} must declare an assets array`);
    const entry = { file: moduleFile, assets: module.assets };
    modules.push(entry);
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
  const sources = [];
  const diagnostics = [];

  for (const declaration of declarations) {
    if (!declaration.path) {
      diagnostics.push({
        status: 'error',
        code: 'lua-source-missing',
        endpoint,
        message: `${endpoint}: no authored ${declaration.kind} source is declared in ${path.relative(api.packageRoot, moduleFile)}; add ${declaration.kind === 'handler' ? 'sourcePath' : 'sharedSourcePaths'} to the module manifest.`,
      });
      continue;
    }
    const file = resolveInside(api.packageRoot, moduleDirectory, declaration.path, `${endpoint} ${declaration.kind} source`);
    const relativeFile = path.relative(api.packageRoot, file);
    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      diagnostics.push({
        status: 'error',
        code: 'lua-source-missing',
        endpoint,
        file: relativeFile,
        message: `${endpoint}: declared ${declaration.kind} Lua source ${relativeFile} is missing (from ${path.relative(api.packageRoot, moduleFile)}); restore it or correct the manifest source path.`,
      });
      continue;
    }
    sources.push({ file, relativeFile, kind: declaration.kind, source });
  }
  return { sources, diagnostics };
}

function longBracketEnd(source, start) {
  const open = source.slice(start).match(/^\[(=*)\[/);
  if (!open) return null;
  const close = `]${open[1]}]`;
  const end = source.indexOf(close, start + open[0].length);
  return end < 0 ? source.length : end + close.length;
}

function tokenizeLua(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      if (char === '\n') line += 1;
      index += 1;
      continue;
    }
    if (source.startsWith('--', index)) {
      const commentStart = index + 2;
      const longEnd = longBracketEnd(source, commentStart);
      if (longEnd !== null) {
        line += (source.slice(index, longEnd).match(/\n/g) ?? []).length;
        index = longEnd;
      } else {
        const newline = source.indexOf('\n', index);
        index = newline < 0 ? source.length : newline;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      const startLine = line;
      const quote = char;
      index += 1;
      let value = '';
      let staticValue = true;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\n') line += 1;
        if (source[index] === '\\') {
          staticValue = false;
          index += Math.min(2, source.length - index);
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (source[index] === quote) index += 1;
      tokens.push({ type: 'string', value: staticValue ? value : null, line: startLine });
      continue;
    }
    const longEnd = char === '[' ? longBracketEnd(source, index) : null;
    if (longEnd !== null) {
      const raw = source.slice(index, longEnd);
      const startLine = line;
      line += (raw.match(/\n/g) ?? []).length;
      tokens.push({ type: 'string', value: null, line: startLine });
      index = longEnd;
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0], line });
      index += identifier[0].length;
      continue;
    }
    const number = source.slice(index).match(/^\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ type: 'number', value: number[0], line });
      index += number[0].length;
      continue;
    }
    const operator = ['...', '..', '==', '~=', '<=', '>=', '//', '::'].find((candidate) => source.startsWith(candidate, index));
    const value = operator ?? char;
    tokens.push({ type: 'symbol', value, line });
    index += value.length;
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
  if (!parameters || parameters.type !== 'params' || !parameters.properties || typeof parameters.properties !== 'object' || Array.isArray(parameters.properties)) {
    return { status: 'unverified', reason: 'the Lexicon parameter schema is not a recognizable params object' };
  }
  return { status: 'verified', names: Object.keys(parameters.properties).sort() };
}

function unverifiedParameter(id, file, reason, line) {
  return {
    status: 'unverified',
    code: 'parameter-contract-unverified',
    endpoint: id,
    file,
    line,
    message: `${id}: parameter contract unverified${file ? ` in ${file}${line ? `:${line}` : ''}` : ''}: ${reason}`,
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
  const actual = [...new Set(inspection.keys)].sort();
  const missing = contract.names.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !contract.names.includes(name));
  if (!missing.length && !extra.length) return { diagnostics: [], verified: true, query: true };
  const file = inspection.file;
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
      message: `${asset.id}: Lua parameter allow-list in ${file}:${inspection.line} differs from its Lexicon${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; extra: ${extra.join(', ')}` : ''}`,
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

function functionDeclarations(tokens) {
  const declarations = [];
  const blocks = [];
  let loopsAwaitingDo = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'identifier') continue;
    const value = tokens[index].value;
    if (value === 'function') {
      if (tokens[index + 1]?.type === 'identifier' && tokens[index + 2]?.value === '(') {
        declarations.push({
          name: tokens[index + 1].value,
          line: tokens[index].line,
          index,
          topLevel: blocks.length === 0,
          local: tokens[index - 1]?.value === 'local',
        });
      }
      blocks.push('function');
    } else if (value === 'if') {
      blocks.push('if');
    } else if (value === 'for' || value === 'while') {
      blocks.push('loop');
      loopsAwaitingDo += 1;
    } else if (value === 'do') {
      if (loopsAwaitingDo > 0) loopsAwaitingDo -= 1;
      else blocks.push('do');
    } else if (value === 'repeat') {
      blocks.push('repeat');
    } else if (value === 'end') {
      if (blocks.length > 0 && blocks.at(-1) !== 'repeat') blocks.pop();
    } else if (value === 'until' && blocks.at(-1) === 'repeat') {
      blocks.pop();
    }
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
  const candidates = [...new Set(definitions.map(({ relativeFile }) => relativeFile))].sort();
  return {
    status: 'unverified',
    code: 'helper-availability-unverified',
    endpoint,
    file: source.relativeFile,
    line: call.line,
    message: `${endpoint}: cannot prove that shared helper ${call.name} at ${source.relativeFile}:${call.line} resolves to a top-level local declared earlier in this ordered bundle${candidates.length ? `; same-name declarations exist in ${candidates.join(', ')}` : ''}. Luacheck remains authoritative for undefined globals.`,
  };
}

function missingHelperDiagnostics(endpoint, sources, catalog, globals) {
  const inBundle = new Map();
  const tokenized = sources.map((source, sourceIndex) => ({ source, sourceIndex, tokens: tokenizeLua(source.source) }));
  for (const item of tokenized) {
    for (const declaration of functionDeclarations(item.tokens)) {
      const definitions = inBundle.get(declaration.name) ?? [];
      definitions.push({ ...declaration, sourceIndex: item.sourceIndex, file: item.source.file, relativeFile: item.source.relativeFile });
      inBundle.set(declaration.name, definitions);
    }
  }

  const diagnostics = [];
  const reported = new Set();
  for (const { source, sourceIndex, tokens } of tokenized) {
    for (const call of functionCalls(tokens)) {
      if (globals.has(call.name)) continue;
      const visible = (inBundle.get(call.name) ?? []).some((definition) => definition.local && definition.topLevel
        && (definition.sourceIndex < sourceIndex || (definition.sourceIndex === sourceIndex && definition.index < call.index)));
      if (visible) continue;
      const candidates = catalog.get(call.name) ?? [];
      if (candidates.length === 0) continue;

      const key = `${source.file}:${call.line}:${call.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const bundleDeclarations = candidates.filter(({ file }) => tokenized.some(({ source: included }) => included.file === file));
      if (bundleDeclarations.length > 0) {
        diagnostics.push(helperAvailabilityDiagnostic(endpoint, source, call, bundleDeclarations));
        continue;
      }

      if (candidates.length === 1 && candidates[0].local && candidates[0].topLevel) {
        diagnostics.push({
          status: 'warning',
          code: 'missing-helper-dependency',
          endpoint,
          file: source.relativeFile,
          line: call.line,
          message: `${endpoint}: possible missing shared dependency for ${call.name} at ${source.relativeFile}:${call.line}; the only registered top-level local declaration is in ${candidates[0].relativeFile}. Add it to sharedSourcePaths if intended. Luacheck remains authoritative for undefined globals.`,
        });
      } else {
        diagnostics.push(helperAvailabilityDiagnostic(endpoint, source, call, candidates));
      }
    }
  }
  return diagnostics;
}

function rawSqlExpressions(tokens) {
  const expressions = [];
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const isDbRaw = tokens[index].value === 'db' && tokens[index + 1].value === '.'
      && tokens[index + 2].value === 'raw' && tokens[index + 3].value === '(';
    if (isDbRaw) {
      const close = matchingClose(tokens, index + 3, '(', ')');
      if (close >= 0) {
        const args = splitTopLevel(tokens.slice(index + 4, close), ',');
        if (args[0]?.length) expressions.push({ expression: args[0], line: tokens[index].line });
      }
    }

    if (tokens[index].value !== 'pcall' || tokens[index + 1].value !== '(') continue;
    const close = matchingClose(tokens, index + 1, '(', ')');
    if (close < 0) continue;
    const args = splitTopLevel(tokens.slice(index + 2, close), ',');
    if (args[0]?.length === 3 && args[0][0].value === 'db' && args[0][1].value === '.' && args[0][2].value === 'raw'
      && args[1]?.length) expressions.push({ expression: args[1], line: tokens[index].line });
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
  const diagnostics = [];
  let queryCount = 0;
  let verifiedCount = 0;
  let unverifiedCount = 0;
  for (const item of handlersAndSources) {
    const result = await compareParameterContracts(api, item.handler, item.sources);
    diagnostics.push(...result.diagnostics);
    if (!result.query) continue;
    queryCount += 1;
    if (result.verified) verifiedCount += 1;
    else unverifiedCount += 1;
  }
  return { diagnostics, queryCount, verifiedCount, unverifiedCount };
}

async function loadHandlerSources(api) {
  const loaded = [];
  const diagnostics = [];
  for (const handler of api.handlers) {
    const result = await authoredSources(api, handler);
    diagnostics.push(...result.diagnostics);
    loaded.push({ handler, sources: result.sources });
  }
  return { loaded, diagnostics };
}

async function allDeclaredSharedSources(api) {
  const sourceDeclarations = new Map();
  for (const { asset, moduleFile } of api.handlers) {
    for (const sourcePath of declaredSharedSources(asset)) {
      const file = resolveInside(api.packageRoot, path.dirname(moduleFile), sourcePath, `${asset.id ?? 'Lua handler'} shared source`);
      sourceDeclarations.set(file, path.relative(api.packageRoot, file));
    }
  }
  const sources = [];
  for (const [file, relativeFile] of sourceDeclarations) {
    try {
      sources.push({ file, relativeFile, source: await readFile(file, 'utf8') });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return sources;
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
