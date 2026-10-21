# Agenda Pro — Docker local (preparação sem envios)

O GitHub armazena **código**, não credenciais do WhatsApp. O Supabase guarda agendamentos e fila; o Docker Desktop executa Node.js/Baileys no seu PC.

## Iniciar teste local

1. Instale Docker Desktop/WSL2 e Git.
2. Baixe esta branch do GitHub e abra a pasta `agenda-baileys-railway`.
3. Copie `.env.docker.example` como `.env` e informe as chaves na sua própria máquina, sem colá-las em chats ou commits.
4. Rode `docker compose up -d --build`.
5. Verifique `docker compose ps` e `http://localhost:8080/health`.

O arquivo `compose.yaml` **obriga DISPATCH_ENABLED=false e ALLOW_ALL_BUSINESSES=false**. Portanto é só preparação/healthcheck, sem disparo de cobranças ou mensagens. As sessões ficam no volume Docker `agenda_whatsapp_sessions` em `/data`; este volume é LOCAL, não um backup externo.

**Não vincule o mesmo WhatsApp em dois Baileys ao mesmo tempo.** Preserve Railway, não habilite automaticamente filas, e não exponha a porta 8080 à Internet. A Agenda Pro hospedada na Vercel não alcança `localhost`; mudar o serviço de produção exige uma conexão pública segura, atualização de roteamento server-side e testes.

## Recuperação e segurança

- O GitHub preserva o código, mas não deve receber arquivos de sessão, tokens, `.env` ou dados pessoais.
- Para resistir à quebra do PC, será necessário configurar um backup **criptografado e externo** do volume `/data`, com acesso restrito; isso ainda **não está configurado**.
- `docker compose down` conserva o volume. **Não use `docker compose down -v` nem exclua volumes no Docker Desktop**, pois isso apaga as sessões.
- A versão publicada no Railway deve continuar intacta até migração supervisionada de uma empresa e validação de mensagens.

