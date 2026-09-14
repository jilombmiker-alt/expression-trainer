# Single persistent VM deployment, not an ephemeral function filesystem.
FROM node:24-bookworm-slim AS node
FROM python:3.11-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/requirements-speech-tested.txt /app/services/requirements-speech-tested.txt
RUN pip install --no-cache-dir -r services/requirements-speech-tested.txt
COPY services /app/services
COPY web /app/web
RUN useradd --uid 10001 --create-home trainer && mkdir -p /data /models && chown trainer:trainer /data /models
ENV EXPRESSION_DATA_DIR=/data MODELSCOPE_CACHE=/models PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER trainer
EXPOSE 4173
CMD ["python", "services/p0_service.py", "--host", "0.0.0.0", "--port", "4173", "--web-dir", "web"]
