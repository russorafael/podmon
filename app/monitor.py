#!/usr/bin/env python3
# File: monitor.py
# Purpose: Main application file for Podmon monitoring system
# Version: 1.0.0
# Created: 2025-04-15 13:47:35 UTC
# Author: russorafael

import os
import sys
import logging
from flask import Flask, render_template, jsonify, request, Response
from flask_socketio import SocketIO
import kubernetes as k8s
import sqlite3
from datetime import datetime, timedelta
import json
import schedule
import time
import threading
import requests
import smtplib
from email.mime.text import MIMEText
import telegram
from database import PodmonDB
import psutil
import pywhatkit
import asyncio


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Initialize Flask application
app = Flask(__name__)
app.config['SECRET_KEY'] = 'podmon-secret-key-2025'
socketio = SocketIO(app)

# Initialize Kubernetes client
try:
    k8s.config.load_incluster_config()
except k8s.config.ConfigException:
    k8s.config.load_kube_config()

# Initialize Kubernetes API clients
core_v1 = k8s.client.CoreV1Api()
apps_v1 = k8s.client.AppsV1Api()

# Initialize database
db = PodmonDB()

class AlertManager:
    def __init__(self):
        self.db = PodmonDB()
        self.telegram_bot = None
        self.setup_telegram()

    def setup_telegram(self):
        """Initialize Telegram bot if token is configured"""
        try:
            self.db.connect()
            token = self.db.get_setting('telegram_token')
            if token:
                self.telegram_bot = telegram.Bot(token=token)
        except Exception as e:
            logger.error(f"Telegram setup error: {e}")
        finally:
            self.db.close()

    async def send_alert(self, alert_type, message, destinations):
        """Send alerts through configured channels"""
        for dest in destinations:
            try:
                if dest['type'] == 'email':
                    self._send_email(dest['destination'], message)
                elif dest['type'] == 'telegram':
                    await self._send_telegram(dest['destination'], message)
                elif dest['type'] == 'whatsapp':
                    self._send_whatsapp(dest['destination'], message)
                elif dest['type'] == 'sms':
                    self._send_sms(dest['destination'], message)
                
                # Log successful alert
                self.db.connect()
                self.db.cursor.execute('''
                    INSERT INTO alert_history (alert_id, destination_id, status)
                    VALUES (?, ?, ?)
                ''', (alert_type, dest['id'], 'sent'))
                self.db.connection.commit()
            
            except Exception as e:
                logger.error(f"Alert sending error: {e}")
                # Log failed alert
                self.db.connect()
                self.db.cursor.execute('''
                    INSERT INTO alert_history (alert_id, destination_id, status)
                    VALUES (?, ?, ?)
                ''', (alert_type, dest['id'], 'failed'))
                self.db.connection.commit()
            finally:
                self.db.close()

    def _send_email(self, email, message):
        """Send email alert"""
        try:
            smtp_server = self.db.get_setting('smtp_server')
            smtp_port = int(self.db.get_setting('smtp_port'))
            smtp_user = self.db.get_setting('smtp_user')
            smtp_pass = self.db.get_setting('smtp_password')

            msg = MIMEText(message)
            msg['Subject'] = 'Podmon Alert'
            msg['From'] = smtp_user
            msg['To'] = email

            with smtplib.SMTP(smtp_server, smtp_port) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        except Exception as e:
            logger.error(f"Email sending error: {e}")
            raise

    async def _send_telegram(self, chat_id, message):
        """Send Telegram alert"""
        if self.telegram_bot:
            try:
                await self.telegram_bot.send_message(chat_id=chat_id, text=message)
            except Exception as e:
                logger.error(f"Telegram sending error: {e}")
                raise

    def _send_whatsapp(self, number, message):
        """Send WhatsApp alert using pywhatkit"""
        try:
            # Garantir que o número está no formato correto
            number = number.replace('+', '').replace('-', '').replace(' ', '')
            
            # Pegar a hora atual
            now = datetime.now()
            # Agendar mensagem para envio em 30 segundos
            send_time = now + timedelta(seconds=30)
            
            # Configurar o pywhatkit
            pywhatkit.playback.playbackSpeed = 0
            
            # Enviar a mensagem
            pywhatkit.sendwhatmsg(
                phone_no=f"+{number}",
                message=message,
                time_hour=send_time.hour,
                time_min=send_time.minute,
                wait_time=15,
                tab_close=True,
                close_time=3
            )
            
            logger.info(f"WhatsApp message sent to {number}")
        except Exception as e:
            logger.error(f"WhatsApp sending error: {e}")
            raise

    def _send_sms(self, number, message):
        """Send SMS alert using TextBelt"""
        try:
            textbelt_key = self.db.get_setting('textbelt_key')
            response = requests.post('https://textbelt.com/text', {
                'phone': number,
                'message': message,
                'key': textbelt_key,
            })
            response.raise_for_status()
        except Exception as e:
            logger.error(f"SMS sending error: {e}")
            raise

class PodMonitor:
    def __init__(self):
        self.db = PodmonDB()
        self.alert_manager = AlertManager()
    
    def get_node_metrics(self):
        """Get node resource metrics"""
        try:
            nodes = core_v1.list_node()
            metrics = {}
            for node in nodes:
                metrics[node.metadata.name] = {
                    'cpu': self._calculate_node_cpu(node),
                    'memory': self._calculate_node_memory(node),
                    'disk': self._calculate_node_disk(node)
                }
            return metrics
        except Exception as e:
            logger.error(f"Error getting node metrics: {e}")
            return {}

    def get_pod_metrics(self, pod_name, namespace):
        """Get pod resource metrics"""
        try:
            metrics = {
                'cpu_usage': 0.0,
                'memory_usage': 0.0,
                'disk_usage': 0.0
            }
            
            # Get pod metrics using metrics API
            pod = core_v1.read_namespaced_pod(pod_name, namespace)
            
            # Calculate resource usage
            if pod.status.container_statuses:
                for container in pod.status.container_statuses:
                    # Get container metrics (simplified for example)
                    metrics['cpu_usage'] += float(container.usage.cpu)
                    metrics['memory_usage'] += float(container.usage.memory)
                    
            return metrics
        except Exception as e:
            logger.error(f"Error getting pod metrics: {e}")
            return None

    def update_pod_status(self):
        """Update pod status in database"""
        try:
            pods = core_v1.list_pod_for_all_namespaces()
            self.db.connect()
            
            for pod in pods:
                metrics = self.get_pod_metrics(pod.metadata.name, pod.metadata.namespace)
                
                # Update pod information
                self.db.cursor.execute('''
                    INSERT OR REPLACE INTO pods (
                        name, namespace, node_name, status, 
                        ip_internal, ip_external, image,
                        created_at, last_updated, is_local, ports
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    pod.metadata.name,
                    pod.metadata.namespace,
                    pod.spec.node_name,
                    pod.status.phase,
                    pod.status.pod_ip,
                    pod.status.host_ip,
                    pod.spec.containers[0].image,
                    pod.metadata.creation_timestamp,
                    datetime.now(),
                    1 if 'local' in pod.metadata.name.lower() else 0,
                    json.dumps([container.ports for container in pod.spec.containers])
                ))
                
                # Update metrics if available
                if metrics:
                    self.db.cursor.execute('''
                        INSERT INTO metrics (
                            pod_id, cpu_usage, memory_usage, disk_usage
                        ) VALUES (
                            (SELECT id FROM pods WHERE name = ? AND namespace = ?),
                            ?, ?, ?
                        )
                    ''', (
                        pod.metadata.name,
                        pod.metadata.namespace,
                        metrics['cpu_usage'],
                        metrics['memory_usage'],
                        metrics['disk_usage']
                    ))
                
            self.db.connection.commit()
        except Exception as e:
            logger.error(f"Error updating pod status: {e}")
        finally:
            self.db.close()

    def check_alerts(self):
        """Check and trigger alerts based on conditions"""
        try:
            self.db.connect()
            alerts = self.db.cursor.execute('SELECT * FROM alerts WHERE enabled = 1').fetchall()
            
            for alert in alerts:
                condition = json.loads(alert['condition'])
                # Check alert conditions and trigger if needed
                if self._evaluate_condition(condition):
                    destinations = self.db.cursor.execute(
                        'SELECT * FROM alert_destinations WHERE enabled = 1'
                    ).fetchall()
                    
                    message = self._generate_alert_message(alert, condition)
                    asyncio.run(self.alert_manager.send_alert(
                        alert['id'],
                        message,
                        destinations
                    ))
        except Exception as e:
            logger.error(f"Error checking alerts: {e}")
        finally:
            self.db.close()

    def _evaluate_condition(self, condition):
        """Evaluate alert condition"""
        try:
            if condition['type'] == 'resource':
                return self._check_resource_condition(condition)
            elif condition['type'] == 'status':
                return self._check_status_condition(condition)
            return False
        except Exception as e:
            logger.error(f"Error evaluating condition: {e}")
            return False

    def _check_resource_condition(self, condition):
        """Check resource-based conditions"""
        try:
            self.db.cursor.execute('''
                SELECT * FROM metrics 
                WHERE pod_id = ? 
                ORDER BY timestamp DESC 
                LIMIT 1
            ''', (condition['pod_id'],))
            
            metric = self.db.cursor.fetchone()
            if not metric:
                return False
                
            if condition['resource'] == 'cpu':
                return metric['cpu_usage'] > condition['threshold']
            elif condition['resource'] == 'memory':
                return metric['memory_usage'] > condition['threshold']
            elif condition['resource'] == 'disk':
                return metric['disk_usage'] > condition['threshold']
            
            return False
        except Exception as e:
            logger.error(f"Error checking resource condition: {e}")
            return False

    def _check_status_condition(self, condition):
        """Check status-based conditions"""
        try:
            self.db.cursor.execute('''
                SELECT status FROM pods 
                WHERE id = ?
            ''', (condition['pod_id'],))
            
            status = self.db.cursor.fetchone()
            if not status:
                return False
                
            return status[0] == condition['status']
        except Exception as e:
            logger.error(f"Error checking status condition: {e}")
            return False

    def _generate_alert_message(self, alert, condition):
        """Generate alert message based on condition"""
        try:
            self.db.cursor.execute('''
                SELECT name, namespace FROM pods 
                WHERE id = ?
            ''', (condition['pod_id'],))
            
            pod = self.db.cursor.fetchone()
            if not pod:
                return f"Alert: {alert['name']} - Condition met"
                
            return f"Alert: {alert['name']}\nPod: {pod[0]}\nNamespace: {pod[1]}\nDescription: {alert['description']}"
        except Exception as e:
            logger.error(f"Error generating alert message: {e}")
            return "Alert triggered"

# Flask routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/pods')
def get_pods():
    try:
        db.connect()
        pods = db.cursor.execute('SELECT * FROM pods').fetchall()
        return jsonify({'pods': pods})
    except Exception as e:
        logger.error(f"Error getting pods: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

@app.route('/api/pod/<name>/<namespace>')
def get_pod_details(name, namespace):
    try:
        db.connect()
        pod = db.cursor.execute('''
            SELECT p.*, m.* 
            FROM pods p 
            LEFT JOIN metrics m ON p.id = m.pod_id 
            WHERE p.name = ? AND p.namespace = ?
            ORDER BY m.timestamp DESC 
            LIMIT 1
        ''', (name, namespace)).fetchone()
        
        return jsonify({'pod': pod})
    except Exception as e:
        logger.error(f"Error getting pod details: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

@app.route('/api/pod/<name>/<namespace>/restart', methods=['POST'])
def restart_pod(name, namespace):
    if request.form.get('password') != 'tiesseadm':
        return jsonify({'error': 'Invalid password'}), 403
        
    try:
        core_v1.delete_namespaced_pod(name, namespace)
        return jsonify({'message': 'Pod restart initiated'})
    except Exception as e:
        logger.error(f"Error restarting pod: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/alerts')
def get_alerts():
    try:
        db.connect()
        alerts = db.cursor.execute('SELECT * FROM alerts').fetchall()
        return jsonify({'alerts': alerts})
    except Exception as e:
        logger.error(f"Error getting alerts: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    try:
        db.connect()
        if request.method == 'POST':
            data = request.json
            db.update_setting(data['key'], data['value'])
            return jsonify({'message': 'Setting updated'})
        else:
            settings = db.cursor.execute('SELECT * FROM settings').fetchall()
            return jsonify({'settings': settings})
    except Exception as e:
        logger.error(f"Error handling settings: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

def background_tasks():
    """Run background tasks"""
    monitor = PodMonitor()
    
    schedule.every(10).minutes.do(monitor.update_pod_status)
    schedule.every(5).minutes.do(monitor.check_alerts)
    schedule.every(1).day.do(db.cleanup_old_data)
    
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == '__main__':
    # Start background tasks in a separate thread
    background_thread = threading.Thread(target=background_tasks)
    background_thread.daemon = True
    background_thread.start()
    
    # Start Flask application
    socketio.run(app, host='0.0.0.0', port=5000)