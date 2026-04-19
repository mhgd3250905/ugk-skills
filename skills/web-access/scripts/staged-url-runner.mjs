#!/usr/bin/env node

import { runStagedRoute } from './staged-router.mjs';
import { runUrlStage } from './url-stage-executor.mjs';

export async function runStagedUrl(input) {
  return runStagedRoute({
    url: input.url,
    taskKind: input.taskKind,
    cachePath: input.cachePath,
    executeStage: (stage) =>
      (input.stageRunner || runUrlStage)(stage, {
        url: input.url,
        taskKind: input.taskKind,
        agentScope: input.agentScope,
        env: input.env,
        fetchImpl: input.fetchImpl,
        ensureBridge: input.ensureBridge,
        proxyClient: input.proxyClient,
      }),
  });
}
