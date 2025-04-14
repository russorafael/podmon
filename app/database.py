# Name: database.py
# Function: Database configuration and models
# Version: 2.0.0
# Author: russorafael
# Date: 2025-04-14 11:22:45

# Current system info
CURRENT_DATE = "2025-04-14 11:22:45"
CURRENT_USER = "russorafael"

import sqlite3
from datetime import datetime, timedelta
import logging
import os

logger = logging.getLogger(__name__)

class Database:
    def __init__(self, db_path='/app/podmon.db'):
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

def save_pod_ports(self, pod_name, namespace, ports_info):
    """Save pod ports information with indexing"""
    try:
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            
            # Create index for faster queries if not exists
            c.execute('''
                CREATE INDEX IF NOT EXISTS idx_pod_ports_lookup 
                ON pod_ports (pod_name, namespace, port_number)
            ''')
            
            # Remove old port information
            c.execute('''
                DELETE FROM pod_ports 
                WHERE pod_name = ? AND namespace = ?
            ''', (pod_name, namespace))
            
            # Insert new port information
            for port in ports_info:
                c.execute('''
                    INSERT INTO pod_ports (
                        pod_name, namespace, port_number, protocol,
                        is_exposed, service_name, external_ip
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    pod_name, namespace, port['port'], port['protocol'],
                    port['is_exposed'], port['service_name'], 
                    port.get('external_ip')
                ))
            
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



    def cleanup_old_data(self, retention_days=30):
        """Remove dados mais antigos que o período de retenção"""
        try:
            cutoff_date = datetime.now() - timedelta(days=retention_days)
            
            with sqlite3.connect(self.db_path) as conn:
                c = conn.cursor()
                
                tables = ['status_history', 'image_history', 'pod_metrics']
                for table in tables:
                    c.execute(f'''
                        DELETE FROM {table}
                        WHERE created_at < ?
                    ''', (cutoff_date,))
                
                conn.commit()
                
                # Log number of deleted rows
                for table in tables:
                    c.execute(f'SELECT changes()')
                    deleted = c.fetchone()[0]
                    logger.info(f"Cleaned up {deleted} rows from {table}")

        except Exception as e:
            logger.error(f"Error during cleanup: {e}")