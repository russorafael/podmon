#!/bin/bash
# Nome: entrypoint.sh
# Função: Script de inicialização do sistema de monitoramento de pods
# Versão: 2.0.0
# Autor: russorafael
# Data: 2025-04-14 12:46:01

# Current system info
CURRENT_DATE="2025-04-14 12:46:01"
CURRENT_USER="russorafael"

# Function for logging with timestamp
log() {
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] $1"
}

# Verify NFS mount with timeout
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

# Configure timezone with verification
log "Setting timezone..."
if ln -snf /usr/share/zoneinfo/Europe/Rome /etc/localtime; then
    log "Timezone set successfully"
else
    log "WARNING: Failed to set timezone"
fi

# Install system dependencies with progress feedback
log "Installing system dependencies..."
{
    # Update package list with timeout
    timeout 300 apt-get update -y || {
        log "ERROR: apt-get update failed"
        exit 1
    }

    # Install packages one by one for better error tracking
    packages=(
        openssh-server
        sudo
        python3-pip
        vim
        curl
        net-tools
        sqlite3
        python3-dev
        build-essential
        libsqlite3-dev
    )

    for package in "${packages[@]}"; do
        log "Installing $package..."
        if ! apt-get install -y $package; then
            log "ERROR: Failed to install $package"
            exit 1
        fi
    done

    apt-get clean
    rm -rf /var/lib/apt/lists/*
} || {
    log "ERROR: Failed to install system dependencies"
    exit 1
}
log "System dependencies installed successfully"

# Configure SSH with verifications
log "Configuring SSH..."
{
    mkdir -p /var/run/sshd
    echo 'root:tiesseadm' | chpasswd
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
} || {
    log "ERROR: Failed to configure SSH"
    exit 1
}

# Create user with verification
log "Creating user tiesse..."
if ! id "tiesse" &>/dev/null; then
    useradd -m -s /bin/bash tiesse || {
        log "ERROR: Failed to create user tiesse"
        exit 1
    }
    echo 'tiesse:tiesseadm' | chpasswd
    echo 'tiesse ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
    log "User tiesse created successfully"
else
    log "User tiesse already exists"
fi

# Install Python dependencies with retry and progress
log "Installing Python dependencies..."
max_retries=3
retry_count=0

# Upgrade pip first
log "Upgrading pip..."
python3 -m pip install --no-cache-dir --upgrade pip

# Install base packages first
log "Installing Python base packages..."
base_packages=(
    "wheel"
    "setuptools"
)

for package in "${base_packages[@]}"; do
    log "Installing base package: $package..."
    if ! pip3 install --no-cache-dir $package; then
        log "ERROR: Failed to install base package $package"
        exit 1
    fi
done

# Install critical packages first
log "Installing critical dependencies..."
critical_packages=(
    "psutil"
)

for package in "${critical_packages[@]}"; do
    log "Installing critical package: $package..."
    if ! pip3 install --no-cache-dir $package; then
        log "ERROR: Failed to install critical package $package"
        exit 1
    fi
done

# Then install other packages
python_packages=(
    flask
    flask-sqlalchemy
    kubernetes
    schedule
    requests
    py-healthcheck
    pytz
    flask-cors
    sqlalchemy
)


while [ $retry_count -lt $max_retries ]; do
    success=true
    
    for package in "${python_packages[@]}"; do
        log "Installing Python package: $package..."
        if ! pip3 install --no-cache-dir $package; then
            success=false
            break
        fi
    done
    
    if $success; then
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

# Configure permissions with verification
log "Setting permissions..."
chown -R tiesse:tiesse /app || {
    log "ERROR: Failed to set permissions on /app"
    exit 1
}
chmod -R 755 /app

# Verify required directories
log "Creating required directories..."
dirs=("/app/templates" "/app/static/js" "/app/static/css" "/app/data")
for dir in "${dirs[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir" || {
            log "ERROR: Failed to create directory: $dir"
            exit 1
        }
        log "Created directory: $dir"
    fi
done

# Verify required files
log "Checking required files..."
required_files=(
    "/app/monitor.py"
    "/app/database.py"
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

# Configure database
log "Setting up database..."
if [ ! -f "/app/data/podmon.db" ]; then
    log "Initializing new database..."
    sqlite3 /app/data/podmon.db ".databases" || {
        log "ERROR: Failed to initialize database"
        exit 1
    }
    chown tiesse:tiesse /app/data/podmon.db
    chmod 644 /app/data/podmon.db
fi

# Start SSH service with verification
log "Starting SSH service..."
if /usr/sbin/sshd; then
    log "SSH service started successfully"
else
    log "ERROR: Failed to start SSH service"
    exit 1
fi

# Start Flask application
log "Starting Flask application..."
cd /app || {
    log "ERROR: Failed to change to /app directory"
    exit 1
}
export FLASK_APP=monitor.py
export FLASK_ENV=production
exec python3 monitor.py