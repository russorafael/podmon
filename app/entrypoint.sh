#!/bin/bash
# File: entrypoint.sh
# Purpose: Initialize podmon environment, install dependencies and start services
# Version: 1.0.0
# Created: 2025-04-15 14:45:12 UTC
# Author: russorafael

# Exit on error
set -e

echo "[$(date +"%Y-%m-%d %H:%M:%S")] Starting Podmon initialization..."

# Function to log messages
log() {
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Create user tiesse with sudo privileges
create_user() {
    log "Creating user tiesse..."
    useradd -m -s /bin/bash tiesse
    echo "tiesse:tiesseadm" | chpasswd
    echo "tiesse ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
}

# Install system dependencies
install_system_deps() {
    log "Updating package lists..."
    apt-get update -q

    log "Installing system dependencies..."
    apt-get install -y --no-install-recommends \
        sudo \
        openssh-server \
        curl \
        git \
        sqlite3 \
        python3-pip \
        nodejs \
        npm \
        build-essential \
        chromium-browser \
        chromium-chromedriver \
        xvfb \
        libgconf-2-4
    
    # Clean up
    apt-get clean
    rm -rf /var/lib/apt/lists/*
}

# Configure SSH
setup_ssh() {
    log "Configuring SSH..."
    mkdir -p /var/run/sshd
    echo 'PermitRootLogin no' >> /etc/ssh/sshd_config
    echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config
    service ssh start
}

# Install Python dependencies
install_python_deps() {
    log "Installing Python packages..."
    pip3 install --no-cache-dir \
        flask==3.0.0 \
        flask-socketio==5.3.6 \
        gunicorn==21.2.0 \
        kubernetes==29.0.0 \
        requests==2.31.0 \
        python-telegram-bot==20.8 \
        pyyaml==6.0.1 \
        schedule==1.2.0 \
        psutil==5.9.0 \
        pandas==2.2.3 \
        selenium==4.18.1 \
        pywhatkit==5.4.0 \
        textbelt==1.0.0
}

# Install Node.js dependencies
install_node_deps() {
    log "Installing Node.js packages..."
    npm install -g @vue/cli tailwindcss
}

# Initialize application
init_app() {
    log "Initializing application..."
    
    # Create necessary directories
    mkdir -p /app/data
    mkdir -p /app/whatsapp  # Directory for WhatsApp session
    
    # Set correct permissions
    chown -R tiesse:tiesse /app
    
    # Initialize database if it doesn't exist
    if [ ! -f "/app/data/podmon.db" ]; then
        log "Initializing SQLite database..."
        python3 /app/database.py --init
    fi

    # Setup virtual display for WhatsApp
    log "Setting up virtual display..."
    Xvfb :99 -screen 0 640x480x8 -nolisten tcp &
    export DISPLAY=:99
}

# Main execution
main() {
    log "Starting main installation process..."
    
    # Run all setup functions
    install_system_deps
    create_user
    setup_ssh
    install_python_deps
    install_node_deps
    init_app
    
    log "Starting application services..."
    
    # Start the monitoring application
    cd /app
    exec python3 monitor.py
}

# Execute main function
main

# Keep container running and handle signals properly
trap 'kill -TERM $PID' TERM INT
python3 /app/monitor.py & 
PID=$!
wait $PID
trap - TERM INT
wait $PID
EXIT_STATUS=$?