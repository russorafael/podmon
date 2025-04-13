#!/usr/bin/env python3
# Nome: monitor.py
# Função: Script principal de monitoramento e servidor web
# Versão: 2.0.0
# Última atualização: 2025-04-13
# Autor: russorafael

import os
import json
import time
import yaml
import smtplib
import requests
import threading
import subprocess
import sqlite3
import logging
import hashlib
import socket
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session
from kubernetes import client, config
from apscheduler.schedulers.background import BackgroundScheduler
from logging.handlers import RotatingFileHandler

# Configurar diretórios
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')
CACHE_DIR = os.path.join(BASE_DIR, 'cache')
DB_FILE = os.path.join(BASE_DIR, 'history.db')
LOG_FILE = os.path.join(BASE_DIR, 'podmon.log')

# Criar diretórios se não existirem
os.makedirs(CACHE_DIR, exist_ok=True)

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        RotatingFileHandler(LOG_FILE, maxBytes=10485760, backupCount=5),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('podmon')

# Configuração padrão atualizada
DEFAULT_CONFIG = {
    "email": {
        "enabled": False,
        "smtp_server": "smtp.example.com",
        "port": 587,
        "username": "",
        "password": "",
        "from_email": "podmon@example.com",
        "recipients": []
    },
    "whatsapp": {
        "enabled": False,
        "api_url": "http://localhost:8000/send",
        "api_token": "",
        "recipients": []
    },
    "monitoring": {
        "namespaces": ["default", "monitoring"],
        "check_interval_minutes": 10,
        "alert_hours": [8, 12, 18],
        "check_images": True,
        "check_status": True,
        "monitor_all_namespaces": True,
        "monitor_nodes": True,
        "history_days": 30,
        "admin_password": "tiesseadm",
        "auto_refresh_interval": 600,
        "retention_days": 7
    }
}

# Funções auxiliares para formatação de recursos
def format_resource_value(value, resource_type):
    try:
        if resource_type == 'memory':
            if 'Ki' in str(value):
                return f"{float(value.replace('Ki', '')) / (1024 * 1024):.2f} GB"
            elif 'Mi' in str(value):
                return f"{float(value.replace('Mi', '')) / 1024:.2f} GB"
            elif 'Gi' in str(value):
                return f"{float(value.replace('Gi', '')):.2f} GB"
            return f"{value} B"
        elif resource_type == 'cpu':
            if str(value).isdigit():
                return f"{int(value)/1000:.2f} cores"
            return value
        return value
    except:
        return value

def get_pod_ports(pod):
    ports = []
    try:
        for container in pod.spec.containers:
            if container.ports:
                for port in container.ports:
                    port_info = {
                        "container": container.name,
                        "port": port.container_port,
                        "protocol": port.protocol if hasattr(port, 'protocol') else 'TCP',
                        "host_port": port.host_port if hasattr(port, 'host_port') else None
                    }
                    ports.append(port_info)
    except Exception as e:
        logger.error(f"Erro ao obter portas do pod: {e}")
    return ports

def get_pod_ips(pod):
    ips = {
        "internal": None,
        "external": None
    }
    try:
        if pod.status.pod_ip:
            ips["internal"] = pod.status.pod_ip
        if pod.status.host_ip:
            ips["external"] = pod.status.host_ip
    except Exception as e:
        logger.error(f"Erro ao obter IPs do pod: {e}")
    return ips

def get_pod_resources(pod):
    resources = {
        "cpu": {"request": "N/A", "limit": "N/A", "usage": "N/A"},
        "memory": {"request": "N/A", "limit": "N/A", "usage": "N/A"},
        "disk": {"usage": "N/A"}
    }
    
    try:
        for container in pod.spec.containers:
            if container.resources:
                if container.resources.requests:
                    cpu_request = container.resources.requests.get('cpu', "N/A")
                    mem_request = container.resources.requests.get('memory', "N/A")
                    resources["cpu"]["request"] = format_resource_value(cpu_request, 'cpu')
                    resources["memory"]["request"] = format_resource_value(mem_request, 'memory')
                
                if container.resources.limits:
                    cpu_limit = container.resources.limits.get('cpu', "N/A")
                    mem_limit = container.resources.limits.get('memory', "N/A")
                    resources["cpu"]["limit"] = format_resource_value(cpu_limit, 'cpu')
                    resources["memory"]["limit"] = format_resource_value(mem_limit, 'memory')
    except Exception as e:
        logger.error(f"Erro ao obter recursos do pod: {e}")
    
    return resources

def get_pod_restart_info(pod):
    restart_info = {
        "total_restarts": 0,
        "last_restart": None,
        "containers": {}
    }
    
    try:
        for container_status in pod.status.container_statuses:
            restart_info["total_restarts"] += container_status.restart_count
            restart_info["containers"][container_status.name] = {
                "restarts": container_status.restart_count,
                "last_state": container_status.last_state.to_dict() if container_status.last_state else None,
                "ready": container_status.ready,
                "started": container_status.started if hasattr(container_status, 'started') else None
            }
            
            if container_status.last_state and container_status.last_state.terminated:
                last_restart = container_status.last_state.terminated.finished_at
                if last_restart and (not restart_info["last_restart"] or last_restart > restart_info["last_restart"]):
                    restart_info["last_restart"] = last_restart
    except Exception as e:
        logger.error(f"Erro ao obter informações de reinicialização: {e}")
    
    return restart_info

# Inicializar banco de dados
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Tabela para histórico de pods
    c.execute('''
    CREATE TABLE IF NOT EXISTS pod_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        namespace TEXT,
        pod_name TEXT,
        images TEXT,
        status TEXT,
        event_type TEXT
    )
    ''')
    
    # Tabela para histórico de nós
    c.execute('''
    CREATE TABLE IF NOT EXISTS node_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        node_name TEXT,
        status TEXT,
        cpu TEXT,
        memory TEXT,
        pods_count INTEGER,
        event_type TEXT
    )
    ''')
    
    # Tabela para recursos dos pods
    c.execute('''
    CREATE TABLE IF NOT EXISTS pod_resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        namespace TEXT,
        pod_name TEXT,
        cpu_usage TEXT,
        memory_usage TEXT,
        disk_usage TEXT
    )
    ''')
    
    # Tabela para portas
    c.execute('''
    CREATE TABLE IF NOT EXISTS pod_ports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pod_name TEXT,
        namespace TEXT,
        port INTEGER,
        protocol TEXT,
        target_port INTEGER
    )
    ''')
    
    conn.commit()
    conn.close()

# Carregar ou criar configuração
def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    else:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        return DEFAULT_CONFIG

# Salvar configuração
def save_config(config_data):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config_data, f, indent=2)



# Função para obter estado atual dos pods
def get_pods_state(namespaces):
    try:
        try:
            config.load_incluster_config()
        except:
            config.load_kube_config()
        
        v1 = client.CoreV1Api()
        pods_state = {}
        
        for namespace in namespaces:
            pods = v1.list_namespaced_pod(namespace)
            for pod in pods.items:
                pod_name = pod.metadata.name
                pod_images = [container.image for container in pod.spec.containers]
                pod_status = pod.status.phase
                
                # Obter informações detalhadas
                pod_ports = get_pod_ports(pod)
                pod_ips = get_pod_ips(pod)
                pod_resources = get_pod_resources(pod)
                restart_info = get_pod_restart_info(pod)
                
                # Verificar idade do pod
                creation_time = pod.metadata.creation_timestamp
                age = (datetime.now(creation_time.tzinfo) - creation_time).days
                is_new = age <= 7
                
                pods_state[f"{namespace}/{pod_name}"] = {
                    "images": pod_images,
                    "status": pod_status,
                    "last_check": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "ports": pod_ports,
                    "ips": pod_ips,
                    "resources": pod_resources,
                    "restart_info": restart_info,
                    "node": pod.spec.node_name,
                    "creation_time": creation_time.strftime("%Y-%m-%d %H:%M:%S"),
                    "is_new": is_new,
                    "age_days": age
                }
        
        return pods_state
    except Exception as e:
        logger.error(f"Erro ao obter estado dos pods: {e}")
        return {}

# Função para obter estado dos nós
def get_nodes_state():
    try:
        try:
            config.load_incluster_config()
        except:
            config.load_kube_config()
        
        v1 = client.CoreV1Api()
        nodes = v1.list_node()
        
        nodes_state = {}
        for node in nodes.items:
            node_name = node.metadata.name
            status = "Ready"
            
            for condition in node.status.conditions:
                if condition.type == "Ready":
                    status = "Ready" if condition.status == "True" else "NotReady"
                    break
            
            allocatable_cpu = node.status.allocatable.get('cpu', '0')
            allocatable_memory = node.status.allocatable.get('memory', '0')
            
            field_selector = f"spec.nodeName={node_name}"
            pods = v1.list_pod_for_all_namespaces(field_selector=field_selector)
            
            nodes_state[node_name] = {
                "status": status,
                "cpu": format_resource_value(allocatable_cpu, 'cpu'),
                "memory": format_resource_value(allocatable_memory, 'memory'),
                "pods_count": len(pods.items),
                "last_check": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
        
        return nodes_state
    except Exception as e:
        logger.error(f"Erro ao obter estado dos nós: {e}")
        return {}

# Função para limpeza de dados antigos
def cleanup_old_data():
    try:
        retention_days = config_data["monitoring"].get("retention_days", 7)
        cutoff_date = (datetime.now() - timedelta(days=retention_days)).strftime("%Y-%m-%d %H:%M:%S")
        
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        
        # Limpar históricos
        tables = ['pod_history', 'node_history', 'pod_resources', 'pod_ports']
        for table in tables:
            c.execute(f"DELETE FROM {table} WHERE timestamp < ?", (cutoff_date,))
        
        conn.commit()
        conn.close()
        
        logger.info(f"Dados anteriores a {cutoff_date} foram removidos")
    except Exception as e:
        logger.error(f"Erro na limpeza de dados antigos: {e}")

# Função para reiniciar pod
def restart_pod(namespace, pod_name, password):
    if password != config_data["monitoring"]["admin_password"]:
        logger.warning(f"Tentativa de reinício com senha incorreta para {namespace}/{pod_name}")
        return False, "Senha incorreta"
    
    try:
        try:
            config.load_incluster_config()
        except:
            config.load_kube_config()
        
        v1 = client.CoreV1Api()
        
        v1.delete_namespaced_pod(
            name=pod_name,
            namespace=namespace,
            body=client.V1DeleteOptions()
        )
        
        store_pod_history(
            namespace=namespace,
            pod_name=pod_name,
            images=[],
            status="Restarting",
            event_type="manual_restart"
        )
        
        logger.info(f"Pod {namespace}/{pod_name} reiniciado manualmente")
        return True, "Pod reiniciado com sucesso"
    except Exception as e:
        logger.error(f"Erro ao reiniciar pod {namespace}/{pod_name}: {e}")
        return False, f"Erro ao reiniciar pod: {e}"

# Função para armazenar histórico de pods
def store_pod_history(namespace, pod_name, images, status, event_type):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    c.execute(
        "INSERT INTO pod_history (timestamp, namespace, pod_name, images, status, event_type) VALUES (?, ?, ?, ?, ?, ?)",
        (timestamp, namespace, pod_name, json.dumps(images), status, event_type)
    )
    
    conn.commit()
    conn.close()

# Função para armazenar histórico de nós
def store_node_history(node_name, status, cpu, memory, pods_count, event_type):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    c.execute(
        "INSERT INTO node_history (timestamp, node_name, status, cpu, memory, pods_count, event_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (timestamp, node_name, status, cpu, memory, pods_count, event_type)
    )
    
    conn.commit()
    conn.close()

# Função para detectar mudanças
def detect_changes(namespaces):
    logger.info(f"Verificando mudanças em {namespaces}...")
    cache_file = os.path.join(CACHE_DIR, 'pods_state.json')
    current_state = get_pods_state(namespaces)
    
    changes = []
    
    if os.path.exists(cache_file):
        with open(cache_file, 'r') as f:
            previous_state = json.load(f)
        
        for pod_key, current_pod in current_state.items():
            namespace, pod_name = pod_key.split('/')
            
            if pod_key in previous_state:
                prev_pod = previous_state[pod_key]
                
                if config_data["monitoring"]["check_images"] and current_pod["images"] != prev_pod["images"]:
                    changes.append(f"Image changed in pod {pod_key}: {prev_pod['images']} → {current_pod['images']}")
                    store_pod_history(namespace, pod_name, current_pod["images"], current_pod["status"], "image_change")
                
                if config_data["monitoring"]["check_status"] and current_pod["status"] != prev_pod["status"]:
                    changes.append(f"Status changed in pod {pod_key}: {prev_pod['status']} → {current_pod['status']}")
                    store_pod_history(namespace, pod_name, current_pod["images"], current_pod["status"], "status_change")
            else:
                changes.append(f"New pod detected: {pod_key} with status {current_pod['status']}")
                store_pod_history(namespace, pod_name, current_pod["images"], current_pod["status"], "new_pod")
        
        for pod_key in previous_state:
            if pod_key not in current_state:
                namespace, pod_name = pod_key.split('/')
                changes.append(f"Pod removed: {pod_key}")
                store_pod_history(namespace, pod_name, previous_state[pod_key]["images"], "Removed", "pod_removed")
    else:
        for pod_key, pod_info in current_state.items():
            namespace, pod_name = pod_key.split('/')
            store_pod_history(namespace, pod_name, pod_info["images"], pod_info["status"], "initial_check")
    
    if config_data["monitoring"].get("monitor_nodes", False):
        nodes_cache_file = os.path.join(CACHE_DIR, 'nodes_state.json')
        current_nodes = get_nodes_state()
        
        if os.path.exists(nodes_cache_file):
            with open(nodes_cache_file, 'r') as f:
                previous_nodes = json.load(f)
            
            for node_name, current_node in current_nodes.items():
                if node_name in previous_nodes:
                    prev_node = previous_nodes[node_name]
                    
                    if current_node["status"] != prev_node["status"]:
                        changes.append(f"Node status changed: {node_name}: {prev_node['status']} → {current_node['status']}")
                        store_node_history(
                            node_name, current_node["status"], current_node["cpu"], 
                            current_node["memory"], current_node["pods_count"], "status_change"
                        )
                else:
                    changes.append(f"New node detected: {node_name}")
                    store_node_history(
                        node_name, current_node["status"], current_node["cpu"], 
                        current_node["memory"], current_node["pods_count"], "new_node"
                    )
            
            for node_name in previous_nodes:
                if node_name not in current_nodes:
                    changes.append(f"Node removed: {node_name}")
                    store_node_history(
                        node_name, "Removed", previous_nodes[node_name]["cpu"], 
                        previous_nodes[node_name]["memory"], 0, "node_removed"
                    )
        
        with open(nodes_cache_file, 'w') as f:
            json.dump(current_nodes, f, indent=2)
    
    with open(cache_file, 'w') as f:
        json.dump(current_state, f, indent=2)
    
    return changes

# Funções de envio de alertas
def send_email(subject, message):
    if not config_data["email"]["enabled"] or not config_data["email"]["recipients"]:
        logger.info("Email sending disabled or no recipients configured")
        return False
    
    try:
        msg = MIMEMultipart()
        msg['From'] = config_data["email"]["from_email"]
        msg['To'] = ", ".join(config_data["email"]["recipients"])
        msg['Subject'] = subject
        
        msg.attach(MIMEText(message, 'plain'))
        
        server = smtplib.SMTP(config_data["email"]["smtp_server"], config_data["email"]["port"])
        server.starttls()
        
        if config_data["email"]["username"] and config_data["email"]["password"]:
            server.login(config_data["email"]["username"], config_data["email"]["password"])
        
        server.send_message(msg)
        server.quit()
        logger.info(f"Email sent to {msg['To']}")
        return True
    except Exception as e:
        logger.error(f"Error sending email: {e}")
        return False

def send_whatsapp(message):
    if not config_data["whatsapp"]["enabled"] or not config_data["whatsapp"]["recipients"]:
        logger.info("WhatsApp sending disabled or no recipients configured")
        return False
    
    try:
        for recipient in config_data["whatsapp"]["recipients"]:
            payload = {
                "phone": recipient,
                "message": message,
                "token": config_data["whatsapp"]["api_token"]
            }
            
            response = requests.post(config_data["whatsapp"]["api_url"], json=payload)
            
            if response.status_code == 200:
                logger.info(f"WhatsApp sent to {recipient}")
            else:
                logger.error(f"Error sending WhatsApp to {recipient}: {response.text}")
        
        return True
    except Exception as e:
        logger.error(f"Error sending WhatsApp: {e}")
        return False

def check_and_alert():
    try:
        current_hour = datetime.now().hour
        logger.info(f"Starting scheduled check at {current_hour}h")
        
        if current_hour not in config_data["monitoring"]["alert_hours"]:
            logger.debug(f"Not an alert hour ({current_hour}h)")
            return
        
        namespaces = config_data["monitoring"]["namespaces"]
        changes = detect_changes(namespaces)
        
        if changes:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            subject = f"[PODMON] Changes detected in {len(changes)} pods - {timestamp}"
            
            message = f"Kubernetes Monitoring - {timestamp}\n\n"
            message += "The following changes were detected:\n\n"
            message += "\n".join(changes)
            message += "\n\nThis is an automated message from the PodMon monitoring system."
            
            if config_data["email"]["enabled"]:
                send_email(subject, message)
            
            if config_data["whatsapp"]["enabled"]:
                send_whatsapp(message)
    except Exception as e:
        logger.error(f"Error during scheduled check: {e}")

# Configurar aplicação Flask
app = Flask(__name__)

# [Todas as rotas da API aqui - já enviadas anteriormente]
# Para manter o código organizado, as rotas da API permanecem as mesmas que enviei anteriormente

# Inicialização principal
if __name__ == '__main__':
    try:
        logger.info("Starting PodMon service")
        
        # Inicializar banco de dados
        init_db()
        logger.info("Database initialized")
        
        # Carregar configuração
        config_data = load_config()
        logger.info("Configuration loaded")
        
        # Configurar e iniciar agendador
        scheduler = BackgroundScheduler()
        
        # Job principal de monitoramento
        scheduler.add_job(
            check_and_alert,
            'interval',
            minutes=config_data["monitoring"].get("check_interval_minutes", 10),
            id='monitoring_job'
        )
        
        # Job de limpeza diária
        scheduler.add_job(
            cleanup_old_data,
            'cron',
            hour=0,
            minute=0,
            id='cleanup_job'
        )
        
        scheduler.start()
        logger.info("Scheduler started")
        
        # Executar verificação inicial em thread separada
        threading.Thread(target=check_and_alert).start()
        logger.info("Initial check started")
        
        # Configurar Flask
        app.secret_key = os.urandom(24)
        
        # Iniciar servidor web
        logger.info("Starting web server on port 5000")
        app.run(
            host='0.0.0.0',
            port=5000,
            threaded=True
        )
    except Exception as e:
        logger.error(f"Fatal error during initialization: {e}")
        raise
    finally:
        if 'scheduler' in locals():
            scheduler.shutdown()
            logger.info("Scheduler shutdown complete")