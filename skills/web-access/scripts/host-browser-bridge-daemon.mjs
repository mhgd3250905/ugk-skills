#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { resolveDefaultIpcDir } from './host-bridge.mjs';
import { getDefaultLocalBrowser } from './local-cdp-browser.mjs';

const ipcDir = resolveDefaultIpcDir();
const requestsDir = path.join(ipcDir, 'browser-requests');
const responsesDir = path.join(ipcDir, 'browser-responses');
const readyPath = path.join(ipcDir, 'host-bridge-ready.json');
const pollingMs = Number(process.env.WEB_ACCESS_HOST_BRIDGE_POLL_MS || 250);
const inFlight = new Set();

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown_error');
}

async function handleRequestFile(fileName) {
  const requestPath = path.join(requestsDir, fileName);
  if (inFlight.has(requestPath)) return;
  inFlight.add(requestPath);

  try {
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    const requestId = String(request.requestId || path.basename(fileName, '.json'));
    const responsePath = path.join(responsesDir, `${requestId}.json`);

    let payload;
    try {
      payload = await getDefaultLocalBrowser().handleCommand(request.command || {}, {
        meta: request.meta,
      });
    } catch (error) {
      payload = {
        ok: false,
        error: errorMessage(error),
      };
    }

    writeJsonAtomic(responsePath, payload);
    fs.rmSync(requestPath, { force: true });
  } catch (error) {
    console.error(`host_bridge_request_failed:${fileName}:${errorMessage(error)}`);
  } finally {
    inFlight.delete(requestPath);
  }
}

async function scanOnce() {
  fs.mkdirSync(requestsDir, { recursive: true });
  fs.mkdirSync(responsesDir, { recursive: true });

  const entries = fs
    .readdirSync(requestsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  await Promise.all(entries.map((entry) => handleRequestFile(entry)));
}

function writeReadyFile() {
  writeJsonAtomic(readyPath, {
    ok: true,
    pid: process.pid,
    ipcDir,
    startedAt: new Date().toISOString(),
  });
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

fs.mkdirSync(ipcDir, { recursive: true });
writeReadyFile();
console.log(`web-access host bridge ready: ${ipcDir}`);

setInterval(() => {
  scanOnce().catch((error) => {
    console.error(`host_bridge_scan_failed:${errorMessage(error)}`);
  });
}, pollingMs);

scanOnce().catch((error) => {
  console.error(`host_bridge_initial_scan_failed:${errorMessage(error)}`);
});
