# Name: database.py
# Function: Database configuration and models
# Version: 2.0.0
# Author: russorafael
# Date: 2025-04-14 15:18:02

# Current system info
CURRENT_DATE = "2025-04-14 15:18:02"
CURRENT_USER = "russorafael"

import sqlite3
from datetime import datetime, timedelta
import logging
import os
import json

logger = logging.getLogger(__name__)

class Database:
    def __init__(self, db_path='/app/data/podmon.db'):
        self.db_path = db_path
        self.setup_database()

    def setup_database(self):
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                
                # Configurações do sistema
                c.execute('''
                    CREATE TABLE IF NOT EXISTS config (
                        key TEXT PRIMARY KEY,
                        value TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Status dos pods
                c.execute('''
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
                ''')

                # Histórico de alterações
                c.execute('''
                    CREATE TABLE IF NOT EXISTS status_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        pod_name TEXT,
                        namespace TEXT,
                        old_status TEXT,
                        new_status TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Histórico de imagens
                c.execute('''
                    CREATE TABLE IF NOT EXISTS image_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        pod_name TEXT,
                        namespace TEXT,
                        old_image TEXT,
                        new_image TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Métricas de recursos
                c.execute('''
                    CREATE TABLE IF NOT EXISTS pod_metrics (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        pod_name TEXT,
                        namespace TEXT,
                        cpu_usage TEXT,
                        memory_usage TEXT,
                        disk_usage TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Portas expostas
                c.execute('''
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
                ''')

                conn.commit()
                logger.info("Database setup completed successfully")

        except Exception as e:
            logger.error(f"Error setting up database: {e}")
            raise

    def get_config(self):
        """Get configuration from database"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                c.execute('''
                    SELECT value FROM config 
                    WHERE key = 'system_config'
                ''')
                result = c.fetchone()
                if result:
                    return json.loads(result[0])
                return None
        except Exception as e:
            logger.error(f"Error getting configuration: {e}")
            return None

    def save_config(self, config_data):
        """Save configuration to database"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                
                # Convert config to JSON string
                config_json = json.dumps(config_data)
                
                # Upsert configuration
                c.execute('''
                    INSERT OR REPLACE INTO config (key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                ''', ('system_config', config_json))
                
                conn.commit()
                logger.info("Configuration saved successfully")
                
        except Exception as e:
            logger.error(f"Error saving configuration: {e}")
            raise

    def get_pod_status(self, pod_name, namespace):
        """Get current pod status"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                c.execute('''
                    SELECT status, image 
                    FROM pod_status 
                    WHERE pod_name = ? AND namespace = ?
                ''', (pod_name, namespace))
                result = c.fetchone()
                if result:
                    return {
                        'status': result[0],
                        'image': result[1]
                    }
                return None
        except Exception as e:
            logger.error(f"Error getting pod status: {e}")
            return None

    def save_pod_status(self, pod_info):
        """Save current pod status"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                c.execute('''
                    INSERT OR REPLACE INTO pod_status (
                        pod_name, namespace, status, node, image
                    ) VALUES (?, ?, ?, ?, ?)
                ''', (
                    pod_info['name'],
                    pod_info['namespace'],
                    pod_info['status'],
                    pod_info['node'],
                    pod_info['image']
                ))
                conn.commit()
        except Exception as e:
            logger.error(f"Error saving pod status: {e}")

    def save_status_change(self, pod_name, namespace, old_status, new_status):
        """Save pod status change"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                c.execute('''
                    INSERT INTO status_history (
                        pod_name, namespace, old_status, new_status
                    ) VALUES (?, ?, ?, ?)
                ''', (pod_name, namespace, old_status, new_status))
                conn.commit()
        except Exception as e:
            logger.error(f"Error saving status change: {e}")

    def save_image_change(self, pod_name, namespace, old_image, new_image):
        """Save pod image change"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                c.execute('''
                    INSERT INTO image_history (
                        pod_name, namespace, old_image, new_image
                    ) VALUES (?, ?, ?, ?)
                ''', (pod_name, namespace, old_image, new_image))
                conn.commit()
        except Exception as e:
            logger.error(f"Error saving image change: {e}")

    def check_recent_image_update(self, pod_name, namespace, days=7):
        """Check if pod had image updates in recent days"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                cutoff = datetime.now() - timedelta(days=days)
                c.execute('''
                    SELECT COUNT(*) FROM image_history
                    WHERE pod_name = ? 
                    AND namespace = ?
                    AND created_at > ?
                ''', (pod_name, namespace, cutoff))
                return c.fetchone()[0] > 0
        except Exception as e:
            logger.error(f"Error checking recent image updates: {e}")
            return False

    def save_node_stats(self, node_stats):
        """Save node statistics"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                
                # Create node_stats table if not exists
                c.execute('''
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
                ''')
                
                # Save stats for each node
                for node_name, stats in node_stats.items():
                    c.execute('''
                        INSERT OR REPLACE INTO node_stats (
                            node_name, cpu, memory, pods, status
                        ) VALUES (?, ?, ?, ?, ?)
                    ''', (
                        node_name,
                        stats['cpu'],
                        stats['memory'],
                        stats['pods'],
                        stats['status']
                    ))
                
                conn.commit()
                
        except Exception as e:
            logger.error(f"Error saving node statistics: {e}")

    def save_pod_ports(self, pod_name, namespace, ports_info):
        """Save pod ports information with indexing"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                
                # Delete existing ports for this pod first
                c.execute('''
                    DELETE FROM pod_ports 
                    WHERE pod_name = ? AND namespace = ?
                ''', (pod_name, namespace))
                
                # Insert new port information if exists
                if ports_info:
                    for port in ports_info:
                        try:
                            c.execute('''
                                INSERT INTO pod_ports (
                                    pod_name, namespace, port_number, protocol,
                                    is_exposed, service_name, external_ip
                                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                            ''', (
                                pod_name,
                                namespace,
                                port['port'],
                                port.get('protocol', 'TCP'),
                                port.get('is_exposed', False),
                                port.get('service_name'),
                                port.get('external_ip')
                            ))
                        except sqlite3.IntegrityError:
                            # Skip duplicate entries
                            continue
                
                conn.commit()
                
        except Exception as e:
            logger.error(f"Error saving pod ports: {e}")

    def save_alert(self, alert_data):
        """Save alert information"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                
                # Create alerts table if not exists
                c.execute('''
                    CREATE TABLE IF NOT EXISTS alerts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        subject TEXT,
                        message TEXT,
                        level TEXT,
                        pod_name TEXT,
                        namespace TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                # Create index for faster queries
                c.execute('''
                    CREATE INDEX IF NOT EXISTS idx_alerts_lookup 
                    ON alerts (pod_name, namespace, level)
                ''')
                
                c.execute('''
                    INSERT INTO alerts (
                        subject, message, level, pod_name, namespace
                    ) VALUES (?, ?, ?, ?, ?)
                ''', (
                    alert_data['subject'],
                    alert_data['message'],
                    alert_data['level'],
                    alert_data['pod_name'],
                    alert_data['namespace']
                ))
                
                conn.commit()
                
        except Exception as e:
            logger.error(f"Error saving alert: {e}")

    def get_pod_metrics(self, pod_name, namespace, hours=24):
        """Get pod metrics with efficient querying"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                
                # Create index for faster queries if not exists
                c.execute('''
                    CREATE INDEX IF NOT EXISTS idx_pod_metrics_lookup 
                    ON pod_metrics (pod_name, namespace, created_at)
                ''')
                
                cutoff = datetime.now() - timedelta(hours=hours)
                
                c.execute('''
                    SELECT cpu_usage, memory_usage, disk_usage, created_at
                    FROM pod_metrics
                    WHERE pod_name = ? 
                    AND namespace = ?
                    AND created_at > ?
                    ORDER BY created_at ASC
                ''', (pod_name, namespace, cutoff))
                
                return c.fetchall()
                
        except Exception as e:
            logger.error(f"Error getting pod metrics: {e}")
            return []

    def get_recent_changes(self, days=7):
        """Get recent changes with optimized query"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                
                cutoff = datetime.now() - timedelta(days=days)
                
                # Combined query for status and image changes
                c.execute('''
                    SELECT 
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
                    ORDER BY created_at DESC
                ''', (cutoff, cutoff))
                
                return c.fetchall()
                
        except Exception as e:
            logger.error(f"Error getting recent changes: {e}")
            return []

    def cleanup_old_data(self, cutoff_date):
        """Enhanced cleanup of old data with statistics"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                deleted_counts = {}
                
                # Tables to clean up
                tables = [
                    'pod_status', 'status_history', 'image_history',
                    'pod_metrics', 'pod_ports', 'alerts'
                ]
                
                for table in tables:
                    c.execute(f'''
                        DELETE FROM {table}
                        WHERE created_at < ?
                    ''', (cutoff_date,))
                    
                    deleted_counts[table] = c.rowcount
                
                # Optimize database after cleanup
                c.execute('VACUUM')
                conn.commit()
                
                return deleted_counts
                
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
            return {}