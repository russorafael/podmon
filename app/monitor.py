#!/usr/bin/env python3
# Nome: monitor.py
# Função: Script principal de monitoramento e servidor web
# Versão: 1.1.0

import os
import json
import time
import yaml
import smtplib
import requests
import threading
import subprocess
import sqlite3
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify
from kubernetes import client, config
from apscheduler.schedulers.background import BackgroundScheduler

# Configurar diretórios
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')
CACHE_DIR = os.path.join(BASE_DIR, 'cache')
DB_FILE = os.path.join(BASE_DIR, 'history.db')

# Criar diretórios se não existirem
os.makedirs(CACHE_DIR, exist_ok=True)

# Configuração padrão
DEFAULT_CONFIG = {
    "email": {
        "enabled": False,
        "smtp_server": "smtp.example.com",
        "port": 587,
        "username": "",
        "password": "",
        "from_email": "falco@example.com",
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
        "check_interval_minutes": 15,
        "alert_hours": [8, 12, 18],
        "check_images": True,
        "check_status": True,
        "monitor_all_namespaces": True,  # Alterado para True
        "monitor_nodes": True,  # Alterado para True
        "history_days": 30
    }
}

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
        # Tentar carregar configuração in-cluster
        try:
            config.load_incluster_config()
        except:
            # Fallback para configuração local
            config.load_kube_config()
        
        v1 = client.CoreV1Api()
        pods_state = {}
        
        for namespace in namespaces:
            pods = v1.list_namespaced_pod(namespace)
            for pod in pods.items:
                pod_name = pod.metadata.name
                pod_images = [container.image for container in pod.spec.containers]
                pod_status = pod.status.phase
                
                pods_state[f"{namespace}/{pod_name}"] = {
                    "images": pod_images,
                    "status": pod_status,
                    "last_check": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
        
        return pods_state
    except Exception as e:
        print(f"Erro ao obter estado dos pods: {e}")
        return {}

# Adicionar função para obter estado dos nós
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
            
            # Obter métricas de CPU e memória
            allocatable_cpu = node.status.allocatable.get('cpu', '0')
            allocatable_memory = node.status.allocatable.get('memory', '0')
            
            # Contar pods no nó
            field_selector = f"spec.nodeName={node_name}"
            pods = v1.list_pod_for_all_namespaces(field_selector=field_selector)
            
            nodes_state[node_name] = {
                "status": status,
                "cpu": allocatable_cpu,
                "memory": allocatable_memory,
                "pods_count": len(pods.items),
                "last_check": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
        
        return nodes_state
    except Exception as e:
        print(f"Erro ao obter estado dos nós: {e}")
        return {}

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
    print(f"Verificando mudanças em {namespaces}...")
    cache_file = os.path.join(CACHE_DIR, 'pods_state.json')
    current_state = get_pods_state(namespaces)
    
    changes = []
    
    # Carregar estado anterior
    if os.path.exists(cache_file):
        with open(cache_file, 'r') as f:
            previous_state = json.load(f)
            
        # Detectar mudanças em pods existentes
        for pod_key, current_pod in current_state.items():
            namespace, pod_name = pod_key.split('/')
            
            if pod_key in previous_state:
                prev_pod = previous_state[pod_key]
                
                # Verificar mudanças de imagem
                if config_data["monitoring"]["check_images"] and current_pod["images"] != prev_pod["images"]:
                    changes.append(f"Imagem alterada no pod {pod_key}: {prev_pod['images']} → {current_pod['images']}")
                    store_pod_history(namespace, pod_name, current_pod["images"], current_pod["status"], "image_change")
                
                # Verificar mudanças de status
                if config_data["monitoring"]["check_status"] and current_pod["status"] != prev_pod["status"]:
                    changes.append(f"Status alterado no pod {pod_key}: {prev_pod['status']} → {current_pod['status']}")
                    store_pod_history(namespace, pod_name, current_pod["images"], current_pod["status"], "status_change")
            else:
                # Novo pod
                changes.append(f"Novo pod detectado: {pod_key} com status {current_pod['status']}")
                store_pod_history(namespace, pod_name, current_pod["images"], current_pod["status"], "new_pod")
        
        # Detectar pods removidos
        for pod_key in previous_state:
            if pod_key not in current_state:
                namespace, pod_name = pod_key.split('/')
                changes.append(f"Pod removido: {pod_key}")
                store_pod_history(namespace, pod_name, previous_state[pod_key]["images"], "Removed", "pod_removed")
    else:
        # Primeira execução, registrar todos os pods
        for pod_key, pod_info in current_state.items():
            namespace, pod_name = pod_key.split('/')
            store_pod_history(namespace, pod_name, pod_info["images"], pod_info["status"], "check")
    
    # Verificar nós se configurado para isso
    if config_data["monitoring"].get("monitor_nodes", False):
        nodes_cache_file = os.path.join(CACHE_DIR, 'nodes_state.json')
        current_nodes = get_nodes_state()
        
        if os.path.exists(nodes_cache_file):
            with open(nodes_cache_file, 'r') as f:
                previous_nodes = json.load(f)
                
            # Verificar mudanças em nós
            for node_name, current_node in current_nodes.items():
                if node_name in previous_nodes:
                    prev_node = previous_nodes[node_name]
                    
                    # Verificar mudança de status
                    if current_node["status"] != prev_node["status"]:
                        changes.append(f"Status do nó alterado: {node_name}: {prev_node['status']} → {current_node['status']}")
                        store_node_history(
                            node_name, current_node["status"], current_node["cpu"], 
                            current_node["memory"], current_node["pods_count"], "status_change"
                        )
                else:
                    # Novo nó
                    changes.append(f"Novo nó detectado: {node_name}")
                    store_node_history(
                        node_name, current_node["status"], current_node["cpu"], 
                        current_node["memory"], current_node["pods_count"], "new_node"
                    )
                    
            # Detectar nós removidos
            for node_name in previous_nodes:
                if node_name not in current_nodes:
                    changes.append(f"Nó removido: {node_name}")
                    store_node_history(
                        node_name, "Removed", previous_nodes[node_name]["cpu"], 
                        previous_nodes[node_name]["memory"], 0, "node_removed"
                    )
        else:
            # Primeira execução para nós
            for node_name, node_info in current_nodes.items():
                store_node_history(
                    node_name, node_info["status"], node_info["cpu"], 
                    node_info["memory"], node_info["pods_count"], "check"
                )
            
        # Salvar estado atual dos nós
        with open(nodes_cache_file, 'w') as f:
            json.dump(current_nodes, f, indent=2)
    
    # Salvar estado atual dos pods
    with open(cache_file, 'w') as f:
        json.dump(current_state, f, indent=2)
    
    return changes

# Função para enviar e-mail
def send_email(subject, message):
    if not config_data["email"]["enabled"] or not config_data["email"]["recipients"]:
        print("Envio de e-mail desativado ou sem destinatários configurados")
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
        print(f"E-mail enviado para {msg['To']}")
        return True
    except Exception as e:
        print(f"Erro ao enviar e-mail: {e}")
        return False

# Função para enviar mensagem WhatsApp
def send_whatsapp(message):
    if not config_data["whatsapp"]["enabled"] or not config_data["whatsapp"]["recipients"]:
        print("Envio de WhatsApp desativado ou sem destinatários configurados")
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
                print(f"WhatsApp enviado para {recipient}")
            else:
                print(f"Erro ao enviar WhatsApp para {recipient}: {response.text}")
        
        return True
    except Exception as e:
        print(f"Erro ao enviar WhatsApp: {e}")
        return False

# Função para verificação e envio de alertas
def check_and_alert():
    current_hour = datetime.now().hour
    
    # Verificar se deve enviar alerta neste horário
    if current_hour not in config_data["monitoring"]["alert_hours"]:
        print(f"Não é horário de alerta ({current_hour}h)")
        return
    
    namespaces = config_data["monitoring"]["namespaces"]
    changes = detect_changes(namespaces)
    
    if changes:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        subject = f"[FALCO] Alterações detectadas em {len(changes)} pods - {timestamp}"
        
        message = f"Monitoramento Kubernetes - {timestamp}\n\n"
        message += "As seguintes alterações foram detectadas:\n\n"
        message += "\n".join(changes)
        message += "\n\nEste é um e-mail automático do sistema de monitoramento Falco."
        
        if config_data["email"]["enabled"]:
            send_email(subject, message)
        
        if config_data["whatsapp"]["enabled"]:
            send_whatsapp(message)

# Configurar aplicação Flask
app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html', config=config_data)

@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify(config_data)

@app.route('/api/config', methods=['POST'])
def update_config():
    global config_data
    config_data = request.json
    save_config(config_data)
    return jsonify({"status": "success"})

@app.route('/api/check-now', methods=['POST'])
def check_now():
    namespaces = config_data["monitoring"]["namespaces"]
    changes = detect_changes(namespaces)
    
    return jsonify({
        "status": "success",
        "changes": changes,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })

@app.route('/api/test-email', methods=['POST'])
def test_email():
    success = send_email(
        "[FALCO] Teste de configuração de e-mail",
        "Este é um e-mail de teste do sistema de monitoramento Falco."
    )
    
    return jsonify({
        "status": "success" if success else "error",
        "message": "E-mail enviado com sucesso" if success else "Falha ao enviar e-mail"
    })

@app.route('/api/test-whatsapp', methods=['POST'])
def test_whatsapp():
    success = send_whatsapp("Teste de configuração do sistema de monitoramento Falco.")
    
    return jsonify({
        "status": "success" if success else "error",
        "message": "WhatsApp enviado com sucesso" if success else "Falha ao enviar WhatsApp"
    })

@app.route('/api/namespaces', methods=['GET'])
def get_namespaces():
    try:
        try:
            config.load_incluster_config()
        except:
            config.load_kube_config()
        
        v1 = client.CoreV1Api()
        namespaces = v1.list_namespace()
        namespace_list = [ns.metadata.name for ns in namespaces.items]
        
        return jsonify({
            "status": "success",
            "namespaces": namespace_list
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        })

@app.route('/api/current-state', methods=['GET'])
def get_current_state():
    try:
        namespaces = config_data["monitoring"]["namespaces"]
        if config_data["monitoring"].get("monitor_all_namespaces", False):
            try:
                config.load_incluster_config()
            except:
                config.load_kube_config()
            
            v1 = client.CoreV1Api()
            ns_list = v1.list_namespace()
            namespaces = [ns.metadata.name for ns in ns_list.items]
        
        pods_state = get_pods_state(namespaces)
        nodes_state = get_nodes_state() if config_data["monitoring"].get("monitor_nodes", False) else {}
        
        return jsonify({
            "status": "success",
            "pods": pods_state,
            "nodes": nodes_state
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        })

@app.route('/api/pod-history', methods=['GET'])
def get_pod_history():
    try:
        namespace = request.args.get('namespace')
        pod_name = request.args.get('pod_name')
        status = request.args.get('status')
        event_type = request.args.get('event_type')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        query = "SELECT * FROM pod_history WHERE 1=1"
        params = []
        
        if namespace:
            query += " AND namespace = ?"
            params.append(namespace)
        
        if pod_name:
            query += " AND pod_name LIKE ?"
            params.append(f"%{pod_name}%")
        
        if status:
            query += " AND status = ?"
            params.append(status)
        
        if event_type:
            query += " AND event_type = ?"
            params.append(event_type)
        
        if start_date:
            query += " AND timestamp >= ?"
            params.append(start_date)
        
        if end_date:
            query += " AND timestamp <= ?"
            params.append(end_date)
        
        query += " ORDER BY timestamp DESC LIMIT 1000"
        
        c.execute(query, params)
        results = c.fetchall()
        
        history = []
        for row in results:
            history.append({
                "timestamp": row['timestamp'],
                "namespace": row['namespace'],
                "pod_name": row['pod_name'],
                "images": json.loads(row['images']),
                "status": row['status'],
                "event_type": row['event_type']
            })
        
        conn.close()
        
        return jsonify({
            "status": "success",
            "history": history
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        })

@app.route('/api/node-history', methods=['GET'])
def get_node_history():
    try:
        node_name = request.args.get('node_name')
        status = request.args.get('status')
        event_type = request.args.get('event_type')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        query = "SELECT * FROM node_history WHERE 1=1"
        params = []
        
        if node_name:
            query += " AND node_name LIKE ?"
            params.append(f"%{node_name}%")
        
        if status:
            query += " AND status = ?"
            params.append(status)
        
        if event_type:
            query += " AND event_type = ?"
            params.append(event_type)
        
        if start_date:
            query += " AND timestamp >= ?"
            params.append(start_date)
        
        if end_date:
            query += " AND timestamp <= ?"
            params.append(end_date)
        
        query += " ORDER BY timestamp DESC LIMIT 1000"
        
        c.execute(query, params)
        results = c.fetchall()
        
        history = []
        for row in results:
            history.append({
                "timestamp": row['timestamp'],
                "node_name": row['node_name'],
                "status": row['status'],
                "cpu": row['cpu'],
                "memory": row['memory'],
                "pods_count": row['pods_count'],
                "event_type": row['event_type']
            })
        
        conn.close()
        
        return jsonify({
            "status": "success",
            "history": history
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        })

@app.route('/api/logs/<namespace>/<pod>', methods=['GET'])
def get_pod_logs(namespace, pod):
    try:
        container = request.args.get('container')
        tail_lines = int(request.args.get('tail_lines', '100'))
        
        try:
            config.load_incluster_config()
        except:
            config.load_kube_config()
        
        v1 = client.CoreV1Api()
        
        if container:
            logs = v1.read_namespaced_pod_log(
                name=pod,
                namespace=namespace,
                container=container,
                tail_lines=tail_lines
            )
        else:
            logs = v1.read_namespaced_pod_log(
                name=pod,
                namespace=namespace,
                tail_lines=tail_lines
            )
        
        # Dividir logs em linhas
        log_lines = logs.split('\n')
        
        return jsonify({
            "status": "success",
            "logs": log_lines
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        })

# Inicializar a configuração
config_data = load_config()

# 

# Configurar agendador
scheduler = BackgroundScheduler()

# Obter o intervalo de configuração com um valor padrão
check_interval = 5  # Valor padrão de 5 minutos
try:
    if config_data and "monitoring" in config_data and "check_interval_minutes" in config_data["monitoring"]:
        check_interval = config_data["monitoring"]["check_interval_minutes"] or check_interval
except:
    pass  # Se qualquer erro ocorrer, mantenha o valor padrão

scheduler.add_job(
    check_and_alert,
    'interval',
    minutes=check_interval,
    id='monitoring_job'
)

# atividades recentes
@app.route('/api/recent-activities', methods=['GET'])
def get_recent_activities():
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        c.execute("""
            SELECT timestamp, namespace, pod_name, event_type
            FROM pod_history
            ORDER BY timestamp DESC
            LIMIT 20
        """)
        
        rows = c.fetchall()
        activities = []
        for row in rows:
            activities.append({
                "timestamp": row["timestamp"],
                "namespace": row["namespace"],
                "resource": row["pod_name"],
                "event": row["event_type"]
            })

        conn.close()
        
        return jsonify({
            "status": "success",
            "activities": activities
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        })




# Função principal
if __name__ == '__main__':
    # Inicializar banco de dados
    init_db()
    
    # Iniciar agendador
    scheduler.start()
    
    # Executar verificação inicial
    threading.Thread(target=check_and_alert).start()
    
    # Iniciar servidor web
    app.run(host='0.0.0.0', port=5000)
    
    
    