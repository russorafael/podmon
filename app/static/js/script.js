/**
 * Name: script.js
 * Function: Frontend JavaScript for PodMon monitoring system
 * Version: 2.0.0
 * Author: russorafael
 * Date: 2025-04-14 14:36:15
 */

// Configuração global
const config = {
    refreshInterval: 600000, // 10 minutos em milissegundos
    newPodThreshold: 7, // dias
    darkMode: localStorage.getItem('darkMode') === 'true',
    adminPassword: 'tiesseadm', // Senha padrão, deve ser alterada em produção
    charts: {
        cpu: null,
        memory: null,
        disk: null
    }
};

// Cache de elementos do DOM
const elements = {
    pages: {
        dashboard: document.getElementById('dashboard'),
        pods: document.getElementById('pods'),
        nodes: document.getElementById('nodes'),
        emailSettings: document.getElementById('email-settings'),
        whatsappSettings: document.getElementById('whatsapp-settings'),
        monitorSettings: document.getElementById('monitor-settings'),
        dataCleanup: document.getElementById('data-cleanup')
    },
    lists: {
        pods: document.getElementById('podsList'),
        nodes: document.getElementById('nodesList'),
        podRestarts: document.getElementById('podRestarts'),
        imageUpdates: document.getElementById('imageUpdates')
    },
    counters: {
        runningPods: document.getElementById('runningPods'),
        warningPods: document.getElementById('warningPods'),
        failedPods: document.getElementById('failedPods'),
        activeNodes: document.getElementById('activeNodes'),
        totalPods: document.getElementById('totalPods'),
        totalNodes: document.getElementById('totalNodes')
    },
    charts: {
        cpu: document.getElementById('cpuChart'),
        memory: document.getElementById('memoryChart'),
        disk: document.getElementById('diskChart')
    },
    filters: {
        namespace: document.getElementById('namespaceFilter'),
        node: document.getElementById('nodeFilter'),
        status: document.getElementById('statusFilter'),
        type: document.getElementById('typeFilter'),
        search: document.getElementById('podSearch'),
        quickNamespace: document.getElementById('quickNamespace'),
        quickNode: document.getElementById('quickNode')
    },
    modals: {
        podDetails: document.getElementById('podDetailsModal'),
        confirmation: document.getElementById('confirmationModal')
    },
    forms: {
        emailSettings: document.getElementById('emailSettingsForm'),
        whatsappSettings: document.getElementById('whatsappSettingsForm'),
        monitorSettings: document.getElementById('monitorSettingsForm'),
        cleanupSettings: document.getElementById('cleanupSettingsForm')
    },
    lastRefresh: document.getElementById('lastRefresh'),
    notificationContainer: document.getElementById('notificationContainer'),
    themeToggle: document.getElementById('toggleTheme'),
    refreshButton: document.getElementById('refreshButton')
};

// Cache de dados
let dashboardData = {
    pods: [],
    nodes: [],
    metrics: {},
    history: {},
    settings: {}
};

// API Client
const api = {
    async getPods() {
        try {
            const response = await fetch('/api/pods');
            if (!response.ok) throw new Error('Failed to fetch pods');
            return await response.json();
        } catch (error) {
            console.error('Error fetching pods:', error);
            showNotification('Failed to fetch pods data', 'error');
            return [];
        }
    },

    async getNodes() {
        try {
            const response = await fetch('/api/nodes');
            if (!response.ok) throw new Error('Failed to fetch nodes');
            return await response.json();
        } catch (error) {
            console.error('Error fetching nodes:', error);
            showNotification('Failed to fetch nodes data', 'error');
            return [];
        }
    },

    async getMetrics(type, name, timeframe = '1h') {
        try {
            const response = await fetch(`/api/metrics/${type}/${name}?timeframe=${timeframe}`);
            if (!response.ok) throw new Error('Failed to fetch metrics');
            return await response.json();
        } catch (error) {
            console.error('Error fetching metrics:', error);
            showNotification('Failed to fetch metrics data', 'error');
            return {};
        }
    },

    async getHistory(days = 7) {
        try {
            const response = await fetch(`/api/history?days=${days}`);
            if (!response.ok) throw new Error('Failed to fetch history');
            return await response.json();
        } catch (error) {
            console.error('Error fetching history:', error);
            showNotification('Failed to fetch history data', 'error');
            return {};
        }
    },

    async getSettings() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('Failed to fetch settings');
            return await response.json();
        } catch (error) {
            console.error('Error fetching settings:', error);
            showNotification('Failed to fetch settings', 'error');
            return {};
        }
    },

    async updateSettings(settings, password) {
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ...settings, password })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to update settings');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error updating settings:', error);
            showNotification(error.message, 'error');
            throw error;
        }
    },

    async restartPod(podName, namespace, password) {
        try {
            const response = await fetch('/api/pod/restart', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pod_name: podName,
                    namespace,
                    password
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to restart pod');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error restarting pod:', error);
            showNotification(error.message, 'error');
            throw error;
        }
    },

    async runCleanup(password) {
        try {
            const response = await fetch('/api/cleanup/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to run cleanup');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error running cleanup:', error);
            showNotification(error.message, 'error');
            throw error;
        }
    }
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    startAutoRefresh();
});

async function initializeApp() {
    showLoading(true);
    try {
        // Carregar configurações
        dashboardData.settings = await api.getSettings();
        
        // Carregar dados iniciais
        await Promise.all([
            loadDashboardData(),
            updateTheme(),
            initializeCharts()
        ]);
        
        // Preencher filtros
        populateFilters();
        
        // Atualizar formulários com configurações
        updateSettingsForms();
        
    } catch (error) {
        console.error('Error initializing app:', error);
        showNotification('Failed to initialize application', 'error');
    } finally {
        showLoading(false);
    }
}

function setupEventListeners() {
    // Navegação
    document.querySelectorAll('[data-page]').forEach(link => {
        link.addEventListener('click', handleNavigation);
    });

    // Tema
    elements.themeToggle?.addEventListener('click', toggleTheme);

    // Refresh
    elements.refreshButton?.addEventListener('click', handleManualRefresh);

    // Filtros
    Object.values(elements.filters).forEach(filter => {
        if (filter) {
            filter.addEventListener('change', handleFilterChange);
        }
    });

    // Forms
    setupFormListeners();
}

function setupFormListeners() {
    // Email Settings
    elements.forms.emailSettings?.addEventListener('submit', handleEmailSettings);
    document.getElementById('testEmail')?.addEventListener('click', handleTestEmail);

    // WhatsApp Settings
    elements.forms.whatsappSettings?.addEventListener('submit', handleWhatsAppSettings);
    document.getElementById('testWhatsApp')?.addEventListener('click', handleTestWhatsApp);

    // Monitor Settings
    elements.forms.monitorSettings?.addEventListener('submit', handleMonitorSettings);

    // Cleanup Settings
    elements.forms.cleanupSettings?.addEventListener('submit', handleCleanupSettings);
    document.getElementById('runCleanup')?.addEventListener('click', handleManualCleanup);

    // Tag inputs
    setupTagInputs();
}

// Adicionar manipulador de configurações SMS
async function handleSmsSettings(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const settings = {
        sms: {
            enabled: formData.get('smsEnabled') === 'on',
            api_url: formData.get('smsApiUrl'),
            api_token: formData.get('smsApiToken'),
            recipients: getTagsFromContainer('smsPhoneTags')
        }
    };
    
    try {
        await api.updateSettings(settings, config.adminPassword);
        showNotification('Configurações de SMS atualizadas com sucesso', 'success');
    } catch (error) {
        showNotification('Falha ao atualizar configurações de SMS', 'error');
    }
}

// Adicionar event listener para o formulário de configurações SMS
document.getElementById('smsSettingsForm').addEventListener('submit', handleSmsSettings);

// Adicionar funcionalidade de teste SMS
document.getElementById('testSms').addEventListener('click', async () => {
    try {
        await api.testSms(config.adminPassword);
        showNotification('SMS de teste enviado com sucesso', 'success');
    } catch (error) {
        showNotification('Falha ao enviar SMS de teste', 'error');
    }
});

// Adicionar manipulação de tags para destinatários SMS
setupTagInput('smsPhoneInput', 'smsPhoneTags', validatePhoneNumber);

function validatePhoneNumber(phone) {
    // Validação básica de número de telefone (pode ser aprimorada conforme necessário)
    return /^\+\d{1,3}\d{6,14}$/.test(phone);
}


// UI Updates
async function loadDashboardData() {
    showLoading(true);
    try {
        const [pods, nodes, history] = await Promise.all([
            api.getPods(),
            api.getNodes(),
            api.getHistory()
        ]);

        dashboardData = {
            ...dashboardData,
            pods,
            nodes,
            history
        };

        updateDashboard();
        updateLastRefreshTime();
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showNotification('Failed to load dashboard data', 'error');
    } finally {
        showLoading(false);
    }
}

function updateDashboard() {
    updatePodsList();
    updateNodesList();
    updateResourceCharts();
    updateCounters();
    updateActivityLists();
}

function updatePodsList() {
    if (!elements.lists.pods) return;

    const filteredPods = dashboardData.pods.filter(applyFilters);
    const podsHTML = filteredPods.map(createPodCard).join('');

    elements.lists.pods.innerHTML = podsHTML || '<div class="no-data">No pods found</div>';
}

function createPodCard(pod) {
    const statusClass = getPodStatusClass(pod.status);
    const isNew = isNewPod(pod);
    
    return `
        <div class="pod-card ${statusClass}">
            <div class="pod-header">
                <h3>${pod.name}</h3>
                ${isNew ? '<span class="new-badge">NEW</span>' : ''}
                ${pod.image_updated ? '<span class="update-badge">★</span>' : ''}
            </div>
            <div class="pod-info">
                <p class="namespace">Namespace: ${pod.namespace}</p>
                <p class="node">Node: ${pod.node}</p>
                <div class="resource-usage">
                    <div class="resource">
                        <span>CPU:</span> ${formatCPU(pod.resources.cpu)}
                    </div>
                    <div class="resource">
                        <span>Memory:</span> ${formatMemory(pod.resources.memory)}
                    </div>
                    <div class="resource">
                        <span>Disk:</span> ${formatDisk(pod.resources.disk)}
                    </div>
                </div>
            </div>
            <div class="pod-ports">
                ${createPortsList(pod.ports)}
            </div>
            <div class="pod-actions">
                <button class="button primary" onclick="showPodDetails('${pod.name}', '${pod.namespace}')">
                    Details
                </button>
                <button class="button danger" onclick="confirmPodRestart('${pod.name}', '${pod.namespace}')">
                    Restart
                </button>
            </div>
        </div>
    `;
}

function createPortsList(ports) {
    if (!ports || !ports.length) return '';
    
    return `
        <div class="ports-list">
            ${ports.map(port => `
                <span class="port-item">
                    ${port.port}${port.protocol !== 'TCP' ? '/' + port.protocol : ''}
                    ${port.is_exposed ? `
                        <a href="${port.access_url}" target="_blank" class="external-link">
                            <i class="fas fa-external-link-alt"></i>
                        </a>
                    ` : ''}
                </span>
            `).join('')}
        </div>
    `;
}

function updateNodesList() {
    if (!elements.lists.nodes) return;

    const nodesHTML = Object.entries(dashboardData.nodes)
        .map(([nodeName, nodeInfo]) => createNodeCard(nodeName, nodeInfo))
        .join('');

    elements.lists.nodes.innerHTML = nodesHTML || '<div class="no-data">No nodes found</div>';
}

function createNodeCard(nodeName, nodeInfo) {
    return `
        <div class="node-card ${nodeInfo.status === 'Ready' ? 'ready' : 'not-ready'}">
            <h3>${nodeName}</h3>
            <div class="node-info">
                <p class="status">Status: ${nodeInfo.status}</p>
                <p class="pods">Pods: ${nodeInfo.pods}</p>
                <div class="node-resources">
                    <div class="resource">
                        <span>CPU:</span> ${nodeInfo.cpu}
                    </div>
                    <div class="resource">
                        <span>Memory:</span> ${nodeInfo.memory}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function updateResourceCharts() {
    if (!elements.charts.cpu) return;

    updateChart('cpu');
    updateChart('memory');
    updateChart('disk');
}

function updateChart(type) {
    const canvas = elements.charts[type];
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const data = getChartData(type);

    if (config.charts[type]) {
        config.charts[type].destroy();
    }

    config.charts[type] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                data: data.values,
                backgroundColor: getChartColors(data.values.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let value = context.raw;
                            switch (type) {
                                case 'cpu':
                                    return value + ' Cores';
                                case 'memory':
                                    return formatMemory(value);
                                case 'disk':
                                    return value + '%';
                                default:
                                    return value;
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            switch (type) {
                                case 'cpu':
                                    return value + ' Cores';
                                case 'memory':
                                    return formatMemory(value);
                                case 'disk':
                                    return value + '%';
                                default:
                                    return value;
                            }
                        }
                    }
                }
            }
        }
    });
}

function updateCounters() {
    const pods = dashboardData.pods;
    
    if (elements.counters.runningPods) {
        elements.counters.runningPods.textContent = 
            pods.filter(pod => pod.status === 'Running').length;
    }
    
    if (elements.counters.warningPods) {
        elements.counters.warningPods.textContent = 
            pods.filter(pod => pod.status === 'Warning').length;
    }
    
    if (elements.counters.failedPods) {
        elements.counters.failedPods.textContent = 
            pods.filter(pod => pod.status === 'Failed').length;
    }
    
    if (elements.counters.activeNodes) {
        elements.counters.activeNodes.textContent = 
            Object.values(dashboardData.nodes).filter(node => node.status === 'Ready').length;
    }
    
    if (elements.counters.totalPods) {
        elements.counters.totalPods.textContent = pods.length;
    }
    
    if (elements.counters.totalNodes) {
        elements.counters.totalNodes.textContent = Object.keys(dashboardData.nodes).length;
    }
}

function updateActivityLists() {
    if (elements.lists.podRestarts) {
        const restartsHTML = dashboardData.history
            .filter(change => change.change_type === 'status')
            .map(createActivityItem)
            .join('');
        
        elements.lists.podRestarts.innerHTML = restartsHTML || 
            '<div class="no-data">No recent restarts</div>';
    }
    
    if (elements.lists.imageUpdates) {
        const updatesHTML = dashboardData.history
            .filter(change => change.change_type === 'image')
            .map(createActivityItem)
            .join('');
        
        elements.lists.imageUpdates.innerHTML = updatesHTML || 
            '<div class="no-data">No recent image updates</div>';
    }
}

function createActivityItem(activity) {
    const date = new Date(activity.created_at).toLocaleString();
    const isStatusChange = activity.change_type === 'status';
    
    return `
        <div class="activity-item">
            <div class="activity-header">
                <span class="activity-pod">${activity.pod_name}</span>
                <span class="activity-time">${date}</span>
            </div>
            <div class="activity-details">
                ${isStatusChange ? 
                    `Status changed from <span class="status-${activity.old_value.toLowerCase()}">${activity.old_value}</span> 
                     to <span class="status-${activity.new_value.toLowerCase()}">${activity.new_value}</span>` :
                    `Image updated from <span class="image-tag">${activity.old_value}</span> 
                     to <span class="image-tag">${activity.new_value}</span>`}
            </div>
        </div>
    `;
}

// Event Handlers
function handleNavigation(event) {
    event.preventDefault();
    const targetPage = event.currentTarget.dataset.page;
    showPage(targetPage);
}

function handleFilterChange() {
    updatePodsList();
}

async function handleManualRefresh() {
    await loadDashboardData();
    showNotification('Dashboard refreshed successfully', 'success');
}

async function handleEmailSettings(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const settings = {
        email: {
            enabled: formData.get('emailEnabled') === 'on',
            smtp_server: formData.get('smtpServer'),
            smtp_port: parseInt(formData.get('smtpPort')),
            username: formData.get('smtpUsername'),
            password: formData.get('smtpPassword'),
            recipients: getTagsFromContainer('emailTags')
        }
    };
    
    try {
        await api.updateSettings(settings, config.adminPassword);
        showNotification('Email settings updated successfully', 'success');
    } catch (error) {
        showNotification('Failed to update email settings', 'error');
    }
}

async function handleWhatsAppSettings(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const settings = {
        whatsapp: {
            enabled: formData.get('whatsappEnabled') === 'on',
            api_url: formData.get('apiUrl'),
            api_token: formData.get('apiToken'),
            recipients: getTagsFromContainer('phoneTags')
        }
    };
    
    try {
        await api.updateSettings(settings, config.adminPassword);
        showNotification('WhatsApp settings updated successfully', 'success');
    } catch (error) {
        showNotification('Failed to update WhatsApp settings', 'error');
    }
}

async function handleMonitorSettings(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const settings = {
        monitoring: {
            refresh_interval: parseInt(formData.get('refreshInterval')) * 60, // Convert to seconds
            retention_days: parseInt(formData.get('historyRetention')),
            namespaces: getTagsFromContainer('namespaceTags'),
            alert_on_status_change: formData.get('alertStatusChange') === 'on',
            alert_on_image_update: formData.get('alertImageUpdate') === 'on'
        }
    };
    
    try {
        await api.updateSettings(settings, config.adminPassword);
        showNotification('Monitor settings updated successfully', 'success');
        
        // Update refresh interval if changed
        if (settings.monitoring.refresh_interval !== config.refreshInterval / 1000) {
            config.refreshInterval = settings.monitoring.refresh_interval * 1000;
            startAutoRefresh();
        }
    } catch (error) {
        showNotification('Failed to update monitor settings', 'error');
    }
}

async function handleCleanupSettings(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const settings = {
        cleanup: {
            retention_days: parseInt(formData.get('retentionDays')),
            cleanup_time: formData.get('cleanupTime')
        }
    };
    
    try {
        await api.updateSettings(settings, config.adminPassword);
        showNotification('Cleanup settings updated successfully', 'success');
    } catch (error) {
        showNotification('Failed to update cleanup settings', 'error');
    }
}

async function handleManualCleanup() {
    showConfirmationModal(
        'Are you sure you want to run cleanup now? This will remove old data permanently.',
        async (password) => {
            try {
                await api.runCleanup(password);
                showNotification('Cleanup completed successfully', 'success');
            } catch (error) {
                showNotification('Failed to run cleanup', 'error');
            }
        }
    );
}

// Utility Functions
function showPage(pageId) {
    Object.values(elements.pages).forEach(page => {
        if (page) {
            page.classList.toggle('active', page.id === pageId);
        }
    });

    document.querySelectorAll('[data-page]').forEach(link => {
        link.classList.toggle('active', link.dataset.page === pageId);
    });
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    elements.notificationContainer.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
}

function showLoading(show) {
    document.body.classList.toggle('loading', show);
}

function updateLastRefreshTime() {
    if (elements.lastRefresh) {
        elements.lastRefresh.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
    }
}

function toggleTheme() {
    config.darkMode = !config.darkMode;
    localStorage.setItem('darkMode', config.darkMode);
    updateTheme();
}

function updateTheme() {
    document.body.classList.toggle('dark-mode', config.darkMode);
    if (elements.themeToggle) {
        elements.themeToggle.querySelector('i').className = 
            config.darkMode ? 'fas fa-sun' : 'fas fa-moon';
    }
}

function formatCPU(cpu) {
    if (typeof cpu === 'string') {
        if (cpu.endsWith('m')) {
            return `${parseInt(cpu) / 1000} Cores`;
        }
    }
    return `${cpu} Cores`;
}

function formatMemory(memory) {
    const units = ['Ki', 'Mi', 'Gi'];
    let value = parseInt(memory);
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    return `${value.toFixed(2)}${units[unitIndex]}`;
}

function formatDisk(disk) {
    return typeof disk === 'string' ? disk : `${disk}%`;
}

function getPodStatusClass(status) {
    const statusMap = {
        'Running': 'status-running',
        'Warning': 'status-warning',
        'Failed': 'status-failed'
    };
    return statusMap[status] || 'status-unknown';
}

function getChartColors(count) {
    const colors = [
        '#2196F3', '#4CAF50', '#FFC107', '#F44336',
        '#9C27B0', '#00BCD4', '#FF9800', '#795548'
    ];
    
    return Array(count).fill().map((_, i) => colors[i % colors.length]);
}

function getChartData(type) {
    const data = {
        labels: [],
        values: []
    };

    switch (type) {
        case 'cpu':
        case 'memory':
        case 'disk':
            dashboardData.pods.forEach(pod => {
                data.labels.push(pod.name);
                data.values.push(parseFloat(pod.resources[type]));
            });
            break;
    }

    return data;
}

function applyFilters(pod) {
    const namespace = elements.filters.namespace?.value || '';
    const node = elements.filters.node?.value || '';
    const status = elements.filters.status?.value || '';
    const type = elements.filters.type?.value || '';
    const search = elements.filters.search?.value.toLowerCase() || '';

    return (!namespace || pod.namespace === namespace) &&
           (!node || pod.node === node) &&
           (!status || pod.status.toLowerCase() === status) &&
           (!type || matchesType(pod, type)) &&
           (!search || pod.name.toLowerCase().includes(search));
}

function matchesType(pod, type) {
    switch (type) {
        case 'local':
            return pod.is_local;
        case 'new':
            return isNewPod(pod);
        case 'updated':
            return pod.image_updated;
        default:
            return true;
    }
}

function isNewPod(pod) {
    const creationDate = new Date(pod.creation_time);
    const now = new Date();
    const diffDays = (now - creationDate) / (1000 * 60 * 60 * 24);
    return diffDays < config.newPodThreshold;
}

function showConfirmationModal(message, onConfirm) {
    const modal = elements.modals.confirmation;
    if (!modal) return;

    document.getElementById('confirmationMessage').textContent = message;
    document.getElementById('confirmPassword').value = '';

    modal.classList.add('active');

    const handleConfirm = async () => {
        const password = document.getElementById('confirmPassword').value;
        modal.classList.remove('active');
        await onConfirm(password);
    };

    const handleCancel = () => {
        modal.classList.remove('active');
    };

    document.getElementById('confirmYes').onclick = handleConfirm;
    document.getElementById('confirmNo').onclick = handleCancel;
    modal.querySelector('.close-button').onclick = handleCancel;
}

// script.js - Adicionar
const CONFIG = {
    refreshInterval: 600000,  // 10 minutes in milliseconds
    retentionDays: 7,
    defaultViewPeriod: 7,
    timeouts: {
        api: 30000,      // 30 seconds
        notification: 5000
    }
};

// script.js - Adicionar
const MESSAGES = {
    errors: {
        api: 'Failed to communicate with server',
        auth: 'Authentication failed',
        validation: 'Please check your input'
    },
    success: {
        saved: 'Changes saved successfully',
        restarted: 'Pod restarted successfully',
        cleaned: 'Cleanup completed successfully'
    }
};

// Adicionar tratamento de erro global
window.onerror = function(msg, url, line, col, error) {
    console.error("Error: ", msg, url, line, col, error);
    showNotification('An error occurred. Please try refreshing the page.', 'error');
    return false;
};

// Melhorar função de inicialização
async function initializeApplication() {
    try {
        // Verificar saúde da aplicação
        const health = await fetch('/health');
        if (!health.ok) {
            throw new Error('Application is not healthy');
        }

        // Carregar configurações
        await loadConfig();
        
        // Iniciar monitores
        startMonitoring();
        
        // Configurar event listeners
        setupEventListeners();
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        showNotification('Failed to initialize application. Please check the server logs.', 'error');
    }
}

// Melhorar função de atualização
async function updateDashboard() {
    try {
        const [podsResponse, nodesResponse] = await Promise.all([
            fetch('/api/pods'),
            fetch('/api/nodes')
        ]);

        if (!podsResponse.ok || !nodesResponse.ok) {
            throw new Error('Failed to fetch data');
        }

        const pods = await podsResponse.json();
        const nodes = await nodesResponse.json();

        updatePodStats(pods);
        updateNodeStats(nodes);
        updateCharts(pods, nodes);
        
    } catch (error) {
        console.error('Error updating dashboard:', error);
        showNotification('Failed to update dashboard', 'error');
    }
}


// Tag Input Handling
function setupTagInputs() {
    setupTagInput('recipientInput', 'emailTags');
    setupTagInput('phoneInput', 'phoneTags');
    setupTagInput('namespaceInput', 'namespaceTags');
}

function setupTagInput(inputId, containerId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const value = input.value.trim();
            if (value) {
                addTag(value, containerId);
                input.value = '';
            }
        }
    });
}

function addTag(value, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `
        ${value}
        <span class="remove" onclick="removeTag(this.parentElement)">×</span>
    `;
    container.appendChild(tag);
}

function removeTag(tag) {
    tag.remove();
}

function getTagsFromContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];

    return Array.from(container.getElementsByClassName('tag'))
        .map(tag => tag.textContent.trim().replace('×', ''));
}

// Auto-refresh
function startAutoRefresh() {
    // Clear existing interval if any
    if (window.refreshInterval) {
        clearInterval(window.refreshInterval);
    }
    
    // Start new interval
    window.refreshInterval = setInterval(loadDashboardData, config.refreshInterval);
}

// Initialize application
initializeApp();