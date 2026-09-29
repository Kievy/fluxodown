const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareCookies, friendlyError, YtDlp } = require('../src/core');
const { fixture } = require('./fixture');

test('cookies usam cópias isoladas e preservam o arquivo original', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-test-'));
  const file = path.join(directory, 'cookies.txt');
  const content = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tTEST\tfake-value\n';
  fs.writeFileSync(file, content);
  let first, second;
  try {
    first = prepareCookies(file); second = prepareCookies(file);
    assert.notEqual(first.file, second.file);
    fs.writeFileSync(first.file, 'modificado pelo teste');
    assert.equal(fs.readFileSync(file, 'utf8'), content);
    assert.equal(fs.readFileSync(second.file, 'utf8'), content);
    first.cleanup(); assert.ok(!fs.existsSync(first.file));
    fs.writeFileSync(file, '# Netscape HTTP Cookie File\ninvalid-secret-value');
    assert.throws(() => prepareCookies(file), error => /Netscape/.test(error.message) && !error.message.includes('invalid-secret-value'));
    fs.writeFileSync(file, content.replace('.youtube.com', 'youtube.com'));
    assert.throws(() => prepareCookies(file), /Netscape/);
  } finally { first?.cleanup(); second?.cleanup(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('erros de verificação do YouTube orientam com e sem cookies', () => {
  const raw = "ERROR: [youtube] video: Sign in to confirm you’re not a bot. Use --cookies";
  assert.match(friendlyError(raw), /YTDLP_COOKIES_FILE/);
  assert.match(friendlyError(raw, true), /Renove os cookies/);
  assert.equal(friendlyError('Video unavailable'), 'Video unavailable');
});
test('opções de operações paralelas não alteram a configuração compartilhada', () => {
  const options = { extraArgs: ['--no-cache-dir'] };
  const first = new YtDlp('', () => {}, options);
  const second = new YtDlp('', () => {}, options);
  first.extraArgs.push('--max-filesize', '100');
  assert.deepEqual(second.extraArgs, ['--no-cache-dir']);
});
test('yt-dlp usa cookies sintéticos e limpa a cópia após sucesso, falha e cancelamento', async () => {
  const source = await fixture();
  const directory = fs.mkdtempSync(path.join(source.output, 'cookie-test-'));
  const cookieFile = path.join(directory, 'cookies.txt');
  const content = '# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t2147483647\tTEST\tfake-value\n';
  fs.writeFileSync(cookieFile, content);
  const engine = new YtDlp(path.join(source.root, 'bin'), () => {}, { cookiesFile: cookieFile });
  try {
    const inspecting = engine.inspect(source.url);
    const temp = engine.child.spawnargs[engine.child.spawnargs.indexOf('--cookies') + 1];
    assert.notEqual(temp, cookieFile);
    assert.ok((await inspecting).profiles.length);
    assert.ok(!fs.existsSync(temp));
    const failure = engine.inspect(source.url.replace('sample.mp4', 'missing.mp4'));
    const failedTemp = engine.child.spawnargs[engine.child.spawnargs.indexOf('--cookies') + 1];
    await assert.rejects(failure); assert.ok(!fs.existsSync(failedTemp));
    const cancelled = engine.inspect(source.url);
    const cancelledTemp = engine.child.spawnargs[engine.child.spawnargs.indexOf('--cookies') + 1];
    engine.cancel(); await assert.rejects(cancelled, /cancelada/);
    assert.ok(!fs.existsSync(cancelledTemp));
    assert.equal(fs.readFileSync(cookieFile, 'utf8'), content);
  } finally { await source.close(); }
});
