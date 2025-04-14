# Name: database.py
# Function: Database configuration and models
# Version: 1.0.0
# Author: russorafael
# Date: 2025-04-14 10:53:14

# Current system info
CURRENT_DATE = "2025-04-14 10:53:14"
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