const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Este instalador foi preparado para Windows x64.');
  }
  // Versões recentes do pacote Electron só baixam o runtime ao serem carregadas.
  require('electron');
  const bin = path.join(__dirname, '..', 'bin');
  await fs.mkdir(bin, { recursive: true });
  console.log('Consultando a versão oficial do yt-dlp...');
  const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
  if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
  const release = await response.json();
  const asset = release.assets.find(a => a.name === 'yt-dlp.exe');
  const sums = release.assets.find(a => a.name === 'SHA2-256SUMS');
  if (!asset || !sums) throw new Error('Release sem executável ou checksum.');
  const [exeResponse, hashResponse] = await Promise.all([fetch(asset.browser_download_url), fetch(sums.browser_download_url)]);
  if (!exeResponse.ok || !hashResponse.ok) throw new Error('Falha ao baixar o yt-dlp.');
  const data = Buffer.from(await exeResponse.arrayBuffer());
  const hashLine = (await hashResponse.text()).split('\n').find(line => /\s\*?yt-dlp\.exe\s*$/.test(line));
  const expected = hashLine?.split(/\s+/)[0];
  if (crypto.createHash('sha256').update(data).digest('hex') !== expected) throw new Error('Checksum do yt-dlp inválido.');
  await fs.writeFile(path.join(bin, 'yt-dlp.exe.tmp'), data);
  await fs.rename(path.join(bin, 'yt-dlp.exe.tmp'), path.join(bin, 'yt-dlp.exe'));
  await fs.copyFile(require('ffmpeg-static'), path.join(bin, 'ffmpeg.exe'));
  await fs.copyFile(require('ffprobe-static').path, path.join(bin, 'ffprobe.exe'));
  // Runtime local usado pelo yt-dlp para os desafios JavaScript do YouTube.
  await fs.copyFile(process.execPath, path.join(bin, 'node.exe'));
  console.log(`Pronto! yt-dlp ${release.tag_name}, FFmpeg, FFprobe e Node preparados.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
