# Fluxo — Video Downloader

Aplicativo de desktop para Windows x64, em português, que usa o [yt-dlp](https://github.com/yt-dlp/yt-dlp) em segundo plano.

Também possui versão web para servidor Linux com Docker/Dokploy. Consulte o passo a passo em [DEPLOY-DOKPLOY.md](DEPLOY-DOKPLOY.md). Ela mantém o seletor de formatos e qualidades, adiciona acesso por senha e entrega os arquivos pelo navegador.

## Como abrir

Nesta máquina, depois de preparado, dê dois cliques em **iniciar.cmd**.

Para instalar novamente ou em outra máquina:

1. Instale o [Node.js](https://nodejs.org/) 22.12 ou superior.
2. Execute **instalar.cmd** e aguarde a instalação das dependências.
3. Abra **iniciar.cmd**.

Cole a URL, clique em **Consultar vídeo**, escolha formato e qualidade, ajuste a pasta se desejar e clique em **Baixar arquivo**. O destino padrão é `Downloads\Fluxo`.

## Recursos

- Formatos de vídeo: MP4, MKV e WebM, conforme disponibilidade na fonte.
- Formatos de áudio: MP3, M4A, Opus e WAV, com conversão pelo FFmpeg.
- Resoluções reais do vídeo, como 360p, 720p, 1080p e 2160p. A opção “Até” limita a altura máxima, sem ampliar o vídeo. MP4 prioriza H.264; “Melhor disponível” usa as prioridades do perfil.
- Progresso por faixa, velocidade, tempo restante, cancelamento e detalhes do yt-dlp.
- Escolha de pasta persistente e botão para localizar o arquivo final.
- Apenas um vídeo por operação. Links de playlists puras e transmissões ao vivo são recusados.

O vídeo e o áudio podem vir em faixas separadas; o progresso reinicia para cada faixa. O download só aparece como concluído depois da junção/conversão. Ao cancelar, arquivos `.part` podem permanecer para permitir retomada. Arquivos existentes não são sobrescritos. Os nomes incluem o formato e a qualidade escolhidos para preservar versões diferentes.

O bitrate de áudio representa a qualidade solicitada à conversão, não melhora a fonte e pode não alterar uma faixa já no formato escolhido. WAV é sem compressão. MP4 e WebM só são oferecidos quando a fonte possui faixas compatíveis, sem recodificação de vídeo.

## Dependências e atualizações

`npm run setup` baixa o executável oficial do yt-dlp, verifica seu SHA-256 e coloca FFmpeg, FFprobe e uma cópia do Node em `bin/`. Não exige Python nem altera o PATH. Execute **atualizar-yt-dlp.cmd**, com o aplicativo fechado, para atualizar o yt-dlp quando os sites mudarem.

A disponibilidade depende do suporte do yt-dlp e das restrições do site. A versão web aceita cookies por arquivo montado no servidor: veja [YOUTUBE-COOKIES.md](YOUTUBE-COOKIES.md). Não há interface para login no YouTube, upload de cookies, conteúdo com DRM ou playlists.

## Desenvolvimento

```powershell
npm ci
npm run setup
npm start
npm test
npm run test:integration
npm run test:ui
```

`test:integration` gera um vídeo local de teste e faz downloads reais pelo yt-dlp, incluindo extração de MP3. `test:ui` abre uma janela oculta do aplicativo, consulta esse vídeo, verifica as seleções e baixa pela interface. As evidências ficam em `test-output/`.

Electron usa renderer isolado, sandbox e CSP; URLs são passadas como argumentos ao yt-dlp sem shell. Os binários e `node_modules` ficam fora do controle de versão. Para levar o aplicativo já preparado a outra pasta, copie a pasta inteira, incluindo `bin` e `node_modules`.

O código do aplicativo está em `src/`; o yt-dlp, Electron, FFmpeg e demais dependências mantêm suas próprias licenças. Consulte-as antes de redistribuir seus binários.
