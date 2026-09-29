const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl, summarize, downloadArgs } = require('../src/core');
const fixture = { title: 'Teste', formats: [
  { ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080 },
  { ext: 'mp4', vcodec: 'avc1', acodec: 'aac', height: 360 },
  { ext: 'm4a', vcodec: 'none', acodec: 'aac' },
  { ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 2160 },
  { ext: 'webm', vcodec: 'none', acodec: 'opus' },
  { ext: 'mp4', vcodec: 'avc1', acodec: 'aac', height: 720, has_drm: true },
] };

test('URL só permite HTTP(S), sem opções de CLI e sem credenciais', () => {
  assert.equal(validateUrl(' https://example.com/a?x=1&y=2 '), 'https://example.com/a?x=1&y=2');
  for (const input of ['--exec=calc', 'file:///C:/private', 'ftp://example.com', 'https://user:pass@example.com', null]) assert.throws(() => validateUrl(input));
});
test('resoluções são distintas por contêiner e ignoram DRM', () => {
  const info = summarize(fixture);
  assert.deepEqual(info.profiles.find(p => p.id === 'mp4').heights, [1080, 360]);
  assert.deepEqual(info.profiles.find(p => p.id === 'webm').heights, [2160]);
  assert.deepEqual(info.profiles.find(p => p.id === 'mkv').heights, [2160, 1080, 360]);
});
test('playlists e lives não iniciam downloads ilimitados', () => {
  assert.throws(() => summarize({ entries: [] }), /playlist/);
  assert.throws(() => summarize({ is_live: true }), /ao vivo/);
});
test('perfil sem áudio compatível não é oferecido', () => {
  const info = summarize({ formats: [fixture.formats[0], fixture.formats[4]] });
  assert.equal(info.profiles.some(p => p.id === 'mp4'), false);
  assert.equal(info.profiles.some(p => p.id === 'mkv'), true);
});
test('arquivos diretos com codecs desconhecidos podem ser baixados', () => {
  const info = summarize({ formats: [{ ext: 'mp4', vcodec: null }] });
  assert.ok(info.profiles.some(p => p.id === 'mp4'));
  assert.ok(info.profiles.some(p => p.id === 'mp3'));
});
test('o limite de resolução é aplicado a todas as alternativas de vídeo', () => {
  const args = downloadArgs({ url: 'https://example.com/v', format: 'mp4', quality: '1080', directory: 'D:\\Vídeos' }, summarize(fixture));
  const selectors = args[args.indexOf('-f') + 1].split('/');
  assert.ok(selectors.every(s => s.includes('[height<=1080]')));
  assert.deepEqual(args.slice(-2), ['--', 'https://example.com/v']);
  assert.ok(args.includes('after_move:__FILE__%(filepath)j'));
});
test('escolhas adulteradas são rejeitadas antes de chamar yt-dlp', () => {
  for (const [format, quality] of [['--exec', 'best'], ['mp4', '9999'], ['mp3', 'evil']]) {
    assert.throws(() => downloadArgs({ url: 'https://example.com', format, quality, directory: 'D:\\Vídeos' }, summarize(fixture)));
  }
});
test('extração de áudio usa formato e bitrate selecionados', () => {
  const args = downloadArgs({ url: 'https://example.com', format: 'mp3', quality: '192', directory: 'D:\\Vídeos' }, summarize(fixture));
  assert.equal(args[args.indexOf('--audio-format') + 1], 'mp3');
  assert.equal(args[args.indexOf('--audio-quality') + 1], '192K');
  assert.ok(args.includes('-x'));
});
