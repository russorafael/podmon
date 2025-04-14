/**
 * Name: script.js
 * Function: Frontend JavaScript for PodMon monitoring system
 * Version: 1.0.0
 * Author: russorafael
 * Date: 2025-04-14
 */

// Global configuration object
const config = {
    refreshInterval: 600000, // 10 minutes in milliseconds
    newPodThreshold: 7, // days
    adminPassword: 'tiesseadm',
    darkMode: localStorage.getItem('darkMode') === 'true'
};

// DOM Elements Cache
const elements = {
    mainDashboard: document.getElementById('mainDashboard'),
    podsList: document.getElementById('podsList'),
    nodesList: document.getElementById('nodesList'),
    filterForm: document.getElementById('filterForm'),
    configForm: document.getElementById('configForm'),
    darkModeToggle: document.getElementById('darkModeToggle'),
    alertsContainer: document.getElementById('alertsContainer')
};

// Dashboard data cache
let dashboardData = {
    pods: [],
    nodes: [],
    metrics: {},
    history: {}
};

// Event Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    startAutoRefresh();
});

// Initialize application
function initializeApp() {
    loadDashboard();
    updateTheme();
    initializeDropdowns();
}

// Setup Event Listeners
function setupEventListeners() {
    // Dark mode toggle
    elements.darkModeToggle?.addEventListener('change', toggleDarkMode);

    // Filter form auto-update
    document.querySelectorAll('.auto-update-select').forEach(select => {
        select.addEventListener('change', handleFilterChange);
    });

    // Config form submission
    elements.configForm?.addEventListener('submit', handleConfigSubmit);

    // Pod restart buttons
    document.querySelectorAll('.pod-restart-btn').forEach(btn => {
        btn.addEventListener('click', handlePodRestart);
    });
}

// Auto-refresh functionality
function startAutoRefresh() {
    setInterval(() => {
        loadDashboard();
    }, config.refreshInterval);
}

// API Calls
const api = {
    async getPods() {
        const response = await fetch('/api/pods');
        return await response.json();
    },

    async getNodes() {
        const response = await fetch('/api/nodes');
        return await response.json();
    },

    async getPodMetrics(namespace, podName, hours = 24) {
        const response = await fetch(`/api/metrics/${namespace}/${podName}?hours=${hours}`);
        return await response.json();
    },

    async getHistory(days = 7) {
        const response = await fetch(`/api/history?days=${days}`);
        return await response.json();
    },

    async getConfig() {
        const response = await fetch('/api/config');
        return await response.json();
    },

    async updateConfig(config, password) {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...config, password })
        });
        return await response.json();
    },

    async restartPod(podName, namespace, password) {
        const response = await fetch('/api/pod/restart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ pod_name: podName, namespace, password })
        });
        return await response.json();
    }
};

// Dashboard Functions
async function loadDashboard() {
    try {
        const [pods, nodes, history] = await Promise.all([
            api.getPods(),
            api.getNodes(),
            api.getHistory()
        ]);

        dashboardData = { pods, nodes, history };
        updateDashboardUI();
    } catch (error) {
        showAlert('Error loading dashboard data', 'error');
    }
}

function updateDashboardUI() {
    updatePodCards();
    updateNodeCards();
    updateMetricsCharts();
    updateHistoryLists();
}

function updatePodCards() {
    if (!elements.podsList) return;

    const podsHTML = dashboardData.pods.map(pod => `
        <div class="pod-card ${getPodStatusClass(pod.status)} ${isNewPod(pod) ? 'new-pod' : ''}" 
             data-namespace="${pod.namespace}" 
             data-node="${pod.node}">
            <div class="pod-header">
                <h3>${pod.name}</h3>
                ${pod.image_updated ? '<span class="image-updated">★</span>' : ''}
            </div>
            <div class="pod-info">
                <p class="pod-namespace">Namespace: ${pod.namespace}</p>
                <p class="pod-ips">
                    <span class="external-ip">${pod.ips.external || 'No external IP'}</span>
                    <span class="internal-ip">${pod.ips.internal || 'No internal IP'}</span>
                </p>
                <div class="pod-ports">
                    ${formatPodPorts(pod.ports)}
                </div>
                <div class="pod-resources">
                    ${formatPodResources(pod.resources)}
                </div>
                <div class="pod-actions">
                    <button class="pod-restart-btn" 
                            data-pod="${pod.name}" 
                            data-namespace="${pod.namespace}">
                        Restart Pod
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    elements.podsList.innerHTML = podsHTML;
    initializePodCharts();
}

function updateNodeCards() {
    if (!elements.nodesList) return;

    const nodesHTML = Object.entries(dashboardData.nodes).map(([nodeName, nodeInfo]) => `
        <div class="node-card ${nodeInfo.status === 'Ready' ? 'ready' : 'not-ready'}">
            <h3>${nodeName}</h3>
            <div class="node-info">
                <p>Status: ${nodeInfo.status}</p>
                <p>Pods: ${nodeInfo.pods}</p>
                <div class="node-resources">
                    <div class="resource-item">
                        <span>CPU:</span> ${nodeInfo.cpu}
                    </div>
                    <div class="resource-item">
                        <span>Memory:</span> ${nodeInfo.memory}
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    elements.nodesList.innerHTML = nodesHTML;
    initializeNodeCharts();
}

// Utility Functions
function formatPodPorts(ports) {
    if (!ports || !ports.length) return 'No ports exposed';
    
    return ports.map(port => `
        <div class="port-item">
            <span class="port-number">${port.port}</span>
            <span class="port-protocol">${port.protocol}</span>
            ${port.is_exposed ? `
                <span class="port-service">
                    → ${port.service_name}:${port.service_port}
                </span>
            ` : ''}
        </div>
    `).join('');
}

function formatPodResources(resources) {
    return `
        <div class="resource-charts">
            <div class="resource-chart" data-type="cpu">
                <canvas></canvas>
                <span>${formatCPU(resources.cpu)}</span>
            </div>
            <div class="resource-chart" data-type="memory">
                <canvas></canvas>
                <span>${formatMemory(resources.memory)}</span>
            </div>
            <div class="resource-chart" data-type="disk">
                <canvas></canvas>
                <span>${formatDisk(resources.disk)}</span>
            </div>
        </div>
    `;
}

function formatCPU(cpu) {
    return cpu.replace('m CPU', ' mCPU');
}

function formatMemory(memory) {
    return memory.replace('Ki', ' KB')
                .replace('Mi', ' MB')
                .replace('Gi', ' GB');
}

function formatDisk(disk) {
    return disk === 'N/A' ? 'N/A' : disk;
}

function isNewPod(pod) {
    const creationDate = new Date(pod.creation_time);
    const now = new Date();
    const diffDays = (now - creationDate) / (1000 * 60 * 60 * 24);
    return diffDays < config.newPodThreshold;
}

// Event Handlers
function handleFilterChange(event) {
    const formData = new FormData(elements.filterForm);
    const filters = Object.fromEntries(formData.entries());
    
    filterDashboard(filters);
}

async function handlePodRestart(event) {
    const button = event.target;
    const podName = button.dataset.pod;
    const namespace = button.dataset.namespace;

    if (!confirm(`Are you sure you want to restart pod ${podName}?`)) {
        return;
    }

    const password = prompt('Enter admin password to continue:');
    if (password !== config.adminPassword) {
        showAlert('Invalid password', 'error');
        return;
    }

    try {
        await api.restartPod(podName, namespace, password);
        showAlert(`Pod ${podName} restart initiated`, 'success');
        setTimeout(loadDashboard, 2000);
    } catch (error) {
        showAlert('Failed to restart pod', 'error');
    }
}

async function handleConfigSubmit(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const config = Object.fromEntries(formData.entries());
    
    try {
        await api.updateConfig(config, config.adminPassword);
        showAlert('Configuration updated successfully', 'success');
    } catch (error) {
        showAlert('Failed to update configuration', 'error');
    }
}

// UI Helpers
function showAlert(message, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    
    elements.alertsContainer.appendChild(alert);
    setTimeout(() => alert.remove(), 5000);
}

function toggleDarkMode() {
    config.darkMode = !config.darkMode;
    localStorage.setItem('darkMode', config.darkMode);
    updateTheme();
}

function updateTheme() {
    document.body.classList.toggle('dark-mode', config.darkMode);
}

// Initialize dropdowns with data from the backend
function initializeDropdowns() {
    const dropdowns = {
        namespace: new Set(),
        node: new Set(),
        status: new Set()
    };

    dashboardData.pods.forEach(pod => {
        dropdowns.namespace.add(pod.namespace);
        dropdowns.node.add(pod.node);
        dropdowns.status.add(pod.status);
    });

    Object.entries(dropdowns).forEach(([key, values]) => {
        const select = document.getElementById(`${key}Select`);
        if (!select) return;

        select.innerHTML = `
            <option value="">All ${key}s</option>
            ${Array.from(values).map(value => `
                <option value="${value}">${value}</option>
            `).join('')}
        `;
    });
}

// Charts initialization
function initializePodCharts() {
    document.querySelectorAll('.resource-chart canvas').forEach(canvas => {
        const chart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [65, 35],
                    backgroundColor: ['#4CAF50', '#f5f5f5']
                }]
            },
            options: {
                cutout: '70%',
                plugins: { legend: { display: false } }
            }
        });
    });
}

function initializeNodeCharts() {
    // Similar to pod charts but for nodes
}

// Start the application
document.addEventListener('DOMContentLoaded', initializeApp);