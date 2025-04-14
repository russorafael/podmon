#!/bin/bash
# Nome: entrypoint.sh
# Função: Script de inicialização do sistema de monitoramento de pods
# Versão: 1.2.0
# Autor: russorafael
# Data: 2025-04-14 10:33:04

# Current system info
CURRENT_DATE="2025-04-14 10:33:04"
CURRENT_USER="russorafael"

# Função para log com timestamp
log() {
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] $1"
}

log "Starting system configuration..."

# Verificar montagem do NFS com timeout
timeout=60
counter=0
while ! mountpoint -q /app; do
    if [ $counter -ge $timeout ]; then
        log "ERROR: /app mount point timeout after ${timeout} seconds"
        exit 1
    fi
    log "Waiting for /app mount point... ($counter/${timeout}s)"
    sleep 1
    ((counter++))
done
log "NFS mount point /app verified successfully"

# Configurar timezone com verificação
log "Setting timezone..."
if ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime; then
    log "Timezone set successfully"
else
    log "WARNING: Failed to set timezone"
fi

# Instalar dependências com feedback
log "Installing system dependencies..."
apt-get update -y && \
apt-get install -y \
    openssh-server \
    sudo \
    python3-pip \
    vim \
    curl \
    net-tools && \
apt-get clean && \
rm -rf /var/lib/apt/lists/* || {
    log "ERROR: Failed to install system dependencies"
    exit 1
}
log "System dependencies installed successfully"

# Configurar SSH com verificações
log "Configuring SSH..."
mkdir -p /var/run/sshd
echo 'root:tiesseadm' | chpasswd
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Criar usuário com verificação
log "Creating user tiesse..."
if id "tiesse" &>/dev/null; then
    log "User tiesse already exists"
else
    useradd -m -s /bin/bash tiesse
    echo 'tiesse:tiesseadm' | chpasswd
    echo 'tiesse ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
    log "User tiesse created successfully"
fi

# Instalar dependências Python com retry
log "Installing Python dependencies..."
max_retries=3
retry_count=0
while [ $retry_count -lt $max_retries ]; do
    if pip3 install --no-cache-dir \
        flask \
        kubernetes \
        schedule \
        requests \
        py-healthcheck \
        psutil \
        pytz \
        flask-cors; then
        log "Python dependencies installed successfully"
        break
    else
        ((retry_count++))
        if [ $retry_count -eq $max_retries ]; then
            log "ERROR: Failed to install Python dependencies after $max_retries attempts"
            exit 1
        fi
        log "Retry $retry_count/$max_retries: Installing Python dependencies..."
        sleep 5
    fi
done

# Configurar permissões com verificação
log "Setting permissions..."
chown -R tiesse:tiesse /app
chmod -R 755 /app

# Verificar diretórios necessários
log "Creating required directories..."
dirs=("/app/templates" "/app/static/js" "/app/static/css")
for dir in "${dirs[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        log "Created directory: $dir"
    fi
done

# Verificar arquivos necessários
log "Checking required files..."
required_files=(
    "/app/monitor.py"
    "/app/templates/index.html"
    "/app/static/js/script.js"
    "/app/static/css/style.css"
)

missing_files=0
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        log "ERROR: Missing required file: $file"
        missing_files=1
    fi
done

if [ $missing_files -eq 1 ]; then
    log "ERROR: Some required files are missing"
    exit 1
fi
log "All required files verified successfully"

# Iniciar serviço SSH com verificação
log "Starting SSH service..."
if /usr/sbin/sshd; then
    log "SSH service started successfully"
else
    log "WARNING: Failed to start SSH service"
fi

# Iniciar aplicação Flask
log "Starting Flask application..."
cd /app
export FLASK_APP=monitor.py
export FLASK_ENV=production
python3 monitor.py