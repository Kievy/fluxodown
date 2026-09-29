const $ = id => document.getElementById(id);
const api = window.downloader;
if (api.web) {
  $('choose-folder').hidden = true;
  $('show-file').textContent = 'Salvar no computador ↓';
  $('open-folder').textContent = 'Seus arquivos ↓';
  $('files-panel').hidden = false;
  $('download').lastChild.textContent = ' Preparar download';
}
let info = null, inspectedUrl = '', busy = false, ready = false, logs = [];
const errors = message => { $('error').textContent = message || ''; $('error').hidden = !message; };
function unwrap(result) { if (!result.ok) throw new Error(result.error); return result.value; }
function controls() {
  $('url').disabled = busy;
  $('inspect').disabled = busy || !ready;
  $('choose-folder').disabled = busy;
  $('format').disabled = busy || !info;
  $('quality').disabled = busy || !info || $('format').value === 'wav';
  $('download').disabled = busy || !info || !ready;
}
function duration(seconds) {
  if (!seconds) return 'VÍDEO';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')} DE DURAÇÃO`;
}
function qualities() {
  const profile = info?.profiles.find(p => p.id === $('format').value);
  if (!profile) return;
  $('quality').replaceChildren(new Option(profile.kind === 'video' ? 'Melhor disponível' : profile.id === 'wav' ? 'Sem compressão (WAV)' : 'Melhor qualidade da fonte', 'best'));
  if (profile.kind === 'video') {
    for (const height of profile.heights) $('quality').add(new Option(`Até ${height}p${height >= 2160 ? ' · 4K ou superior' : height === 1080 ? ' · Full HD' : height === 720 ? ' · HD' : ''}`, String(height)));
  } else if (profile.id !== 'wav') {
    for (const rate of [320, 256, 192, 128]) $('quality').add(new Option(`${rate} kbps`, String(rate)));
  }
  $('format-hint').textContent = profile.kind === 'video'
    ? profile.id === 'mp4' ? 'Vídeo + áudio em MP4. Prioriza H.264 quando disponível.' : 'Vídeo + áudio, preservando os codecs originais. A resolução é um limite máximo.'
    : profile.id === 'wav' ? 'Áudio sem compressão. Arquivos maiores; a qualidade depende da fonte.' : 'Extrai apenas o áudio. A conversão não aumenta a qualidade da fonte.';
  controls();
}
$('format').addEventListener('change', qualities);
$('url').addEventListener('input', () => {
  if ($('url').value.trim() === inspectedUrl) return;
  info = null; $('video').hidden = true; $('empty').hidden = false;
  $('format').replaceChildren(new Option('Selecione um vídeo', ''));
  $('quality').replaceChildren(new Option('Selecione um vídeo', ''));
  $('video-badge').textContent = 'AGUARDANDO LINK';
  controls();
});
$('inspect-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !ready) return;
  errors(); busy = true; info = null; controls();
  $('inspect').textContent = 'Consultando…';
  $('status-panel').hidden = true;
  $('video').hidden = true; $('empty').hidden = false;
  $('video-badge').textContent = 'CONSULTANDO';
  try {
    const url = $('url').value.trim();
    info = unwrap(await api.inspect(url)); inspectedUrl = url;
    $('video-title').textContent = info.title; $('video-author').textContent = info.author;
    $('video-meta').textContent = duration(info.duration);
    $('thumbnail').hidden = true; $('thumbnail-fallback').hidden = false;
    if (info.thumbnail) {
      $('thumbnail').onload = () => { $('thumbnail').hidden = false; $('thumbnail-fallback').hidden = true; };
      $('thumbnail').onerror = () => { $('thumbnail').hidden = true; $('thumbnail-fallback').hidden = false; };
      $('thumbnail').src = info.thumbnail;
    } else $('thumbnail').removeAttribute('src');
    $('empty').hidden = true; $('video').hidden = false;
    $('video-badge').textContent = 'PRONTO PARA BAIXAR';
    $('format').replaceChildren(...info.profiles.map(p => new Option(`${p.label} · ${p.kind === 'video' ? 'Vídeo' : 'Áudio'}`, p.id)));
    qualities();
  } catch (error) { errors(error.message); $('video-badge').textContent = 'TENTE NOVAMENTE'; }
  finally { busy = false; $('inspect').textContent = 'Consultar vídeo →'; controls(); }
});
$('choose-folder').addEventListener('click', async () => {
  try { const folder = unwrap(await api.chooseFolder()); $('folder').textContent = folder; $('folder').title = folder; } catch (error) { errors(error.message); }
});
for (const id of ['open-folder', 'show-file']) $(id).addEventListener('click', async () => {
  if (api.web && id === 'open-folder') { refreshFiles(); $('files-panel').scrollIntoView({ behavior: 'smooth' }); return; }
  try { unwrap(await api.openFolder()); } catch (error) { errors(error.message); }
});
$('download').addEventListener('click', async () => {
  if (!info || busy) return;
  busy = true; errors(); controls(); logs = []; $('log').textContent = '';
  $('status-panel').hidden = false; $('status-title').textContent = 'Preparando download…';
  $('status-detail').textContent = 'Conectando à fonte…'; $('progress').value = 0;
  $('cancel').hidden = false; $('cancel').disabled = false; $('cancel').textContent = 'Cancelar'; $('show-file').hidden = true;
  $('status-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const result = unwrap(await api.download({ url: inspectedUrl, format: $('format').value, quality: $('quality').value }));
    $('status-title').textContent = api.web ? 'Arquivo pronto para salvar' : 'Download concluído'; $('status-detail').textContent = result.name;
    $('progress').value = 100; $('show-file').hidden = false;
    if (api.web) refreshFiles();
  } catch (error) {
    const cancelled = error.message === 'Operação cancelada.';
    $('status-title').textContent = cancelled ? 'Download cancelado' : 'Não foi possível concluir';
    $('status-detail').textContent = cancelled ? 'Você pode iniciar o download novamente.' : 'Confira os detalhes abaixo e tente novamente.';
    $('progress').value = 0;
    if (!cancelled) errors(error.message);
  } finally { busy = false; $('cancel').hidden = true; controls(); }
});
$('cancel').addEventListener('click', async () => {
  $('cancel').disabled = true; $('cancel').textContent = 'Cancelando…';
  try { unwrap(await api.cancel()); } catch (error) { errors(error.message); }
});
function bytes(value) { return `${(Number(value || 0) / 1048576).toFixed(1)} MB`; }
api.onProgress(event => {
  if (event.type === 'progress') {
    if (event.status === 'finished') { $('status-title').textContent = 'Processando arquivo…'; $('status-detail').textContent = 'Finalizando esta faixa. O áudio e o vídeo podem ser baixados separadamente.'; $('progress').removeAttribute('value'); }
    else {
      $('status-title').textContent = event.percent == null ? 'Baixando…' : `Baixando… ${Math.floor(event.percent)}%`;
      if (event.percent == null) $('progress').removeAttribute('value'); else $('progress').value = event.percent;
      $('status-detail').textContent = `${bytes(event.downloaded)} nesta faixa${event.speed ? ` · ${bytes(event.speed)}/s` : ''}${event.eta != null ? ` · ${Math.ceil(event.eta)}s restantes` : ''}`;
    }
  } else {
    if (event.type === 'logs') logs = event.messages;
    else logs.push(event.message);
    logs = logs.slice(-120); $('log').textContent = logs.join('\n');
    if (/\[(Merger|ExtractAudio|VideoRemuxer|Fixup)/.test(logs.at(-1) || '')) { $('status-title').textContent = 'Finalizando arquivo…'; $('status-detail').textContent = 'O FFmpeg está preparando o formato escolhido.'; $('progress').removeAttribute('value'); }
  }
});
async function refreshFiles() {
  if (!api.web) return;
  $('refresh-files').disabled = true;
  try {
    const files = unwrap(await api.listFiles());
    $('files-list').replaceChildren();
    if (!files.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'Os arquivos concluídos aparecerão aqui.'; $('files-list').append(empty); }
    for (const file of files) {
      const row = document.createElement('div'); row.className = 'file-row';
      const title = document.createElement('span'); title.textContent = file.result.name;
      const link = document.createElement('a'); link.className = 'text-button'; link.href = file.result.downloadUrl; link.download = file.result.name; link.textContent = 'Salvar ↓';
      row.append(title, link); $('files-list').append(row);
    }
  } catch (error) { errors(error.message); }
  finally { $('refresh-files').disabled = false; }
}
$('refresh-files').addEventListener('click', refreshFiles);
api.init().then(result => {
  const state = unwrap(result);
  $('folder').textContent = state.web ? 'No seu computador, depois que o arquivo estiver pronto.' : state.folder;
  $('folder').title = $('folder').textContent;
  if (state.web) {
    $('sites-hint').textContent = `Sites habilitados: ${state.allowedHosts.join(', ')}.`;
    $('retention-hint').textContent = `Disponíveis por ${state.retentionHours} ${state.retentionHours === 1 ? 'hora' : 'horas'}. Depois são apagados automaticamente do servidor.`;
    refreshFiles();
  }
  ready = true; controls();
}).catch(error => errors(error.message));
