const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./fixture');
const { YtDlp } = require('../src/core');
(async () => {
  const test = await fixture();
  try {
    const events = [];
    const engine = new YtDlp(path.join(test.root, 'bin'), event => events.push(event));
    const info = await engine.inspect(test.url);
    assert.ok(info.profiles.some(p => p.id === 'mp4'));
    const directory = fs.mkdtempSync(path.join(test.output, 'integration-'));
    for (const format of ['mp4', 'mp3', 'mkv', 'wav', 'm4a', 'opus', 'webm']) {
      const url = format === 'webm' ? test.url.replace('.mp4', '.webm') : test.url;
      const metadata = format === 'webm' ? await engine.inspect(url) : info;
      const file = await engine.download({ url, format, quality: 'best', directory }, metadata);
      assert.equal(path.extname(file), `.${format}`);
      assert.ok(fs.statSync(file).size > 100);
      const probe = spawnSync(path.join(test.root, 'bin', 'ffprobe.exe'), ['-v', 'quiet', '-show_streams', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
      assert.equal(probe.status, 0);
      const streams = JSON.parse(probe.stdout).streams;
      assert.ok(streams.some(s => s.codec_type === 'audio'));
      if (['mp4', 'mkv', 'webm'].includes(format)) assert.ok(streams.some(s => s.codec_type === 'video'));
      else assert.ok(streams.every(s => s.codec_type === 'audio'));
      console.log(`OK: download real ${format}, arquivo validado pelo FFprobe`);
    }
    assert.ok(fs.readdirSync(directory).some(file => file.endsWith('.mp4')), 'As conversões de áudio preservam o vídeo baixado anteriormente');
    assert.ok(events.some(e => e.type === 'progress'));
    await assert.rejects(engine.inspect(test.url.replace('sample.mp4', 'missing.mp4')));
    const pending = engine.inspect(test.url);
    engine.cancel();
    await assert.rejects(pending, /cancelada/);
    console.log('OK: progresso, erro HTTP e cancelamento');
  } finally { await test.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
