#!/usr/bin/env bash
set -euo pipefail

echo "== Agenda Pro WhatsApp / Oracle =="
echo "Atualizando código..."
git pull --ff-only

cd agenda-baileys-oracle

if [ ! -f .env ]; then
  echo "ERRO: arquivo .env não encontrado em $(pwd)"
  echo "Copie .env.example para .env e preencha as chaves do Supabase."
  exit 1
fi

echo "Parando versão anterior..."
docker compose down || true

echo "Reconstruindo com Baileys 6.7.24..."
docker compose build --no-cache

echo "Subindo serviço..."
docker compose up -d

echo "Aguardando inicialização..."
sleep 6

echo "Status dos containers:"
docker compose ps

echo
echo "Últimos logs:"
docker compose logs --tail=120 whatsapp

echo
echo "Atualização concluída."
