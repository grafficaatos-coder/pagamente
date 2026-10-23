# Agenda Pro — migração gradual de WhatsApp Railway → Docker/Cloudflare

## Estado seguro (2026-10-22)
- Servidor Docker local: `http://127.0.0.1:8080` e `/ready` saudável (confirmado pelo usuário).
- Túnel Cloudflare: `agenda-pro-docker` e hostname `whatsapp-agenda.parkingjp.com.br`; túnel saudável, mas **a política Access ainda precisa ser concluída**.
- Proxy Supabase: `agenda-baileys-proxy` v7, aceita Cloudflare Access **somente** no hostname acima. O destino padrão permanece Railway.
- Docker Compose **força** `DISPATCH_ENABLED=false` e `ALLOW_ALL_BUSINESSES=false`. Não habilitar em paralelo ao Railway.
- Supabase: trigger `zz_agenda_appointment_changes` desativado até teste.
- Os dados e credenciais de sessão existentes no volume Railway não foram movidos. GitHub NÃO guarda sessões.

## Passos sem exposição de credenciais
1. Na conta Cloudflare que contém `agenda-pro-docker`, abra **Zero Trust → Access controls → Service credentials → Service tokens**. Crie um token denominado `agenda-pro-docker`. Guarde *Client ID* e *Client Secret* em lugar seguro, nunca no GitHub ou chat.
2. Em **Access controls → Applications**, crie/confirme um aplicativo auto-hospedado protegendo **somente** `whatsapp-agenda.parkingjp.com.br`. Adicione política **Service Auth**, selector **Service Token** → token `agenda-pro-docker`. Não use Bypass ou Everyone. Verifique que requisições anônimas recebem negação do Access.
3. No Supabase **Edge Functions → Secrets**, salve dois segredos:
   - `AGENDA_CF_ACCESS_CLIENT_ID` = Client ID do token Cloudflare
   - `AGENDA_CF_ACCESS_CLIENT_SECRET` = Client Secret do token Cloudflare
   A Edge Function v7 injeta esses cabeçalhos **apenas** quando a rota da empresa apontar para `https://whatsapp-agenda.parkingjp.com.br`.
4. No computador mantenha o Docker ligado; valide `docker compose ps`, `Invoke-RestMethod http://localhost:8080/ready`.
5. **Não mude a URL global** `agenda_platform_settings.baileys_service_url`. Escolha UMA empresa de teste sem WhatsApp ativo no Railway; na tabela `agenda_whatsapp_runtime_routes` configure apenas essa empresa com `service_url=https://whatsapp-agenda.parkingjp.com.br` e `runtime_prefix=railway:` (sem executar warmup antigo). Configure ALLOWED_BUSINESS_IDS SOMENTE com o UUID da empresa de teste no Docker e recrie o contêiner, preservando envio desativado.
6. Faça pareamento da conta de teste pelo painel Agenda Pro. Confira sincronização Supabase e conexão WhatsApp, sem enviar mensagem automática.
7. Apenas após confirmar exclusividade da sessão, isolamento multi-tenant, idempotência da fila e envio de ponta a ponta, habilite despacho para a empresa de teste (exige alterar o compose em nova versão) e, em etapa separada, a rotina de cancelamento/reagendamento. Sem teste, manter desativados.

## Alertas
- O envio automático no Docker para se o PC dormir, desligar ou ficar sem internet.
- As sessões estão no volume Docker local; criar backup externo **criptografado** com controle de acesso. Nunca colocar o volume de sessão no GitHub.
- Não executar o mesmo WhatsApp simultaneamente no Railway e Docker (pode invalidar sessões ou causar mensagens duplicadas).
- Nunca compartilhar Cloudflare Tunnel token, Cloudflare Access Client Secret ou Supabase secret key.
- Não conectar a aplicação pelo navegador diretamente ao Cloudflare com tokens; a chamada deve passar pelo backend Supabase Edge Function.
