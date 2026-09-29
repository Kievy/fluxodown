const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const output = path.join(root, 'test-output');
async function fixture() {
  fs.mkdirSync(output, { recursive: true });
  const source = path.join(output, 'sample.mp4');
  const result = spawnSync(path.join(root, 'bin', 'ffmpeg.exe'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const webm = path.join(output, 'sample.webm');
  const converted = spawnSync(path.join(root, 'bin', 'ffmpeg.exe'), ['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', webm], { windowsHide: true });
  if (converted.status !== 0) throw new Error(converted.stderr.toString());
  const server = http.createServer((req, res) => {
    if (!['/sample.mp4', '/sample.webm'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    const file = req.url.endsWith('.webm') ? webm : source;
    const size = fs.statSync(file).size;
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : size - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type': file === webm ? 'video/webm' : 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file, { start, end }).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/sample.mp4`, close: () => new Promise(resolve => server.close(resolve)), root, output };
}
module.exports = { fixture, root, output };
