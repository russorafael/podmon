// main.js - Principal script for PodMon Monitoring System
// Version: 2.0.0
// Last update: 2025-04-13

// Global configuration and variables
const API_ENDPOINTS = {
    CONFIG: '/api/config',
    CHECK_NOW: '/api/check-now',
    TEST_EMAIL: '/api/test-email',
    TEST_WHATSAPP: '/api/test-whatsapp',
    NAMESPACES: '/api/namespaces',
    CURRENT_STATE: '/api/current-state',
    POD_HISTORY: '/api/pod-history',
    NODE_HISTORY: '/api/node-history',
    LOGS: '/api/logs',
    RECENT_ACTIVITIES: '/api/recent-activities',
    RESTART_POD: '/api/restart-pod',
    POD_RESOURCES: '/api/pod-resources',
    NODE_RESOURCES: '/api/node-resources',
    POD_DETAILS: '/api/pod-details'
};

let currentConfig = {};
let podData = {};
let nodeData = {};
let resourceCharts = {};
let currentTheme = localStorage.getItem('theme') || 'light';
let autoUpdateInterval;
let lastUpdateTime = null;

// Constants
const AUTO_REFRESH_INTERVAL = 600000; // 10 minutes
const NEW_POD_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const RESTART_PASSWORD = 'tiesseadm';
const HUMAN_READABLE_SIZES = {
    Ki: 1024,
    Mi: 1024 * 1024,
    Gi: 1024 * 1024 * 1024
};

// Initialization functions
document.addEventListener('DOMContentLoaded', function() {
    setupThemeToggle();
    initializePage();
    setupEventListeners();
    setupAutoRefresh();
    refreshDashboard();
});

function setupAutoRefresh() {
    if (autoUpdateInterval) {
        clearInterval(autoUpdateInterval);
    }
    autoUpdateInterval = setInterval(refreshDashboard, AUTO_REFRESH_INTERVAL);
    updateLastCheckTime();
}

function updateLastCheckTime() {
    lastUpdateTime = new Date();
    const lastUpdateElement = document.getElementById('last-update');
    if (lastUpdateElement) {
        lastUpdateElement.textContent = `Last update: ${formatTimestamp(lastUpdateTime)}`;
    }
    updateNextCheckTime();
}

function updateNextCheckTime() {
    const nextCheckElement = document.getElementById('next-check-time');
    if (nextCheckElement && lastUpdateTime) {
        const nextCheck = new Date(lastUpdateTime.getTime() + AUTO_REFRESH_INTERVAL);
        nextCheckElement.textContent = formatTimestamp(nextCheck);
    }
}

function setupThemeToggle() {
    document.body.classList.toggle('dark-mode', currentTheme === 'dark');
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.checked = currentTheme === 'dark';
        themeToggle.addEventListener('change', function() {
            currentTheme = this.checked ? 'dark' : 'light';
            document.body.classList.toggle('dark-mode', this.checked);
            localStorage.setItem('theme', currentTheme);
            updateChartsTheme();
        });
    }
}

function setupEventListeners() {
    // Main actions
    setupNavigationListeners();
    setupFilterListeners();
    setupModalListeners();
    setupResourcesListeners();
    setupPodActionListeners();
    
    // Auto-updating filters
    document.querySelectorAll('.auto-update').forEach(element => {
        element.addEventListener('change', () => {
            refreshCurrentView();
        });
    });

    // Search inputs
    document.querySelectorAll('.search-input').forEach(input => {
        input.addEventListener('input', debounce(() => {
            refreshCurrentView();
        }, 300));
    });

    // Configuration forms
    setupConfigurationForms();
}

function setupNavigationListeners() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            showTab(tabId);
        });
    });

    // Handle direct links from dashboard cards
    document.querySelectorAll('.stat-card.clickable').forEach(card => {
        card.addEventListener('click', function(e) {
            e.preventDefault();
            const href = this.getAttribute('href');
            if (href) {
                const [tab, params] = href.substring(1).split('?');
                showTab(tab);
                if (params) {
                    applyUrlParams(params);
                }
            }
        });
    });
}

// Resource handling functions
function setupResourcesListeners() {
    // Initialize charts
    if (Chart) {
        Chart.defaults.color = currentTheme === 'dark' ? '#fff' : '#666';
        Chart.defaults.scale.grid.color = currentTheme === 'dark' ? '#444' : '#ddd';
    }
}

function createResourceChart(canvasId, data, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    const defaultOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: {
                position: 'top',
            }
        }
    };

    return new Chart(ctx, {
        type: options.type || 'line',
        data: data,
        options: { ...defaultOptions, ...options }
    });
}

function updateChartsTheme() {
    Object.values(resourceCharts).forEach(chart => {
        if (chart) {
            chart.options.color = currentTheme === 'dark' ? '#fff' : '#666';
            chart.options.scale.grid.color = currentTheme === 'dark' ? '#444' : '#ddd';
            chart.update();
        }
    });
}

function formatResourceValue(value, type) {
    if (type === 'cpu') {
        return `${(parseFloat(value) * 100).toFixed(1)}%`;
    } else if (type === 'memory' || type === 'disk') {
        // Convert Ki, Mi, Gi to human readable
        const match = value.match(/^(\d+)([KMG]i)?$/);
        if (!match) return value;
        
        const number = parseInt(match[1]);
        const unit = match[2] || '';
        const bytes = number * (HUMAN_READABLE_SIZES[unit] || 1);

        if (bytes >= HUMAN_READABLE_SIZES.Gi) {
            return `${(bytes / HUMAN_READABLE_SIZES.Gi).toFixed(1)} GB`;
        } else if (bytes >= HUMAN_READABLE_SIZES.Mi) {
            return `${(bytes / HUMAN_READABLE_SIZES.Mi).toFixed(1)} MB`;
        } else if (bytes >= HUMAN_READABLE_SIZES.Ki) {
            return `${(bytes / HUMAN_READABLE_SIZES.Ki).toFixed(1)} KB`;
        }
        return `${bytes} B`;
    }
    return value;
}

// Pod management functions
function setupPodActionListeners() {
    document.body.addEventListener('click', function(e) {
        if (e.target.classList.contains('restart-pod-btn')) {
            const podName = e.target.dataset.pod;
            const namespace = e.target.dataset.namespace;
            showRestartConfirmation(podName, namespace);
        }
    });
}

function showRestartConfirmation(podName, namespace) {
    const modal = document.getElementById('password-modal');
    const podNameElement = document.createElement('p');
    podNameElement.textContent = `Pod: ${namespace}/${podName}`;
    podNameElement.classList.add('confirmation-pod-name');
    
    modal.querySelector('.modal-body').insertBefore(
        podNameElement,
        modal.querySelector('.form-group')
    );

    modal.style.display = 'block';
    
    const confirmButton = modal.querySelector('#confirm-restart-btn');
    const passwordInput = modal.querySelector('#restart-password');
    
    const handleConfirm = () => {
        if (passwordInput.value === RESTART_PASSWORD) {
            restartPod(podName, namespace);
            modal.style.display = 'none';
        } else {
            showNotification('Invalid password', 'error');
        }
        passwordInput.value = '';
    };

    confirmButton.onclick = handleConfirm;
    passwordInput.onkeyup = (e) => {
        if (e.key === 'Enter') handleConfirm();
    };

    modal.querySelector('.cancel-btn').onclick = () => {
        modal.style.display = 'none';
        passwordInput.value = '';
    };
}

function restartPod(podName, namespace) {
    fetch(API_ENDPOINTS.RESTART_POD, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ podName, namespace })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            showNotification('Pod restart initiated successfully', 'success');
            setTimeout(refreshDashboard, 5000);
        } else {
            showNotification(`Failed to restart pod: ${data.message}`, 'error');
        }
    })
    .catch(error => {
        showNotification('Error restarting pod', 'error');
        console.error('Pod restart error:', error);
    });
}

// Enhanced pod list functions
function updatePodsList() {
    const podListContainer = document.getElementById('pods-grid');
    if (!podListContainer) return;

    podListContainer.innerHTML = '';
    
    if (Object.keys(podData).length === 0) {
        podListContainer.innerHTML = '<p class="no-data">No pods found</p>';
        return;
    }

    const filteredPods = filterPods(podData);
    
    for (const podKey in filteredPods) {
        const [namespace, podName] = podKey.split('/');
        const pod = filteredPods[podKey];
        const podElement = createPodCard(podName, namespace, pod);
        podListContainer.appendChild(podElement);
    }
}

function createPodCard(podName, namespace, pod) {
    const card = document.createElement('div');
    card.className = `pod-card status-${pod.status.toLowerCase()}`;
    
    const isNew = isNewPod(pod.created_at);
    const imageUpdated = wasImageUpdated(pod.image_last_update);
    
    card.innerHTML = `
        <div class="pod-card-header">
            <h3>
                ${podName}
                ${isNew ? '<span class="badge new">NEW</span>' : ''}
                ${imageUpdated ? '<i class="fas fa-star image-updated" title="Image updated in last 7 days"></i>' : ''}
            </h3>
            <span class="badge status-badge ${pod.status.toLowerCase()}">${pod.status}</span>
        </div>
        <div class="pod-card-body">
            <div class="pod-info">
                <p><strong>Namespace:</strong> ${namespace}</p>
                <p><strong>Node:</strong> ${pod.node}</p>
                <p class="ip-info">
                    <strong>External IP:</strong> 
                    <span class="ip external">${pod.external_ip}</span>
                    ${pod.external_ip ? `
                        <a href="ssh://${pod.external_ip}" class="ssh-link" title="Open SSH Connection">
                            <i class="fas fa-terminal"></i>
                        </a>
                    ` : ''}
                </p>
                <p class="ip-info">
                    <strong>Internal IP:</strong> 
                    <span class="ip internal">${pod.internal_ip || 'N/A'}</span>
                </p>
            </div>
            <div class="pod-resources">
                <div class="resource-graph">
                    <canvas id="cpu-${namespace}-${podName}" height="50"></canvas>
                </div>
                <div class="resource-graph">
                    <canvas id="memory-${namespace}-${podName}" height="50"></canvas>
                </div>
                <div class="resource-graph">
                    <canvas id="disk-${namespace}-${podName}" height="50"></canvas>
                </div>
            </div>
            <div class="pod-ports">
                <strong>Open Ports:</strong>
                <div class="ports-list">
                    ${formatPorts(pod.ports)}
                </div>
            </div>
        </div>
        <div class="pod-card-footer">
            <button class="view-logs-btn" data-namespace="${namespace}" data-pod="${podName}">
                <i class="fas fa-file-alt"></i> Logs
            </button>
            <button class="restart-pod-btn" data-namespace="${namespace}" data-pod="${podName}">
                <i class="fas fa-redo"></i> Restart
            </button>
        </div>
    `;

    // Initialize resource charts
    setTimeout(() => {
        initializePodResourceCharts(namespace, podName, pod);
    }, 0);

    return card;
}

function formatPorts(ports) {
    if (!ports || ports.length === 0) return 'No open ports';
    
    return ports.map(port => `
        <span class="port-badge">
            <i class="fas fa-network-wired"></i>
            ${port}
        </span>
    `).join('');
}

function isNewPod(createdAt) {
    if (!createdAt) return false;
    const created = new Date(createdAt);
    return (Date.now() - created.getTime()) < NEW_POD_THRESHOLD;
}

function wasImageUpdated(lastUpdate) {
    if (!lastUpdate) return false;
    const updated = new Date(lastUpdate);
    return (Date.now() - updated.getTime()) < NEW_POD_THRESHOLD;
}

// Resource charts initialization
function initializePodResourceCharts(namespace, podName, pod) {
    const resources = ['cpu', 'memory', 'disk'];
    resources.forEach(resource => {
        const chartId = `${resource}-${namespace}-${podName}`;
        const data = {
            labels: ['Used', 'Available'],
            datasets: [{
                data: [
                    parseFloat(pod[`${resource}_used`]) || 0,
                    parseFloat(pod[`${resource}_total`]) || 0
                ],
                backgroundColor: [
                    resource === 'cpu' ? '#ff6384' : 
                    resource === 'memory' ? '#36a2eb' : '#ffcd56',
                    '#eee'
                ]
            }]
        };

        const options = {
            type: 'doughnut',
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            return ` ${formatResourceValue(context.raw.toString(), resource)}`;
                        }
                    }
                }
            }
        };

        resourceCharts[chartId] = createResourceChart(chartId, data, options);
    });
}

// Filter functions
function filterPods(pods) {
    const filters = {
        namespace: document.getElementById('namespace-filter')?.value,
        node: document.getElementById('node-filter')?.value,
        status: document.getElementById('status-filter')?.value,
        type: document.getElementById('type-filter')?.value,
        search: document.getElementById('pod-search')?.value.toLowerCase()
    };

    return Object.entries(pods).reduce((filtered, [key, pod]) => {
        const [namespace, podName] = key.split('/');
        
        if (filters.namespace && namespace !== filters.namespace) return filtered;
        if (filters.node && pod.node !== filters.node) return filtered;
        if (filters.status && pod.status !== filters.status) return filtered;
        if (filters.type === 'local' && !podName.includes('local')) return filtered;
        if (filters.search && !podName.toLowerCase().includes(filters.search)) return filtered;
        
        filtered[key] = pod;
        return filtered;
    }, {});
}

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function applyUrlParams(params) {
    const searchParams = new URLSearchParams(params);
    searchParams.forEach((value, key) => {
        const element = document.getElementById(`${key}-filter`);
        if (element) {
            element.value = value;
            element.dispatchEvent(new Event('change'));
        }
    });
}

// Data cleanup function
function setupDataCleanup() {
    const historyDays = parseInt(currentConfig.monitoring?.history_days) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - historyDays);
    
    // Clean up old data from arrays
    Object.keys(podData).forEach(key => {
        const pod = podData[key];
        if (new Date(pod.last_check) < cutoffDate) {
            delete podData[key];
        }
    });
}

// Export necessary functions for external use
window.PodMon = {
    refreshDashboard,
    showRestartConfirmation,
    createResourceChart,
    formatResourceValue
};