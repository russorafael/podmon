# Name: database.py
# Function: Database configuration and models
# Version: 2.0.0
# Author: russorafael
# Date: 2025-04-15 08:20:11

# Current system info
CURRENT_DATE = "2025-04-15 08:20:11"
CURRENT_USER = "russorafael"

import sqlite3
from datetime import datetime, timedelta
import logging
import os
import json

logger = logging.getLogger(__name__)

class DatabaseCursor:
    """Context manager for database operations"""
    def __init__(self, connection, cursor):
        self.connection = connection
        self.cursor = cursor

    def __enter__(self):
        return self.cursor

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self.connection.commit()
        else:
            self.connection.rollback()
        self.cursor.close()
        self.connection.close()

class Database:
    def __init__(self, db_path='/app/data/podmon.db'):
        """Initialize database with path verification"""
        try:
            self.db_path = db_path
            self._ensure_db_directory()
            self.setup_database()
            self._verify_connection()
            logger.info("Database initialized successfully")
        except Exception as e:
            logger.critical(f"Failed to initialize database: {e}")
            raise

    def _ensure_db_directory(self):
        """Ensure database directory exists"""
        try:
            db_dir = os.path.dirname(self.db_path)
            if not os.path.exists(db_dir):
                os.makedirs(db_dir)
                logger.info(f"Created database directory: {db_dir}")
        except Exception as e:
            logger.error(f"Failed to create database directory: {e}")
            raise

    def _verify_connection(self):
        """Verify database connection"""
        try:
            with self.execute("SELECT 1") as cursor:
                result = cursor.fetchone()
                if result and result[0] == 1:
                    logger.info("Database connection verified")
                else:
                    raise Exception("Database verification failed")
        except Exception as e:
            logger.error(f"Database connection verification failed: {e}")
            raise

    def execute(self, query, params=None):
        """Centralized execute method with error handling"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            
            return DatabaseCursor(conn, cursor)
        except Exception as e:
            logger.error(f"Query execution failed: {query}\nError: {e}")
            raise

    def setup_database(self):
        """Setup database schema with improved error handling"""
        try:
            # Configurar WAL mode e outros pragmas
            with self.execute('PRAGMA journal_mode=WAL'), \
                 self.execute('PRAGMA synchronous=NORMAL'), \
                 self.execute('PRAGMA temp_store=MEMORY'):
                pass

            # Configurações do sistema
            with self.execute('''
                CREATE TABLE IF NOT EXISTS config (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            '''):
                pass

            # Status dos pods
            with self.execute('''
                CREATE TABLE IF NOT EXISTS pod_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pod_name TEXT,
                    namespace TEXT,
                    status TEXT,
                    node TEXT,
                    image TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(pod_name, namespace)
                )
            '''):
                pass

            # Histórico de alterações
            with self.execute('''
                CREATE TABLE IF NOT EXISTS status_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pod_name TEXT,
                    namespace TEXT,
                    old_status TEXT,
                    new_status TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            '''):
                pass

            # Histórico de imagens
            with self.execute('''
                CREATE TABLE IF NOT EXISTS image_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pod_name TEXT,
                    namespace TEXT,
                    old_image TEXT,
                    new_image TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            '''):
                pass

            # Métricas de recursos
            with self.execute('''
                CREATE TABLE IF NOT EXISTS pod_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pod_name TEXT,
                    namespace TEXT,
                    cpu_usage TEXT,
                    memory_usage TEXT,
                    disk_usage TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            '''):
                pass

            # Portas expostas
            with self.execute('''
                CREATE TABLE IF NOT EXISTS pod_ports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pod_name TEXT,
                    namespace TEXT,
                    port_number INTEGER,
                    protocol TEXT,
                    is_exposed BOOLEAN,
                    service_name TEXT,
                    external_ip TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(pod_name, namespace, port_number)
                )
            '''):
                pass

            # Node stats
            with self.execute('''
                CREATE TABLE IF NOT EXISTS node_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_name TEXT,
                    cpu TEXT,
                    memory TEXT,
                    pods INTEGER,
                    status TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(node_name)
                )
            '''):
                pass

            # Alerts
            with self.execute('''
                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    subject TEXT,
                    message TEXT,
                    level TEXT,
                    pod_name TEXT,
                    namespace TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            '''):
                pass
                
            # Criar tabela de configuração SMS se não existir
            with self.execute('''
                CREATE TABLE IF NOT EXISTS sms_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    enabled BOOLEAN DEFAULT FALSE,
                    api_url TEXT,
                    api_token TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            '''):
                pass
            
            # Criar tabela de destinatários SMS se não existir
            with self.execute('''
                CREATE TABLE IF NOT EXISTS sms_recipients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phone_number TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            '''):
                pass
            


            # Create indexes for better performance
            indexes = [
                ('idx_pod_status_lookup', 'pod_status(pod_name, namespace)'),
                ('idx_status_history_lookup', 'status_history(pod_name, namespace, created_at)'),
                ('idx_image_history_lookup', 'image_history(pod_name, namespace, created_at)'),
                ('idx_pod_metrics_lookup', 'pod_metrics(pod_name, namespace, created_at)'),
                ('idx_pod_ports_lookup', 'pod_ports(pod_name, namespace)'),
                ('idx_alerts_lookup', 'alerts(pod_name, namespace, level)'),
                ('idx_node_stats_lookup', 'node_stats(node_name)')
            ]

            for idx_name, idx_cols in indexes:
                with self.execute(f'CREATE INDEX IF NOT EXISTS {idx_name} ON {idx_cols}'):
                    pass

            logger.info("Database setup completed successfully")

        except Exception as e:
            logger.error(f"Database setup failed: {e}")
            raise


    def get_config(self):
        """Get configuration from database"""
        try:
            with self.execute(
                'SELECT value FROM config WHERE key = ?', 
                ('system_config',)
            ) as cursor:
                result = cursor.fetchone()
                return json.loads(result[0]) if result else None
        except Exception as e:
            logger.error(f"Error getting configuration: {e}")
            return None

    def save_config(self, config_data):
        """Save configuration to database"""
        try:
            config_json = json.dumps(config_data)
            with self.execute(
                '''INSERT OR REPLACE INTO config (key, value, updated_at)
                   VALUES (?, ?, CURRENT_TIMESTAMP)''',
                ('system_config', config_json)
            ):
                logger.info("Configuration saved successfully")
        except Exception as e:
            logger.error(f"Error saving configuration: {e}")
            raise

    def get_pod_status(self, pod_name, namespace):
        """Get current pod status"""
        try:
            with self.execute(
                '''SELECT status, image 
                   FROM pod_status 
                   WHERE pod_name = ? AND namespace = ?''',
                (pod_name, namespace)
            ) as cursor:
                result = cursor.fetchone()
                return {'status': result[0], 'image': result[1]} if result else None
        except Exception as e:
            logger.error(f"Error getting pod status: {e}")
            return None

    def save_pod_status(self, pod_info):
        """Save current pod status"""
        try:
            with self.execute(
                '''INSERT OR REPLACE INTO pod_status 
                   (pod_name, namespace, status, node, image)
                   VALUES (?, ?, ?, ?, ?)''',
                (pod_info['name'], pod_info['namespace'], 
                 pod_info['status'], pod_info['node'], 
                 pod_info['image'])
            ):
                pass
        except Exception as e:
            logger.error(f"Error saving pod status: {e}")
            raise

    def save_status_change(self, pod_name, namespace, old_status, new_status):
        """Save pod status change"""
        try:
            with self.execute(
                '''INSERT INTO status_history 
                   (pod_name, namespace, old_status, new_status)
                   VALUES (?, ?, ?, ?)''',
                (pod_name, namespace, old_status, new_status)
            ):
                pass
        except Exception as e:
            logger.error(f"Error saving status change: {e}")
            raise

    def save_image_change(self, pod_name, namespace, old_image, new_image):
        """Save pod image change"""
        try:
            with self.execute(
                '''INSERT INTO image_history 
                   (pod_name, namespace, old_image, new_image)
                   VALUES (?, ?, ?, ?)''',
                (pod_name, namespace, old_image, new_image)
            ):
                pass
        except Exception as e:
            logger.error(f"Error saving image change: {e}")
            raise

    def check_recent_image_update(self, pod_name, namespace, days=7):
        """Check if pod had image updates in recent days"""
        try:
            cutoff = datetime.now() - timedelta(days=days)
            with self.execute(
                '''SELECT COUNT(*) FROM image_history
                   WHERE pod_name = ? 
                   AND namespace = ?
                   AND created_at > ?''',
                (pod_name, namespace, cutoff)
            ) as cursor:
                return cursor.fetchone()[0] > 0
        except Exception as e:
            logger.error(f"Error checking recent image updates: {e}")
            return False

    def save_node_stats(self, node_stats):
        """Save node statistics"""
        try:
            for node_name, stats in node_stats.items():
                with self.execute(
                    '''INSERT OR REPLACE INTO node_stats (
                        node_name, cpu, memory, pods, status
                    ) VALUES (?, ?, ?, ?, ?)''',
                    (node_name, stats['cpu'], stats['memory'],
                     stats['pods'], stats['status'])
                ):
                    pass
            logger.info(f"Node statistics saved for {len(node_stats)} nodes")
        except Exception as e:
            logger.error(f"Error saving node statistics: {e}")
            raise

    def save_pod_ports(self, pod_name, namespace, ports_info):
        """Save pod ports information"""
        try:
            # Delete existing ports first
            with self.execute(
                '''DELETE FROM pod_ports 
                   WHERE pod_name = ? AND namespace = ?''',
                (pod_name, namespace)
            ):
                pass

            # Insert new port information
            if ports_info:
                for port in ports_info:
                    with self.execute(
                        '''INSERT INTO pod_ports (
                            pod_name, namespace, port_number, protocol,
                            is_exposed, service_name, external_ip
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)''',
                        (pod_name, namespace, port['port'],
                         port.get('protocol', 'TCP'),
                         port.get('is_exposed', False),
                         port.get('service_name'),
                         port.get('external_ip'))
                    ):
                        pass
            logger.info(f"Port information saved for pod {pod_name}")
        except Exception as e:
            logger.error(f"Error saving pod ports: {e}")
            raise

    def save_alert(self, alert_data):
        """Save alert information"""
        try:
            with self.execute(
                '''INSERT INTO alerts (
                    subject, message, level, pod_name, namespace
                ) VALUES (?, ?, ?, ?, ?)''',
                (alert_data['subject'], alert_data['message'],
                 alert_data['level'], alert_data['pod_name'],
                 alert_data['namespace'])
            ):
                logger.info(f"Alert saved for pod {alert_data['pod_name']}")
        except Exception as e:
            logger.error(f"Error saving alert: {e}")
            raise

    def save_pod_metrics(self, pod_name, namespace, cpu_usage, memory_usage, disk_usage):
        """Save pod metrics to database"""
        try:
            with self.execute(
                '''INSERT INTO pod_metrics 
                   (pod_name, namespace, cpu_usage, memory_usage, disk_usage)
                   VALUES (?, ?, ?, ?, ?)''',
                (pod_name, namespace, cpu_usage, memory_usage, disk_usage)
            ):
                logger.info(f"Metrics saved for pod {pod_name} in namespace {namespace}")
        except Exception as e:
            logger.error(f"Error saving pod metrics: {e}")
            raise

    def get_pod_metrics(self, pod_name, namespace, hours=24):
        """Get pod metrics with efficient querying"""
        try:
            cutoff = datetime.now() - timedelta(hours=hours)
            with self.execute(
                '''SELECT cpu_usage, memory_usage, disk_usage, created_at
                   FROM pod_metrics
                   WHERE pod_name = ? 
                   AND namespace = ?
                   AND created_at > ?
                   ORDER BY created_at ASC''',
                (pod_name, namespace, cutoff)
            ) as cursor:
                return cursor.fetchall()
        except Exception as e:
            logger.error(f"Error getting pod metrics: {e}")
            return []

    def get_recent_changes(self, days=7):
        """Get recent changes with optimized query"""
        try:
            cutoff = datetime.now() - timedelta(days=days)
            with self.execute(
                '''SELECT 
                       'status' as change_type,
                       pod_name,
                       namespace,
                       old_status as old_value,
                       new_status as new_value,
                       created_at
                   FROM status_history
                   WHERE created_at > ?
                   UNION ALL
                   SELECT 
                       'image' as change_type,
                       pod_name,
                       namespace,
                       old_image as old_value,
                       new_image as new_value,
                       created_at
                   FROM image_history
                   WHERE created_at > ?
                   ORDER BY created_at DESC''',
                (cutoff, cutoff)
            ) as cursor:
                return cursor.fetchall()
        except Exception as e:
            logger.error(f"Error getting recent changes: {e}")
            return []

    def cleanup_old_data(self, cutoff_date):
        """Enhanced cleanup of old data with statistics"""
        try:
            deleted_counts = {}
            tables = [
                'pod_status', 'status_history', 'image_history',
                'pod_metrics', 'pod_ports', 'alerts', 'node_stats'
            ]
            
            for table in tables:
                with self.execute(
                    f'DELETE FROM {table} WHERE created_at < ?',
                    (cutoff_date,)
                ) as cursor:
                    deleted_counts[table] = cursor.rowcount

            # Optimize database after cleanup
            with self.execute('VACUUM'):
                pass

            logger.info(f"Cleanup completed. Deleted counts: {deleted_counts}")
            return deleted_counts
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
            return {}