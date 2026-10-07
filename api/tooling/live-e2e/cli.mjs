#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadCatalogue, casesFor } from './catalogue.mjs';
import { createReplayTransport, createTransport } from './runtime.mjs';
import { runSuite } from './suite.mjs';

const help = `Live Hypercerts API E2E (read-only GET requests)

  node api/tooling/live-e2e/cli.mjs --list
  node api/tooling/live-e2e/cli.mjs --catalogue [--endpoint NSID]
  node api/tooling/live-e2e/cli.mjs --run --target URL --budget N [options]
  node api/tooling/live-e2e/cli.mjs --replay EVIDENCE_DIR [--endpoint NSID] [--out PATH]

--endpoint NSID       Repeat to select endpoints. Discovery may call their listed source endpoints.
--full               Enable bounded full-traversal cases (default: off).
--max-pages N        Full traversal page cap (default: 100).
--discovery-pages N  Discovery and positive-filter scan cap (default: 2).
--interval-ms N      Minimum interval between request starts, at least 1000 (default: 1000).
--out PATH           New evidence directory; existing directories are never reused.
--strict-gaps        Exit nonzero for insufficient data, not only failures/not-run.
--replay PATH        Replay exact retained GET evidence offline; missing requests are not-run, never fetched.
--help               Show usage. Only --run can make HTTP requests; --replay never fetches.

Exit: 0 completed with no failures (gaps allowed); 1 assertion/schema/source failure; 2 incomplete/usage error.
The live request budget includes discovery, negative probes, and transport failures. Offline replay uses zero live requests. No retries.
`;

function integer(value, name, fallback, minimum = 1) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} must be an integer >= ${minimum}.`);
  return parsed;
}

function sourceFailureCount(report) {
  return report.sourceFailures ?? report.sourceObservations.filter(source => source.status === 'failed' || source.incompleteCause?.status === 'failed').length;
}

function exitCode(report, strictGaps) {
  if ((report.counts.failed ?? 0) || report.schemaFindings.length || sourceFailureCount(report)) return 1;
  if ((report.counts['not-run'] ?? 0) || report.sourceObservations.some(source => source.status === 'not-run' || source.status === 'partial') || (strictGaps && report.counts['insufficient-data'])) return 2;
  return 0;
}

try {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean' }, list: { type: 'boolean' }, catalogue: { type: 'boolean' }, run: { type: 'boolean' },
    target: { type: 'string' }, budget: { type: 'string' }, replay: { type: 'string' }, endpoint: { type: 'string', multiple: true },
    full: { type: 'boolean' }, 'max-pages': { type: 'string' }, 'discovery-pages': { type: 'string' },
    'interval-ms': { type: 'string' }, out: { type: 'string' }, 'strict-gaps': { type: 'boolean' },
  } });
  if (values.help) {
    process.stdout.write(help);
  } else {
    if ([values.list, values.catalogue, values.run, Boolean(values.replay)].filter(Boolean).length > 1) throw new Error('Choose only one of --list, --catalogue, --run, or --replay.');
    const catalogue = await loadCatalogue();
    const requested = new Set(values.endpoint ?? []);
    for (const nsid of requested) if (!catalogue.endpoints.some(endpoint => endpoint.nsid === nsid)) throw new Error(`Unknown endpoint ${nsid}; use --list to choose a registered NSID.`);
    let selected = catalogue.endpoints.filter(endpoint => !requested.size || requested.has(endpoint.nsid));
    let options = { full: values.full ?? false,
      maxPages: integer(values['max-pages'], '--max-pages', 100),
      discoveryPages: integer(values['discovery-pages'], '--discovery-pages', 2) };
    if (values.replay) {
      if (values.target || values.budget || values['interval-ms'] !== undefined) throw new Error('--replay uses only retained evidence and does not accept --target, --budget, or --interval-ms.');
      const evidenceDirectory = path.resolve(values.replay);
      const capturedPlan = JSON.parse(await readFile(path.join(evidenceDirectory, 'plan.json'), 'utf8'));
      const capturedEndpoints = (capturedPlan.endpoints ?? []).map(endpoint => typeof endpoint === 'string' ? endpoint : endpoint.nsid).filter(Boolean);
      const capturedSet = new Set(capturedEndpoints);
      if (!capturedSet.size) throw new Error('Captured plan has no endpoint list; replay requires retained plan.json and request artifacts.');
      const unknownCaptured = [...capturedSet].filter(nsid => !catalogue.endpoints.some(endpoint => endpoint.nsid === nsid));
      if (unknownCaptured.length) throw new Error(`Captured plan endpoints are not registered in this checkout: ${unknownCaptured.join(', ')}.`);
      const outsideCapture = [...requested].filter(nsid => !capturedSet.has(nsid));
      if (outsideCapture.length) throw new Error(`Requested endpoint(s) were not in the captured run plan: ${outsideCapture.join(', ')}.`);
      selected = catalogue.endpoints.filter(endpoint => capturedSet.has(endpoint.nsid) && (!requested.size || requested.has(endpoint.nsid)));
      options = { full: values.full ?? capturedPlan.full ?? false,
        maxPages: integer(values['max-pages'], '--max-pages', capturedPlan.maxPages ?? 100),
        discoveryPages: integer(values['discovery-pages'], '--discovery-pages', capturedPlan.discoveryPages ?? 2) };
      const directory = path.resolve(values.out ?? path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), '.local/state'), 'hypercerts-live-e2e', `replay-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`));
      await mkdir(path.dirname(directory), { recursive: true });
      await mkdir(directory, { mode: 0o700 });
      const transport = await createReplayTransport({ evidenceDirectory, target: capturedPlan.target ?? null });
      await writeFile(path.join(directory, 'plan.json'), JSON.stringify({ mode: 'offline-replay', evidenceDirectory,
        capturedTarget: capturedPlan.target ?? null, ...options,
        endpoints: selected.map(endpoint => ({ nsid: endpoint.nsid, source: endpoint.source, cases: casesFor(endpoint, options) })) }, null, 2), { flag: 'wx', mode: 0o600 });
      process.stdout.write(`Offline replay output: ${directory}\n`);
      const report = await runSuite({ catalogue, selected, transport, directory, ...options });
      const partialSources = report.sourceObservations.filter(source => source.status === 'partial').length;
      process.stdout.write(`Summary: ${JSON.stringify(report.counts)}; ${report.attempts} live requests, ${report.replayEvaluations} replay evaluations, ${report.evidenceSequencesUsed.length} captured requests used, ${sourceFailureCount(report)} failed sources, ${partialSources} partial sources\n`);
      process.exitCode = exitCode(report, values['strict-gaps']);
    } else if (!values.run) {
      if (values.catalogue) process.stdout.write(`${JSON.stringify(selected.map(endpoint => ({
        endpoint: endpoint.nsid, discoverySource: endpoint.source, minimumRecords: endpoint.minimumRecords,
        cases: casesFor(endpoint, options),
      })), null, 2)}\n`);
      else for (const endpoint of selected) process.stdout.write(`${endpoint.nsid} (${casesFor(endpoint, options).length} cases; source ${endpoint.source})\n`);
    } else {
      if (!values.target || !values.budget) throw new Error('--run requires explicit --target and --budget. Review --catalogue before approving a live run.');
      const budget = integer(values.budget, '--budget');
      const interval = integer(values['interval-ms'], '--interval-ms', 1000, 1000);
      const directory = path.resolve(values.out ?? path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), '.local/state'), 'hypercerts-live-e2e', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`));
      const transport = createTransport({ target: values.target, budget, interval, directory });
      await mkdir(path.dirname(directory), { recursive: true });
      await mkdir(directory, { mode: 0o700 });
      await writeFile(path.join(directory, 'plan.json'), JSON.stringify({ target: values.target, budget, interval,
        ...options, endpoints: selected.map(endpoint => ({ nsid: endpoint.nsid, source: endpoint.source, cases: casesFor(endpoint, options) })) }, null, 2), { flag: 'wx', mode: 0o600 });
      process.stdout.write(`Evidence: ${directory}\n`);
      const report = await runSuite({ catalogue, selected, transport, directory, ...options });
      process.stdout.write(`Summary: ${JSON.stringify(report.counts)}; ${report.attempts}/${budget} live requests, ${report.schemaFindings.length} schema failures, ${sourceFailureCount(report)} source failures, ${report.sourceObservations.filter(source => source.status === 'partial').length} partial sources\n`);
      process.exitCode = exitCode(report, values['strict-gaps']);
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\nUse --help for usage.\n`);
  process.exitCode = 2;
}
