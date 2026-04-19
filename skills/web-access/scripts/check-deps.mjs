#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { ensureHostBrowserBridge } from './host-bridge.mjs';

const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3456);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROXY_SCRIPT = path.join(SCRIPT_DIR, 'cdp-proxy.mjs');

async function isProxyReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function startProxyDetached() {
  const child = spawn(process.execPath, [PROXY_SCRIPT], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function main() {
  const status = await ensureHostBrowserBridge();
  console.log(`host-browser: ok (${status.endpoint})`);

  if (await isProxyReady()) {
    console.log(`proxy: ready (127.0.0.1:${PROXY_PORT})`);
    return;
  }

  console.log('proxy: starting');
  startProxyDetached();

  for (let index = 0; index < 20; index += 1) {
    if (await isProxyReady()) {
      console.log(`proxy: ready (127.0.0.1:${PROXY_PORT})`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('proxy_start_timeout');
}

function isLikelyContainer() {
  return fs.existsSync('/.dockerenv') || process.cwd() === '/app';
}

function isDirectCdpMode() {
  const provider = String(process.env.WEB_ACCESS_BROWSER_PROVIDER || '').trim().toLowerCase();
  return provider === 'direct_cdp' || provider === 'direct' || provider === 'sidecar';
}

function printBrowserHelp(error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  console.error(`host-browser: unavailable (${message})`);
  console.error('proxy: not checked (host browser is unavailable)');

  if (isDirectCdpMode()) {
    console.error('');
    console.error('Direct CDP sidecar mode is enabled for this container.');
    console.error('Check that the browser service is running and reachable at the configured CDP endpoint.');
    console.error('You can restart the sidecar browser stack from the project root with:');
    console.error('');
    console.error('  npm run docker:chrome:restart');
    console.error('');
    console.error('If you need manual login, open the browser GUI entrypoint and complete login there first.');
    return;
  }

  if (message === 'local_browser_executable_not_found' && isLikelyContainer()) {
    console.error('');
    console.error('This command is running inside the container, so it cannot start Windows Chrome directly.');
    console.error('Start the host IPC bridge from the Windows project directory, then retry:');
    console.error('');
    console.error('  powershell -ExecutionPolicy Bypass -File .\\scripts\\start-web-access-browser.ps1');
    console.error('');
    console.error('The bridge will launch the configured Chrome/profile when the agent sends a browser IPC request.');
    return;
  }

  if (message === 'local_cdp_start_timeout') {
    console.error('');
    console.error('A browser executable was found, but CDP did not become ready.');
    console.error('Try starting the host IPC bridge explicitly:');
    console.error('');
    console.error('  powershell -ExecutionPolicy Bypass -File .\\scripts\\start-web-access-browser.ps1');
    return;
  }

  if (message === 'local_browser_executable_not_found') {
    console.error('');
    console.error('Install Chrome or set WEB_ACCESS_CHROME_PATH to the browser executable.');
  }
}

try {
  await main();
} catch (error) {
  printBrowserHelp(error);
  process.exitCode = 1;
}
