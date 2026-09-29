const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { fixture } = require('./fixture');
const { createServer, configFromEnv, allowedUrl } = require('../src/server');

test('servidor recusa senha vazia e URLs fora dos sites habilitados', async () => {
  await assert.rejects(createServer(configFromEnv({})), /APP_PASSWORD/);
  assert.equal(allowedUrl('https://www.youtube.com/watch?v=test', ['youtube.com']), 'https://www.youtube.com/watch?v=test');
  for (const url of ['http://127.0.0.1', 'http://169.254.169.254', 'https://youtube.com.evil.test', 'https://youtube.com:3000']) assert.throws(() => allowedUrl(url, ['youtube.com']));
});

test('HTTP real: autenticação, download, persistência, cancelamento e expiração', { timeout: 60000 }, async () => {
  const source = await fixture();
  const config = configFromEnv({ APP_PASSWORD: 'test-only-password-1234' });
  config.directory = await fs.mkdtemp(path.join(source.output, 'web-server-'));
  config.allowedHosts = ['127.0.0.1', new URL(source.url).host];
  config.maxConcurrent = 1;
  let instance;
  let base;
  async function start() {
    instance = await createServer(config);
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${instance.server.address().port}`;
  }
  const headers = { Authorization: `Basic ${Buffer.from(`admin:${config.password}`).toString('base64')}` };
  async function request(route, data, extra = {}) {
    return fetch(base + route, { headers: { ...headers, ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'Fluxo' }), ...extra }, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) });
  }
  async function poll(id) {
    for (let i = 0; i < 100; i++) {
      const response = await request(`/api/jobs/${id}`);
      const { value } = await response.json();
      if (value.status !== 'running') return value;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Timeout da tarefa');
  }
  try {
    await start();
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/')).status, 401);
    assert.equal((await fetch(base + '/api/files')).status, 401);
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/api/inspect', { url: source.url }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await request('/api/inspect', { url: source.url }, { 'X-Requested-With': '' })).status, 403);
    assert.equal((await request('/api/inspect', { url: 'http://169.254.169.254' })).status, 400);
    assert.equal((await request('/src/server.js')).status, 404);
    const inspection = (await (await request('/api/inspect', { url: source.url })).json()).value;
    assert.equal((await request('/api/inspect', { url: source.url })).status, 429);
    assert.equal((await poll(inspection.id)).status, 'done');
    assert.equal((await request('/api/download', { inspectionId: inspection.id, url: source.url, format: '--exec', quality: 'best' })).status, 400);
    const started = await request('/api/download', { inspectionId: inspection.id, url: source.url, format: 'mp3', quality: '192' });
    assert.equal(started.status, 202);
    const { value: download } = await started.json();
    const job = await poll(download.id);
    assert.equal(job.status, 'done', job.error);
    assert.ok(job.logs.length);
    assert.equal((await fetch(base + job.result.downloadUrl)).status, 401);
    const file = await request(job.result.downloadUrl);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-disposition'), /attachment/);
    assert.ok((await file.arrayBuffer()).byteLength > 100);
    const entries = (await (await request('/api/files')).json()).value;
    assert.equal(entries.length, 1);
    assert.ok(!JSON.stringify(entries).includes(config.directory));
    const downloadOptions = { inspectionId: inspection.id, url: source.url, format: 'mp4', quality: 'best' };
    const interrupted = (await (await request('/api/download', downloadOptions)).json()).value;
    await request(`/api/jobs/${interrupted.id}/cancel`, {});
    assert.equal((await poll(interrupted.id)).status, 'cancelled');
    await assert.rejects(fs.stat(path.join(config.directory, interrupted.id)), { code: 'ENOENT' });
    const originalLimit = config.maxBytes;
    config.maxBytes = 32;
    const oversized = (await (await request('/api/download', downloadOptions)).json()).value;
    assert.equal((await poll(oversized.id)).status, 'error');
    await assert.rejects(fs.stat(path.join(config.directory, oversized.id)), { code: 'ENOENT' });
    config.maxBytes = originalLimit;
    const originalStorage = config.maxDiskBytes;
    config.maxDiskBytes = 1;
    assert.equal((await request('/api/download', downloadOptions)).status, 507);
    config.maxDiskBytes = originalStorage;
    const cancel = (await (await request('/api/inspect', { url: source.url })).json()).value;
    await request(`/api/jobs/${cancel.id}/cancel`, {});
    assert.equal((await poll(cancel.id)).status, 'cancelled');
    await instance.close();
    await start();
    assert.equal((await (await request('/api/files')).json()).value.length, 1);
    assert.equal((await request(job.result.downloadUrl)).status, 200);
    await instance.close();
    const manifestPath = path.join(config.directory, download.id, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.expiresAt = Date.now() - 1;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await start();
    assert.equal((await (await request('/api/files')).json()).value.length, 0);
    await assert.rejects(fs.stat(path.join(config.directory, download.id)), { code: 'ENOENT' });
    assert.equal((await request(job.result.downloadUrl)).status, 404);
  } finally { if (instance) await instance.close(); await source.close(); }
});
