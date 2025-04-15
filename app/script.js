// File: script.js
// Purpose: Frontend JavaScript for Podmon monitoring system
// Version: 1.0.0
// Created: 2025-04-15 13:50:11 UTC
// Author: russorafael

// Initialize socket connection
const socket = io();

// Vue application
const app = Vue.createApp({
    data() {
        return {
            pods: [],
            alerts: [],
            settings: {},
            loading: true,
            error: null,
            selectedPod: null,
            showRestartModal: false,
            restartPassword: '',
            darkMode: false,
            refreshInterval: 600000, // 10 minutes
            searchQuery: '',
            filterNode: '',
            filterNamespace: '',
            showLocalOnly: false,
            metrics: {
                cpu: [],
                memory: [],
                disk: []
            },
            notificationSettings: {
                email: true,
                telegram: true,
                whatsapp: true,
                sms: true
            },
            chartOptions: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        }
    },
    computed: {
        filteredPods() {
            return this.pods.filter(pod => {
                const matchesSearch = pod.name.toLowerCase().includes(this.searchQuery.toLowerCase());
                const matchesNode = !this.filterNode || pod.node_name === this.filterNode;
                const matchesNamespace = !this.filterNamespace || pod.namespace === this.filterNamespace;
                const matchesLocal = !this.showLocalOnly || pod.is_local;
                return matchesSearch && matchesNode && matchesNamespace && matchesLocal;
            });
        },
        nodeList() {
            return [...new Set(this.pods.map(pod => pod.node_name))];
        },
        namespaceList() {
            return [...new Set(this.pods.map(pod => pod.namespace))];
        },
        podStats() {
            const total = this.pods.length;
            const running = this.pods.filter(pod => pod.status === 'Running').length;
            const failed = this.pods.filter(pod => pod.status === 'Failed').length;
            const pending = this.pods.filter(pod => pod.status === 'Pending').length;
            return { total, running, failed, pending };
        }
    },
    methods: {
        async fetchData() {
            try {
                this.loading = true;
                const [podsResponse, alertsResponse, settingsResponse] = await Promise.all([
                    fetch('/api/pods'),
                    fetch('/api/alerts'),
                    fetch('/api/settings')
                ]);

                const podsData = await podsResponse.json();
                const alertsData = await alertsResponse.json();
                const settingsData = await settingsResponse.json();

                this.pods = podsData.pods;
                this.alerts = alertsData.alerts;
                this.settings = settingsData.settings;

                this.updateCharts();
            } catch (error) {
                this.error = 'Error fetching data: ' + error.message;
                console.error('Error:', error);
            } finally {
                this.loading = false;
            }
        },
        async selectPod(pod) {
            try {
                const response = await fetch(`/api/pod/${pod.name}/${pod.namespace}`);
                const data = await response.json();
                this.selectedPod = data.pod;
                this.updatePodMetrics(data.pod);
            } catch (error) {
                console.error('Error fetching pod details:', error);
            }
        },
        async restartPod(pod) {
            try {
                const formData = new FormData();
                formData.append('password', this.restartPassword);

                const response = await fetch(`/api/pod/${pod.name}/${pod.namespace}/restart`, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error('Invalid password or server error');
                }

                this.showNotification('Pod restart initiated', 'success');
                this.showRestartModal = false;
                this.restartPassword = '';
            } catch (error) {
                this.showNotification(error.message, 'error');
            }
        },
        updateCharts() {
            const cpuChart = new Chart(document.getElementById('cpuChart'), {
                type: 'line',
                data: {
                    labels: this.metrics.cpu.map(m => m.timestamp),
                    datasets: [{
                        label: 'CPU Usage',
                        data: this.metrics.cpu.map(m => m.value),
                        borderColor: 'rgb(59, 130, 246)',
                        tension: 0.1
                    }]
                },
                options: this.chartOptions
            });

            const memoryChart = new Chart(document.getElementById('memoryChart'), {
                type: 'line',
                data: {
                    labels: this.metrics.memory.map(m => m.timestamp),
                    datasets: [{
                        label: 'Memory Usage',
                        data: this.metrics.memory.map(m => m.value),
                        borderColor: 'rgb(99, 102, 241)',
                        tension: 0.1
                    }]
                },
                options: this.chartOptions
            });

            const diskChart = new Chart(document.getElementById('diskChart'), {
                type: 'line',
                data: {
                    labels: this.metrics.disk.map(m => m.timestamp),
                    datasets: [{
                        label: 'Disk Usage',
                        data: this.metrics.disk.map(m => m.value),
                        borderColor: 'rgb(245, 158, 11)',
                        tension: 0.1
                    }]
                },
                options: this.chartOptions
            });
        },
        updatePodMetrics(pod) {
            if (!pod) return;

            this.metrics.cpu.push({
                timestamp: new Date(),
                value: pod.cpu_usage
            });

            this.metrics.memory.push({
                timestamp: new Date(),
                value: pod.memory_usage
            });

            this.metrics.disk.push({
                timestamp: new Date(),
                value: pod.disk_usage
            });

            // Keep only last 30 data points
            this.metrics.cpu = this.metrics.cpu.slice(-30);
            this.metrics.memory = this.metrics.memory.slice(-30);
            this.metrics.disk = this.metrics.disk.slice(-30);

            this.updateCharts();
        },
        formatDate(date) {
            return new Date(date).toLocaleString();
        },
        formatUptime(startTime) {
            const start = new Date(startTime);
            const now = new Date();
            const diff = Math.floor((now - start) / 1000);

            const days = Math.floor(diff / 86400);
            const hours = Math.floor((diff % 86400) / 3600);
            const minutes = Math.floor((diff % 3600) / 60);

            return `${days}d ${hours}h ${minutes}m`;
        },
        showNotification(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `toast toast-${type} fade-in`;
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.remove();
            }, 3000);
        },
        toggleDarkMode() {
            this.darkMode = !this.darkMode;
            document.documentElement.setAttribute('data-theme', this.darkMode ? 'dark' : 'light');
            localStorage.setItem('darkMode', this.darkMode);
        },
        async updateSettings(key, value) {
            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ key, value })
                });

                if (!response.ok) {
                    throw new Error('Failed to update settings');
                }

                this.showNotification('Settings updated successfully', 'success');
            } catch (error) {
                this.showNotification(error.message, 'error');
            }
        },
        copyToClipboard(text) {
            navigator.clipboard.writeText(text)
                .then(() => this.showNotification('Copied to clipboard', 'success'))
                .catch(() => this.showNotification('Failed to copy', 'error'));
        },
        openSSH(ip) {
            window.location.href = `ssh://tiesse@${ip}`;
        }
    },
    mounted() {
        // Initial data fetch
        this.fetchData();

        // Set up WebSocket listeners
        socket.on('pod_update', (data) => {
            const index = this.pods.findIndex(p => p.name === data.name && p.namespace === data.namespace);
            if (index !== -1) {
                this.pods[index] = data;
            } else {
                this.pods.push(data);
            }
            if (this.selectedPod && this.selectedPod.name === data.name) {
                this.updatePodMetrics(data);
            }
        });

        socket.on('alert', (data) => {
            this.showNotification(data.message, data.type);
            this.alerts.unshift(data);
        });

        // Set up refresh interval
        setInterval(() => {
            this.fetchData();
        }, this.refreshInterval);

        // Load dark mode preference
        this.darkMode = localStorage.getItem('darkMode') === 'true';
        if (this.darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }

        // Set up keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === '/') {
                this.$refs.searchInput.focus();
            }
        });
    }
}).mount('#app');

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = app;
}
// Adicionar método para lidar com métricas dos nós:
async fetchNodeMetrics() {
    try {
        const response = await fetch('/api/nodes/metrics');
        const data = await response.json();
        this.nodeMetrics = data;
    } catch (error) {
        console.error('Error fetching node metrics:', error);
    }
}