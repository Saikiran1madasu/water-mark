FROM node:22-bookworm-slim AS node
FROM python:3.14-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HOST=0.0.0.0 PORT=10000 \
    MSK_PYTHON=/opt/venv/bin/python MSK_DATA_DIR=/app/storage
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libstdc++6 gosu \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv /opt/venv
WORKDIR /app
COPY requirements.txt ./
RUN /opt/venv/bin/pip install -r requirements.txt
COPY --chown=10001:10001 server.mjs deployment.mjs package.json ./
COPY --chown=10001:10001 engine ./engine
COPY --chown=10001:10001 dist ./dist
RUN mkdir -p /app/storage && chown -R 10001:10001 /app/storage
COPY scripts/container-entrypoint.sh /usr/local/bin/msk-start
RUN chmod 755 /usr/local/bin/msk-start
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(async r=>{if(!r.ok||!(await r.json()).available)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["/usr/local/bin/msk-start"]
