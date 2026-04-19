#!/usr/bin/env node

import {
  buildRouteCacheKey,
  loadRouteCache,
  recordRouteFailure,
  recordRouteSuccess,
  saveRouteCache,
} from './route-cache.mjs';

export const STAGE_ORDER = ['S1', 'S2', 'S3'];

function getStageIndex(stage) {
  return STAGE_ORDER.indexOf(stage);
}

function getNextStage(stage) {
  const currentIndex = getStageIndex(stage);
  if (currentIndex === -1 || currentIndex >= STAGE_ORDER.length - 1) {
    return null;
  }
  return STAGE_ORDER[currentIndex + 1];
}

export function determineStartingStage(entry) {
  if (entry?.lastSuccessfulStage && getStageIndex(entry.lastSuccessfulStage) >= 0) {
    return entry.lastSuccessfulStage;
  }

  if (entry?.lastFailedStage && getStageIndex(entry.lastFailedStage) >= 0) {
    return getNextStage(entry.lastFailedStage) || 'S3';
  }

  return 'S1';
}

export async function runStagedRoute(input) {
  const cache = loadRouteCache({ cachePath: input.cachePath });
  const cacheKey = buildRouteCacheKey({
    url: input.url,
    taskKind: input.taskKind,
  });
  const cacheEntry = cache.entries[cacheKey];
  const startStage = determineStartingStage(cacheEntry);
  const attempts = [];

  let currentStage = startStage;
  while (currentStage) {
    attempts.push(currentStage);
    const result = await input.executeStage(currentStage);

    if (result?.ok) {
      recordRouteSuccess(cache, cacheKey, currentStage);
      saveRouteCache(cache, { cachePath: input.cachePath });
      return {
        ok: true,
        startStage,
        attempts,
        finalStage: currentStage,
        failureReason: null,
        result,
      };
    }

    const failureReason = result?.failureReason || 'stage_failed';
    recordRouteFailure(cache, cacheKey, currentStage, failureReason);
    saveRouteCache(cache, { cachePath: input.cachePath });

    if (result?.escalatable === false) {
      return {
        ok: false,
        startStage,
        attempts,
        finalStage: currentStage,
        failureReason,
        result,
      };
    }

    const nextStage = getNextStage(currentStage);
    if (!nextStage) {
      return {
        ok: false,
        startStage,
        attempts,
        finalStage: currentStage,
        failureReason,
        result,
      };
    }

    currentStage = nextStage;
  }

  return {
    ok: false,
    startStage,
    attempts,
    finalStage: attempts[attempts.length - 1] || 'S1',
    failureReason: 'stage_failed',
  };
}
