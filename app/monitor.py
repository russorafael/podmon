# Nome: monitor.py
# Função: Servidor web e lógica de monitoramento de pods
# Versão: 1.2.0

from flask import Flask, render_template, jsonify, request
from kubernetes import client, config
import os
import schedule
import time
import threading
import json
from datetime import datetime, timedelta
import pytz
import smtplib
import requests
import psutil
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/app/podmon.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'tiesseadm'

# Configuração do Kubernetes
try:
    config.load_incluster_config()
except config.ConfigException:
    try:
        config.load_kube_config()
    except Exception as e:
        logger.error(f"Erro ao carregar configuração do Kubernetes: {e}")
        raise

v1 = client.CoreV1Api()
apps_v1 = client.AppsV1Api()

class PodMonitor:
    def __init__(self):
        self.config_file = '/app/config.json'
        self.history_file = '/app/history.json'
        self.config = self.load_config()
        self.history = self.load_history()
        self.last_check = {}
        self.pod_states = {}
        self.setup_cleanup_schedule()

    def load_config(self):
        default_config = {
            'email': {
                'enabled': False,
                'smtp_server': 'localhost',
                'smtp_port': 25,
                'username': '',
                'password': '',
                'recipients': [],
                'schedule': []
            },
            'whatsapp': {
                'enabled': False,
                'api_url': '',
                'api_token': '',
                'recipients': [],
                'schedule': []
            },
            'monitoring': {
                'refresh_interval': 600,
                'history_retention_days': 7,
                'namespaces': ['default', 'monitoring'],
                'admin_password': 'tiesseadm',
                'alert_on_status_change': True,
                'alert_on_image_update': True
            }
        }

        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r') as f:
                    loaded_config = json.load(f)
                    # Merge com configurações padrão
                    for key in default_config:
                        if key not in loaded_config:
                            loaded_config[key] = default_config[key]
                    return loaded_config
            except Exception as e:
                logger.error(f"Erro ao carregar configuração: {e}")
                return default_config
        return default_config

    def save_config(self):
        try:
            with open(self.config_file, 'w') as f:
                json.dump(self.config, f, indent=4)
        except Exception as e:
            logger.error(f"Erro ao salvar configuração: {e}")

    def format_resources(self, value, unit):
        try:
            if unit == 'memory':
                if isinstance(value, str):
                    if 'Ki' in value:
                        value = int(value.replace('Ki', '')) * 1024
                    elif 'Mi' in value:
                        value = int(value.replace('Mi', '')) * 1024 * 1024
                    elif 'Gi' in value:
                        value = int(value.replace('Gi', '')) * 1024 * 1024 * 1024
                    else:
                        value = int(value)

                if value >= 1024 * 1024 * 1024:
                    return f"{value / (1024 * 1024 * 1024):.2f} GB"
                elif value >= 1024 * 1024:
                    return f"{value / (1024 * 1024):.2f} MB"
                elif value >= 1024:
                    return f"{value / 1024:.2f} KB"
                return f"{value} B"

            elif unit == 'cpu':
                if isinstance(value, str):
                    if 'm' in value:
                        value = int(value.replace('m', ''))
                    else:
                        value = int(float(value) * 1000)
                return f"{value}m CPU"

        except Exception as e:
            logger.error(f"Erro ao formatar recursos: {e}")
            return str(value)

    # Atualização da função get_pods_info no monitor.py
    def get_pod_ports(self, pod):
        ports_info = []
        try:
            # Verificar portas dos containers
            for container in pod.spec.containers:
                if container.ports:
                    for port in container.ports:
                        port_info = {
                            'port': port.container_port,
                            'protocol': port.protocol,
                            'name': port.name if hasattr(port, 'name') else '',
                            'host_port': port.host_port if hasattr(port, 'host_port') else None,
                            'is_exposed': False
                        }
                        ports_info.append(port_info)

                      # Verificar se as portas estão expostas via serviço
            services = v1.list_service_for_all_namespaces(
                field_selector=f'metadata.namespace={pod.metadata.namespace}'
            )
            
            for svc in services.items:
                if svc.spec.selector and all(
                    pod.metadata.labels.get(k) == v 
                    for k, v in svc.spec.selector.items()
                ):
                    for port in ports_info:
                        for svc_port in svc.spec.ports:
                            if svc_port.target_port == port['port']:
                                port['is_exposed'] = True
                                port['service_port'] = svc_port.port
                                port['service_name'] = svc.metadata.name
                                if svc.spec.type == 'LoadBalancer':
                                    port['load_balancer'] = True

            return ports_info
        except Exception as e:
            logger.error(f"Erro ao obter informações de portas: {e}")
            return []

    def check_pod_changes(self, pod_info):
        pod_key = f"{pod_info['namespace']}/{pod_info['name']}"
        current_time = datetime.now().isoformat()

        if pod_key in self.last_check:
            last_status = self.last_check[pod_key]['status']
            last_image = self.last_check[pod_key]['image']

            # Verificar mudanças de status
            if last_status != pod_info['status']:
                self.history['status_changes'].append({
                    'pod': pod_info['name'],
                    'namespace': pod_info['namespace'],
                    'timestamp': current_time,
                    'old_status': last_status,
                    'new_status': pod_info['status']
                })
                if self.config['monitoring']['alert_on_status_change']:
                    self.send_alert(
                        f"Pod Status Change: {pod_info['name']}",
                        f"Pod {pod_info['name']} in namespace {pod_info['namespace']} " \
                        f"changed from {last_status} to {pod_info['status']}"
                    )

            # Verificar mudanças de imagem
            if last_image != pod_info['image']:
                self.history['image_updates'].append({
                    'pod': pod_info['name'],
                    'namespace': pod_info['namespace'],
                    'timestamp': current_time,
                    'old_image': last_image,
                    'new_image': pod_info['image']
                })
                if self.config['monitoring']['alert_on_image_update']:
                    self.send_alert(
                        f"Pod Image Update: {pod_info['name']}",
                        f"Pod {pod_info['name']} in namespace {pod_info['namespace']} " \
                        f"updated from {last_image} to {pod_info['image']}"
                    )

        self.last_check[pod_key] = pod_info
        self.save_history()

    def send_alert(self, subject, message):
        if self.config['email']['enabled']:
            self.send_email_alert(subject, message)
        if self.config['whatsapp']['enabled']:
            self.send_whatsapp_alert(message)

    def send_email_alert(self, subject, message):
        try:
            msg = MIMEMultipart()
            msg['From'] = self.config['email']['username'] or 'podmon@localhost'
            msg['To'] = ', '.join(self.config['email']['recipients'])
            msg['Subject'] = subject

            msg.attach(MIMEText(message, 'plain'))

            with smtplib.SMTP(
                self.config['email']['smtp_server'],
                self.config['email']['smtp_port']
            ) as server:
                if self.config['email']['username'] and self.config['email']['password']:
                    server.login(
                        self.config['email']['username'],
                        self.config['email']['password']
                    )
                server.send_message(msg)
                logger.info(f"Email alert sent: {subject}")
        except Exception as e:
            logger.error(f"Erro ao enviar email: {e}")

    def send_whatsapp_alert(self, message):
        if not self.config['whatsapp']['enabled']:
            return

        try:
            for recipient in self.config['whatsapp']['recipients']:
                response = requests.post(
                    self.config['whatsapp']['api_url'],
                    headers={'Authorization': f"Bearer {self.config['whatsapp']['api_token']}"},
                    json={
                        'phone': recipient,
                        'message': message
                    }
                )
                if response.status_code == 200:
                    logger.info(f"WhatsApp alert sent to {recipient}")
                else:
                    logger.error(f"Erro ao enviar WhatsApp: {response.status_code}")
        except Exception as e:
            logger.error(f"Erro ao enviar WhatsApp: {e}")

    def cleanup_old_data(self):
        try:
            retention_days = self.config['monitoring']['history_retention_days']
            cutoff_date = datetime.now() - timedelta(days=retention_days)
            
            for key in ['status_changes', 'image_updates']:
                self.history[key] = [
                    item for item in self.history[key]
                    if datetime.fromisoformat(item['timestamp']) > cutoff_date
                ]
            
            self.save_history()
            logger.info("Limpeza de dados antigos concluída")
        except Exception as e:
            logger.error(f"Erro na limpeza de dados: {e}")

    def setup_cleanup_schedule(self):
        schedule.every().day.at("00:00").do(self.cleanup_old_data)

# Continuação do arquivo monitor.py...

    def get_pods_info(self):
        pods_info = []
        try:
            pods = v1.list_pod_for_all_namespaces(watch=False)
            now = datetime.now(pytz.UTC)

            for pod in pods.items:
                # Verificar se namespace está sendo monitorado
                if pod.metadata.namespace not in self.config['monitoring']['namespaces']:
                    continue

                # Calcular idade do pod
                creation_time = pod.metadata.creation_timestamp
                age = now - creation_time
                is_new = age.days < 7

                # Informações do pod
                pod_info = {
                    'name': pod.metadata.name,
                    'namespace': pod.metadata.namespace,
                    'status': pod.status.phase,
                    'node': pod.spec.node_name,
                    'creation_time': creation_time.isoformat(),
                    'age_days': age.days,
                    'is_new': is_new,
                    'is_local': 'local' in pod.metadata.name.lower(),
                    'image': pod.spec.containers[0].image if pod.spec.containers else '',
                    'image_updated': False,  # Será atualizado pelo histórico
                    'ports': self.get_pod_ports(pod),
                    'ips': {
                        'internal': pod.status.pod_ip or '',
                        'external': ''
                    },
                    'resources': {
                        'cpu': '0',
                        'memory': '0',
                        'disk': '0'
                    }
                }

                # Verificar serviços para IP externo
                services = v1.list_service_for_all_namespaces(
                    field_selector=f'metadata.namespace={pod.metadata.namespace}'
                )
                for svc in services.items:
                    if svc.spec.selector and all(
                        pod.metadata.labels.get(k) == v 
                        for k, v in svc.spec.selector.items()
                    ):
                        if svc.status.load_balancer.ingress:
                            pod_info['ips']['external'] = svc.status.load_balancer.ingress[0].ip

                # Recursos do pod
                if pod.spec.containers:
                    container = pod.spec.containers[0]
                    if container.resources.limits:
                        pod_info['resources'] = {
                            'cpu': self.format_resources(
                                container.resources.limits.get('cpu', '0'),
                                'cpu'
                            ),
                            'memory': self.format_resources(
                                container.resources.limits.get('memory', '0Ki'),
                                'memory'
                            ),
                            'disk': '0'  # Será atualizado abaixo
                        }

                # Verificar uso de disco
                try:
                    if pod.status.pod_ip:
                        pod_info['resources']['disk'] = self.get_pod_disk_usage(pod)
                except Exception as e:
                    logger.error(f"Erro ao obter uso de disco: {e}")

                # Verificar se a imagem foi atualizada nos últimos 7 dias
                pod_info['image_updated'] = self.check_recent_image_update(
                    pod_info['name'],
                    pod_info['namespace']
                )

                pods_info.append(pod_info)
                self.check_pod_changes(pod_info)

        except Exception as e:
            logger.error(f"Erro ao obter informações dos pods: {e}")

        return pods_info

    def get_pod_disk_usage(self, pod):
        try:
            exec_command = [
                '/bin/sh',
                '-c',
                'df -h / | tail -n 1 | awk \'{print $5}\''
            ]
            
            resp = stream = v1.connect_get_namespaced_pod_exec(
                pod.metadata.name,
                pod.metadata.namespace,
                command=exec_command,
                stderr=True,
                stdin=False,
                stdout=True,
                tty=False
            )
            
            if resp:
                return resp.strip()
            return "N/A"
        except:
            return "N/A"

    def check_recent_image_update(self, pod_name, namespace):
        cutoff_date = datetime.now() - timedelta(days=7)
        
        for update in self.history.get('image_updates', []):
            if (update['pod'] == pod_name and 
                update['namespace'] == namespace and 
                datetime.fromisoformat(update['timestamp']) > cutoff_date):
                return True
        return False

    def get_node_stats(self):
        try:
            nodes = v1.list_node()
            node_stats = {}

            for node in nodes.items:
                node_name = node.metadata.name
                node_stats[node_name] = {
                    'pods': 0,
                    'cpu': '0',
                    'memory': '0',
                    'status': node.status.conditions[-1].type
                }

            # Contar pods por nó
            pods = v1.list_pod_for_all_namespaces(watch=False)
            for pod in pods.items:
                if pod.spec.node_name in node_stats:
                    node_stats[pod.spec.node_name]['pods'] += 1

            return node_stats
        except Exception as e:
            logger.error(f"Erro ao obter estatísticas dos nós: {e}")
            return {}

# Instanciar monitor
monitor = PodMonitor()

# Rotas da API
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/pods')
def get_pods():
    return jsonify(monitor.get_pods_info())

@app.route('/api/nodes')
def get_nodes():
    return jsonify(monitor.get_node_stats())

@app.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    if request.method == 'POST':
        data = request.json
        if data.get('password') != monitor.config['monitoring']['admin_password']:
            return jsonify({'error': 'Invalid password'}), 403
        
        monitor.config.update(data)
        monitor.save_config()
        return jsonify({'status': 'success'})
    return jsonify(monitor.config)

@app.route('/api/history')
def get_history():
    return jsonify(monitor.history)

@app.route('/api/pod/restart', methods=['POST'])
def restart_pod():
    data = request.json
    if data.get('password') != monitor.config['monitoring']['admin_password']:
        return jsonify({'error': 'Invalid password'}), 403

    try:
        v1.delete_namespaced_pod(
            name=data['pod_name'],
            namespace=data['namespace']
        )
        logger.info(f"Pod reiniciado: {data['namespace']}/{data['pod_name']}")
        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Erro ao reiniciar pod: {e}")
        return jsonify({'error': str(e)}), 500

# Função de monitoramento em background
def background_monitor():
    while True:
        try:
            monitor.get_pods_info()
            schedule.run_pending()
            time.sleep(monitor.config['monitoring']['refresh_interval'])
        except Exception as e:
            logger.error(f"Erro no monitoramento: {e}")
            time.sleep(60)  # Espera 1 minuto em caso de erro

# Iniciar monitoramento em background
monitor_thread = threading.Thread(target=background_monitor, daemon=True)
monitor_thread.start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
    
    

