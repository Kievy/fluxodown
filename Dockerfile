FROM node:24-bookworm-slim

ARG YTDLP_VERSION=2026.8.19
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DOWNLOAD_DIR=/data/downloads \
    YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    FFMPEG_LOCATION=/usr/bin \
    NODE_EXECUTABLE=/usr/local/bin/node \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]==${YTDLP_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/downloads \
    && chown -R node:node /data

WORKDIR /app
# A versão web usa apenas módulos nativos do Node. Não leva Electron ao servidor.
COPY --chown=node:node src/core.js src/server.js ./src/
COPY --chown=node:node src/ui ./src/ui
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
