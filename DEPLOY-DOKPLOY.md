# Publicar o Fluxo no Dokploy

O Fluxo agora tem uma versão web, além da versão de desktop. O contêiner Linux reúne Node, yt-dlp, FFmpeg e FFprobe; não precisa de Electron, banco de dados ou instalação manual no servidor.

## Passo a passo

1. Coloque o projeto em um repositório Git acessível pelo Dokploy. Inclua `Dockerfile`, `docker-compose.yml`, `src/` e os demais arquivos de código. Não envie `node_modules`, `bin`, `test-output`, `downloads` ou `.env`.
2. No seu projeto do Dokploy, crie um serviço **Docker Compose**. Selecione **Compose**, não **Stack**: o arquivo usa `build`.
3. Conecte o repositório e a branch. Configure o caminho do Compose como `docker-compose.yml`, na raiz do repositório.
4. Na aba **Environment**, copie as variáveis de `.env.example`. Defina `APP_PASSWORD` com uma senha exclusiva de pelo menos 12 caracteres. O usuário padrão é `admin`; pode ser alterado em `APP_USERNAME`.
5. Na aba **Domains**, adicione o domínio/subdomínio que aponta para o servidor. Selecione o serviço **fluxo**, porta interna **3000** e caminho **/**. Habilite HTTPS/Let's Encrypt. Publique na raiz de um subdomínio, como `videos.seudominio.com`, em vez de um subcaminho.
6. Faça o **Deploy**. O primeiro build instala as dependências. Confira os logs: `Fluxo web pronto na porta 3000.`
7. Abra seu domínio e informe usuário e senha na janela de autenticação do navegador.

O Compose deixa a porta 3000 acessível apenas na rede do contêiner. O Dokploy configura o acesso externo pelo domínio/Traefik. Não é necessário abrir a porta 3000 no firewall nem escrever labels manualmente. Use o botão **Preview Compose** do Dokploy para conferir o roteamento gerado.

Referências oficiais: [Docker Compose](https://docs.dokploy.com/docs/core/docker-compose) e [domínios de serviços Compose](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Como funciona

Cole a URL e consulte o vídeo. Escolha o formato e a qualidade, clique em **Preparar download** e aguarde. Quando terminar, clique em **Salvar no computador**. O navegador escolhe a pasta local conforme suas configurações.

Os arquivos prontos aparecem em **Seus arquivos**, inclusive após atualizar a página ou reiniciar o serviço. O volume Docker `fluxo-downloads` guarda os arquivos em `/data/downloads`. Eles expiram após 1 hora por padrão; a limpeza acontece a cada minuto. Transferências já iniciadas podem terminar antes da exclusão. Falhas e cancelamentos removem os arquivos incompletos dessa tarefa.

Consultar e preparar downloads usa tarefas curtas na API, acompanhadas por consultas periódicas. A conexão não precisa ficar aberta durante toda a conversão. Se a página for fechada, o servidor continua trabalhando; volte depois e clique em **Atualizar** em **Seus arquivos**. Reiniciar ou republicar o serviço interrompe tarefas em andamento; inicie essas tarefas novamente.

Esta versão é para uso pessoal ou por pessoas de confiança, com uma única conta compartilhada. Todos que possuem a senha veem a mesma lista de arquivos. Use HTTPS: a autenticação é HTTP Basic, fornecida pelo próprio navegador. Não existe cadastro, cobrança ou separação de arquivos por usuário.

## Configuração

| Variável | Padrão | Função |
| --- | --- | --- |
| `APP_USERNAME` | `admin` | Usuário de acesso |
| `APP_PASSWORD` | Obrigatória | Senha com pelo menos 12 caracteres |
| `ALLOWED_HOSTS` | `youtube.com,youtu.be,vimeo.com` | Sites aceitos na URL inicial; subdomínios também são aceitos |
| `MAX_CONCURRENT_JOBS` | `2` | Total de consultas/downloads simultâneos |
| `MAX_DOWNLOAD_MB` | `2048` | Limite de espaço por tarefa, incluindo intermediários |
| `MAX_STORAGE_MB` | `10240` | Limite de espaço para todas as tarefas |
| `FILE_RETENTION_HOURS` | `1` | Validade dos arquivos prontos |
| `JOB_TIMEOUT_MINUTES` | `60` | Tempo máximo de um download; consultas têm limite de 2 minutos |
| `YTDLP_VERSION` | `2026.8.19` | Versão instalada ao construir a imagem |
| `YTDLP_COOKIES_FILE` | Vazio | Caminho de um arquivo Netscape cookies.txt montado no contêiner |

O Compose também limita o contêiner a 2 CPUs e 2 GiB de RAM. Ajuste esses valores no arquivo conforme o servidor. Os limites de disco são verificados pela aplicação a cada 2 segundos e podem ser ultrapassados brevemente durante downloads rápidos; não são uma quota rígida do volume.

Para permitir mais sites compatíveis com yt-dlp, acrescente seus domínios a `ALLOWED_HOSTS` e faça novo deploy. A lista valida a URL inicial; não é um firewall de saída para todas as requisições feitas pelo yt-dlp. Não use esta conta compartilhada como um serviço público anônimo.

## Atualizar o yt-dlp

Altere `YTDLP_VERSION` na aba Environment para uma versão publicada no [PyPI](https://pypi.org/project/yt-dlp/) e faça um novo build/deploy. O executável não se atualiza dentro do contêiner. Arquivos já concluídos continuam no volume.

## Testar localmente

Sem Docker, nesta máquina Windows já preparada:

```powershell
Copy-Item .env.example .env
# Edite APP_PASSWORD no .env antes de iniciar.
npm run start:web
```

Abra `http://localhost:3000`. Sem autenticação o aplicativo retorna 401. A rota `/healthz` fica aberta apenas para informar que o processo está saudável.

Com Docker instalado, prepare o `.env` e execute:

```sh
docker compose build
docker compose run --rm --service-ports -p 127.0.0.1:3000:3000 fluxo
```

Para encerrar esse teste, pressione Ctrl+C. No Dokploy, utilize o deploy normal do Compose.

## Verificação e limitações

```powershell
npm test
npm run test:web
npm run test:web-ui
npm run test:ui
```

Os testes web verificam autenticação, restrição de sites, requisições de outras origens, consulta/download reais com yt-dlp, transferência para o navegador, cancelamento, persistência e expiração. O teste visual usa Microsoft Edge instalado na máquina. A versão de desktop continua abrindo pelo `iniciar.cmd`.

O build Linux/Docker precisa ser verificado no servidor: o ambiente de desenvolvimento atual não possui Docker nem WSL instalado. Não foi realizado deploy em um servidor remoto.

Alguns sites podem bloquear o IP de servidores ou exigir autenticação/cookies. O sucesso na máquina local não garante que o mesmo vídeo esteja disponível no IP do servidor. Para o erro de verificação do YouTube, consulte [YOUTUBE-COOKIES.md](YOUTUBE-COOKIES.md). O aplicativo aceita cookies fornecidos pelo administrador por arquivo montado; não há upload de cookies pela interface nem desbloqueio de DRM.
