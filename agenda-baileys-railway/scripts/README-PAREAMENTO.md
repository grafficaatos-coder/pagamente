# Agenda Pro — Pareamento local por código

O pacote `Conectar_WhatsApp_Teste_Agenda_Pro.zip` inclui um script PowerShell e um Node.js que roda somente via `docker exec -i agenda-pro-whatsapp node - <telefone>`. O script lê a chave `SUPABASE_SERVICE_ROLE_KEY` exclusivamente dentro do container, valida `LOCAL_POLL_ENABLED=true`, `DISPATCH_ENABLED=false`, `ALLOW_ALL_BUSINESSES=false` e exige a lista de uma única empresa de teste (`270de0ad-2013-4afb-b8ba-2e21175b3f01`).

O código de pareamento aparece no terminal local e expira. Usuário confirma no próprio WhatsApp em *Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone*. Nenhuma chave pode ser exibida ou compartilhada.

As sessões do Railway e os envios automáticos não são alterados. **Baileys não é a API oficial; um número de teste isolado é obrigatório.**
