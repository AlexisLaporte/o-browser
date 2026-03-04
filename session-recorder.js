#!/usr/bin/env node
/**
 * Session Recorder — Captures DOM (rrweb), network (HAR with bodies), and browser state via CDP
 * Usage: node session-recorder.js <recording-dir> [cdp-port]
 *
 * Outputs:
 *   <recording-dir>/rrweb-events.json    — DOM + interactions (rrweb replay format)
 *   <recording-dir>/network.har          — HAR 1.2 with response bodies (routeFromHAR compatible)
 *   <recording-dir>/browser-state.jsonl  — Cookies/localStorage/sessionStorage snapshots
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const recordingDir = process.argv[2] || '/tmp/recording';
const cdpPort = process.argv[3] || 9222;

// Output paths
const rrwebPath = path.join(recordingDir, 'rrweb-events.json');
const harPath = path.join(recordingDir, 'network.har');
const statePath = path.join(recordingDir, 'browser-state.jsonl');

// ---- State ----

const rrwebEvents = [];
const requests = new Map();
const pendingBodies = new Map(); // requestId → entry (waiting for getResponseBody)
const har = {
  log: {
    version: '1.2',
    creator: { name: 'session-recorder', version: '2.0' },
    entries: []
  }
};

// MIME types to skip body capture (binary content)
const BINARY_MIMES = /^(image|video|audio|font)\//;
const BINARY_EXACT = new Set(['application/octet-stream', 'application/pdf', 'application/zip', 'application/wasm']);
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

// ---- CDP Connection ----

function getCdpWebSocketUrl() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${cdpPort}/json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const pages = JSON.parse(data);
        if (pages.length > 0) {
          resolve(pages[0].webSocketDebuggerUrl);
        } else {
          reject(new Error('No pages found'));
        }
      });
    }).on('error', reject);
  });
}

let ws;
let msgId = 1;
const pending = new Map(); // id → {resolve, reject}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    // Timeout after 10s
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 10000);
  });
}

// ---- rrweb Injection ----

let rrwebScript = null;

function loadRrwebScript() {
  // Try multiple possible paths for the rrweb UMD bundle
  const bases = [__dirname, path.join(__dirname, '..')];
  const candidates = bases.flatMap(base => [
    path.join(base, 'node_modules', '@rrweb', 'record', 'dist', 'record.umd.cjs'),
    path.join(base, 'node_modules', '@rrweb', 'record', 'dist', 'record.js'),
  ]);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`rrweb script found: ${p}`);
      return fs.readFileSync(p, 'utf8');
    }
  }
  throw new Error(`rrweb UMD not found. Tried: ${candidates.join(', ')}`);
}

function buildInjectionScript() {
  return `
(function() {
  if (window.__rrwebRecording) return;
  window.__rrwebRecording = true;
  window.__rrwebEvents = [];
  ${rrwebScript}
  if (typeof rrwebRecord !== 'undefined' && rrwebRecord.default) {
    rrwebRecord.default({ emit(e) { window.__rrwebEvents.push(e); } });
  } else if (typeof rrwebRecord !== 'undefined') {
    rrwebRecord({ emit(e) { window.__rrwebEvents.push(e); } });
  } else if (typeof rrweb !== 'undefined' && rrweb.record) {
    rrweb.record({ emit(e) { window.__rrwebEvents.push(e); } });
  }
})();
`;
}

async function injectRrweb() {
  const script = buildInjectionScript();
  // Inject on every new document
  await send('Page.addScriptToEvaluateOnNewDocument', { source: script });
  // Also inject into current page
  await send('Runtime.evaluate', { expression: script }).catch(() => {});
}

let rrwebPollTimer = null;

function startRrwebPolling() {
  rrwebPollTimer = setInterval(async () => {
    try {
      const result = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__rrwebEvents ? window.__rrwebEvents.splice(0) : [])',
        returnByValue: true
      });
      const value = result?.result?.value;
      if (value) {
        const events = JSON.parse(value);
        if (events.length > 0) {
          rrwebEvents.push(...events);
        }
      }
    } catch (e) {
      // Page might be navigating, ignore
    }
  }, 2000);
}

// ---- Network Capture (HAR with bodies) ----

function shouldCaptureBody(mimeType) {
  if (!mimeType) return true;
  if (BINARY_MIMES.test(mimeType)) return false;
  if (BINARY_EXACT.has(mimeType)) return false;
  return true;
}

function parseQueryString(url) {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function handleRequestWillBeSent(params) {
  const { requestId, request, timestamp, wallTime } = params;
  requests.set(requestId, {
    startedDateTime: new Date(wallTime * 1000).toISOString(),
    time: 0,
    request: {
      method: request.method,
      url: request.url,
      httpVersion: 'HTTP/1.1',
      headers: Object.entries(request.headers || {}).map(([name, value]) => ({ name, value })),
      queryString: parseQueryString(request.url),
      cookies: [],
      headersSize: -1,
      bodySize: request.postData ? request.postData.length : 0,
      postData: request.postData ? {
        mimeType: request.headers?.['Content-Type'] || 'application/x-www-form-urlencoded',
        text: request.postData
      } : undefined
    },
    response: null,
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
    _timestamp: timestamp,
    _mimeType: null
  });
}

function handleResponseReceived(params) {
  const { requestId, response, timestamp } = params;
  const entry = requests.get(requestId);
  if (!entry) return;

  entry._mimeType = response.mimeType || '';
  entry.response = {
    status: response.status,
    statusText: response.statusText,
    httpVersion: response.protocol || 'HTTP/1.1',
    headers: Object.entries(response.headers || {}).map(([name, value]) => ({ name, value })),
    cookies: [],
    content: {
      size: response.encodedDataLength || 0,
      mimeType: response.mimeType || '',
      text: ''
    },
    redirectURL: '',
    headersSize: -1,
    bodySize: -1
  };
  entry.time = (timestamp - entry._timestamp) * 1000;
}

async function handleLoadingFinished(params) {
  const { requestId, encodedDataLength } = params;
  const entry = requests.get(requestId);
  if (!entry || !entry.response) return;

  // Try to capture response body
  if (shouldCaptureBody(entry._mimeType) && encodedDataLength < MAX_BODY_SIZE) {
    try {
      const result = await send('Network.getResponseBody', { requestId });
      if (result?.body) {
        let body = result.body;
        if (body.length > MAX_BODY_SIZE) {
          body = body.slice(0, MAX_BODY_SIZE) + '\n[TRUNCATED at 1MB]';
        }
        entry.response.content.text = body;
        entry.response.content.size = body.length;
        if (result.base64Encoded) {
          entry.response.content.encoding = 'base64';
        }
      }
    } catch (e) {
      // Body may be unavailable (e.g. redirect), that's fine
    }
  }

  // Clean up internal fields
  delete entry._timestamp;
  delete entry._mimeType;

  har.log.entries.push(entry);
  requests.delete(requestId);
}

// ---- Browser State ----

async function captureBrowserState(url) {
  try {
    const [cookiesResult, localStorageResult, sessionStorageResult] = await Promise.all([
      send('Network.getCookies').catch(() => ({ cookies: [] })),
      send('Runtime.evaluate', {
        expression: '(() => { try { return JSON.stringify(localStorage); } catch(e) { return "{}"; } })()',
        returnByValue: true
      }).catch(() => ({ result: { value: '{}' } })),
      send('Runtime.evaluate', {
        expression: '(() => { try { return JSON.stringify(sessionStorage); } catch(e) { return "{}"; } })()',
        returnByValue: true
      }).catch(() => ({ result: { value: '{}' } }))
    ]);

    const snapshot = {
      ts: Date.now(),
      url: url || '',
      cookies: cookiesResult.cookies || [],
      localStorage: JSON.parse(localStorageResult?.result?.value || '{}'),
      sessionStorage: JSON.parse(sessionStorageResult?.result?.value || '{}')
    };

    fs.appendFileSync(statePath, JSON.stringify(snapshot) + '\n');
  } catch (e) {
    console.error('Browser state capture failed:', e.message);
  }
}

// ---- Save Functions ----

function saveRrweb() {
  fs.writeFileSync(rrwebPath, JSON.stringify(rrwebEvents));
  console.log(`rrweb saved: ${rrwebEvents.length} events`);
}

function saveHar() {
  // Flush pending requests that have responses
  for (const [id, entry] of requests) {
    if (entry.response && !har.log.entries.includes(entry)) {
      delete entry._timestamp;
      delete entry._mimeType;
      har.log.entries.push(entry);
    }
  }
  fs.writeFileSync(harPath, JSON.stringify(har, null, 2));
  console.log(`HAR saved: ${har.log.entries.length} entries`);
}

function saveAll() {
  saveRrweb();
  saveHar();
}

// ---- Main ----

async function main() {
  console.log(`Session Recorder starting — output: ${recordingDir}`);

  // Load rrweb
  rrwebScript = loadRrwebScript();

  // Connect to CDP
  let wsUrl;
  try {
    wsUrl = await getCdpWebSocketUrl();
  } catch (e) {
    console.error('Failed to get CDP URL:', e.message);
    process.exit(1);
  }

  console.log('Connecting to:', wsUrl);
  ws = new WebSocket(wsUrl);

  ws.on('open', async () => {
    console.log('Connected, enabling domains...');
    try {
      await send('Network.enable');
      await send('Page.enable');
      await send('Runtime.enable');
      await injectRrweb();
      startRrwebPolling();
      console.log('All domains enabled, recording started.');
    } catch (e) {
      console.error('Setup failed:', e.message);
    }
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    // Handle responses to our send() calls
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // CDP events
    switch (msg.method) {
      case 'Network.requestWillBeSent':
        handleRequestWillBeSent(msg.params);
        break;
      case 'Network.responseReceived':
        handleResponseReceived(msg.params);
        break;
      case 'Network.loadingFinished':
        handleLoadingFinished(msg.params);
        break;
      case 'Page.loadEventFired':
        // Capture state after page loads
        send('Runtime.evaluate', {
          expression: 'window.location.href',
          returnByValue: true
        }).then(r => captureBrowserState(r?.result?.value)).catch(() => {});
        break;
      case 'Page.frameNavigated':
        if (msg.params?.frame?.parentId === undefined) {
          // Top-level navigation only
          captureBrowserState(msg.params.frame.url);
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log('CDP connection closed, saving...');
    saveAll();
    process.exit(0);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Signal received, saving and exiting...');
    if (rrwebPollTimer) clearInterval(rrwebPollTimer);
    saveAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Periodic save every 30s
  setInterval(saveAll, 30000);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
