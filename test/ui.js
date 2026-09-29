const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron } = require('playwright');
const { fixture } = require('./fixture');
(async () => {
  const test = await fixture();
  let app;
  try {
    const userData = fs.mkdtempSync(path.join(test.output, 'ui-profile-'));
    const folder = path.join(userData, 'downloads');
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ folder }));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [test.root, '--smoke-hide', `--user-data-dir=${userData}`], env });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => !document.getElementById('inspect').disabled);
    assert.equal(await page.locator('#download').isDisabled(), true);
    await page.screenshot({ path: path.join(test.output, 'interface.png'), fullPage: true });
    await page.locator('#url').fill(test.url);
    await page.locator('#inspect').click();
    await page.waitForFunction(() => !document.getElementById('download').disabled, { timeout: 30000 });
    await page.locator('#format').selectOption('mp3');
    await page.locator('#quality').selectOption('192');
    await page.locator('#download').click();
    await page.locator('#show-file').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.locator('#status-title').innerText(), 'Download concluído');
    assert.ok(fs.readdirSync(folder).some(f => f.endsWith('.mp3')));
    await page.screenshot({ path: path.join(test.output, 'download-concluido.png'), fullPage: true });
    await page.locator('#url').fill(test.url + '?changed=1');
    assert.equal(await page.locator('#download').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('OK: interface, consulta real, seleção de MP3/192 kbps, download e invalidação ao mudar URL.');
  } finally { if (app) await app.close(); await test.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
