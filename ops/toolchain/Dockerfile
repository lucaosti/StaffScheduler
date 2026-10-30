# Verification toolchain — every gate in one image, nothing on the host (#864).
#
# WHY AN IMAGE INSTEAD OF A HOST SETUP. The gate needs Node, a Python with the
# pinned OR-Tools (the parity suite is a statement about one solver version),
# ruff, a Chromium matching the Playwright release in the lockfile, and the
# client tools for MySQL. Installed on a workstation, each of those drifts from
# CI and from the other developers, and the results depend on the host OS (the
# macOS filesystem is case-insensitive, Homebrew ships a different MySQL
# major). Built from this file, the toolchain is the same everywhere.
#
# WHY node:22-bookworm AND NOT THE PLAYWRIGHT IMAGE. The Playwright image ships
# Node 24, while production (backend/Dockerfile) and CI run Node 22; the gate
# must exercise the runtime that is deployed. Debian bookworm also brings the
# Python 3.11 CI uses. Chromium and its system libraries are installed below
# with Playwright's own installer, pinned to the lockfile version.
#
# Only the toolchain lives here. The repository is bind-mounted at runtime
# (docker-compose.verify.yml), with node_modules and build output in volumes.

FROM node:22-bookworm

# Keep in step with backend/optimization-scripts/requirements.txt (solver) and
# the @playwright/test version in package-lock.json (browser build).
ARG RUFF_VERSION=0.17.3
ARG PLAYWRIGHT_VERSION=1.62.1

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # The root `prepare` hook installs git hooks; a container has no use for them.
    HUSKY=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-venv default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

COPY backend/optimization-scripts/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt "ruff==${RUFF_VERSION}" \
    && rm /tmp/requirements.txt
# The backend spawns `python3` from PATH (ScheduleOptimizerORTools.ts), so the
# venv must come first for the solver to be found.
ENV PATH=/opt/venv/bin:$PATH

RUN npx -y "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
    && rm -rf /root/.npm /var/lib/apt/lists/*

# The Docker CLI and its Compose plugin, for scripts/compose-config.test.mjs:
# `docker compose config` resolves the deployment files the way `up` would and
# needs no daemon, so no socket is mounted. Copied from the official CLI image
# (both binaries are static) rather than installed from Docker's apt
# repository, which would add a third-party source and its signing key for two
# files.
COPY --from=docker:29.9.2-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:29.9.2-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

# The repository is bind-mounted and owned by the host user; without this git
# refuses to run in it, and the drift checks are `git diff --exit-code`.
RUN git config --system --add safe.directory /workspace

WORKDIR /workspace
