# Name: monitor.py
# Function: Web server and pod monitoring logic
# Version: 2.0.0
# Author: russorafael
# Date: 2025-04-15 08:32:01

# Current system info
CURRENT_DATE = "2025-04-15 08:32:01"
CURRENT_USER = "russorafael"

from flask import Flask, render_template, jsonify, request
from kubernetes import client, config
import os
import schedule
import time
import threading
from datetime import datetime, timedelta
import pytz
import smtplib
import requests
import psutil
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from database import Database

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/app/data/podmon.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Classe de erro personalizada
class VersionMismatchError(Exception):
    pass

# Funções globais
def get_component_version(filename):
    try:
        with open(os.path.join('/app', filename), 'r') as f:
            for line in f:
                if 'Version:' in line:
                    return line.split(':')[1].strip()
    except Exception as e:
        logger.error(f"Error reading version from {filename}: {e}")
        return None

def validate_components_version():
    components = {
        'monitor.py': '2.0.0',
        'database.py': '2.0.0',
        'script.js': '2.0.0',
        'style.css': '2.0.0',
        'index.html': '2.0.0'
    }
    for component, version in components.items():
        if get_component_version(component) != version:
            raise VersionMismatchError(f"Version mismatch in {component}")

# Função de criação do app Flask (movida para o escopo global)
def create_app():
    try:
        app = Flask(__name__)
        app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'tiesseadm')
        return app
    except Exception as e:
        logger.error(f"Failed to create Flask application: {e}")
        raise

# Criar instância do Flask
app = create_app()

# Configuração padrão
DEFAULT_CONFIG = {
    'refresh_interval': 600,  # seconds
    'retention_days': 7,      # days
    'default_view_period': 7  # days
}

# Handler de erro global
@app.errorhandler(Exception)
def handle_error(error):
    logger.error(f"Unhandled error: {error}")
    return jsonify({
        'error': str(error),
        'status': 'error'
    }), 500

# Rota de verificação de saúde
@app.route('/health')
def health_check():
    try:
        # Verificar conexão com K8s
        v1.list_namespace(limit=1)
        # Verificar banco de dados
        monitor.db.execute("SELECT 1")
        return jsonify({'status': 'healthy'}), 200
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({'status': 'unhealthy', 'error': str(e)}), 500

# Função de resposta da API padronizada
def api_response(success=True, data=None, message=None, status=200):
    return jsonify({
        'success': success,
        'data': data,
        'message': message
    }), status

# Configuração do Kubernetes
try:
    config.load_incluster_config()
except config.ConfigException:
    try:
        config.load_kube_config()
    except Exception as e:
        logger.error(f"Error loading Kubernetes configuration: {e}")
        raise

v1 = client.CoreV1Api()
apps_v1 = client.AppsV1Api()
# Classe principal de monitoramento
class PodMonitor:
    def __init__(self):
        try:
            # Verificar conexão com Kubernetes
            try:
                v1.list_namespace(timeout_seconds=5)
                logger.info("Successfully connected to Kubernetes API")
            except Exception as e:
                logger.error(f"Failed to connect to Kubernetes API: {e}")
                raise
    
            # Inicializar banco de dados
            self.db = Database('/app/data/podmon.db')
            
            # Carregar configuração
            self.config = self.load_config()
            if not self.config:
                logger.warning("Using default configuration")
                self.config = self.get_default_config()
                self.save_config()
                
            # Configurar limpeza automática
            self.setup_cleanup_schedule()
            
            logger.info("PodMonitor initialized successfully")
            
        except Exception as e:
            logger.error(f"Error initializing PodMonitor: {e}")
            raise


            # Adicionar este método à classe Monitor
    
    def send_sms_alert(self, message):
        """Enviar alertas SMS"""
        if not self.config['sms']['enabled']:
            return
    
        try:
            for recipient in self.config['sms']['recipients']:
                response = requests.post(
                    self.config['sms']['api_url'],
                    headers={
                        'Authorization': f"Bearer {self.config['sms']['api_token']}",
                        'Content-Type': 'application/json'
                    },
                    json={
                        'phone': recipient,
                        'message': message
                    },
                    timeout=30
                )
                
                if response.status_code == 200:
                    logger.info(f"Alerta SMS enviado para {recipient}")
                else:
                    logger.error(f"Erro ao enviar SMS: {response.status_code} - {response.text}")
                        
        except Exception as e:
            logger.error(f"Erro ao enviar SMS: {e}")
    

    def get_default_config(self):
        """Get default configuration"""
        return {
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
                'retention_days': 30,
                'namespaces': ['default', 'monitoring'],
                'admin_password': os.getenv('ADMIN_PASSWORD', 'tiesseadm'),
                'alert_on_status_change': True,
                'alert_on_image_update': True,
                'alert_schedule': [
                    {
                        'start': '00:00',
                        'end': '23:59',
                        'levels': ['error', 'warning', 'info'],
                        'namespaces': []
                    }
                ]
            }
        }

    def load_config(self):
        """Load configuration from database"""
        try:
            config = self.db.get_config()
            if not config:
                default_config = self.get_default_config()
                self.db.save_config(default_config)
                return default_config
            return config
        except Exception as e:
            logger.error(f"Error loading configuration: {e}")
            return self.get_default_config()

    def save_config(self):
        """Save current configuration to database"""
        try:
            self.db.save_config(self.config)
            logger.info("Configuration saved successfully")
        except Exception as e:
            logger.error(f"Error saving configuration: {e}")

    def get_pods_info(self):
        """Get information about all monitored pods"""
        pods_info = []
        try:
            pods = v1.list_pod_for_all_namespaces(watch=False)
            now = datetime.now(pytz.UTC)

            for pod in pods.items:
                if pod.metadata.namespace not in self.config['monitoring']['namespaces']:
                    continue

                creation_time = pod.metadata.creation_timestamp
                age = now - creation_time

                pod_info = {
                    'name': pod.metadata.name,
                    'namespace': pod.metadata.namespace,
                    'status': pod.status.phase,
                    'node': pod.spec.node_name,
                    'creation_time': creation_time.isoformat(),
                    'age_days': age.days,
                    'is_new': age.days < 7,
                    'is_local': 'local' in pod.metadata.name.lower(),
                    'image': pod.spec.containers[0].image if pod.spec.containers else '',
                    'image_updated': False,
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

                # Check services for external IP
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

                # Get pod resources
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
                            'disk': '0'
                        }

                # Get disk usage
                try:
                    if pod.status.pod_ip:
                        disk_usage = self.get_pod_disk_usage(pod)
                        pod_info['resources']['disk'] = disk_usage
                        
                        self.db.save_pod_metrics(
                            pod_info['name'],
                            pod_info['namespace'],
                            pod_info['resources']['cpu'],
                            pod_info['resources']['memory'],
                            disk_usage
                        )
                except Exception as e:
                    logger.error(f"Error getting disk usage: {e}")

                pod_info['image_updated'] = self.db.check_recent_image_update(
                    pod_info['name'],
                    pod_info['namespace']
                )

                self.check_pod_changes(pod_info)
                pods_info.append(pod_info)

        except Exception as e:
            logger.error(f"Error getting pods information: {e}")

        return pods_info

    def get_pod_ports(self, pod):
        """Get detailed pod ports information including external access"""
        ports_info = []
        try:
            for container in pod.spec.containers:
                if container.ports:
                    for port in container.ports:
                        port_info = {
                            'port': port.container_port,
                            'protocol': port.protocol if hasattr(port, 'protocol') else 'TCP',
                            'name': port.name if hasattr(port, 'name') else '',
                            'host_port': port.host_port if hasattr(port, 'host_port') else None,
                            'is_exposed': False,
                            'service_port': None,
                            'service_name': None,
                            'load_balancer': False,
                            'external_ip': None,
                            'access_url': None
                        }
                        ports_info.append(port_info)

            try:
                services = v1.list_service_for_all_namespaces(
                    field_selector=f'metadata.namespace={pod.metadata.namespace}',
                    timeout_seconds=10
                )
                
                for svc in services.items:
                    if not svc.spec.selector:
                        continue
                        
                    pod_labels = pod.metadata.labels or {}
                    matches = all(
                        pod_labels.get(k) == v 
                        for k, v in svc.spec.selector.items()
                    )
                    
                    if matches:
                        for port in ports_info:
                            for svc_port in svc.spec.ports:
                                target_port = str(svc_port.target_port) if hasattr(svc_port, 'target_port') else str(svc_port.port)
                                if str(port['port']) == target_port:
                                    external_ip = None
                                    if svc.spec.type == 'LoadBalancer' and svc.status.load_balancer.ingress:
                                        external_ip = svc.status.load_balancer.ingress[0].ip

                                    port.update({
                                        'is_exposed': True,
                                        'service_port': svc_port.port,
                                        'service_name': svc.metadata.name,
                                        'load_balancer': svc.spec.type == 'LoadBalancer',
                                        'external_ip': external_ip,
                                        'access_url': f"http://{external_ip}:{svc_port.port}" if external_ip else None
                                    })

            except Exception as e:
                logger.error(f"Error checking service exposure: {e}")

            # Add SSH access information
            for port in ports_info:
                if port['port'] == 22 and port['external_ip']:
                    port['ssh_url'] = f"ssh://tiesse@{port['external_ip']}"

            self.db.save_pod_ports(pod.metadata.name, pod.metadata.namespace, ports_info)
            return ports_info
                
        except Exception as e:
            logger.error(f"Error getting port information: {e}")
            return []

    def format_resources(self, value, unit):
        """Format resource values to human readable format"""
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
                        return f"{value/1000:.2f} Cores"
                    else:
                        value = float(value)
                        return f"{value:.2f} Cores"
                return f"{float(value):.2f} Cores"
            
            return str(value)
            
        except Exception as e:
            logger.error(f"Error formatting resources: {e}")
            return str(value)

    def check_pod_changes(self, pod_info):
        """Check and record pod status and image changes"""
        try:
            current_status = self.db.get_pod_status(
                pod_info['name'],
                pod_info['namespace']
            )

            if current_status:
                if current_status['status'] != pod_info['status']:
                    self.db.save_status_change(
                        pod_info['name'],
                        pod_info['namespace'],
                        current_status['status'],
                        pod_info['status']
                    )
                    if self.config['monitoring']['alert_on_status_change']:
                        self.send_alert(
                            f"Pod Status Change: {pod_info['name']}",
                            f"Pod {pod_info['name']} in namespace {pod_info['namespace']} " \
                            f"changed from {current_status['status']} to {pod_info['status']}",
                            level='warning'
                        )

                if current_status['image'] != pod_info['image']:
                    self.db.save_image_change(
                        pod_info['name'],
                        pod_info['namespace'],
                        current_status['image'],
                        pod_info['image']
                    )
                    if self.config['monitoring']['alert_on_image_update']:
                        self.send_alert(
                            f"Pod Image Update: {pod_info['name']}",
                            f"Pod {pod_info['name']} in namespace {pod_info['namespace']} " \
                            f"updated from {current_status['image']} to {pod_info['image']}",
                            level='info'
                        )

            self.db.save_pod_status(pod_info)

        except Exception as e:
            logger.error(f"Error checking pod changes: {e}")

    def send_alert(self, subject, message, level='info', pod_name=None, namespace=None):
        """Sistema de alerta aprimorado com múltiplos canais incluindo SMS"""
    try:
        alert_data = {
            'subject': subject,
            'message': message,
            'level': level,
            'pod_name': pod_name,
            'namespace': namespace
        }

        self.db.save_alert(alert_data)

        if self.should_send_alert(alert_data):
            if self.config['email']['enabled']:
                self.send_email_alert(subject, message)
            if self.config['whatsapp']['enabled']:
                self.send_whatsapp_alert(message)
            if self.config['sms']['enabled']:
                self.send_sms_alert(message)

    except Exception as e:
        logger.error(f"Erro ao enviar alerta: {e}")

    def should_send_alert(self, alert_data):
        """Check if alert should be sent based on configuration"""
        try:
            current_time = datetime.now().time()
            
            for schedule in self.config['monitoring']['alert_schedule']:
                start_time = datetime.strptime(schedule['start'], '%H:%M').time()
                end_time = datetime.strptime(schedule['end'], '%H:%M').time()
                
                if start_time <= current_time <= end_time:
                    if alert_data['level'] in schedule['levels']:
                        if not schedule['namespaces'] or alert_data['namespace'] in schedule['namespaces']:
                            return True
            
            return False

        except Exception as e:
            logger.error(f"Error checking alert schedule: {e}")
            return True

    def send_email_alert(self, subject, message):
        """Send email alerts"""
        if not self.config['email']['enabled']:
            return

        try:
            msg = MIMEMultipart()
            msg['From'] = self.config['email']['username'] or 'podmon@localhost'
            msg['To'] = ', '.join(self.config['email']['recipients'])
            msg['Subject'] = subject

            msg.attach(MIMEText(message, 'plain'))

            with smtplib.SMTP(
                self.config['email']['smtp_server'],
                self.config['email']['smtp_port'],
                timeout=30
            ) as server:
                if self.config['email']['username'] and self.config['email']['password']:
                    server.starttls()
                    server.login(
                        self.config['email']['username'],
                        self.config['email']['password']
                    )
                server.send_message(msg)
                logger.info(f"Email alert sent: {subject}")
        except Exception as e:
            logger.error(f"Error sending email: {e}")

    def send_whatsapp_alert(self, message):
        """Send WhatsApp alerts"""
        if not self.config['whatsapp']['enabled']:
            return

        try:
            for recipient in self.config['whatsapp']['recipients']:
                response = requests.post(
                    self.config['whatsapp']['api_url'],
                    headers={
                        'Authorization': f"Bearer {self.config['whatsapp']['api_token']}",
                        'Content-Type': 'application/json'
                    },
                    json={
                        'phone': recipient,
                        'message': message
                    },
                    timeout=30
                )
                
                if response.status_code == 200:
                    logger.info(f"WhatsApp alert sent to {recipient}")
                else:
                    logger.error(f"Error sending WhatsApp: {response.status_code} - {response.text}")
                    
        except Exception as e:
            logger.error(f"Error sending WhatsApp: {e}")

    def get_node_stats(self):
        """Get statistics for all nodes"""
        try:
            nodes = v1.list_node()
            node_stats = {}

            for node in nodes.items:
                node_name = node.metadata.name
                conditions = {cond.type: cond.status for cond in node.status.conditions}
                ready_status = conditions.get('Ready', 'Unknown')
                
                allocatable = node.status.allocatable
                capacity = node.status.capacity
                
                node_stats[node_name] = {
                    'pods': 0,
                    'cpu': self.format_resources(allocatable.get('cpu', '0'), 'cpu'),
                    'memory': self.format_resources(allocatable.get('memory', '0'), 'memory'),
                    'status': 'Ready' if ready_status == 'True' else 'NotReady',
                    'capacity': {
                        'cpu': self.format_resources(capacity.get('cpu', '0'), 'cpu'),
                        'memory': self.format_resources(capacity.get('memory', '0'), 'memory')
                    }
                }

            pods = v1.list_pod_for_all_namespaces(watch=False)
            for pod in pods.items:
                if pod.spec.node_name in node_stats:
                    node_stats[pod.spec.node_name]['pods'] += 1

            self.db.save_node_stats(node_stats)
            return node_stats
            
        except Exception as e:
            logger.error(f"Error getting node statistics: {e}")
            return {}

    def get_pod_disk_usage(self, pod):
        """Get pod disk usage with enhanced error handling and websocket support"""
        try:
            if not pod.status.phase == 'Running':
                logger.warning(f"Pod {pod.metadata.name} is not running, skipping disk usage check")
                return "N/A"
                
            if not pod.spec.containers:
                logger.warning(f"No containers found in pod {pod.metadata.name}")
                return "N/A"
            
            container_name = pod.spec.containers[0].name
            logger.info(f"Using container {container_name} for disk usage check in pod {pod.metadata.name}")
            
            try:
                from kubernetes.stream import stream
                
                exec_command = [
                    '/bin/sh',
                    '-c',
                    'df -h / | tail -n 1 | awk \'{print $5}\''
                ]
                
                resp = stream(
                    v1.connect_get_namespaced_pod_exec,
                    pod.metadata.name,
                    pod.metadata.namespace,
                    container=container_name,
                    command=exec_command,
                    stderr=True,
                    stdin=False,
                    stdout=True,
                    tty=False,
                    _preload_content=False
                )
                
                resp.run_forever(timeout=10)
                
                if resp.returncode == 0:
                    output = resp.read_stdout()
                    if output and output.strip():
                        usage = output.strip()
                        if usage.endswith('%') and usage[:-1].isdigit():
                            return usage
                
                logger.warning(f"Invalid or empty disk usage data from pod {pod.metadata.name}")
                return "N/A"
                
            except Exception as stream_error:
                logger.error(f"Stream error for pod {pod.metadata.name}: {stream_error}")
                return "N/A"
                
        except Exception as e:
            logger.error(f"Error getting disk usage for pod {pod.metadata.name}: {e}")
            return "N/A"

    def setup_cleanup_schedule(self):
        """Setup automatic data cleanup schedule"""
        try:
            retention_days = self.config['monitoring'].get('retention_days', 30)
            schedule.every().day.at("00:00").do(self.cleanup_old_data, retention_days)
            logger.info(f"Scheduled automatic cleanup with {retention_days} days retention")
        except Exception as e:
            logger.error(f"Error setting up cleanup schedule: {e}")

    def cleanup_old_data(self, retention_days):
        """Clean up old data based on retention policy"""
        try:
            cutoff_date = datetime.now() - timedelta(days=retention_days)
            deleted_counts = self.db.cleanup_old_data(cutoff_date)
            
            for table, count in deleted_counts.items():
                logger.info(f"Cleaned up {count} records from {table}")
            
            total_deleted = sum(deleted_counts.values())
            
            self.send_alert(
                "System Maintenance",
                f"Cleaned up {total_deleted} old records as per {retention_days} days retention policy",
                level='info'
            )
            
            return total_deleted

        except Exception as e:
            logger.error(f"Error during data cleanup: {e}")
            return 0

# Rotas da API
@app.route('/')
def index():
    """Render main page"""
    return render_template('index.html')

@app.route('/api/pods')
def get_pods():
    """Get all pods information"""
    try:
        return jsonify(monitor.get_pods_info())
    except Exception as e:
        logger.error(f"Error getting pods: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/nodes')
def get_nodes():
    """Get all nodes information"""
    try:
        return jsonify(monitor.get_node_stats())
    except Exception as e:
        logger.error(f"Error getting nodes: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/metrics/<namespace>/<pod_name>')
def get_pod_metrics(namespace, pod_name):
    """Get pod metrics history"""
    try:
        hours = min(max(request.args.get('hours', 24, type=int), 1), 168)
        return jsonify(monitor.db.get_pod_metrics(pod_name, namespace, hours))
    except Exception as e:
        logger.error(f"Error getting pod metrics: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/history')
def get_history():
    """Get pods history"""
    try:
        days = min(max(request.args.get('days', 7, type=int), 1), 30)
        return jsonify(monitor.db.get_recent_changes(days))
    except Exception as e:
        logger.error(f"Error getting history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    """Handle configuration"""
    try:
        if request.method == 'POST':
            data = request.json
            if not data:
                return jsonify({'error': 'Invalid request data'}), 400
                
            if data.get('password') != monitor.config['monitoring']['admin_password']:
                return jsonify({'error': 'Invalid password'}), 403
            
            monitor.config.update(data)
            monitor.save_config()
            return jsonify({'status': 'success'})
            
        return jsonify(monitor.config)
    except Exception as e:
        logger.error(f"Error handling config: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/pod/restart', methods=['POST'])
def restart_pod():
    """Restart a pod"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid request data'}), 400
            
        if data.get('password') != monitor.config['monitoring']['admin_password']:
            return jsonify({'error': 'Invalid password'}), 403

        v1.delete_namespaced_pod(
            name=data['pod_name'],
            namespace=data['namespace']
        )
        
        logger.info(f"Pod restarted: {data['namespace']}/{data['pod_name']}")
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error(f"Error restarting pod: {e}")
        return jsonify({'error': str(e)}), 500

# Background monitoring
def background_monitor():
    """Background monitoring process"""
    retry_count = 0
    max_retries = 3
    base_sleep = monitor.config['monitoring']['refresh_interval']
    
    while True:
        try:
            monitor.get_pods_info()
            monitor.get_node_stats()
            schedule.run_pending()
            time.sleep(base_sleep)
            retry_count = 0
        except Exception as e:
            retry_count += 1
            logger.error(f"Error in background monitoring (attempt {retry_count}/{max_retries}): {e}")
            sleep_time = min(300, base_sleep * (2 ** retry_count))
            time.sleep(sleep_time)
            
            if retry_count >= max_retries:
                logger.critical("Maximum retry attempts reached in background monitoring")
                retry_count = 0

# Initialize monitor
monitor = PodMonitor()

# Start background monitoring
monitor_thread = threading.Thread(target=background_monitor, daemon=True)
monitor_thread.start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)