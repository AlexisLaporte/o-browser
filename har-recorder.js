#!/usr/bin/env node
/**
 * HAR Recorder - Captures network traffic via CDP
 * Usage: node har-recorder.js <output.har> [cdp-port]
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const outputPath = process.argv[2] || '/tmp/recording.har';
const cdpPort = process.argv[3] || 9222;

// HAR structure
const har = {
  log: {
    version: '1.2',
    creator: { name: 'har-recorder', version: '1.0' },
    entries: []
  }
};

// Track requests
const requests = new Map();

async function getCdpWebSocketUrl() {
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

async function main() {
  console.log(`HAR Recorder starting, output: ${outputPath}`);

  // Get WebSocket URL for first page
  let wsUrl;
  try {
    wsUrl = await getCdpWebSocketUrl();
  } catch (e) {
    console.error('Failed to get CDP URL:', e.message);
    process.exit(1);
  }

  console.log('Connecting to:', wsUrl);
  const ws = new WebSocket(wsUrl);

  let msgId = 1;
  const send = (method, params = {}) => {
    ws.send(JSON.stringify({ id: msgId++, method, params }));
  };

  ws.on('open', () => {
    console.log('Connected, enabling Network domain...');
    send('Network.enable');
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.method === 'Network.requestWillBeSent') {
      const { requestId, request, timestamp, wallTime, initiator } = msg.params;
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
          postData: request.postData ? { mimeType: 'application/x-www-form-urlencoded', text: request.postData } : undefined
        },
        response: null,
        cache: {},
        timings: { send: 0, wait: 0, receive: 0 },
        _timestamp: timestamp
      });
    }

    if (msg.method === 'Network.responseReceived') {
      const { requestId, response, timestamp } = msg.params;
      const entry = requests.get(requestId);
      if (entry) {
        entry.response = {
          status: response.status,
          statusText: response.statusText,
          httpVersion: response.protocol || 'HTTP/1.1',
          headers: Object.entries(response.headers || {}).map(([name, value]) => ({ name, value })),
          cookies: [],
          content: { size: 0, mimeType: response.mimeType || '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1
        };
        entry.time = (timestamp - entry._timestamp) * 1000;
      }
    }

    if (msg.method === 'Network.loadingFinished') {
      const { requestId } = msg.params;
      const entry = requests.get(requestId);
      if (entry && entry.response) {
        har.log.entries.push(entry);
      }
    }
  });

  ws.on('close', () => {
    console.log('Connection closed, saving HAR...');
    saveHar();
    process.exit(0);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });

  // Save on signals
  const saveAndExit = () => {
    console.log('Signal received, saving HAR...');
    saveHar();
    process.exit(0);
  };

  process.on('SIGINT', saveAndExit);
  process.on('SIGTERM', saveAndExit);

  // Periodic save
  setInterval(() => {
    saveHar();
  }, 30000);
}

function parseQueryString(url) {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function saveHar() {
  // Add pending requests with responses
  for (const entry of requests.values()) {
    if (entry.response && !har.log.entries.includes(entry)) {
      har.log.entries.push(entry);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(har, null, 2));
  console.log(`HAR saved: ${outputPath} (${har.log.entries.length} entries)`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
