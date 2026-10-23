# Agenda Pro: WhatsApp no Docker SEM Cloudflare (canal de saída via Supabase)

## Situação segura
- Supabase Edge Function `agenda-baileys-proxy` v8: reconhece apenas a rota exata `runtime_prefix=local-poll:` e `service_url=supabase-poll://local`.
- Docker chama o Supabase a cada 2,5 s, usando **somente** a chave de servidor que já está guardada no `.env` LOCAL.
- O painel Vercel continua chamando o proxy Supabase. O navegador não acessa a máquina nem recebe chaves secretas.
- Novas tabelas `agenda_whatsapp_local_commands` e `agenda_whatsapp_local_status` são privadas (sem acesso `anon` ou `authenticated` via REST).
- **NENHUMA empresa foi migrada automaticamente.** URL global segue Railway.
- O Compose fixa `DISPATCH_ENABLED=false` e `ALLOW_ALL_BUSINESSES=false` para evitar envios e sessões de empresas não autorizadas.
- O Docker LOCAL ainda não possui as sessões ativas do Railway. Não copiar/iniciar o mesmo WhatsApp em duas máquinas.

## Atualização do Docker no Windows (sem apagar as sessões)
1. Baixar a branch `feature/agenda-supabase-poll-bridge` do GitHub como ZIP.
2. Faça backup seguro do `.env` local antes de substituir arquivos. **Não** envie o `.env` nem a pasta/volume `/data` ao GitHub.
3. Atualize os arquivos na pasta local `agenda-baileys-railway` (mantenha o `.env` e o volume nomeado `agenda_whatsapp_sessions`).
4. Na pasta, PowerShell: `docker compose up -d --build`.
5. Confirmar `docker compose ps` e `Invoke-RestMethod http://localhost:8080/ready`.
6. Enquanto `LOCAL_POLL_ENABLED=false`, o novo canal **não inicia**. Isso permite a atualização segura sem impactar o Railway.

## Primeiro teste: UMA empresa de testes sem WhatsApp ativo no Railway
1. Escolher empresa UUID que **não tenha sessão WhatsApp em uso no Railway**, com autorização expressa do titular.
2. No `.env` local definir `ALLOWED_BUSINESS_IDS=<UUID_DA_EMPRESA_DE_TESTE>` e `LOCAL_POLL_ENABLED=true`; deixar `DISPATCH_ENABLED=false` e `ALLOW_ALL_BUSINESSES=false`.
3. `docker compose up -d` recria serviço após mudança de variáveis. Acompanhe `docker compose logs --tail 50`.
4. No Supabase, verifique que `agenda_whatsapp_local_status` contém status atualizado para esse UUID nos últimos 20 segundos.
5. Somente agora crie/atualize a rota dessa empresa na tabela `agenda_whatsapp_runtime_routes`: `service_url='supabase-poll://local'`, `runtime_prefix='local-poll:'`. NÃO editar a URL global `agenda_platform_settings.baileys_service_url`.
6. Testar `status` e `connect` pelo painel. Testar pareamento via código e confirmar que o mesmo número não está ligado no Railway. Testar `disconnect` apenas na conta isolada.
7. **Não ativar disparo de fila** sem auditoria de idempotência e teste com um único assinante; Compose continuará bloqueando por segurança.

## Retorno imediato ao Railway
- Na empresa testada, restaurar ou excluir a linha de `agenda_whatsapp_runtime_routes` para voltar ao destino anterior (guardar valores anteriores antes de alterar).
- `LOCAL_POLL_ENABLED=false` no `.env` e `docker compose up -d` para interromper os comandos no PC.
- *Retornar rota não traz automaticamente a sessão do WhatsApp para o Railway.* Evite mudanças de contas que já estão ativas.

## Depois que o canal novo funcionar
- Desativar a publicação Cloudflare `whatsapp-agenda.parkingjp.com.br`, pois não será necessária. Não excluir o túnel até confirmar os testes.
- Backup **criptografado fora do PC** para o volume de sessões (não configurado; GitHub só protege código).
- Para operação 24h o computador deve permanecer ligado, com internet e Docker Desktop em execução.
- Baileys é uma biblioteca não oficial do WhatsApp; bloqueios/alterações de protocolo são riscos reais.

## Diagnóstico
- Status local ausente / >20s: Docker desligado, chave Supabase incorreta, `LOCAL_POLL_ENABLED=false` ou UUID não incluído em `ALLOWED_BUSINESS_IDS`.
- `local_poll_pending`: a solicitação foi registrada, mas o worker ainda não confirmou; **não repetir em sequência**. Consultar status.
- `local_action_disabled`: envio de catálogo e outras ações manuais não foram habilitadas na ponte inicial.
- O serviço não expõe a porta 8080 à internet: o Compose a publica apenas em `127.0.0.1`.
