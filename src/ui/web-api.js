// No Electron, a API é fornecida pelo preload. No navegador, usa o servidor HTTP.
if (!window.downloader) {
  let inspectionId, activeId, lastResult, callback = () => {};
  async function request(url, data) {
    try {
      const response = await fetch(url, {
        credentials: 'same-origin', cache: 'no-store',
        ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Fluxo' }, body: JSON.stringify(data) }),
      });
      if (response.status === 401) return { ok: false, error: 'Acesso não autorizado. Atualize a página e informe sua senha.' };
      return await response.json();
    } catch { return { ok: false, error: 'Sem conexão com o servidor. Tente novamente; os arquivos concluídos aparecem em Seus arquivos.', network: true }; }
  }
  async function operation(endpoint, data) {
    const started = await request(endpoint, data);
    if (!started.ok) return started;
    activeId = started.value.id;
    const id = activeId;
    let failures = 0, previousLogs = '';
    try {
      while (true) {
        const response = await request(`/api/jobs/${id}`);
        if (!response.ok) {
          if (!response.network || ++failures > 15) return response;
        } else {
          failures = 0;
          const job = response.value;
          if (job.progress) callback(job.progress);
          const serialized = JSON.stringify(job.logs);
          if (serialized !== previousLogs) { callback({ type: 'logs', messages: job.logs }); previousLogs = serialized; }
          if (job.status === 'done') return { ok: true, value: job.result, id };
          if (job.status !== 'running') return { ok: false, error: job.error || 'A operação não foi concluída.' };
        }
        await new Promise(resolve => setTimeout(resolve, 750));
      }
    } finally { if (activeId === id) activeId = null; }
  }
  window.downloader = {
    web: true,
    init: () => request('/api/config'),
    inspect: async url => { inspectionId = null; const result = await operation('/api/inspect', { url }); if (result.ok) inspectionId = result.id; return result; },
    download: async options => { lastResult = null; const result = await operation('/api/download', { ...options, inspectionId }); if (result.ok) lastResult = result.value; return result; },
    cancel: () => activeId ? request(`/api/jobs/${activeId}/cancel`, {}) : Promise.resolve({ ok: true }),
    listFiles: () => request('/api/files'),
    openFolder: async () => {
      if (lastResult) {
        const link = document.createElement('a'); link.href = lastResult.downloadUrl; link.download = lastResult.name;
        document.body.append(link); link.click(); link.remove();
      } else document.getElementById('files-panel').scrollIntoView({ behavior: 'smooth' });
      return { ok: true };
    },
    onProgress: handler => { callback = handler; },
  };
}
