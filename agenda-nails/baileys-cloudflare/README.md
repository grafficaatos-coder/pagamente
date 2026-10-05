# Agenda Pro — WhatsApp automático com Baileys + Cloudflare

Serviço experimental e independente para o Agenda Pro.

## Arquitetura

```text
Agenda Pro
   |
   v
Cloudflare Worker
   |
   +--> Durable Object por empresa
   |       |
   |       v
   |    Container Node 22 + Baileys
   |       |
   |       v
   |    WhatsApp
   |
   +--> Cloudflare R2
   |       |
   |       +--> checkpoint da sessão /data/auth
   |
   +--> Supabase
           |
           +--> status / lease
           +--> fila de confirmação
           +--> lembrete
           +--> pós-atendimento
```

O Gably foi usado apenas como referência arquitetural. Este serviço não acessa banco,
sessões, R2, Worker ou credenciais do Gably.

## Proteções implementadas

- uma sessão por empresa;
- Durable Object identificado pelo `business_id`;
- runtime lease de 20 segundos, renovado pelo agente a cada 5 segundos;
- heartbeat a cada 5 segundos;
- checkpoint do diretório do Baileys em R2;
- restauração automática do R2 quando o container reinicia;
- self-heal do Durable Object;
- fila no PostgreSQL/Supabase;
- reserva atômica com `reservation_token`;
- `idempotency_key` única por agendamento/tipo;
- `AT_MOST_ONCE` para mensagens diretas;
- revalidação do agendamento, status e telefone imediatamente antes do envio;
- `socket.onWhatsApp()` antes de `sendMessage()`;
- sem endpoint público de disparo genérico em massa.

## Tabelas usadas

- `agenda_baileys_sessions`
- `agenda_whatsapp_queue`
- `agenda_appointments`
- `agenda_customers`
- `agenda_services`
- `agenda_businesses`

As chaves de autenticação do WhatsApp não ficam em uma tabela pública.
O diretório `/data/auth` é compactado pelo runtime e salvo no R2.

## Bucket R2

Crie um bucket com o nome:

```text
agenda-pro-whatsapp-sessions
```

O binding já está definido em `wrangler.jsonc` como:

```text
WHATSAPP_PROFILES
```

Cada empresa usa uma chave semelhante a:

```text
agenda-whatsapp/<business_id>.tar.gz
```

## Segredos da Cloudflare

Configure no Worker. Nunca grave estes valores no GitHub.

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put INTERNAL_TOKEN
```

`INTERNAL_TOKEN` deve ser um valor aleatório forte usado somente entre Worker e Container.

## Primeiro deploy

Requisitos:

- Node.js 22+
- Docker
- Cloudflare Workers Paid com Containers habilitados

Dentro desta pasta:

```bash
npm install
npm run deploy
```

Depois do deploy:

1. copie a URL HTTPS do Worker;
2. entre no Agenda Pro como proprietário;
3. abra **Configurações > Baileys + Cloudflare**;
4. cole a URL do Worker;
5. marque **Ativar modo Baileys para assinantes**;
6. salve;
7. entre em uma empresa de teste;
8. abra **WhatsApp**;
9. clique em **Conectar por QR Code**;
10. no celular abra **WhatsApp > Aparelhos conectados > Conectar um aparelho**;
11. escaneie o QR.

## Fluxo de envio

O runtime consulta a fila aproximadamente a cada 2,5 segundos.

Antes de enviar, o Worker confirma novamente:

- o agendamento ainda existe;
- não foi cancelado;
- para pós-atendimento, o atendimento está concluído;
- o cliente ainda existe;
- o telefone não mudou;
- o serviço ainda existe;
- o número possui WhatsApp.

Depois a mensagem é reservada e o runtime marca o início do disparo antes de chamar
`socket.sendMessage()`.

Se o resultado ficar ambíguo após o início do envio, o job é marcado como falha e
**não recebe retry automático**, evitando duplicidade.

## Limitação

Baileys implementa o protocolo do WhatsApp Web e não é a API oficial da Meta.
O WhatsApp pode alterar o protocolo, desconectar sessões ou restringir números.
Por isso o Agenda Pro mantém também o modo manual e a integração oficial da Meta.


## Deploy automático pelo GitHub

O repositório possui:

```text
.github/workflows/deploy-agenda-baileys-cloudflare.yml
```

Cadastre apenas estes três GitHub Actions Secrets no repositório:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
SUPABASE_SERVICE_ROLE_KEY
```

Depois abra **GitHub > Actions > Deploy Agenda Pro Baileys to Cloudflare > Run workflow**.

O workflow executa automaticamente:

1. cria o bucket R2 `agenda-pro-whatsapp-sessions` se ainda não existir;
2. configura os secrets do Worker;
3. deriva um token interno sem expor a service role ao Container;
4. publica Worker + Durable Object + Container;
5. testa o endpoint `/health`;
6. identifica a URL `workers.dev`;
7. grava a URL em `agenda_platform_settings.baileys_service_url`;
8. ativa `baileys_enabled=true`.

Assim o assinante passa a ver **Conectar por QR Code** na aba WhatsApp do Agenda Pro.
