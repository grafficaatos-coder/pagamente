# Atualização automática da Agenda Pro no Windows — sem ZIPs

Uma única instalação cria a tarefa do Windows **Agenda Pro - Atualizador Docker**. Depois disso, cada versão aprovada na branch `deploy/agenda-pro-docker` será verificada automaticamente a cada 10 minutos, quando o Windows e o Docker Desktop estiverem ligados.

## Instalar uma única vez

Abra **PowerShell** na conta do Windows que utiliza o Docker Desktop e execute:

```powershell
$u='https://raw.githubusercontent.com/grafficaatos-coder/pagamente/deploy/agenda-pro-docker/agenda-baileys-railway/scripts/Instalar-Atualizacao-Automatica.ps1'; $p=Join-Path $env:TEMP 'agenda-auto-instalar.ps1'; Invoke-WebRequest -Uri $u -OutFile $p -UseBasicParsing; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p
```

Requer apenas que o contêiner `agenda-pro-whatsapp` já esteja rodando e que a pasta original com `.env` e `compose.yaml` ainda exista. Não instale repetidamente. Não envie nem compartilhe chaves.

O instalador **não reinicia o servidor atual**. Marca o release atual como referência e aguarda a **próxima publicação aprovada**. O WhatsApp que está conectado permanece intacto.

## Como funciona

- Somente a branch de implantação **`deploy/agenda-pro-docker`** é observada, nunca a de desenvolvimento.
- O instalador salva o atualizador em `%LOCALAPPDATA%\AgendaProDocker\Atualizar-AgendaPro.ps1`.
- O Windows verifica a branch a cada 10 minutos enquanto você estiver **logado** e o Docker Desktop ligado.
- Quando há mudança aprovada, baixa e descompacta o código **internamente**, constrói a imagem Docker antes de trocar a versão, preserva **`.env`** e o **volume Docker `/data`** e confere `http://127.0.0.1:8080/ready`.
- Se o novo serviço não fica saudável, tenta restaurar a versão anterior. As sessões no volume não são apagadas, mas toda mudança pode provocar uma reconexão momentânea.
- O atualizador recusa uma versão que remova os bloqueios `DISPATCH_ENABLED: "false"` e `ALLOW_ALL_BUSINESSES: "false"`; a migração de clientes reais precisa de um processo separado e auditado.
- Logs em `%LOCALAPPDATA%\AgendaProDocker\atualizacoes.log`.

## Teste e manutenção

- Em **Agendador de Tarefas** do Windows, procure `Agenda Pro - Atualizador Docker`.
- Para forçar uma verificação manual, execute:
  ```powershell
  & "$env:LOCALAPPDATA\AgendaProDocker\Atualizar-AgendaPro.ps1"
  ```
- Para pausar atualizações sem desligar o WhatsApp, desative essa tarefa no Agendador.
- Sem o computador ligado, os envios de WhatsApp não funcionam.
- Alterações feitas apenas no painel Vercel/Supabase continuam sendo publicadas pela infraestrutura em nuvem e não exigem atualização do Docker.
- Quando o plano de migração para clientes reais estiver aprovado, use uma branch de implantação estável e manutenção gradual; não faça disparos em várias empresas simultaneamente.

**Importante:** o atualizador está disponível, mas ainda precisa ser instalado e verificado no computador Windows do usuário. O ChatGPT não tem acesso direto ao Windows para clicar ou executar a tarefa.
