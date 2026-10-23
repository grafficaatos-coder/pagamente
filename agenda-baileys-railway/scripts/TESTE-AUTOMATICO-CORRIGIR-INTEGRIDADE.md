# Correção do erro de integridade do compose.yaml

O instalador de confirmação/lembrete técnico fornecido em 23/10/2026 tinha um hash do arquivo `compose.yaml` incompleto (37 caracteres). O blob SHA-1 correto no commit fixado `3d84740b4c8e2d217ef25a86dc74b5058855f39f` é `75f72382799bd5e84b2fab75b725fe346b073f73` (40 caracteres). O script falha **antes de copiar qualquer arquivo**, então o contêiner permanece como estava.

Na pasta já extraída, substitua somente essa constante no arquivo `ATIVAR-TESTE-AUTOMATICO-AGENDA-PRO.ps1` e execute o mesmo `.bat`. Não altere os hashes de `server.mjs` ou `local-poll-bridge.mjs`, não apague o `.env`, e nunca use `docker compose down -v`.

O processo de atualização contínua deve ser configurado separadamente pela branch `deploy/agenda-pro-docker`, via instalador de uma única vez. A branch `feature/agenda-supabase-poll-bridge` é apenas desenvolvimento e não deve ser usada como canal de deploy automático.
