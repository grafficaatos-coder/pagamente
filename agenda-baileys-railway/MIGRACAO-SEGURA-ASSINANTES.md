# Agenda Pro — migração segura do WhatsApp (Railway → Docker / Supabase)

## Atualização do responsável pela plataforma — 23/10/2026

O responsável pela plataforma informou no chat que **todos os clientes já confirmaram a autorização para migrar**. Trata-se de confirmação relatada pelo operador; não são identidades autenticadas pelo login dos clientes. A migração não exige nova solicitação verbal, mas o titular de cada WhatsApp deverá acompanhar o pareamento seguro de seu próprio aparelho.

**Situação de segurança:** Nenhum cliente real foi redirecionado, nenhum WhatsApp do Railway foi encerrado e nenhuma fila antiga foi disparada. O banco continua exigindo aprovação autenticada para a habilitação automática do primeiro piloto. Foi preparado um campo de auditoria separado no GitHub, ainda não aplicado devido a bloqueio da ferramenta de migração. Não confundir o relatório do operador com `consent_confirmed_by`.

## Preparação executada em 23/10/2026

Esta é uma **avaliação**, não uma migração. O Supabase foi atualizado com:
- `agenda_private.whatsapp_migration_reviews`: registro privado de avaliação para empresas reais, sem números, tokens ou senhas
- `agenda_private.whatsapp_migration_assess(business_id)`: diagnóstico (lease em vigor, fila pendente/vencida, rota, aprovação)
- nenhuma alteração em `agenda_whatsapp_runtime_routes`, `agenda_baileys_sessions`, `agenda_whatsapp_queue` ou nas sessões persistidas
- nenhuma mudança na branch `deploy/agenda-pro-docker` observada pelo atualizador do Windows

## Resultado verificado

- 2 empresas com WhatsApp conectado no Railway: `blocked` para transferência automática; ambas têm leases ativos
- 1 empresa com WhatsApp ainda em QR no destino Railway padrão: `awaiting_owner_approval`
- 11 mensagens pendentes em empresas reais, com **5 vencidas há mais de 30 min** no momento da avaliação
- empresa técnica permanece conectada via Docker, isolada de assinantes reais

**Não ativar todas as empresas** na variável `ALLOWED_BUSINESS_IDS`, não ligar `ALLOW_ALL_BUSINESSES` nem `DISPATCH_ENABLED` global, e não alterar `runtime_prefix` das empresas conectadas.

## Procedimento de migração individual

1. Escolher somente UMA empresa piloto, obter aprovação do responsável pelo WhatsApp (e janela de manutenção).
2. Revisar a fila e decidir o destino das mensagens vencidas. Não disparar mensagens antigas, principalmente lembretes 24h já fora do horário; preservar registros para auditoria. Não apagar a fila global.
3. Manter o servidor da origem ativo para **todas as outras empresas**. Para a empresa piloto, coordenar a parada do gerenciamento da sessão e aguardar a expiração do lease antigo. Não reiniciar o Railway inteiro como atalho.
4. Preservar autenticação: exportar/recuperar a sessão **com transferência segura e autorizada do volume Railway** (método ainda não disponível nas ferramentas conectadas) OU solicitar um **novo pareamento ao responsável da empresa**. Nunca colocar credenciais/sessões no GitHub nem no chat.
5. Configurar uma autorização explícita para APENAS essa empresa no Docker (controle de allowlist). A branch atual do Docker ainda tem `TEST_AUTO_DISPATCH_ENABLED` restrito à empresa técnica; um modo de produção por empresa deve ser implementado e testado antes da transferência.
6. Garantir que o Docker reconhece somente esse lease, WhatsApp conectou, o proxy no Supabase responde sem túnel e o serviço não processará fila duplicada.
7. Atualizar `agenda_whatsapp_runtime_routes` apenas após a sessão nova estar validada e o destino antigo desligado para aquela empresa. Testar consulta de status, envio de uma mensagem autorizada e confirmação de agendamento.
8. Ligar somente o processamento automático dessa empresa após proteção contra fila vencida e reenvio duplicado. Acompanhar e retornar ao Railway apenas se a sessão original estiver preservada e não existir sessão concorrente.

## Barreiras ativas

- Leases impedem dois processos de usar a mesma sessão ao mesmo tempo, mas não transferem a autenticação entre volumes.
- O servidor Docker atual utiliza uma allowlist só da empresa técnica.
- O Docker instalado no Windows verifica apenas a branch `deploy/agenda-pro-docker`. Este plano em branch `feature/agenda-safe-tenant-cutover` não é implantado automaticamente.
- O usuário já comprovou entrega de confirmação e lembrete pelo Docker com empresa técnica. Isso **não comprova** a migração de um assinante real.

## Dados pendentes para iniciar o primeiro piloto

- Autorização do titular do WhatsApp de uma empresa real
- Método para autenticar o WhatsApp no Docker (preferir novo pareamento autorizado, dado que o volume Railway não pode ser copiado automaticamente)
- Confirmar horário de transferência com a empresa
- Criar e testar modo de produção por empresa, com aprovações e filas elegíveis

**Nunca desativar o Railway integralmente enquanto houver empresas em produção nele.**
