#!/usr/bin/env node

import {
  buildRouteCacheKey,
  loadRouteCache,
  recordRouteFailure,
  recordRouteSuccess,
  saveRouteCache,
} from './route-cache.mjs';
import { determineStartingStage } from './staged-router.mjs';
import { runStagedUrl } from './staged-url-runner.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--')) continue;
    args[key.slice(2)] = value;
  }

  return args;
}

function readTarget(args) {
  return {
    url: args.url,
    taskKind: args['task-kind'] || 'general',
    cachePath: args['cache-path'],
  };
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function runRecommend(args) {
  const target = readTarget(args);
  const cache = loadRouteCache({ cachePath: target.cachePath });
  const key = buildRouteCacheKey(target);
  const entry = cache.entries[key];

  writeJson({
    key,
    startStage: determineStartingStage(entry),
    lastSuccessfulStage: entry?.lastSuccessfulStage || null,
    lastFailedStage: entry?.lastFailedStage || null,
    failureReason: entry?.failureReason || null,
  });
}

function runReport(args) {
  const target = readTarget(args);
  const cache = loadRouteCache({ cachePath: target.cachePath });
  const key = buildRouteCacheKey(target);
  const stage = args.stage;
  const status = args.status;

  if (status === 'success') {
    recordRouteSuccess(cache, key, stage);
  } else {
    recordRouteFailure(
      cache,
      key,
      stage,
      args['failure-reason'] || 'stage_failed',
    );
  }

  saveRouteCache(cache, { cachePath: target.cachePath });

  writeJson({
    key,
    entry: cache.entries[key],
  });
}

async function runUrl(args) {
  const target = readTarget(args);
  const result = await runStagedUrl(target);
  writeJson(result);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'recommend') {
    runRecommend(args);
    return;
  }

  if (args.command === 'report') {
    runReport(args);
    return;
  }

  if (args.command === 'run-url') {
    await runUrl(args);
    return;
  }

  throw new Error('unsupported_command');
}

await main();
