# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

COPY pyproject.toml ./
# Install dependencies first (cached layer), then the source.
RUN mkdir app jira_mcp && touch app/__init__.py jira_mcp/__init__.py \
    && pip install . && pip uninstall -y enterprise-ai-assistant
COPY app ./app
COPY jira_mcp ./jira_mcp
COPY alembic ./alembic
COPY alembic.ini ./
COPY config ./config
COPY evals ./evals
COPY start.sh ./start.sh

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /srv
USER appuser
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/healthz')" || exit 1
CMD ["./start.sh"]
