const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const os = require('node:os');

const PROFILES = {
  mp4: { label: 'MP4', kind: 'video', ext: 'mp4', audio: 'm4a' },
  mkv: { label: 'MKV', kind: 'video' },
  webm: { label: 'WebM', kind: 'video', ext: 'webm', audio: 'webm' },
  mp3: { label: 'MP3', kind: 'audio' },
  m4a: { label: 'M4A', kind: 'audio' },
  opus: { label: 'Opus', kind: 'audio' },
  wav: { label: 'WAV', kind: 'audio' },
};

function validateUrl(input) {
  if (typeof input !== 'string' || input.length > 8192) throw new Error('Cole uma URL de vídeo válida.');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Cole uma URL completa, começando com https://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use uma URL HTTP ou HTTPS, sem credenciais.');
  return url.href;
}

function videoFormats(info, profile) {
  return (info.formats || []).filter(f => f.vcodec !== 'none' && !f.has_drm && (!profile.ext || f.ext === profile.ext));
}

function summarize(info) {
  if (info._type === 'playlist' || info.entries) throw new Error('Cole o link de um único vídeo, em vez de uma playlist.');
  if (info.is_live || info.live_status === 'is_upcoming') throw new Error('Use um vídeo já publicado. Transmissões ao vivo não são suportadas nesta versão.');
  const formats = info.formats || [];
  // O extrator genérico pode não informar os codecs de um arquivo direto.
  const hasAudio = formats.some(f => f.acodec !== 'none' && !f.has_drm);
  const profiles = Object.entries(PROFILES).flatMap(([id, profile]) => {
    if (profile.kind === 'audio') return hasAudio ? [{ id, ...profile, heights: [] }] : [];
    const videos = videoFormats(info, profile);
    // Formatos separados precisam de uma faixa de áudio compatível com o contêiner.
    const compatible = videos.filter(f => f.acodec !== 'none' || formats.some(a => a.acodec !== 'none' && !a.has_drm && (!profile.audio || a.ext === profile.audio)) || !hasAudio);
    if (!compatible.length) return [];
    return [{ id, ...profile, heights: [...new Set(compatible.map(f => f.height).filter(h => Number.isInteger(h) && h > 0))].sort((a, b) => b - a) }];
  });
  if (!profiles.length) throw new Error('Nenhum formato disponível para este vídeo.');
  return {
    title: info.title || 'Vídeo sem título',
    author: info.uploader || info.channel || info.extractor_key || 'Vídeo',
    duration: info.duration || 0,
    thumbnail: typeof info.thumbnail === 'string' && info.thumbnail.startsWith('https://') ? info.thumbnail : null,
    profiles,
  };
}

function downloadArgs({ url, format, quality, directory }, summary) {
  const profile = summary.profiles.find(p => p.id === format);
  if (!profile) throw new Error('Selecione um formato disponível.');
  const args = ['--no-simulate', '--no-quiet', '--newline', '--progress', '--progress-delta', '0.3',
    '--progress-template', 'download:__PROGRESS__%(progress)j',
    '--print', 'after_move:__FILE__%(filepath)j',
    '--windows-filenames', '--no-overwrites', '--no-mtime',
    '-P', directory, '-o', `%(title).140B [%(id)s] (${format}-${quality}).%(ext)s`];
  if (profile.kind === 'audio') {
    if (!['best', '128', '192', '256', '320'].includes(String(quality))) throw new Error('Qualidade de áudio inválida.');
    args.push('-f', 'ba/b', '-x', '--audio-format', format, '--audio-quality', quality === 'best' ? '0' : `${quality}K`);
  } else {
    if (quality !== 'best' && !profile.heights.includes(Number(quality))) throw new Error('Resolução indisponível. Consulte o vídeo novamente.');
    const height = quality === 'best' ? '' : `[height<=${Number(quality)}]`;
    const ext = profile.ext ? `[ext=${profile.ext}]` : '';
    const audio = profile.audio ? `[ext=${profile.audio}]` : '';
    args.push('-f', `bv${ext}${height}+ba${audio}/b${ext}${height}/bv${ext}${height}`,
      '--merge-output-format', format, '--remux-video', format);
    if (format === 'mp4') args.push('-S', 'vcodec:h264,acodec:aac');
  }
  args.push('--', validateUrl(url));
  return args;
}

function prepareCookies(source) {
  if (!source) return null;
  let content;
  try {
    if (!fs.statSync(source).isFile() || fs.statSync(source).size > 1024 * 1024) throw new Error();
    content = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
  } catch { throw new Error('Não foi possível ler YTDLP_COOKIES_FILE. Confira o arquivo montado e suas permissões no servidor.'); }
  const lines = content.split(/\r?\n/);
  const entries = lines.filter(line => line.trim() && (!line.startsWith('#') || line.startsWith('#HttpOnly_')));
  const valid = entries.length && entries.every(line => {
    const fields = line.replace(/^#HttpOnly_/, '').split('\t');
    return fields.length === 7 && /^[.a-z\d-]+$/i.test(fields[0]) && /^(TRUE|FALSE)$/.test(fields[1])
      && fields[0].startsWith('.') === (fields[1] === 'TRUE') && fields[2].startsWith('/')
      && /^(TRUE|FALSE)$/.test(fields[3]) && /^\d+$/.test(fields[4]) && Number.isSafeInteger(Number(fields[4])) && fields[5];
  });
  if (!/^# (?:Netscape )?HTTP Cookie File/.test(lines[0]) || !valid) {
    throw new Error('Arquivo de cookies inválido. Exporte os cookies no formato Netscape cookies.txt.');
  }
  // yt-dlp regrava o cookie jar. Use uma cópia por operação para aceitar secrets
  // montados somente para leitura e evitar concorrência no arquivo original.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-cookies-'));
  const file = path.join(directory, 'cookies.txt');
  try { fs.writeFileSync(file, content, { mode: 0o600 }); }
  catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  return { file, cleanup: () => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }) };
}

function friendlyError(message, hasCookies = false) {
  if (/sign in to confirm (?:you[’']?re|you are) not a bot/i.test(message)) {
    return hasCookies
      ? 'O YouTube continua exigindo verificação, mesmo com cookies. A sessão pode ter expirado ou o IP do servidor pode estar bloqueado. Renove os cookies ou tente a versão desktop na sua conexão local.'
      : 'O YouTube exigiu verificação de acesso nesta conexão. Configure cookies do YouTube no servidor (YTDLP_COOKIES_FILE) ou tente a versão desktop na sua conexão local. A senha do Fluxo não autentica no YouTube.';
  }
  return message;
}

class YtDlp {
  constructor(bin, onEvent = () => {}, options = {}) {
    this.bin = bin;
    this.onEvent = onEvent;
    this.child = null;
    this.cancelled = false;
    this.executable = options.executable || path.join(bin, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    this.ffmpeg = options.ffmpeg || bin;
    this.node = options.node || path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
    this.extraArgs = [...(options.extraArgs || [])];
    this.cookiesFile = options.cookiesFile || '';
  }
  check() {
    const suffix = process.platform === 'win32' ? '.exe' : '';
    for (const file of [this.executable, this.node, path.join(this.ffmpeg, `ffmpeg${suffix}`), path.join(this.ffmpeg, `ffprobe${suffix}`)]) {
      if (!fs.existsSync(file)) throw new Error('Dependências ausentes. Verifique a instalação do yt-dlp, FFmpeg e Node.');
    }
  }
  cancel() {
    if (!this.child) return;
    this.cancelled = true;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true });
      killer.on('error', () => this.child?.kill());
    } else {
      // O FFmpeg também pertence ao grupo: cancelar não deixa conversões órfãs.
      try { process.kill(-this.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  run(args, { metadata = false } = {}) {
    if (this.child) throw new Error('Aguarde a operação atual terminar.');
    this.check();
    this.cancelled = false;
    const cookies = prepareCookies(this.cookiesFile);
    return new Promise((resolve, reject) => {
      let output = '', errors = '', finalPath = '', timedOut = false;
      const child = spawn(this.executable, [
        '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-colors',
        '--encoding', 'utf-8', '--socket-timeout', '25', '--retries', '3',
        '--ffmpeg-location', this.ffmpeg, '--js-runtimes', `node:${this.node}`,
        ...(cookies ? ['--cookies', cookies.file] : []), ...this.extraArgs, ...args,
      ], { windowsHide: true, shell: false, detached: process.platform !== 'win32' });
      this.child = child;
      const timer = metadata ? setTimeout(() => { timedOut = true; this.cancel(); }, 120000) : null;
      const reader = readline.createInterface({ input: child.stdout });
      reader.on('line', line => {
        if (metadata) { output += `${line}\n`; if (output.length > 32 * 1024 * 1024) this.cancel(); return; }
        try {
          if (line.startsWith('__PROGRESS__')) {
            const p = JSON.parse(line.slice(12));
            const total = p.total_bytes || p.total_bytes_estimate;
            this.onEvent({ type: 'progress', percent: total ? Math.min(100, 100 * p.downloaded_bytes / total) : null, speed: p.speed, eta: p.eta, downloaded: p.downloaded_bytes, status: p.status });
          } else if (line.startsWith('__FILE__')) finalPath = JSON.parse(line.slice(8));
          else this.onEvent({ type: 'log', message: line });
        } catch { this.onEvent({ type: 'log', message: line }); }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', data => { errors = (errors + data).slice(-12000); if (!metadata) this.onEvent({ type: 'log', message: data.trim() }); });
      child.once('error', error => { clearTimeout(timer); this.child = null; reject(new Error(`Não foi possível iniciar o yt-dlp: ${error.message}`)); });
      child.once('close', code => {
        clearTimeout(timer); reader.close(); this.child = null;
        if (timedOut) return reject(new Error('A consulta demorou demais. Confira sua conexão e tente novamente.'));
        if (this.cancelled) return reject(new Error('Operação cancelada.'));
        if (code !== 0) return reject(new Error(friendlyError(errors.trim() || `O yt-dlp encerrou com código ${code}.`, Boolean(cookies))));
        resolve(metadata ? output : finalPath);
      });
    }).finally(() => cookies?.cleanup());
  }
  async inspect(url) {
    return summarize(JSON.parse(await this.run(['--dump-single-json', '--skip-download', '--', validateUrl(url)], { metadata: true })));
  }
  async download(options, summary) {
    const file = await this.run(downloadArgs(options, summary));
    if (!file || !fs.existsSync(file)) throw new Error('O yt-dlp terminou, mas o arquivo final não foi encontrado. Consulte os detalhes.');
    return file;
  }
}
module.exports = { validateUrl, summarize, downloadArgs, YtDlp, prepareCookies, friendlyError };
