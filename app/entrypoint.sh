#!/bin/bash
# Nome: entrypoint.sh
# Função: Script de inicialização do sistema de monitoramento de pods
# Versão: 1.2.0

# Função para log
log() {
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] $1"
}

log "Iniciando configuração do sistema..."

# Verificar montagem do NFS
if ! mountpoint -q /app; then
    log "ERRO: Diretório /app não está montado corretamente"
    exit 1
fi

# Configurar timezone
log "Configurando timezone..."
ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime

# Instalar dependências
log "Instalando dependências..."
apt-get update && apt-get install -y \
    openssh-server \
    sudo \
    python3-pip \
    vim \
    curl \
    net-tools \
    && rm -rf /var/lib/apt/lists/*

# Configurar SSH
log "Configurando SSH..."
mkdir -p /var/run/sshd
echo 'root:tiesseadm' | chpasswd
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Criar usuário tiesse
log "Criando usuário tiesse..."
useradd -m -s /bin/bash tiesse
echo 'tiesse:tiesseadm' | chpasswd
echo 'tiesse ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Instalar dependências Python
log "Instalando dependências Python..."
pip3 install flask \
    kubernetes \
    schedule \
    requests \
    py-healthcheck \
    psutil \
    pytz \
    flask-cors

# Configurar permissões do /app
log "Configurando permissões..."
chown -R tiesse:tiesse /app
chmod -R 755 /app

# Criar diretórios necessários se não existirem
mkdir -p /app/templates
mkdir -p /app/static/js
mkdir -p /app/static/css

# Verificar se todos os arquivos necessários existem
required_files=(
    "/app/monitor.py"
    "/app/templates/index.html"
    "/app/static/js/script.js"
    "/app/static/css/style.css"
)

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        log "ERRO: Arquivo $file não encontrado"
        exit 1
    fi
done

# Iniciar serviço SSH
log "Iniciando serviço SSH..."
/usr/sbin/sshd

# Iniciar aplicação Flask
log "Iniciando aplicação..."
cd /app
python3 monitor.py