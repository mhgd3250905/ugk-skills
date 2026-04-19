#!/usr/bin/env node

import fs from 'node:fs';
import dns from 'node:dns/promises';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = Number(process.env.WEB_ACCESS_CDP_PORT || 9222);
const DEFAULT_HOST = process.env.WEB_ACCESS_CDP_HOST || '127.0.0.1';
const DEFAULT_LISTEN_ADDRESS =
  process.env.WEB_ACCESS_CDP_LISTEN_ADDRESS || DEFAULT_HOST;

function normalizePublicBaseUrl(options = {}) {
  return String(
    options.publicBaseUrl ||
      process.env.PUBLIC_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || '3000'}`,
  ).replace(/\/+$/, '');
}

function normalizeBrowserPublicBaseUrl(options = {}) {
  return String(
    options.browserPublicBaseUrl ||
      process.env.WEB_ACCESS_BROWSER_PUBLIC_BASE_URL ||
      normalizePublicBaseUrl(options),
  ).replace(/\/+$/, '');
}

function rewriteSameOriginUrlForBrowser(input, options = {}) {
  const publicBaseUrl = normalizePublicBaseUrl(options);
  const browserBaseUrl = normalizeBrowserPublicBaseUrl(options);

  if (publicBaseUrl === browserBaseUrl) {
    return input;
  }

  try {
    const inputUrl = new URL(input);
    const publicUrl = new URL(publicBaseUrl);
    const browserUrl = new URL(browserBaseUrl);

    if (inputUrl.origin !== publicUrl.origin) {
      return input;
    }

    inputUrl.protocol = browserUrl.protocol;
    inputUrl.hostname = browserUrl.hostname;
    inputUrl.port = browserUrl.port;
    return inputUrl.toString();
  } catch {
    return input;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(options = {}) {
  if (options.endpoint) {
    return String(options.endpoint).replace(/\/$/, '');
  }
  return `http://${options.host || DEFAULT_HOST}:${options.port || DEFAULT_PORT}`;
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 5000),
  });
  if (!response.ok) {
    throw new Error(`cdp_http_${response.status}:${url}`);
  }
  return await response.json();
}

async function tryFetchJson(url, options = {}) {
  try {
    return await fetchJson(url, options);
  } catch {
    return undefined;
  }
}

function findOnPath(command) {
  const pathValue = process.env.PATH || '';
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function findBrowserExecutable() {
  const explicit = process.env.WEB_ACCESS_CHROME_PATH || process.env.CHROME_PATH;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const allowEdgeFallback = process.env.WEB_ACCESS_ALLOW_EDGE === '1';
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
          ...(allowEdgeFallback
            ? [
                path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
                path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
                path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
              ]
            : []),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            findOnPath('google-chrome'),
            findOnPath('chromium'),
            findOnPath('microsoft-edge'),
          ]
        : [
            findOnPath('google-chrome'),
            findOnPath('google-chrome-stable'),
            findOnPath('chromium'),
            findOnPath('chromium-browser'),
            findOnPath('microsoft-edge'),
          ];

  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate));
}

function getDefaultProfileDir(executable) {
  if (process.env.WEB_ACCESS_CHROME_PROFILE_DIR) {
    return process.env.WEB_ACCESS_CHROME_PROFILE_DIR;
  }

  const browserName = path.basename(executable || 'browser', path.extname(executable || 'browser'));
  return path.join(process.cwd(), '.tmp', `web-access-${browserName.toLowerCase()}`);
}

function normalizeTarget(target) {
  if (!target) return undefined;
  return {
    id: target.id,
    type: target.type,
    title: target.title,
    url: target.url,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
  };
}

function normalizeSlashPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function decodeFileUrlPath(fileUrl) {
  try {
    const url = new URL(fileUrl);
    if (url.protocol !== 'file:') {
      return undefined;
    }
    return decodeURIComponent(url.pathname || '');
  } catch {
    return undefined;
  }
}

function resolveWorkspaceArtifactPath(input, options = {}) {
  const normalizedInput = String(input || '').trim();
  if (!normalizedInput) {
    return undefined;
  }

  const decodedInput = normalizedInput.startsWith('file://')
    ? decodeFileUrlPath(normalizedInput) || normalizedInput
    : normalizedInput;
  const projectRoot = normalizeSlashPath(
    options.projectRoot || process.env.WEB_ACCESS_PROJECT_ROOT || '/app',
  ).replace(/\/+$/, '');
  const slashInput = normalizeSlashPath(decodedInput);

  if (!slashInput) {
    return undefined;
  }

  if (slashInput.startsWith('/app/public/') || slashInput.startsWith('/app/runtime/')) {
    return slashInput;
  }
  if (
    slashInput.startsWith(`${projectRoot}/public/`) ||
    slashInput.startsWith(`${projectRoot}/runtime/`)
  ) {
    return decodedInput;
  }
  if (/^(public|runtime)(\/|$)/.test(slashInput)) {
    return `${projectRoot}/${slashInput}`;
  }
  return undefined;
}

export function resolveBrowserInputUrl(input, options = {}) {
  const normalizedInput = String(input || '').trim();
  if (!normalizedInput) {
    throw new Error('browser_target_url_required');
  }
  if (/^https?:\/\//i.test(normalizedInput)) {
    return rewriteSameOriginUrlForBrowser(normalizedInput, options);
  }

  const artifactPath = resolveWorkspaceArtifactPath(normalizedInput, options);
  if (artifactPath) {
    const baseUrl = normalizeBrowserPublicBaseUrl(options);
    return `${baseUrl}/v1/local-file?path=${encodeURIComponent(artifactPath)}`;
  }

  if (normalizedInput.startsWith('file://')) {
    return normalizedInput;
  }

  if (path.isAbsolute(normalizedInput)) {
    return pathToFileURL(normalizedInput).toString();
  }

  return normalizedInput;
}

export function rewriteCdpTargetForBaseUrl(target, baseUrl) {
  const normalized = normalizeTarget(target);
  if (!normalized?.webSocketDebuggerUrl) {
    return normalized;
  }

  const endpoint = new URL(baseUrl);
  const websocket = new URL(normalized.webSocketDebuggerUrl);
  const isLoopback =
    websocket.hostname === '127.0.0.1' ||
    websocket.hostname === 'localhost' ||
    websocket.hostname === '[::1]' ||
    websocket.hostname === '::1';

  if (!isLoopback) {
    return normalized;
  }

  websocket.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  websocket.hostname = endpoint.hostname;
  websocket.port = endpoint.port;

  return {
    ...normalized,
    webSocketDebuggerUrl: websocket.toString(),
  };
}

export async function findDockerHostCdpBaseUrl(options = {}) {
  const lookup = options.lookup || dns.lookup;
  const fetchImpl = options.fetchImpl || fetch;
  const port = options.port || DEFAULT_PORT;
  const timeoutMs = options.timeoutMs || 1200;
  let address;

  try {
    const result = await lookup('host.docker.internal', { family: 4 });
    address = typeof result === 'string' ? result : result?.address;
  } catch {
    return undefined;
  }

  if (!address) {
    return undefined;
  }

  const baseUrl = `http://${address}:${port}`;
  const response = await fetchImpl(`${baseUrl}/json/version`, {
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  return baseUrl;
}

class CdpConnection {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.webSocketUrl);
      const timer = setTimeout(() => reject(new Error('cdp_ws_connect_timeout')), 5000);

      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });

      this.socket.addEventListener('message', (event) => {
        const payload = JSON.parse(String(event.data));
        if (!payload.id || !this.pending.has(payload.id)) {
          return;
        }

        const callbacks = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) {
          callbacks.reject(new Error(payload.error.message || 'cdp_command_failed'));
          return;
        }
        callbacks.resolve(payload.result);
      });

      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('cdp_ws_connect_failed'));
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cdp_command_timeout:${method}`));
      }, 10000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export class LocalCdpBrowser {
  constructor(options = {}) {
    this.options = options;
    this.baseUrl = normalizeBaseUrl(options);
    this.fetchImpl = options.fetchImpl || fetch;
    this.defaultTargets = new Map();
  }

  async handleCommand(command, context = {}) {
    switch (command.action) {
      case 'status':
        return await this.status();
      case 'list_targets':
        return { ok: true, targets: await this.listTargets() };
      case 'new_target':
        return { ok: true, target: await this.newTarget(command.url) };
      case 'close_target':
        return await this.closeTarget(command.targetId);
      case 'get_target_info':
        return { ok: true, page: await this.getTargetInfo(command.targetId) };
      case 'navigate':
        return { ok: true, page: await this.navigate(command.targetId, command.url) };
      case 'back':
        return { ok: true, page: await this.back(command.targetId) };
      case 'evaluate':
        return { ok: true, value: await this.evaluate(command.targetId, command.expression) };
      case 'click':
      case 'click_at':
        return { ok: true, value: await this.click(command.targetId, command.selector) };
      case 'scroll':
        return { ok: true, value: await this.scroll(command.targetId, command) };
      case 'screenshot':
        return {
          ok: true,
          screenshotBase64: await this.screenshot(command.targetId),
        };
      case 'download':
        return await this.download(command.targetId, command);
      case 'get_default_target':
        return {
          ok: true,
          targetId: this.defaultTargets.get(this.readScope(context.meta)),
        };
      case 'set_default_target':
        this.defaultTargets.set(this.readScope(context.meta), command.targetId);
        return { ok: true };
      case 'clear_default_target':
        this.defaultTargets.delete(this.readScope(context.meta));
        return { ok: true };
      case 'close_scope_targets':
        return await this.closeScopeTargets(this.readScope(context.meta));
      default:
        return { ok: false, error: `unsupported_local_browser_action:${command.action}` };
    }
  }

  readScope(meta) {
    return meta?.agentScope || 'default';
  }

  async status() {
    const version = await this.ensureBrowser();
    return {
      ok: true,
      status: {
        enabled: true,
        connected: true,
        endpoint: this.baseUrl,
        browser: version.Browser || version.browser || 'chrome-cdp',
      },
    };
  }

  async ensureBrowser() {
    const existing = await tryFetchJson(`${this.baseUrl}/json/version`, {
      timeoutMs: 1200,
      fetchImpl: this.fetchImpl,
    });
    if (existing) {
      return existing;
    }

    const dockerHostBaseUrl = await findDockerHostCdpBaseUrl({
      fetchImpl: this.fetchImpl,
      port: this.options.port || DEFAULT_PORT,
      timeoutMs: 1200,
    });
    if (dockerHostBaseUrl) {
      this.baseUrl = dockerHostBaseUrl;
      return await fetchJson(`${this.baseUrl}/json/version`, {
        timeoutMs: 1200,
        fetchImpl: this.fetchImpl,
      });
    }

    await this.startBrowser();
    for (let index = 0; index < 40; index += 1) {
      const version = await tryFetchJson(`${this.baseUrl}/json/version`, {
        timeoutMs: 1200,
        fetchImpl: this.fetchImpl,
      });
      if (version) {
        return version;
      }
      await sleep(250);
    }

    throw new Error('local_cdp_start_timeout');
  }

  async startBrowser() {
    const executable = findBrowserExecutable();
    if (!executable) {
      throw new Error('local_browser_executable_not_found');
    }

    const profileDir = this.options.profileDir || getDefaultProfileDir(executable);
    await mkdir(profileDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${this.options.port || DEFAULT_PORT}`,
      `--remote-debugging-address=${this.options.listenAddress || DEFAULT_LISTEN_ADDRESS}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-breakpad',
      '--disable-background-networking',
      '--disable-crash-reporter',
      '--disable-crashpad',
      '--disable-popup-blocking',
      'about:blank',
    ];

    if (process.platform !== 'win32' && process.getuid?.() === 0) {
      args.unshift('--no-sandbox');
    }

    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }

  async listTargets() {
    await this.ensureBrowser();
    const targets = await fetchJson(`${this.baseUrl}/json/list`, {
      fetchImpl: this.fetchImpl,
    });
    return targets
      .filter((target) => target.type === 'page')
      .map((target) => rewriteCdpTargetForBaseUrl(target, this.baseUrl));
  }

  async getTarget(targetId) {
    if (!targetId) {
      throw new Error('missing_target');
    }
    const target = (await this.listTargets()).find((entry) => entry.id === targetId);
    if (!target) {
      throw new Error(`target_not_found:${targetId}`);
    }
    return target;
  }

  async newTarget(url = 'about:blank') {
    await this.ensureBrowser();
    const resolvedUrl = resolveBrowserInputUrl(url, this.options);
    const target = await fetchJson(`${this.baseUrl}/json/new?${encodeURIComponent(resolvedUrl)}`, {
      method: 'PUT',
      fetchImpl: this.fetchImpl,
    });
    return rewriteCdpTargetForBaseUrl(target, this.baseUrl);
  }

  async closeTarget(targetId) {
    await this.ensureBrowser();
    await this.fetchImpl(`${this.baseUrl}/json/close/${encodeURIComponent(targetId)}`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);

    for (const [scope, id] of this.defaultTargets.entries()) {
      if (id === targetId) {
        this.defaultTargets.delete(scope);
      }
    }

    return { ok: true };
  }

  async closeScopeTargets(scope) {
    const targetId = this.defaultTargets.get(scope);
    if (targetId) {
      await this.closeTarget(targetId);
    }
    this.defaultTargets.delete(scope);
    return { ok: true };
  }

  async getTargetInfo(targetId) {
    return normalizeTarget(await this.getTarget(targetId));
  }

  async withTarget(targetId, callback) {
    const target = await this.getTarget(targetId);
    if (!target.webSocketDebuggerUrl) {
      throw new Error(`target_missing_websocket:${targetId}`);
    }

    const cdp = new CdpConnection(target.webSocketDebuggerUrl);
    await cdp.connect();
    try {
      return await callback(cdp, target);
    } finally {
      cdp.close();
    }
  }

  async waitForReady(cdp) {
    for (let index = 0; index < 60; index += 1) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      const state = result?.result?.value;
      if (state === 'complete' || state === 'interactive') {
        return;
      }
      await sleep(250);
    }
  }

  async navigate(targetId, url) {
    return await this.withTarget(targetId, async (cdp) => {
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', {
        url: resolveBrowserInputUrl(url, this.options),
      });
      await this.waitForReady(cdp);
      return await this.getTargetInfo(targetId);
    });
  }

  async back(targetId) {
    await this.evaluate(targetId, 'history.back(); true');
    await sleep(600);
    return await this.getTargetInfo(targetId);
  }

  async evaluate(targetId, expression) {
    return await this.withTarget(targetId, async (cdp) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression: String(expression || ''),
        awaitPromise: true,
        returnByValue: true,
      });
      if (result?.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'runtime_evaluate_failed');
      }
      const value = result?.result?.value;
      return value === undefined ? result?.result?.description : value;
    });
  }

  async click(targetId, selector) {
    const serializedSelector = JSON.stringify(String(selector || ''));
    return await this.evaluate(
      targetId,
      `(() => {
        const selector = ${serializedSelector};
        const element = document.querySelector(selector);
        if (!element) return false;
        element.scrollIntoView({ block: 'center', inline: 'center' });
        element.click();
        return true;
      })()`,
    );
  }

  async scroll(targetId, command) {
    const y =
      typeof command.y === 'number'
        ? command.y
        : command.direction === 'top'
          ? 0
          : 'document.documentElement.scrollHeight';
    return await this.evaluate(
      targetId,
      `(() => {
        window.scrollTo({ top: ${y}, behavior: 'instant' });
        return true;
      })()`,
    );
  }

  async screenshot(targetId) {
    return await this.withTarget(targetId, async (cdp) => {
      await cdp.send('Page.enable');
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      });
      return result.data;
    });
  }

  async download(targetId, command) {
    const downloadDir = command.downloadDir || path.join(process.cwd(), 'downloads');
    await mkdir(downloadDir, { recursive: true });
    const before = new Set((await readdir(downloadDir).catch(() => [])).map((file) => path.join(downloadDir, file)));

    if (command.selector) {
      await this.click(targetId, command.selector);
    }

    const deadline = Date.now() + (command.timeoutMs || 30000);
    while (Date.now() < deadline) {
      const entries = await readdir(downloadDir).catch(() => []);
      for (const entry of entries) {
        const filePath = path.join(downloadDir, entry);
        if (before.has(filePath) || entry.endsWith('.crdownload')) {
          continue;
        }
        const fileStat = await stat(filePath).catch(() => undefined);
        if (fileStat?.isFile()) {
          return { ok: true, downloadedFilePath: filePath };
        }
      }
      await sleep(250);
    }

    return { ok: false, error: 'download_timeout' };
  }
}

let defaultLocalBrowser;

export function getDefaultLocalBrowser() {
  defaultLocalBrowser ||= new LocalCdpBrowser();
  return defaultLocalBrowser;
}
