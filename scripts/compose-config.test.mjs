/**
 * The deployment's compose files, checked as Compose itself resolves them.
 *
 * A compose file is configuration nothing else type-checks: a variable the
 * backend reads but the service block never forwards, or a port published on
 * every interface instead of the loopback, is invisible until it is exploited
 * in production. These cases run `docker compose config`, which interpolates
 * the variables and merges the overlays exactly as `up` would, and assert on
 * the resulting model rather than on the YAML text, so an overlay that undoes
 * a base setting is caught too.
 *
 * Needs only the Docker CLI with the Compose plugin; `config` never talks to a
 * daemon. The toolchain image ships it (ops/toolchain/Dockerfile) and so does
 * the CI runner.
 *
 * @author Luca Ostinelli
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// An empty env file, so a developer's own .env cannot change what is asserted:
// Compose would otherwise load ROOT/.env on its own.
const emptyEnvFile = path.join(mkdtempSync(path.join(tmpdir(), 'compose-config-')), 'empty.env');
writeFileSync(emptyEnvFile, '');

// The secrets the base file refuses to interpolate without. Values are
// irrelevant; only their presence is.
const REQUIRED_ENV = {
  MYSQL_ROOT_PASSWORD: 'x',
  MYSQL_PASSWORD: 'x',
  JWT_SECRET: 'x',
  GRAFANA_ADMIN_PASSWORD: 'x',
};

/** Runs `docker compose config` and returns { status, stderr, model }. */
function composeConfig({ files = ['docker-compose.yml'], profiles = [], env = REQUIRED_ENV } = {}) {
  const args = ['compose', '--project-directory', root, '--env-file', emptyEnvFile];
  for (const file of files) args.push('-f', path.join(root, file));
  for (const profile of profiles) args.push('--profile', profile);
  args.push('config', '--format', 'json');
  // Only PATH and HOME from the caller: an exported TRUST_PROXY_HOPS in the
  // shell running the tests must not mask a missing default.
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stderr: result.stderr,
    model: result.status === 0 ? JSON.parse(result.stdout) : null,
  };
}

function resolved(options) {
  const { status, stderr, model } = composeConfig(options);
  assert.equal(status, 0, `docker compose config failed:\n${stderr}`);
  return model;
}

test('the backend trusts exactly the one nginx hop in front of it (#822)', () => {
  // Every request reaches the backend through one nginx: the frontend's /api
  // proxy, or backend-lb in the scale overlay. Without the variable, req.ip
  // is that nginx's address and the login limiter is one global bucket.
  for (const files of [['docker-compose.yml'], ['docker-compose.yml', 'docker-compose.scale.yml']]) {
    const backend = resolved({ files }).services.backend;
    assert.equal(backend.environment.TRUST_PROXY_HOPS, '1', files.join(' + '));
  }
});

test('TRUST_PROXY_HOPS stays overridable from the environment (#822)', () => {
  const backend = resolved({ env: { ...REQUIRED_ENV, TRUST_PROXY_HOPS: '2' } }).services.backend;
  assert.equal(backend.environment.TRUST_PROXY_HOPS, '2');
});

test('the backend\'s direct port is loopback-only, so the trusted hop cannot be skipped (#822)', () => {
  // With one hop trusted, a client that reached the backend directly could
  // write its own X-Forwarded-For and pick the address it is limited under.
  const ports = resolved().services.backend.ports;
  assert.ok(ports.length > 0);
  for (const port of ports) assert.equal(port.host_ip, '127.0.0.1', JSON.stringify(port));
});

test('compose refuses to resolve without a Grafana admin password (#823)', () => {
  // Grafana reads every log line through Loki, and its built-in fallback is
  // admin/admin. Compose interpolates every service whatever the active
  // profiles, so this binds every deployment, not only `--profile ops`.
  const unset = { ...REQUIRED_ENV };
  delete unset.GRAFANA_ADMIN_PASSWORD;
  for (const env of [unset, { ...unset, GRAFANA_ADMIN_PASSWORD: '' }]) {
    const { status, stderr } = composeConfig({ env });
    assert.notEqual(status, 0, JSON.stringify(env));
    assert.match(stderr, /GRAFANA_ADMIN_PASSWORD/);
  }
});

test('Grafana takes the operator\'s password verbatim (#823)', () => {
  const grafana = resolved({
    profiles: ['ops'],
    env: { ...REQUIRED_ENV, GRAFANA_ADMIN_PASSWORD: 'operator-chosen' },
  }).services.grafana;
  assert.equal(grafana.environment.GF_SECURITY_ADMIN_PASSWORD, 'operator-chosen');
});

test('admin consoles are published on the loopback interface only (#823)', () => {
  const { services } = resolved({ profiles: ['ops', 'dev'] });
  for (const name of ['grafana', 'phpmyadmin']) {
    assert.ok(services[name].ports.length > 0, name);
    for (const port of services[name].ports) {
      assert.equal(port.host_ip, '127.0.0.1', `${name}: ${JSON.stringify(port)}`);
    }
  }
});

test('backups live on a host path, out of reach of `down -v` (#847)', () => {
  // A named volume belongs to the compose project, so `down -v` deleted the
  // backups in the same command that deleted the database they protect.
  const { services, volumes = {} } = resolved({ profiles: ['backup'] });
  const mount = services.backup.volumes.find((volume) => volume.target === '/backups');
  assert.equal(mount.type, 'bind', JSON.stringify(mount));
  assert.equal(mount.source, path.join(root, 'backups'));
  assert.equal(volumes.backup_data, undefined);
});

test('the backup directory is configurable (#847)', () => {
  const { services } = resolved({ profiles: ['backup'], env: { ...REQUIRED_ENV, BACKUP_HOST_DIR: '/srv/backups' } });
  const mount = services.backup.volumes.find((volume) => volume.target === '/backups');
  assert.equal(mount.source, '/srv/backups');
});

test('phpMyAdmin asks for credentials instead of logging every visitor in (#823)', () => {
  const { environment } = resolved({ profiles: ['dev'] }).services.phpmyadmin;
  assert.equal(environment.PMA_USER, undefined);
  assert.equal(environment.PMA_PASSWORD, undefined);
});
