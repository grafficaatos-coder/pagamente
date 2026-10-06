#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

echo "Agenda Pro - instalação Baileys Oracle Cloud"
echo

ensure_swap() {
  local mem_kb swap_kb
  mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/SwapTotal/ {print $2}' /proc/meminfo)"
  if [ "${mem_kb:-0}" -lt 2000000 ] && [ "${swap_kb:-0}" -lt 1000000 ]; then
    echo "VM com pouca RAM detectada. Criando 3 GB de memória SWAP..."
    if command -v fallocate >/dev/null 2>&1; then
      $SUDO fallocate -l 3G /swapfile
    else
      $SUDO dd if=/dev/zero of=/swapfile bs=1M count=3072 status=progress
    fi
    $SUDO chmod 600 /swapfile
    $SUDO mkswap /swapfile
    $SUDO swapon /swapfile
    if ! grep -q '^/swapfile ' /etc/fstab; then
      echo '/swapfile swap swap defaults 0 0' | $SUDO tee -a /etc/fstab >/dev/null
    fi
  fi
}

ensure_swap

install_ubuntu() {
  $SUDO apt-get update
  $SUDO apt-get install -y docker.io git curl ca-certificates
  if ! docker compose version >/dev/null 2>&1; then
    $SUDO apt-get install -y docker-compose-v2 2>/dev/null || \
    $SUDO apt-get install -y docker-compose-plugin
  fi
}

install_oracle_linux() {
  # Oracle Linux pode iniciar dnf-makecache automaticamente e bloquear o instalador.
  $SUDO systemctl disable --now dnf-makecache.timer >/dev/null 2>&1 || true
  $SUDO systemctl stop dnf-makecache.service >/dev/null 2>&1 || true
  $SUDO dnf clean all >/dev/null 2>&1 || true
  $SUDO dnf -y install dnf-plugins-core git curl ca-certificates
  if ! command -v docker >/dev/null 2>&1; then
    $SUDO dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    $SUDO dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif ! docker compose version >/dev/null 2>&1; then
    $SUDO dnf -y install docker-compose-plugin
  fi
}

if command -v apt-get >/dev/null 2>&1; then
  install_ubuntu
elif command -v dnf >/dev/null 2>&1; then
  install_oracle_linux
else
  echo "Sistema operacional não suportado automaticamente."
  exit 1
fi

$SUDO systemctl enable --now docker
$SUDO usermod -aG docker "$USER" || true

INSTALL_DIR="/opt/agenda-pro-baileys"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  $SUDO git clone https://github.com/grafficaatos-coder/pagamente.git "$INSTALL_DIR"
else
  $SUDO git -C "$INSTALL_DIR" pull --ff-only
fi

$SUDO chown -R "$USER":"$USER" "$INSTALL_DIR"
cd "$INSTALL_DIR/agenda-nails/baileys-oracle"

PUBLIC_IP="$(curl -4fsS https://api.ipify.org)"
if [ -z "$PUBLIC_IP" ]; then
  echo "Não foi possível descobrir o IP público da VM."
  exit 1
fi

PUBLIC_HOST="${PUBLIC_IP}.sslip.io"

echo
echo "Cole agora a chave secreta do Supabase (sb_secret_... ou service_role legado)."
echo "O valor não aparecerá na tela e será salvo somente nesta VM."
read -r -s SERVICE_KEY
echo

if [ -z "$SERVICE_KEY" ]; then
  echo "Service Role vazia. Instalação cancelada."
  exit 1
fi

umask 077
cat > .env <<EOF
SUPABASE_URL=https://zmrihyzwsyxjikdknfug.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_nX-qLw9rEdLUvZpgXMj1LA_2gjB3umn
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
PORT=8080
DATA_DIR=/data
AGENDA_ORIGIN=https://agenda-nails-grafficaatos-3591.vercel.app
PUBLIC_HOST=$PUBLIC_HOST
LOG_LEVEL=warn
EOF

mkdir -p data

if command -v ufw >/dev/null 2>&1; then
  $SUDO ufw allow 22/tcp || true
  $SUDO ufw allow 80/tcp || true
  $SUDO ufw allow 443/tcp || true
fi

if command -v firewall-cmd >/dev/null 2>&1; then
  $SUDO systemctl enable --now firewalld || true
  $SUDO firewall-cmd --permanent --add-service=http || true
  $SUDO firewall-cmd --permanent --add-service=https || true
  $SUDO firewall-cmd --reload || true
fi

$SUDO docker compose build --pull
$SUDO docker compose up -d

echo
echo "Aguardando o serviço..."
for i in $(seq 1 36); do
  if curl -kfsS "https://$PUBLIC_HOST/health" >/dev/null 2>&1; then
    echo
    echo "PRONTO"
    echo "URL_DO_BAILEYS=https://$PUBLIC_HOST"
    echo
    echo "Copie essa URL e use no Agenda Pro > Proprietário > Configurações."
    exit 0
  fi
  sleep 5
done

echo
echo "O serviço subiu, mas o HTTPS ainda não respondeu."
echo "Confirme se as portas TCP 80 e 443 estão liberadas na Oracle Cloud."
echo "Depois teste: https://$PUBLIC_HOST/health"
