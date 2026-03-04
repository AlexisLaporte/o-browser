#!/usr/bin/env node
/**
 * Browser Session API
 * Exposes sessions via HTTP, filesystem-based
 *
 * Endpoints:
 *   GET  /sessions              - List all sessions
 *   GET  /sessions/current      - Get current session
 *   GET  /sessions/:id          - Get specific session
 *   GET  /sessions/:id/files    - List session files (screencast, HAR, screenshots)
 *   POST /sessions              - Start new session {workflow: "name"}
 *   DELETE /sessions/current    - End current session
 *   POST /sessions/current/screenshot - Take screenshot {name: "step1"}
 *   GET  /recordings/:session/:file - Serve recording files
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
const CDP_PORT = 9222;
const BASE_DIR = __dirname;
const SESSIONS_DIR = path.join(BASE_DIR, 'sessions');
const RECORDINGS_DIR = path.join(BASE_DIR, 'recordings');

// Auth token (same as CDP)
const AUTH_TOKEN = process.env.AUTH_TOKEN || '4557b80990c053660af41594ff39a9919e439b96cf3851142284ebb5eeff01db';

function checkAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === AUTH_TOKEN;
}

function addCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function jsonResponse(res, status, data) {
  addCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// List all sessions
function listSessions() {
  const sessions = [];
  if (!fs.existsSync(SESSIONS_DIR)) return sessions;

  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.startsWith('ses_') && f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'));
      sessions.push(data);
    } catch (e) {
      // Skip invalid files
    }
  }
  return sessions.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

// Get current session
function getCurrentSession() {
  const currentFile = path.join(SESSIONS_DIR, 'current.json');
  if (!fs.existsSync(currentFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(currentFile, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Start session
function startSession(workflow = 'manual', profile = 'default') {
  try {
    const result = execSync(`${BASE_DIR}/start-session.sh "${workflow}" "${profile}"`, {
      encoding: 'utf8',
      timeout: 120000  // 2 minutes - Chrome startup can be slow
    });
    // Parse JSON from output (skip non-JSON lines)
    const lines = result.split('\n');
    for (const line of lines) {
      if (line.trim().startsWith('{')) {
        return JSON.parse(line + lines.slice(lines.indexOf(line) + 1).join('\n'));
      }
    }
    return { error: 'Failed to parse session output' };
  } catch (e) {
    const stderr = e.stderr?.trim() || '';
    const stdout = e.stdout?.trim() || '';
    // Read process logs for diagnostics
    const logs = {};
    for (const f of ['xvfb', 'x11vnc', 'novnc', 'chrome', 'ffmpeg']) {
      try { logs[f] = fs.readFileSync(`/tmp/${f}.log`, 'utf8').slice(-500); } catch (_) {}
    }
    console.error('start-session failed:', { stderr, stdout, logs });
    return { error: e.message, stderr, stdout, logs };
  }
}

// End session
function endSession(reason = 'api') {
  try {
    const result = execSync(`${BASE_DIR}/end-session.sh "${reason}"`, {
      encoding: 'utf8',
      timeout: 60000
    });
    const lines = result.split('\n');
    for (const line of lines) {
      if (line.trim().startsWith('{')) {
        return JSON.parse(line + lines.slice(lines.indexOf(line) + 1).join('\n'));
      }
    }
    return { error: 'Failed to parse output' };
  } catch (e) {
    return { error: e.message };
  }
}

// Take screenshot via Xvfb (xwd + convert to PNG, no ImageMagick needed)
async function takeScreenshot(name = Date.now().toString()) {
  try {
    const current = getCurrentSession();
    if (!current) return { error: 'No active session' };

    const screenshotDir = path.join(RECORDINGS_DIR, current.id, 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const filePath = path.join(screenshotDir, `${name}.png`);

    // Use ffmpeg to grab a single frame from X11 (already installed)
    execSync(
      `ffmpeg -y -f x11grab -video_size 1920x1080 -i :99 -frames:v 1 "${filePath}"`,
      { timeout: 10000, stdio: 'pipe' }
    );

    return { screenshot: filePath };
  } catch (e) {
    return { error: e.message };
  }
}

// List session files (screencast, HAR, screenshots)
function listSessionFiles(sessionId) {
  const sessionDir = path.join(RECORDINGS_DIR, sessionId);

  if (!fs.existsSync(sessionDir)) {
    return { error: 'Session not found' };
  }

  const result = {
    sessionId,
    screencast: null,
    har: null,
    rrweb: null,
    browserState: null,
    screenshots: []
  };

  const files = fs.readdirSync(sessionDir);

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    const stat = fs.statSync(filePath);

    if (file === 'screencast.mp4') {
      result.screencast = { name: file, size: stat.size };
    } else if (file === 'network.har') {
      let entries = 0;
      try {
        const har = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        entries = har.log?.entries?.length || 0;
      } catch (e) {}
      result.har = { name: file, size: stat.size, entries };
    } else if (file === 'rrweb-events.json') {
      let events = 0;
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        events = Array.isArray(data) ? data.length : 0;
      } catch (e) {}
      result.rrweb = { name: file, size: stat.size, events };
    } else if (file === 'browser-state.jsonl') {
      let snapshots = 0;
      try {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (content) snapshots = content.split('\n').length;
      } catch (e) {}
      result.browserState = { name: file, size: stat.size, snapshots };
    } else if (file.endsWith('.png') || file.endsWith('.jpg')) {
      result.screenshots.push({
        name: file,
        size: stat.size,
        timestamp: stat.mtime.toISOString()
      });
    }
  }

  // Also scan screenshots/ subdirectory (step snapshots from automation)
  const screenshotsDir = path.join(sessionDir, 'screenshots');
  if (fs.existsSync(screenshotsDir)) {
    const ssFiles = fs.readdirSync(screenshotsDir);
    for (const file of ssFiles) {
      if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.html')) {
        const filePath = path.join(screenshotsDir, file);
        const stat = fs.statSync(filePath);
        result.screenshots.push({
          name: `screenshots/${file}`,
          size: stat.size,
          timestamp: stat.mtime.toISOString()
        });
      }
    }
  }

  // Sort screenshots by name (001_xxx, 002_xxx, etc.)
  result.screenshots.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}

// Serve recording file with Range support for video seeking
function serveRecording(req, res, sessionId, filename) {
  const filePath = path.join(RECORDINGS_DIR, sessionId, filename);

  if (!fs.existsSync(filePath)) {
    jsonResponse(res, 404, { error: 'File not found' });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filename).toLowerCase();

  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.har': 'application/json',
    '.json': 'application/json',
    '.jsonl': 'application/x-ndjson',
    '.png': 'image/png',
    '.jpg': 'image/jpeg'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  addCorsHeaders(res);

  // Handle Range requests for video seeking
  const range = req.headers.range;
  if (range && ext === '.mp4') {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes'
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes'
    });

    fs.createReadStream(filePath).pipe(res);
  }
}

// Request handler
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Strip /api prefix (nginx proxies /api/* to this server)
  const pathname = url.pathname.replace(/^\/api/, '');
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Auth check (except for health)
  if (pathname !== '/health' && !checkAuth(req)) {
    jsonResponse(res, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    // Health check
    if (pathname === '/health') {
      jsonResponse(res, 200, { status: 'ok', current: getCurrentSession() !== null });
      return;
    }

    // CDP proxy - forward /cdp/* to Chrome on CDP_PORT
    if (url.pathname.startsWith('/cdp/')) {
      const cdpPath = url.pathname.replace('/cdp', '');
      const cdpUrl = `http://127.0.0.1:${CDP_PORT}${cdpPath}`;

      try {
        const cdpRes = await fetch(cdpUrl);
        const data = await cdpRes.json();
        jsonResponse(res, cdpRes.status, data);
      } catch (e) {
        jsonResponse(res, 502, { error: `CDP proxy error: ${e.message}` });
      }
      return;
    }

    // List profiles
    if (pathname === '/profiles' && method === 'GET') {
      const profilesDir = path.join(BASE_DIR, 'profiles');
      let profiles = [];
      if (fs.existsSync(profilesDir)) {
        profiles = fs.readdirSync(profilesDir, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => {
            const stat = fs.statSync(path.join(profilesDir, e.name));
            return { name: e.name, lastModified: stat.mtime.toISOString() };
          })
          .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
      }
      jsonResponse(res, 200, { profiles });
      return;
    }

    // List sessions
    if (pathname === '/sessions' && method === 'GET') {
      jsonResponse(res, 200, { sessions: listSessions() });
      return;
    }

    // Get current session
    if (pathname === '/sessions/current' && method === 'GET') {
      const current = getCurrentSession();
      if (current) {
        jsonResponse(res, 200, current);
      } else {
        jsonResponse(res, 404, { error: 'No active session' });
      }
      return;
    }

    // Start session
    if (pathname === '/sessions' && method === 'POST') {
      const body = await parseBody(req);
      const result = startSession(body.workflow, body.profile);
      if (result.error) {
        jsonResponse(res, 400, result);
      } else {
        jsonResponse(res, 201, result);
      }
      return;
    }

    // End session
    if (pathname === '/sessions/current' && method === 'DELETE') {
      const result = endSession('api');
      if (result.error) {
        jsonResponse(res, 400, result);
      } else {
        jsonResponse(res, 200, result);
      }
      return;
    }

    // Screenshot
    if (pathname === '/sessions/current/screenshot' && method === 'POST') {
      const body = await parseBody(req);
      const result = await takeScreenshot(body.name);
      if (result.error) {
        jsonResponse(res, 400, result);
      } else {
        jsonResponse(res, 201, result);
      }
      return;
    }

    // Serve recordings
    const recordingMatch = pathname.match(/^\/recordings\/([^/]+)\/(.+)$/);
    if (recordingMatch && method === 'GET') {
      serveRecording(req, res, recordingMatch[1], recordingMatch[2]);
      return;
    }

    // List session files
    const filesMatch = pathname.match(/^\/sessions\/([^/]+)\/files$/);
    if (filesMatch && method === 'GET') {
      const result = listSessionFiles(filesMatch[1]);
      if (result.error) {
        jsonResponse(res, 404, result);
      } else {
        jsonResponse(res, 200, result);
      }
      return;
    }

    // Get specific session
    const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch && method === 'GET') {
      const sessionId = sessionMatch[1];
      const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.json`);
      if (fs.existsSync(sessionFile)) {
        const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        jsonResponse(res, 200, data);
      } else {
        jsonResponse(res, 404, { error: 'Session not found' });
      }
      return;
    }

    // Not found
    jsonResponse(res, 404, { error: 'Not found' });

  } catch (e) {
    jsonResponse(res, 500, { error: e.message });
  }
}

// Start server
const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Browser Session API running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /health`);
  console.log(`  GET  /profiles`);
  console.log(`  GET  /sessions`);
  console.log(`  GET  /sessions/current`);
  console.log(`  GET  /sessions/:id`);
  console.log(`  GET  /sessions/:id/files`);
  console.log(`  POST /sessions`);
  console.log(`  DELETE /sessions/current`);
  console.log(`  POST /sessions/current/screenshot`);
  console.log(`  GET  /recordings/:session/:file`);
});
