# Agenda Pro — Baileys + Cloudflare Containers

Serviço experimental para automatizar confirmações, lembretes e pós-atendimento do Agenda Pro usando Baileys.

## Como funciona

1. O assinante conecta o WhatsApp por QR Code.
2. A sessão fica vinculada ao business_id.
3. As chaves do Baileys são persistidas no Supabase.
4. O Cron da Cloudflare encontra mensagens vencidas na agenda_whatsapp_queue.
5. A Cloudflare Queue encaminha a mensagem ao Container da empresa.
6. O Container reconecta a sessão, se necessário, e envia a mensagem.
7. A mensagem é marcada como concluída no Supabase.

O serviço não expõe um endpoint de disparo genérico em massa. Ele envia somente itens já criados pela fila de agendamentos do Agenda Pro.

## Requisitos

- Cloudflare Workers Paid com Containers
- Docker para o primeiro deploy via Wrangler
- Node.js 22+
- Projeto Supabase do Agenda Pro

Cloudflare Containers não faz parte do plano gratuito.

## Segredos

Nunca salve segredos no Git.

Configure na Cloudflare:

    npx wrangler secret put SUPABASE_URL
    npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
    npx wrangler secret put SUPABASE_PUBLISHABLE_KEY

Opcionalmente defina AGENDA_ORIGIN como variável pública para limitar CORS ao endereço do Agenda Pro.

## Publicação

    npm install
    npm run deploy

Depois do deploy, copie a URL do Worker e salve em:

- agenda_platform_settings.baileys_service_url
- agenda_platform_settings.baileys_enabled = true

## Aviso

Baileys usa o protocolo do WhatsApp Web e não é uma integração oficial da Meta. O WhatsApp pode alterar o protocolo, desconectar uma sessão ou aplicar restrições. Mantenha a integração oficial da Meta disponível como alternativa.
