# Function: Web server and pod monitoring logic
# Version: # Versão: 2.0.0
# Author: russorafael
# Date: 2025-04-14 11:26:32

# Current system info
CURRENT_DATE = "2025-04-14 11:26:32"
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
        logger.error(f"Error loading Kubernetes configuration: {e}")
        raise

v1 = client.CoreV1Api()
apps_v1 = client.AppsV1Api()

class PodMonitor:
    def __init__(self):
        self.db = Database('/app/data/podmon.db')
        self.config = self.load_config()
        self.setup_cleanup_schedule()

    def load_config(self):
        """Load configuration from database or create default"""
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
                'retention_days': 30,
                'namespaces': ['default', 'monitoring'],
                'admin_password': 'tiesseadm',
                'alert_on_status_change': True,
                'alert_on_image_update': True
            }
        }

        try:
            config = self.db.get_config()
            if not config:
                self.db.save_config(default_config)
                return default_config
            return config
        except Exception as e:
            logger.error(f"Error loading configuration: {e}")
            return default_config

    def save_config(self):
        """Save current configuration to database"""
        try:
            self.db.save_config(self.config)
        except Exception as e:
            logger.error(f"Error saving configuration: {e}")
            
    def get_pod_ports(self, pod):
        """Get detailed pod ports information including external access"""
        ports_info = []
        try:
            # Check container ports
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

            # Check if ports are exposed via service
            try:
                services = v1.list_service_for_all_namespaces(
                    field_selector=f'metadata.namespace={pod.metadata.namespace}',
                    timeout_seconds=10
                )
                
                for svc in services.items:
                    if not svc.spec.selector:
                        continue
                        
                    # Check if pod matches service selectors
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
                                    # Get external IP if LoadBalancer
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

            # Add SSH access information for port 22
            for port in ports_info:
                if port['port'] == 22 and port['external_ip']:
                    port['ssh_url'] = f"ssh://tiesse@{port['external_ip']}"

            # Save ports information to database
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
        except Exception as e:
            logger.error(f"Error formatting resources: {e}")
            return str(value)

    def get_pods_info(self):
        """Get information about all monitored pods"""
        pods_info = []
        try:
            pods = v1.list_pod_for_all_namespaces(watch=False)
            now = datetime.now(pytz.UTC)

            for pod in pods.items:
                # Check if namespace is being monitored
                if pod.metadata.namespace not in self.config['monitoring']['namespaces']:
                    continue

                # Calculate pod age
                creation_time = pod.metadata.creation_timestamp
                age = now - creation_time
                is_new = age.days < 7

                # Pod basic information
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

                # Check external IP from services
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
                        
                        # Save metrics to database
                        self.db.save_pod_metrics(
                            pod_info['name'],
                            pod_info['namespace'],
                            pod_info['resources']['cpu'],
                            pod_info['resources']['memory'],
                            disk_usage
                        )
                except Exception as e:
                    logger.error(f"Error getting disk usage: {e}")

                # Check for recent image updates
                pod_info['image_updated'] = self.db.check_recent_image_update(
                    pod_info['name'],
                    pod_info['namespace'],
                    days=7
                )

                # Save current pod status and check for changes
                self.check_pod_changes(pod_info)
                pods_info.append(pod_info)

        except Exception as e:
            logger.error(f"Error getting pods information: {e}")

        return pods_info

    def check_pod_changes(self, pod_info):
        """Check and record pod status and image changes"""
        try:
            current_status = self.db.get_pod_status(
                pod_info['name'],
                pod_info['namespace']
            )

            if current_status:
                # Check status changes
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
                            f"changed from {current_status['status']} to {pod_info['status']}"
                        )

                # Check image changes
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
                            f"updated from {current_status['image']} to {pod_info['image']}"
                        )

            # Update current pod status
            self.db.save_pod_status(pod_info)

        except Exception as e:
            logger.error(f"Error checking pod changes: {e}")

    def send_alert(self, subject, message, level='info', pod_name=None, namespace=None):
        """Enhanced alert system with multiple channels"""
        try:
            # Prepare alert data
            alert_data = {
                'subject': subject,
                'message': message,
                'level': level,
                'timestamp': datetime.now(pytz.UTC),
                'pod_name': pod_name,
                'namespace': namespace
            }

            # Save alert to database
            self.db.save_alert(alert_data)

            # Check alert schedule and preferences
            if self.should_send_alert(alert_data):
                if self.config['email']['enabled']:
                    self.send_email_alert(subject, message)
                if self.config['whatsapp']['enabled']:
                    self.send_whatsapp_alert(message)

        except Exception as e:
            logger.error(f"Error sending alert: {e}")

    def should_send_alert(self, alert_data):
        """Check if alert should be sent based on configuration"""
        try:
            current_time = datetime.now().time()
            
            # Check schedule
            for schedule in self.config['monitoring']['alert_schedule']:
                start_time = datetime.strptime(schedule['start'], '%H:%M').time()
                end_time = datetime.strptime(schedule['end'], '%H:%M').time()
                
                if start_time <= current_time <= end_time:
                    # Check alert level
                    if alert_data['level'] in schedule['levels']:
                        # Check namespace filter
                        if not schedule['namespaces'] or alert_data['namespace'] in schedule['namespaces']:
                            return True
            
            return False

        except Exception as e:
            logger.error(f"Error checking alert schedule: {e}")
            return True  # Default to sending alert if error occurs

    def send_email_alert(self, subject, message):
        """Send email alerts"""
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
            logger.error(f"Error sending email: {e}")

    def send_whatsapp_alert(self, message):
        """Send WhatsApp alerts"""
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
                    logger.error(f"Error sending WhatsApp: {response.status_code}")
        except Exception as e:
            logger.error(f"Error sending WhatsApp: {e}")

    def get_node_stats(self):
        """Get statistics for all nodes"""
        try:
            nodes = v1.list_node()
            node_stats = {}

            for node in nodes.items:
                node_name = node.metadata.name
                
                # Get node conditions
                conditions = {cond.type: cond.status for cond in node.status.conditions}
                ready_status = conditions.get('Ready', 'Unknown')
                
                # Get node resources
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

            # Count pods per node
            pods = v1.list_pod_for_all_namespaces(watch=False)
            for pod in pods.items:
                if pod.spec.node_name in node_stats:
                    node_stats[pod.spec.node_name]['pods'] += 1

            # Save node stats to database
            self.db.save_node_stats(node_stats)
            return node_stats
            
        except Exception as e:
            logger.error(f"Error getting node statistics: {e}")
            return {}

    def get_pod_disk_usage(self, pod):
        """Get pod disk usage"""
        try:
            exec_command = [
                '/bin/sh',
                '-c',
                'df -h / | tail -n 1 | awk \'{print $5}\''
            ]
            
            resp = v1.connect_get_namespaced_pod_exec(
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
        except Exception as e:
            logger.error(f"Error getting pod disk usage: {e}")
            return "N/A"

    def setup_cleanup_schedule(self):
        """Setup automatic data cleanup schedule"""
        try:
            retention_days = self.config['monitoring'].get('retention_days', 30)
            
            # Schedule daily cleanup at midnight
            schedule.every().day.at("00:00").do(self.cleanup_old_data, retention_days)
            
            logger.info(f"Scheduled automatic cleanup with {retention_days} days retention")

        except Exception as e:
            logger.error(f"Error setting up cleanup schedule: {e}")

    def cleanup_old_data(self, retention_days):
        """Clean up old data based on retention policy"""
        try:
            cutoff_date = datetime.now() - timedelta(days=retention_days)
            
            # Call database cleanup
            cleaned = self.db.cleanup_old_data(cutoff_date)
            
            logger.info(f"Cleaned up {cleaned} old records older than {retention_days} days")
            
            # Send notification about cleanup
            self.send_alert(
                "System Maintenance",
                f"Cleaned up {cleaned} old records as per {retention_days} days retention policy",
                level='info'
            )

        except Exception as e:
            logger.error(f"Error during data cleanup: {e}")

# Rotas da API
@app.route('/')
def index():
    """Render main page"""
    return render_template('index.html')

@app.route('/api/pods')
def get_pods():
    """Get all pods information"""
    return jsonify(monitor.get_pods_info())

@app.route('/api/nodes')
def get_nodes():
    """Get all nodes information"""
    return jsonify(monitor.get_node_stats())

@app.route('/api/metrics/<namespace>/<pod_name>')
def get_pod_metrics(namespace, pod_name):
    """Get pod metrics history"""
    hours = request.args.get('hours', 24, type=int)
    return jsonify(monitor.db.get_pod_metrics(pod_name, namespace, hours))

@app.route('/api/history')
def get_history():
    """Get pods history"""
    days = request.args.get('days', 7, type=int)
    return jsonify(monitor.db.get_recent_changes(days))

@app.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    """Handle configuration"""
    if request.method == 'POST':
        data = request.json
        if data.get('password') != monitor.config['monitoring']['admin_password']:
            return jsonify({'error': 'Invalid password'}), 403
        
        monitor.config.update(data)
        monitor.save_config()
        return jsonify({'status': 'success'})
    return jsonify(monitor.config)

@app.route('/api/pod/restart', methods=['POST'])
def restart_pod():
    """Restart a pod"""
    data = request.json
    if data.get('password') != monitor.config['monitoring']['admin_password']:
        return jsonify({'error': 'Invalid password'}), 403

    try:
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
    while True:
        try:
            monitor.get_pods_info()
            monitor.get_node_stats()
            schedule.run_pending()
            time.sleep(monitor.config['monitoring']['refresh_interval'])
        except Exception as e:
            logger.error(f"Error in background monitoring: {e}")
            time.sleep(60)

# Initialize monitor
monitor = PodMonitor()

# Start background monitoring
monitor_thread = threading.Thread(target=background_monitor, daemon=True)
monitor_thread.start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)