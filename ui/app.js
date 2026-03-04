// Browser Session Manager

const API_BASE = '/api';
let currentSession = null;

// DOM elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const sessionInfo = document.getElementById('session-info');
const sessionId = document.getElementById('session-id');
const sessionTime = document.getElementById('session-time');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnScreenshot = document.getElementById('btn-screenshot');
const vncPlaceholder = document.getElementById('vnc-placeholder');
const vncIframe = document.getElementById('vnc-iframe');
const recordingsPanel = document.getElementById('recordings-panel');

// Recording elements
const recVideoStatus = document.getElementById('rec-video-status');
const recVideoSize = document.getElementById('rec-video-size');
const recVideoDownload = document.getElementById('rec-video-download');
const recHarStatus = document.getElementById('rec-har-status');
const recHarSize = document.getElementById('rec-har-size');
const recHarEntries = document.getElementById('rec-har-entries');
const recHarDownload = document.getElementById('rec-har-download');
const recScreenshotsCount = document.getElementById('rec-screenshots-count');
const screenshotsList = document.getElementById('screenshots-list');

// Get token from URL or prompt
function getToken() {
  const params = new URLSearchParams(window.location.search);
  let token = params.get('token');
  if (!token) {
    token = localStorage.getItem('browser_token');
  }
  if (!token) {
    token = prompt('Enter access token:');
    if (token) {
      localStorage.setItem('browser_token', token);
    }
  }
  return token;
}

const TOKEN = getToken();

if (!TOKEN) {
  statusText.textContent = 'No token provided';
  statusDot.classList.add('error');
  btnStart.disabled = true;
}

// API helpers
async function api(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Update UI based on session state
function updateUI() {
  if (currentSession) {
    statusDot.classList.add('active');
    statusDot.classList.remove('error');
    statusText.textContent = 'Session active';

    sessionInfo.classList.remove('hidden');
    sessionId.textContent = currentSession.id || currentSession.session_id || '-';
    sessionTime.textContent = formatTime(currentSession.started_at);

    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
    btnScreenshot.classList.remove('hidden');

    vncPlaceholder.classList.add('hidden');
    vncIframe.classList.remove('hidden');
    recordingsPanel.classList.remove('hidden');

    // Show recording status
    recVideoStatus.classList.add('recording');
    recVideoStatus.classList.remove('done');
    recHarStatus.classList.add('recording');
    recHarStatus.classList.remove('done');

    // Hide download links during recording
    recVideoDownload.classList.add('hidden');
    recHarDownload.classList.add('hidden');
  } else {
    statusDot.classList.remove('active');
    statusText.textContent = 'No active session';

    sessionInfo.classList.add('hidden');

    btnStart.classList.remove('hidden');
    btnStop.classList.add('hidden');
    btnScreenshot.classList.add('hidden');

    vncPlaceholder.classList.remove('hidden');
    vncIframe.classList.add('hidden');
    vncIframe.src = '';
    recordingsPanel.classList.add('hidden');

    // Reset recording stats
    recVideoSize.textContent = '-';
    recHarSize.textContent = '-';
    recHarEntries.textContent = '';
    recScreenshotsCount.textContent = '0 captures';
    screenshotsList.innerHTML = '';
  }
}

function formatTime(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleTimeString();
}

// VNC connection via iframe
function connectVNC() {
  if (!TOKEN) return;

  const host = window.location.host;
  const vncPath = encodeURIComponent(`vnc/websockify?token=${TOKEN}`);
  const vncUrl = `/vnc/vnc.html?autoconnect=true&resize=scale&host=${host}&port=443&path=${vncPath}&encrypt=1`;

  vncIframe.src = vncUrl;
  console.log('VNC iframe src:', vncUrl);
}

// Fetch recording stats
async function fetchRecordingStats() {
  if (!currentSession) return;

  try {
    const stats = await api('/sessions/current/stats');

    // Update video stats
    if (stats.video) {
      recVideoSize.textContent = formatBytes(stats.video.size);
    }

    // Update HAR stats
    if (stats.har) {
      recHarSize.textContent = formatBytes(stats.har.size);
      recHarEntries.textContent = `(${stats.har.entries} req)`;
    }

    // Update screenshots
    if (stats.screenshots) {
      recScreenshotsCount.textContent = `${stats.screenshots.length} capture${stats.screenshots.length !== 1 ? 's' : ''}`;

      // Update screenshots list
      screenshotsList.innerHTML = '';
      for (const screenshot of stats.screenshots) {
        const thumb = document.createElement('div');
        thumb.className = 'screenshot-thumb';
        thumb.title = screenshot.name;
        thumb.onclick = () => {
          const url = `${API_BASE}/recordings/${currentSession.id}/screenshots/${screenshot.name}`;
          window.open(url, '_blank');
        };
        screenshotsList.appendChild(thumb);
      }
    }
  } catch (e) {
    console.error('Failed to fetch recording stats:', e);
  }
}

// Fetch current session
async function fetchSession() {
  try {
    const data = await api('/sessions/current');
    if (data.error) {
      currentSession = null;
    } else {
      currentSession = data;
    }
  } catch (e) {
    currentSession = null;
  }

  updateUI();

  if (currentSession && !vncIframe.src) {
    connectVNC();
  }

  // Fetch recording stats if session active
  if (currentSession) {
    fetchRecordingStats();
  }
}

// Start session
async function startSession() {
  btnStart.disabled = true;
  btnStart.textContent = 'Starting...';

  try {
    const data = await api('/sessions', {
      method: 'POST',
      body: JSON.stringify({ workflow: 'manual' }),
    });

    if (data.error) {
      throw new Error(data.error);
    }

    currentSession = data;
    updateUI();

    // Wait a bit for Chrome to start, then connect VNC
    setTimeout(() => connectVNC(), 2000);
  } catch (e) {
    alert('Failed to start session: ' + e.message);
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = 'Start Session';
  }
}

// Stop session
async function stopSession() {
  btnStop.disabled = true;
  btnStop.textContent = 'Stopping...';

  try {
    const result = await api('/sessions/current', { method: 'DELETE' });

    // Show final stats with download links
    if (result && result.id) {
      showCompletedSession(result);
    } else {
      currentSession = null;
      updateUI();
    }
  } catch (e) {
    alert('Failed to stop session: ' + e.message);
  } finally {
    btnStop.disabled = false;
    btnStop.textContent = 'Stop Session';
  }
}

// Show completed session with download links
function showCompletedSession(session) {
  currentSession = null;

  // Keep recordings panel visible
  recordingsPanel.classList.remove('hidden');
  vncPlaceholder.classList.remove('hidden');
  vncIframe.classList.add('hidden');
  vncIframe.src = '';

  // Update status
  statusDot.classList.remove('active');
  statusText.textContent = 'Session completed';
  sessionInfo.classList.add('hidden');
  btnStart.classList.remove('hidden');
  btnStop.classList.add('hidden');
  btnScreenshot.classList.add('hidden');

  // Update recording status to done
  recVideoStatus.classList.remove('recording');
  recVideoStatus.classList.add('done');
  recHarStatus.classList.remove('recording');
  recHarStatus.classList.add('done');

  // Show download links
  const baseUrl = '/api';

  if (session.recordings) {
    if (session.recordings.screencast_size) {
      recVideoSize.textContent = formatBytes(session.recordings.screencast_size);
    }
    if (session.recordings.har_size) {
      recHarSize.textContent = formatBytes(session.recordings.har_size);
      recHarEntries.textContent = `(${session.recordings.har_entries || 0} req)`;
    }
  }

  recVideoDownload.href = `${baseUrl}/recordings/${session.id}/screencast.mp4`;
  recVideoDownload.classList.remove('hidden');

  recHarDownload.href = `${baseUrl}/recordings/${session.id}/network.har`;
  recHarDownload.classList.remove('hidden');
}

// Take screenshot
async function takeScreenshot() {
  const name = prompt('Screenshot name:', `screenshot-${Date.now()}`);
  if (!name) return;

  try {
    await api('/sessions/current/screenshot', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    // Refresh stats to show new screenshot
    fetchRecordingStats();
  } catch (e) {
    alert('Failed to take screenshot: ' + e.message);
  }
}

// Event listeners
btnStart.addEventListener('click', startSession);
btnStop.addEventListener('click', stopSession);
btnScreenshot.addEventListener('click', takeScreenshot);

// Initial fetch and polling
fetchSession();
setInterval(fetchSession, 5000); // Poll every 5s for stats updates
