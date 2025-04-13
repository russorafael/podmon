#!/bin/bash
# Nome: entrypoint.sh
# Função: Script de inicialização do container
# Versão: 2.0.0
# Última atualização: 2025-04-13
# Autor: russorafael

set -e

echo "Starting PodMon Monitoring System setup..."

# Atualizar pacotes e instalar dependências
echo "Installing system dependencies..."
apt-get update
apt-get install -y openssh-server sudo git nano curl htop net-tools

# Configurar SSH
echo "Configuring SSH service..."
mkdir -p /var/run/sshd
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Criar usuário tiesse
echo "Setting up user tiesse..."
useradd -m -s /bin/bash tiesse
echo "tiesse:tiesseadm" | chpasswd
echo "tiesse ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/tiesse
chmod 0440 /etc/sudoers.d/tiesse

# Instalar dependências Python
echo "Installing Python packages..."
pip install --no-cache-dir \
    flask \
    requests \
    flask_cors \
    apscheduler \
    kubernetes \
    pyyaml \
    psutil \
    prometheus_client

# Criar estrutura de diretórios
echo "Creating directory structure..."
mkdir -p /app/templates /app/static /app/cache /app/logs
chown -R tiesse:tiesse /app

# Configurar permissões de logs
touch /app/logs/podmon.log
chown tiesse:tiesse /app/logs/podmon.log
chmod 644 /app/logs/podmon.log

# Configurar diretório de trabalho
cd /app

# Iniciar serviço SSH
echo "Starting SSH service..."
service ssh start

# Verificar dependências do Kubernetes
echo "Checking Kubernetes configuration..."
if [ -f /var/run/secrets/kubernetes.io/serviceaccount/token ]; then
    echo "Running in Kubernetes cluster"
else
    echo "Running in local development mode"
    if [ -f $HOME/.kube/config ]; then
        echo "Found local Kubernetes configuration"
    fi
fi

# Definir variáveis de ambiente
export PYTHONUNBUFFERED=1
export FLASK_ENV=production
export PODMON_VERSION="2.0.0"

# Iniciar o script de monitoramento
echo "Starting monitoring script..."
echo "Access web interface at http://localhost:5000"
echo "SSH access: ssh tiesse@<container-ip>"
python3 /app/monitor.py &

# Manter o container em execução e monitorar o processo Python
echo "Setup completed. PodMon is running..."
while true; do
    if ! pgrep -f "python3 /app/monitor.py" > /dev/null; then
        echo "Monitor process died, restarting..."
        python3 /app/monitor.py &
    fi
    sleep 60
done