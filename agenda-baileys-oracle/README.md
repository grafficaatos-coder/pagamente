# Agenda Pro WhatsApp — Oracle Cloud

Serviço persistente de WhatsApp para o Agenda Pro, adaptado da arquitetura do agente V2 do Gably para rodar em uma VM Oracle Cloud.

## Objetivo

Permitir que cada empresa conecte o WhatsApp usando **somente o próprio celular**, sem depender de QR Code:

1. a empresa informa o número;
2. o servidor Oracle abre o socket Baileys;
3. o código só é solicitado depois que o socket entra em `connecting`/QR;
4. o código é mostrado no Agenda Pro;
5. o usuário digita esse código em **WhatsApp → Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone**;
6. quando o WhatsApp responde com `515 / restartRequired`, o runtime salva as credenciais e recria o socket automaticamente;
7. a sessão continua persistida no volume da Oracle.

## Estrutura mantida da referência

- Node 22 + Baileys em processo persistente.
- Uma sessão isolada por empresa.
- Runtime lease para evitar dois executores na mesma conexão.
- Heartbeat periódico.
- Sessão persistente em `/data/sessions/<business_id>`.
- Fila no Supabase com reserva de job e proteção contra duplicidade.
- Reconexão automática.

## Rotas usadas pelo Agenda Pro

- `GET /ready`
- `GET /v1/:business_id/status`
- `POST /v1/:business_id/pair-code`
- `POST /v1/:business_id/connect` — QR apenas como alternativa
- `POST /v1/:business_id/disconnect`
- `POST /v1/:business_id/send-message`
- `POST /v1/:business_id/send-queue`

## Publicação na Oracle Linux 9

Na VM, entre no repositório e nesta pasta:

```bash
cd agenda-baileys-oracle
cp .env.example .env
nano .env
```

Preencha as chaves do Supabase e confirme o host HTTPS.

Depois:

```bash
docker compose up -d --build
```

Teste:

```bash
curl https://129.148.54.231.sslip.io/ready
```

O retorno deve conter `"ok":true`.

## Correções importantes do pareamento por celular

O runtime usa um browser canônico (`Browsers.macOS('Desktop')`) e não um nome personalizado. O pedido de código acontece apenas depois do evento de conexão inicial. O fechamento 515 é tratado como reinício esperado após o pareamento, e não como erro terminal.
