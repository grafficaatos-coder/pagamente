# Agenda Pro — Baileys na Oracle Cloud

Esta versão roda o Baileys em uma VM Oracle Cloud 24 horas, sem depender do computador do proprietário.

## Arquitetura

```text
Celular do assinante
      |
      v
Agenda Pro / Vercel
      |
      v
Supabase
      |
      v
Oracle Cloud VM
Node 22 + Baileys
      |
      v
WhatsApp
```

A VM mantém várias sessões simultâneas, uma por empresa.

## Persistência

As sessões ficam em:

```text
/opt/agenda-pro-baileys/agenda-nails/baileys-oracle/data/sessions/
```

O Docker monta esse diretório como `/data`. Reiniciar o container ou a VM normalmente não exige novo QR.

Nunca envie ou publique esse diretório. Ele contém credenciais equivalentes a um aparelho conectado ao WhatsApp.

## Proteções mantidas

O serviço usa as mesmas funções de proteção já criadas no Supabase:

- runtime lease por empresa;
- heartbeat;
- reservation_token;
- idempotency_key;
- fila AT_MOST_ONCE;
- revalidação do agendamento imediatamente antes do envio;
- bloqueio de retry automático depois do início do sendMessage;
- verificação do número com socket.onWhatsApp().

## VM recomendada

Use uma instância Always Free elegível, preferencialmente:

```text
Shape: VM.Standard.A1.Flex
Imagem: Ubuntu
OCPU: 1
RAM: 6 GB
```

1 OCPU e 6 GB são suficientes para começar e ficam dentro dos limites Always Free documentados para A1.

## Portas

Na Security List ou Network Security Group da Oracle, permita entrada TCP:

```text
22   SSH
80   HTTP, usado pelo Caddy para emitir certificado
443  HTTPS do serviço Baileys
```

Não exponha a porta 8080 à internet.

## Instalação

Conecte por SSH na VM e rode:

```bash
curl -fsSL https://raw.githubusercontent.com/grafficaatos-coder/pagamente/main/agenda-nails/baileys-oracle/install.sh -o install.sh
chmod +x install.sh
./install.sh
```

O instalador:

1. instala Docker;
2. baixa o projeto;
3. descobre o IP público;
4. cria um host `IP.sslip.io`;
5. pede a Service Role do Supabase de forma oculta;
6. sobe Baileys + Caddy;
7. configura HTTPS;
8. mostra a URL final.

Exemplo de saída:

```text
URL_DO_BAILEYS=https://129.146.10.20.sslip.io
```

## Ativar no Agenda Pro

Entre como proprietário:

```text
Configurações
  > Baileys + Oracle Cloud
```

Cole a URL mostrada pelo instalador, marque a opção para ativar e salve.

Depois entre numa empresa:

```text
WhatsApp
  > Conectar por QR Code
```

No celular:

```text
WhatsApp
  > Aparelhos conectados
  > Conectar um aparelho
```

Escaneie o QR.

## Atualizar

Na VM:

```bash
cd /opt/agenda-pro-baileys
sudo git pull --ff-only
cd agenda-nails/baileys-oracle
sudo docker compose build --pull
sudo docker compose up -d
```

## Logs

```bash
cd /opt/agenda-pro-baileys/agenda-nails/baileys-oracle
sudo docker compose logs -f baileys
```

## Aviso

Baileys não é a API oficial da Meta. O WhatsApp pode alterar o protocolo, desconectar sessões ou restringir números.
