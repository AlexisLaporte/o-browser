FROM node:20-slim

# Install system deps (Xvfb, x11vnc, websockify, ffmpeg, nginx, tini)
# Chromium is installed separately via Patchright (anti-detection patched)
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    jq \
    socat \
    gnupg \
    tini \
    xvfb \
    x11vnc \
    websockify \
    ffmpeg \
    procps \
    nginx \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # Install noVNC
    && mkdir -p /opt/novnc \
    && curl -sL https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz -C /opt/novnc --strip-components=1

# Create app directory
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm install --production 2>/dev/null || true

# Install Patchright's anti-detection Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.browsers
RUN npx patchright install chromium --with-deps \
    && ln -sf $(find /app/.browsers -name "chrome" -type f | head -1) /usr/bin/google-chrome

# Copy service files (flatten into /app/ for runtime)
COPY service/api-server.js service/session-recorder.js ./
COPY service/start-session.sh service/end-session.sh ./
RUN chmod +x *.sh

# Copy UI
COPY service/ui/ ./ui/

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Create directories
RUN mkdir -p /app/sessions /app/recordings

# Environment
ENV DISPLAY=:99
ENV PORT=8080
ENV AUTH_TOKEN=""
ENV VNC_BASE_URL=""

# Expose ports
# 8080 = nginx (routes /api, /vnc, /cdp)
# 6080 = websockify (VNC) - direct access fallback
# 9222 = CDP - direct access fallback
EXPOSE 8080 6080 9222

# Start script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

STOPSIGNAL SIGTERM
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]
