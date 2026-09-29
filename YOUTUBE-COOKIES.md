# YouTube pedindo confirmação de que você não é um robô

O erro `Sign in to confirm you're not a bot` é uma exigência do YouTube para a conexão usada pelo yt-dlp. Pode acontecer no IP de um servidor mesmo quando o vídeo abre normalmente no seu computador. `APP_PASSWORD` protege o Fluxo; ela não autentica no YouTube.

O Fluxo aceita um arquivo de cookies pelo parâmetro `YTDLP_COOKIES_FILE`. O uso de cookies pode ajudar, mas não garante acesso: o YouTube ainda pode rejeitar o IP, exigir verificações adicionais ou invalidar a sessão. Outra opção é usar o Fluxo desktop na sua conexão local.

## Preparar o arquivo

Exporte apenas os cookies de `youtube.com`, em formato **Netscape cookies.txt**, seguindo o [procedimento oficial do yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies). O guia recomenda uma sessão privada dedicada para evitar a rotação dos cookies; veja também as [ferramentas de exportação indicadas pelo projeto](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp).

Esses cookies dão acesso à sessão da conta. Não os envie ao GitHub, ao chat nem os coloque em uma pasta pública. O yt-dlp alerta que o uso de uma conta pode levar a restrições ou suspensão; evite usar sua conta principal.

## Dokploy — Application com Dockerfile

1. Faça o deploy da versão do Fluxo que inclui suporte a `YTDLP_COOKIES_FILE`.
2. No serviço do Fluxo, em **Advanced → Mounts**, crie uma montagem de arquivo (**File Mount**) para o arquivo exportado. O destino **dentro do contêiner** deve ser `/run/secrets/youtube-cookies.txt`. Preencha o conteúdo diretamente no painel, sem passar pelo repositório.
3. Garanta que o usuário do contêiner (`node`, UID 1000) consiga ler o arquivo. O arquivo de origem pode ser montado somente para leitura.
4. Na aba **Environment**, acrescente:

   ```env
   YTDLP_COOKIES_FILE=/run/secrets/youtube-cookies.txt
   ```

5. Salve e faça novo **Deploy**. Depois consulte o vídeo novamente.

Definir somente a variável não cria o arquivo: a montagem também precisa existir. Se o arquivo não puder ser lido ou não estiver no formato correto, o Fluxo mostrará essa informação ao consultar o vídeo.

## Dokploy — Docker Compose

Crie o File Mount com nome `youtube-cookies.txt` em **Advanced → Mounts**. O Dokploy mantém esses arquivos fora do checkout. Acrescente ao serviço `fluxo`, no bloco `volumes` já existente:

```yaml
volumes:
  - fluxo-downloads:/data/downloads
  - ../files/youtube-cookies.txt:/run/secrets/youtube-cookies.txt:ro
```

Defina a mesma variável `YTDLP_COOKIES_FILE` no Environment e faça novo deploy. O Compose do projeto já repassa essa variável. Veja a [documentação de mounts do Dokploy](https://docs.dokploy.com/docs/core/troubleshooting/volumes-mounts).

## Renovação e armazenamento

Quando a sessão deixar de funcionar, exporte novamente e substitua o conteúdo da montagem. O Fluxo usa uma cópia temporária por operação, porque o yt-dlp precisa regravar seu arquivo de cookies. Essa cópia é apagada ao terminar, falhar ou cancelar a operação; o arquivo montado não é modificado.

A retenção de 1 hora aplica-se aos vídeos/áudios preparados. O arquivo de cookies montado permanece no servidor até você removê-lo. Para desativá-lo, esvazie `YTDLP_COOKIES_FILE`, remova a montagem pelo painel e faça novo deploy.

O suporte foi testado com cookies sintéticos em um servidor local, incluindo limpeza das cópias temporárias. Nenhuma sessão real do YouTube foi exportada ou enviada durante o desenvolvimento. A aceitação da sessão pelo YouTube precisa ser verificada no seu servidor.
