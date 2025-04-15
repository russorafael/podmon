#!/bin/bash
# Nome: entrypoint.sh
# Função: Script de inicialização do sistema de monitoramento de pods
# Versão: 2.0.0
# Autor: russorafael
# Data: 2025-04-14 15:20:47

# Current system info
CURRENT_DATE="2025-04-14 15:20:47"
CURRENT_USER="russorafael"

# Function for logging with timestamp
log() {
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] $1"
}

# Environment variables
ROOT_PASSWORD=${ROOT_PASSWORD:-"tiesseadm"}
USER_PASSWORD=${USER_PASSWORD:-"tiesseadm"}
REQUIRED_DISK_SPACE=1000000  # 1GB em KB
REQUIRED_MEMORY=512000       # 512MB em KB
DB_PATH="/app/data/podmon.db"
MOUNT_TIMEOUT=60
APP_DIR="/app"

# Check system resources
check_system_resources() {
    log "Checking system resources..."

    # Check disk space
    local available_space=$(df -k ${APP_DIR} | awk 'NR==2 {print $4}')
    if [ "$available_space" -lt "$REQUIRED_DISK_SPACE" ]; then
        log "ERROR: Insufficient disk space. Required: 1GB, Available: $((available_space/1024))MB"
        exit 1
    fi

    # Check memory
    local available_mem=$(free | awk '/Mem:/ {print $7}')
    if [ "$available_mem" -lt "$REQUIRED_MEMORY" ]; then
        log "ERROR: Insufficient memory. Required: 512MB, Available: $((available_mem/1024))MB"
        exit 1
    fi

    # Check network connectivity
    if ! ping -c 1 8.8.8.8 &>/dev/null; then
        log "WARNING: Network connectivity check failed"
    fi

    log "System resource checks completed"
}

# Verify NFS mount
verify_nfs_mount() {
    log "Verifying NFS mount..."
    local counter=0
    
    while ! mountpoint -q ${APP_DIR}; do
        if [ $counter -ge $MOUNT_TIMEOUT ]; then
            log "ERROR: ${APP_DIR} mount point timeout after ${MOUNT_TIMEOUT} seconds"
            exit 1
        fi
        log "Waiting for ${APP_DIR} mount point... ($counter/${MOUNT_TIMEOUT}s)"
        sleep 1
        ((counter++))
    done
    
    if ! df -T ${APP_DIR} | grep -q "nfs"; then
        log "ERROR: ${APP_DIR} is not an NFS mount"
        exit 1
    fi
    
    log "NFS mount verified successfully"
}

# Configure timezone
setup_timezone() {
    log "Setting timezone..."
    if ln -snf /usr/share/zoneinfo/Europe/Rome /etc/localtime; then
        log "Timezone set successfully"
    else
        log "WARNING: Failed to set timezone"
    fi
}

# Install system dependencies
install_dependencies() {
    log "Installing system dependencies..."
    {
        # Update package list with timeout
        timeout 300 apt-get update -y || {
            log "ERROR: apt-get update failed"
            exit 1
        }

        # Install packages with verification
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

        # Cleanup
        apt-get clean
        apt-get autoclean
        apt-get autoremove -y
        rm -rf /var/lib/apt/lists/*
        rm -rf /tmp/*

    } || {
        log "ERROR: Failed to install system dependencies"
        exit 1
    }
    log "System dependencies installed successfully"
}

# Configure SSH
configure_ssh() {
    log "Configuring SSH..."
    {
        mkdir -p /var/run/sshd
        echo "root:${ROOT_PASSWORD}" | chpasswd
        sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
        sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
    } || {
        log "ERROR: Failed to configure SSH"
        exit 1
    }
    log "SSH configured successfully"
}

# Create user
create_user() {
    log "Creating user tiesse..."
    if ! id "tiesse" &>/dev/null; then
        useradd -m -s /bin/bash tiesse || {
            log "ERROR: Failed to create user tiesse"
            exit 1
        }
        echo "tiesse:${USER_PASSWORD}" | chpasswd
        echo 'tiesse ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
        log "User tiesse created successfully"
    else
        log "User tiesse already exists"
    fi
}

# Install Python packages
install_python_packages() {
    log "Installing Python packages..."
    
    # Upgrade pip
    log "Upgrading pip..."
    python3 -m pip install --no-cache-dir --upgrade pip

    # Install base packages
    base_packages=("wheel" "setuptools")
    for package in "${base_packages[@]}"; do
        log "Installing base package: $package..."
        if ! pip3 install --no-cache-dir $package; then
            log "ERROR: Failed to install base package $package"
            exit 1
        fi
    done

    # Install critical packages
    critical_packages=("psutil")
    for package in "${critical_packages[@]}"; do
        log "Installing critical package: $package..."
        if ! pip3 install --no-cache-dir $package; then
            log "ERROR: Failed to install critical package $package"
            exit 1
        fi
    done

    # Install remaining packages with retry
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

    max_retries=3
    retry_count=0

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
            log "Python packages installed successfully"
            break
        else
            ((retry_count++))
            if [ $retry_count -eq $max_retries ]; then
                log "ERROR: Failed to install Python packages after $max_retries attempts"
                exit 1
            fi
            log "Retry $retry_count/$max_retries: Installing Python packages..."
            sleep 5
        fi
    done
}

# Setup database
setup_database() {
    log "Setting up database..."
    local db_dir="/app/data"
    
    mkdir -p "$db_dir"
    chown -R tiesse:tiesse "$db_dir"
    chmod 755 "$db_dir"

    if [ ! -f "$DB_PATH" ]; then
        log "Initializing new database..."
        sqlite3 "$DB_PATH" <<EOF
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA mmap_size=30000000000;
.databases
EOF
        if [ $? -ne 0 ]; then
            log "ERROR: Failed to initialize database"
            exit 1
        fi
    fi

    chown tiesse:tiesse "$DB_PATH"
    chmod 644 "$DB_PATH"
    log "Database setup completed"
}

# Verify directories and files
verify_files_and_dirs() {
    log "Verifying directories and files..."
    
    # Create directories
    dirs=(
        "/app/templates"
        "/app/static/js"
        "/app/static/css"
        "/app/data"
    )
    
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
    
    log "All files and directories verified successfully"
}

# Start services
start_services() {
    log "Starting services..."
    
    # Start SSH
    if /usr/sbin/sshd; then
        log "SSH service started successfully"
    else
        log "ERROR: Failed to start SSH service"
        exit 1
    fi
}

# Start Flask application
start_flask() {
    log "Starting Flask application..."
    cd ${APP_DIR} || {
        log "ERROR: Failed to change to ${APP_DIR} directory"
        exit 1
    }

    # Verify Python files
    python3 -m py_compile monitor.py database.py || {
        log "ERROR: Python syntax check failed"
        exit 1
    }

    # Set environment variables
    export FLASK_APP=monitor.py
    export FLASK_ENV=production
    export PYTHONUNBUFFERED=1
    export PYTHONDONTWRITEBYTECODE=1

    # Start Flask
    exec python3 monitor.py
}

# Main execution sequence
main() {
    log "Starting initialization sequence..."
    
    check_system_resources
    verify_nfs_mount
    setup_timezone
    install_dependencies
    configure_ssh
    create_user
    install_python_packages
    verify_files_and_dirs
    setup_database
    start_services
    start_flask
}

# Execute main with error handling
{
    main
} || {
    log "ERROR: Initialization failed"
    exit 1
}