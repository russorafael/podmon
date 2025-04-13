#!/bin/bash
# Nome: entrypoint.sh
# Função: Script de inicialização do container
# Versão: 1.0.0

set -e

echo "Iniciando configuração do sistema Falco Monitor..."

# Atualizar pacotes e instalar dependências
echo "Instalando dependências..."
apt-get update
apt-get install -y openssh-server sudo git nano curl 

# Configurar SSH
echo "Configurando SSH..."
mkdir -p /var/run/sshd
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Criar usuário tiesse
echo "Configurando usuário tiesse..."
useradd -m -s /bin/bash tiesse
echo "tiesse:tiesseadm" | chpasswd
echo "tiesse ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/tiesse
chmod 0440 /etc/sudoers.d/tiesse

# Instalar dependências Python
echo "Instalando pacotes Python..."
pip install flask requests flask_cors apscheduler kubernetes pyyaml 

# Garanta que diretórios necessários existam
mkdir -p /app/templates /app/static

# Iniciar serviço SSH
echo "Iniciando serviço SSH..."
service ssh start

# Inicie o script de monitoramento em segundo plano
echo "Iniciando script de monitoramento..."
cd /app
python3 /app/monitor.py &

# Mantenha o container rodando
echo "Configuração concluída"
tail -f /dev/null
