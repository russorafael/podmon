#!/usr/bin/env python3
# File: database.py
# Purpose: Database management and initialization for Podmon
# Version: 1.0.0
# Created: 2025-04-15 13:46:11 UTC
# Author: russorafael

import sqlite3
import argparse
import sys
import logging
from datetime import datetime, timedelta
import json
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

class PodmonDB:
    def __init__(self, db_path="/app/data/podmon.db"):
        self.db_path = db_path
        self.connection = None
        self.cursor = None

    def connect(self):
        """Establish database connection"""
        try:
            self.connection = sqlite3.connect(self.db_path)
            self.cursor = self.connection.cursor()
            logger.info("Database connection established")
        except sqlite3.Error as e:
            logger.error(f"Database connection error: {e}")
            sys.exit(1)

    def close(self):
        """Close database connection"""
        if self.connection:
            self.connection.close()
            logger.info("Database connection closed")

    def init_database(self):
        """Initialize database schema"""
        try:
            self.connect()
            
            # Create pods table
            self.cursor.execute('''
                CREATE TABLE IF NOT EXISTS pods (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    namespace TEXT NOT NULL,
                    node_name TEXT,
                    status TEXT,
                    ip_internal TEXT,
                    ip_external TEXT,
                    image TEXT,
                    created_at TIMESTAMP,
                    last_updated TIMESTAMP,
                    is_local INTEGER DEFAULT 0,
                    ports TEXT,
                    resources TEXT,
                    UNIQUE(name, namespace)
                )
            ''')

            # Create pod_events table
            self.cursor.execute('''
                CREATE TABLE IF NOT EXISTS pod_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pod_id INTEGER,
                    event_type TEXT NOT NULL,
                    description TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (pod_id) REFERENCES pods(id)
                )
            ''')

            # Create alerts table
            self.cursor.execute('''
                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    condition TEXT,
                    severity TEXT,
                    enabled INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Create alert_destinations table
            self.cursor.execute('''
                CREATE TABLE IF NOT EXISTS alert_destinations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL,
                    destination TEXT NOT NULL,
                    name TEXT,
                    enabled INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Create alert_history table
            self.cursor.execute('''
                CREATE TABLE IF NOT EXISTS alert_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alert_id INTEGER,
                    destination_id INTEGER,
                    status TEXT,
                    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (alert_id) REFERENCES alerts(id),
                    FOREIGN KEY (destination_id) REFERENCES alert_destinations(id)
                )
            ''')

            # Create settings table
            self.cursor.execute('''
                CREATE TABLE IF NOT EXISTS settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT,
                    description TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Create metrics table
            self.cursor.execute('''
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pod_id INTEGER,
                    cpu_usage REAL,
                    memory_usage REAL,
                    disk_usage REAL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (pod_id) REFERENCES pods(id)
                )
            ''')
            
            # Adicionar após a criação das tabelas:
            self.cursor.execute('CREATE INDEX IF NOT EXISTS idx_pods_name_ns ON pods(name, namespace)')
            self.cursor.execute('CREATE INDEX IF NOT EXISTS idx_metrics_pod_time ON metrics(pod_id, timestamp)')
            self.cursor.execute('CREATE INDEX IF NOT EXISTS idx_alerts_enabled ON alerts(enabled)')

            # Insert default settings
            default_settings = [
                ('retention_days', '30', 'Number of days to keep historical data'),
                ('refresh_interval', '600', 'Dashboard refresh interval in seconds'),
                ('new_pod_threshold', '7', 'Days threshold for new pods'),
                ('theme', 'light', 'UI theme (light/dark)'),
                ('alert_check_interval', '300', 'Alert check interval in seconds')
            ]
            
            self.cursor.executemany('''
                INSERT OR IGNORE INTO settings (key, value, description)
                VALUES (?, ?, ?)
            ''', default_settings)

            self.connection.commit()
            logger.info("Database initialized successfully")

        except sqlite3.Error as e:
            logger.error(f"Database initialization error: {e}")
            sys.exit(1)
        finally:
            self.close()

    def cleanup_old_data(self):
        """Remove data older than retention period"""
        try:
            self.connect()
            retention_days = self.get_setting('retention_days')
            cutoff_date = datetime.now() - timedelta(days=int(retention_days))
            
            # Delete old metrics
            self.cursor.execute('''
                DELETE FROM metrics 
                WHERE timestamp < ?
            ''', (cutoff_date,))

            # Delete old events
            self.cursor.execute('''
                DELETE FROM pod_events 
                WHERE timestamp < ?
            ''', (cutoff_date,))

            # Delete old alert history
            self.cursor.execute('''
                DELETE FROM alert_history 
                WHERE sent_at < ?
            ''', (cutoff_date,))

            self.connection.commit()
            logger.info(f"Cleaned up data older than {retention_days} days")

        except sqlite3.Error as e:
            logger.error(f"Database cleanup error: {e}")
        finally:
            self.close()

    def get_setting(self, key):
        """Get setting value by key"""
        try:
            self.cursor.execute('SELECT value FROM settings WHERE key = ?', (key,))
            result = self.cursor.fetchone()
            return result[0] if result else None
        except sqlite3.Error as e:
            logger.error(f"Error getting setting {key}: {e}")
            return None

    def update_setting(self, key, value):
        """Update setting value"""
        try:
            self.cursor.execute('''
                UPDATE settings 
                SET value = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE key = ?
            ''', (value, key))
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            logger.error(f"Error updating setting {key}: {e}")
            return False

def main():
    parser = argparse.ArgumentParser(description='Podmon Database Management')
    parser.add_argument('--init', action='store_true', help='Initialize database')
    parser.add_argument('--cleanup', action='store_true', help='Clean up old data')
    args = parser.parse_args()

    db = PodmonDB()

    if args.init:
        db.init_database()
    elif args.cleanup:
        db.cleanup_old_data()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()