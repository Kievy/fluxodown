const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { YtDlp, validateUrl, downloadArgs } = require('./core');

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;
const UI = path.join(__dirname, 'ui');
const digest = value => createHash('sha256').update(value).digest();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function number(value, fallback, minimum, maximum) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new Error('Limite de configuração inválido.');
  return result;
}
function configFromEnv(env = process.env) {
  const windows = process.platform === 'win32';
  const bin = path.resolve(__dirname, '..', 'bin');
  return {
    username: env.APP_USERNAME || 'admin', password: env.APP_PASSWORD || '',
    port: number(env.PORT, 3000, 0, 65535), host: env.HOST || '0.0.0.0',
    directory: path.resolve(env.DOWNLOAD_DIR || path.join(__dirname, '..', 'downloads')),
    allowedHosts: (env.ALLOWED_HOSTS || 'youtube.com,youtu.be,vimeo.com').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
    maxConcurrent: number(env.MAX_CONCURRENT_JOBS, 2, 1, 8),
    maxBytes: number(env.MAX_DOWNLOAD_MB, 2048, 1, 102400) * 1024 * 1024,
    maxDiskBytes: number(env.MAX_STORAGE_MB, 10240, 1, 1048576) * 1024 * 1024,
    retentionMs: number(env.FILE_RETENTION_HOURS, 1, 0.01, 720) * 3600000,
    timeoutMs: number(env.JOB_TIMEOUT_MINUTES, 60, 1, 240) * 60000,
    engine: { executable: env.YTDLP_PATH || (windows ? path.join(bin, 'yt-dlp.exe') : '/opt/yt-dlp/bin/yt-dlp'),
      ffmpeg: env.FFMPEG_LOCATION || (windows ? bin : '/usr/bin'),
      node: env.NODE_EXECUTABLE || process.execPath,
      extraArgs: ['--no-cache-dir'],
    }, bin,
  };
}
function allowedUrl(input, hosts) {
  const url = new URL(validateUrl(input));
  if (!hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw fail('Este site não está habilitado no servidor. Consulte a configuração ALLOWED_HOSTS.');
  }
  if (url.port && !['80', '443'].includes(url.port) && !hosts.includes(url.host)) {
    throw fail('Porta da URL não permitida.');
  }
  return url.href;
}
function jobView(job) {
  return { id: job.id, type: job.type, status: job.status, progress: job.progress, logs: job.logs,
    result: job.result, error: job.error, createdAt: job.createdAt, expiresAt: job.expiresAt };
}
async function createServer(config = configFromEnv()) {
  if (config.password.length < 12) throw new Error('Defina APP_PASSWORD com pelo menos 12 caracteres antes de iniciar.');
  if (config.username.includes(':')) throw new Error('APP_USERNAME não pode conter dois-pontos.');
  await fsp.mkdir(config.directory, { recursive: true });
  const jobs = new Map();
  const credentials = digest(`${config.username}:${config.password}`);
  let closing = false;
  const engineFor = job => new YtDlp(config.bin, event => {
    if (event.type === 'progress') job.progress = event;
    else { job.logs.push(String(event.message).slice(0, 2000)); if (job.logs.length > 120) job.logs.shift(); }
  }, config.engine);
  engineFor({ logs: [] }).check();
  const jobDir = id => {
    if (!UUID.test(id)) throw fail('Identificador inválido.', 404);
    const directory = path.resolve(config.directory, id);
    if (path.dirname(directory) !== config.directory) throw fail('Caminho inválido.');
    return directory;
  };
  // Recupera os arquivos concluídos; tarefas interrompidas não são retomadas sozinhas.
  for (const item of await fsp.readdir(config.directory, { withFileTypes: true })) {
    if (!item.isDirectory() || !UUID.test(item.name)) continue;
    const directory = jobDir(item.name);
    try {
      const record = JSON.parse(await fsp.readFile(path.join(directory, 'manifest.json'), 'utf8'));
      if (record.id !== item.name || typeof record.name !== 'string' || path.basename(record.name) !== record.name || !Number.isFinite(record.expiresAt)) throw new Error('Registro inválido');
      const file = path.join(directory, record.name);
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Arquivo inválido');
      jobs.set(item.name, { id: item.name, type: 'download', status: 'done', createdAt: record.createdAt,
        expiresAt: record.expiresAt, file, logs: [], result: { name: record.name, downloadUrl: `/api/files/${item.name}` } });
    } catch {
      // Diretórios de tarefas incompletas são removidos após a mesma retenção.
      const stat = await fsp.stat(directory);
      jobs.set(item.name, { id: item.name, type: 'download', status: 'error', error: 'Interrompido por reinício do servidor.', createdAt: stat.mtimeMs, expiresAt: stat.mtimeMs + config.retentionMs, logs: [] });
    }
  }
  async function cleanup() {
    for (const [id, job] of jobs) {
      if (job.status === 'running' || job.readers || job.expiresAt > Date.now()) continue;
      if (job.type === 'download') await fsp.rm(jobDir(id), { recursive: true, force: true });
      jobs.delete(id);
    }
  }
  await cleanup();
  const cleaner = setInterval(() => cleanup().catch(error => console.error('Limpeza:', error.message)), 60000);
  cleaner.unref();
  async function diskUsage(directory) {
    let total = 0;
    for (const item of await fsp.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) total += await diskUsage(file);
      else if (item.isFile()) total += (await fsp.stat(file).catch(() => ({ size: 0 }))).size;
    }
    return total;
  }
  function newJob(type) {
    if (closing) throw fail('Servidor reiniciando.', 503);
    if ([...jobs.values()].filter(j => j.status === 'running').length >= config.maxConcurrent) throw fail('O servidor está ocupado. Aguarde um download terminar e tente novamente.', 429);
    if (jobs.size >= 500) throw fail('Limite de tarefas atingido. Aguarde a limpeza automática.', 429);
    const job = { id: randomUUID(), type, status: 'running', createdAt: Date.now(), expiresAt: Date.now() + config.retentionMs, logs: [], readers: 0 };
    job.engine = engineFor(job);
    jobs.set(job.id, job);
    return job;
  }
  function runJob(job, task) {
    const timer = setTimeout(() => { job.stopReason = 'Tempo máximo da operação excedido.'; job.engine.cancel(); }, job.type === 'inspect' ? 120000 : config.timeoutMs);
    let checking = false;
    const budget = job.type === 'download' ? setInterval(async () => {
      if (checking || job.status !== 'running') return;
      checking = true;
      try {
        if (await diskUsage(jobDir(job.id)) > config.maxBytes || await diskUsage(config.directory) > config.maxDiskBytes) {
          job.stopReason = 'Limite de armazenamento atingido.'; job.engine.cancel();
        }
      } catch {} finally { checking = false; }
    }, 2000) : null;
    job.promise = (async () => {
      try {
        job.result = await task();
        if (job.stopReason) throw new Error(job.stopReason);
        job.status = 'done';
      } catch (error) {
        job.error = job.stopReason || error.message;
        job.status = job.error === 'Operação cancelada.' ? 'cancelled' : 'error';
        if (job.type === 'download') await fsp.rm(jobDir(job.id), { recursive: true, force: true }).catch(() => {});
      } finally {
        clearTimeout(timer); clearInterval(budget);
        job.expiresAt = Date.now() + (job.type === 'inspect' ? 3600000 : config.retentionMs);
        delete job.engine;
      }
    })();
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json') || req.headers['x-requested-with'] !== 'Fluxo') throw fail('Requisição inválida.', 403);
    if (req.headers.origin) {
      let origin; try { origin = new URL(req.headers.origin); } catch { throw fail('Origem inválida.', 403); }
      if (origin.host !== req.headers.host) throw fail('Origem inválida.', 403);
    }
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 16384) throw fail('Requisição muito grande.', 413); }
    try { const parsed = JSON.parse(data || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; }
    catch { throw fail('JSON inválido.'); }
  }
  function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, value })); }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/healthz') return json(res, { status: 'ok' });
      const authorization = req.headers.authorization || '';
      const provided = authorization.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString('utf8') : '';
      if (!timingSafeEqual(digest(provided), credentials)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Fluxo", charset="UTF-8"');
        throw fail('Informe usuário e senha para acessar.', 401);
      }
      if (req.method === 'GET' && pathname === '/api/config') return json(res, { web: true, retentionHours: config.retentionMs / 3600000, allowedHosts: config.allowedHosts });
      if (req.method === 'GET' && pathname === '/api/files') return json(res, [...jobs.values()].filter(j => j.type === 'download' && j.status === 'done' && j.expiresAt > Date.now()).sort((a, b) => b.createdAt - a.createdAt).map(jobView));
      const match = pathname.match(/^\/api\/(jobs|files)\/([a-f\d-]+)(\/cancel)?$/);
      if (match) {
        const job = jobs.get(match[2]);
        if (!job || job.expiresAt < Date.now() && job.status !== 'running') throw fail('Arquivo ou tarefa expirou. Inicie novamente.', 404);
        if (req.method === 'GET' && match[1] === 'jobs' && !match[3]) return json(res, jobView(job));
        if (req.method === 'POST' && match[1] === 'jobs' && match[3]) {
          await body(req);
          if (job.status === 'running') { job.stopReason = 'Operação cancelada.'; job.engine.cancel(); }
          return json(res, null);
        }
        if (req.method === 'GET' && match[1] === 'files' && !match[3] && job.status === 'done' && job.file) {
          job.readers++;
          res.once('close', () => { job.readers--; });
          const stat = await fsp.stat(job.file);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="download${path.extname(job.file)}"; filename*=UTF-8''${encodeURIComponent(path.basename(job.file)).replace(/'/g, '%27')}` });
          const stream = fs.createReadStream(job.file);
          stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy());
          return stream.pipe(res);
        }
      }
      if (req.method === 'POST' && pathname === '/api/inspect') {
        const data = await body(req);
        const url = allowedUrl(data.url, config.allowedHosts);
        const job = newJob('inspect'); job.url = url;
        runJob(job, () => job.engine.inspect(url));
        return json(res, { id: job.id }, 202);
      }
      if (req.method === 'POST' && pathname === '/api/download') {
        const data = await body(req);
        const inspection = jobs.get(data.inspectionId);
        if (!inspection || inspection.type !== 'inspect' || inspection.status !== 'done' || inspection.expiresAt < Date.now()) throw fail('Consulte o vídeo novamente.');
        if (validateUrl(data.url) !== inspection.url) throw fail('A URL mudou. Consulte o vídeo novamente.');
        const options = { url: inspection.url, format: data.format, quality: data.quality, directory: config.directory };
        downloadArgs(options, inspection.result); // Valida antes de reservar uma tarefa.
        if (await diskUsage(config.directory) >= config.maxDiskBytes) throw fail('Armazenamento cheio. Aguarde a limpeza automática.', 507);
        const job = newJob('download');
        runJob(job, async () => {
          const directory = jobDir(job.id);
          await fsp.mkdir(directory);
          if (job.stopReason) throw new Error(job.stopReason);
          job.engine.extraArgs.push('--max-filesize', String(config.maxBytes));
          job.file = await job.engine.download({ ...options, directory }, inspection.result);
          if (path.dirname(path.resolve(job.file)) !== directory) throw new Error('Arquivo fora da pasta de download.');
          if (await diskUsage(directory) > config.maxBytes || await diskUsage(config.directory) > config.maxDiskBytes) throw new Error('Limite de armazenamento atingido.');
          const name = path.basename(job.file);
          await fsp.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ id: job.id, name, createdAt: job.createdAt, expiresAt: Date.now() + config.retentionMs }));
          return { name, downloadUrl: `/api/files/${job.id}` };
        });
        return json(res, { id: job.id }, 202);
      }
      const assets = { '/': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/renderer.js': ['renderer.js', 'text/javascript'], '/web-api.js': ['web-api.js', 'text/javascript'] };
      if (req.method === 'GET' && assets[pathname]) {
        const [file, type] = assets[pathname];
        const content = await fsp.readFile(path.join(UI, file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(content);
      }
      throw fail('Não encontrado.', 404);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      res.writeHead(error.status || 400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  server.requestTimeout = 30000;
  async function close() {
    closing = true; clearInterval(cleaner);
    for (const job of jobs.values()) if (job.status === 'running') { job.stopReason = 'Servidor reiniciado. Inicie o download novamente.'; job.engine.cancel(); }
    await Promise.all([...jobs.values()].map(j => j.promise));
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  return { server, close, cleanup };
}
if (require.main === module) {
  (async () => {
    const config = configFromEnv();
    const instance = await createServer(config);
    instance.server.listen(config.port, config.host, () => console.log(`Fluxo web pronto na porta ${config.port}.`));
    instance.server.on('error', error => { console.error(error.message); process.exitCode = 1; instance.close(); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => instance.close().then(() => process.exit(0)));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createServer, configFromEnv, allowedUrl };
