# Agenda Pro: WhatsApp no Railway

Serviço persistente Node.js 22 + Baileys, com o mesmo Supabase e a mesma fila do Agenda Pro.

## Configuração do serviço

- Diretório raiz: `/agenda-baileys-railway`.
- Dockerfile: `Dockerfile`; inclui Git, necessário para instalar dependências do Baileys.
- Volume persistente montado em `/data`; uma réplica, sem suspensão automática.
- Porta: `8080`; healthcheck `/health`; prontidão do banco em `/ready`.
- Reinício: `ON_FAILURE`, até 10 tentativas.

Variáveis necessárias (a chave privada fica somente nas Variables do Railway):

```
SUPABASE_URL=https://zmrihyzwsyxjikdknfug.supabase.co
SUPABASE_PUBLISHABLE_KEY=<chave pública do mesmo projeto>
SUPABASE_SERVICE_ROLE_KEY=<chave secreta sb_secret_... ou service_role>
PORT=8080
DATA_DIR=/data
AGENDA_ORIGIN=https://agenda-pro-iucw.vercel.app
ALLOWED_BUSINESS_IDS=<UUID da empresa piloto>
ALLOW_ALL_BUSINESSES=false
DISPATCH_ENABLED=false
```

Sem credenciais, `/health` informa apenas que o processo responde. `/ready` retorna 503 e as operações ficam bloqueadas. Só prossiga quando `/ready` retornar 200, `configured: true` e `database_ready: true`.

## Sessões, fila e recuperação

Cada empresa tem seu socket e checkpoint atômico em `/data/sessions/<business_id>/auth.json`. As credenciais e chaves de criptografia são salvas com permissão 0600; o volume sobrevive a reinícios e novos deploys. Um volume novo NÃO transfere as sessões antigas do Oracle. A primeira conexão no Railway precisa ser refeita, salvo migração validada do estado de autenticação. Nunca coloque sessões ou chaves no Git.

A renovação do lease e o heartbeat usam as funções existentes `agenda_baileys_*` no Supabase. Perder o lease ou a conexão com o banco fecha o socket. Conexões travadas são recuperadas; logout explícito exige novo pareamento. Desligamento preserva o estado e libera o lease.

A fila continua em `agenda_whatsapp_queue`: reserva atômica, revalidação de empresa/agendamento/telefone, bloqueio de agendamentos cancelados ou vencidos e envio com semântica AT_MOST_ONCE. Um resultado incerto não é reenviado automaticamente. Os envios permanecem pausados até `DISPATCH_ENABLED=true`.

O código por número só é solicitado depois do evento QR que indica socket pronto. QR continua disponível como alternativa. Não há garantia de que o WhatsApp aceite o pareamento por código.

## Migração gradual

1. Inserir a chave privada e publicar. Conferir `/ready`.
2. Manter `DISPATCH_ENABLED=false` e liberar apenas a empresa piloto em `ALLOWED_BUSINESS_IDS`.
3. Pausar/desconectar o runtime da empresa piloto no Oracle antes de conectar no Railway. Não forçar/liberar leases de um runtime ainda ativo.
4. Roteamento por empresa: `agenda_whatsapp_runtime_routes` define a URL e o prefixo de lease autorizados para a piloto. O proxy consulta essa tabela, acessível somente pelo servidor. Após cadastrar a rota Railway, o Oracle perde a renovação do lease, fecha seu socket e o Railway aguarda a expiração normal antes de assumir. A configuração global `agenda_platform_settings.baileys_service_url` permanece no Oracle para as demais empresas.
5. Conectar o WhatsApp da piloto, conferir heartbeat e reiniciar o serviço para comprovar restauração sem novo pareamento.
6. Revisar pendências antigas da fila. Ativar envios e realizar uma confirmação de teste para destinatário autorizado, verificando `done` e ausência de duplicidade.
7. Somente após aceite do teste, migrar as demais empresas, parar seus runtimes antigos, definir `ALLOW_ALL_BUSINESSES=true` e trocar a URL global do Agenda Pro pela URL Railway. Remover o override da piloto após a troca.

## Reversão

Pausar envios no Railway e parar os runtimes antes de restaurar o roteamento antigo. Aguardar a expiração do lease; nunca manter dois servidores usando a mesma sessão. Não apagar volume/sessões durante a reversão.

## Validação local

`npm ci --omit=dev` e `npm test` verificam instalação, persistência e isolamento de credenciais, exclusão de chaves e parada por perda de lease. O teste real de WhatsApp exige pareamento no aparelho e credenciais de produção; testes locais não comprovam esse fluxo.
