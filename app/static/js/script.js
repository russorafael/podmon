// Nome: script.js
// Função: Lógica de interface e interações da aplicação
// Versão: 1.2.0
// Autor: russorafael
// Date: 2025-04-14 11:02:12

// Current system info
const CURRENT_DATE = "2025-04-14 11:02:12";
const CURRENT_USER = "russorafael";

document.addEventListener('DOMContentLoaded', function() {
    // Cache de elementos DOM frequentemente usados
    const elements = {
        refreshButton: document.getElementById('refreshButton'),
        toggleTheme: document.getElementById('toggleTheme'),
        lastRefresh: document.getElementById('lastRefresh'),
        confirmationModal: document.getElementById('confirmationModal'),
        podDetailsModal: document.getElementById('podDetailsModal'),
        confirmPassword: document.getElementById('confirmPassword'),
        confirmYes: document.getElementById('confirmYes'),
        confirmNo: document.getElementById('confirmNo'),
        podsList: document.getElementById('podsList'),
        namespaceFilter: document.getElementById('namespaceFilter'),
        nodeFilter: document.getElementById('nodeFilter'),
        statusFilter: document.getElementById('statusFilter'),
        typeFilter: document.getElementById('typeFilter'),
        podSearch: document.getElementById('podSearch'),
        retentionDate: document.getElementById('retentionDate'),
        cleanupForm: document.getElementById('cleanupForm'),
        monitoringForm: document.getElementById('monitoringForm')
    };

    // Estado global da aplicação
    const state = {
        theme: localStorage.getItem('theme') || 'dark',
        refreshInterval: 600000, // 10 minutos
        refreshTimer: null,
        selectedPod: null,
        podsData: [],
        filters: {
            namespace: '',
            node: '',
            status: '',
            type: '',
            search: ''
        },
        charts: {},
        lastUpdate: new Date(),
        retentionDays: 30
    };

    // Inicialização
    function initialize() {
        applyTheme();
        setupEventListeners();
        setupWebSocket();
        refreshData();
        startRefreshTimer();
        updateRetentionDate();
    }

    // Configuração de WebSocket para atualizações em tempo real
    function setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            handleRealtimeUpdate(data);
        };

        ws.onclose = function() {
            setTimeout(setupWebSocket, 5000); // Tentar reconectar após 5 segundos
        };
    }

    // Manipular atualizações em tempo real
    function handleRealtimeUpdate(data) {
        switch(data.type) {
            case 'pod_status':
                updatePodStatus(data.pod);
                break;
            case 'image_update':
                handleImageUpdate(data.pod);
                break;
            case 'metrics':
                updateMetrics(data.metrics);
                break;
            case 'alert':
                showNotification(data.message, data.level);
                break;
        }
    }

    // Configuração de Event Listeners
    function setupEventListeners() {
        // Botões e controles principais
        elements.refreshButton.addEventListener('click', handleRefresh);
        elements.toggleTheme.addEventListener('click', toggleTheme);
        
        // Filtros de pods com atualização automática
        const filterElements = [
            elements.namespaceFilter,
            elements.nodeFilter,
            elements.statusFilter,
            elements.typeFilter
        ];

        filterElements.forEach(element => {
            element.addEventListener('change', () => {
                updateFilters();
                applyFilters();
            });
        });

        // Pesquisa com debounce
        elements.podSearch.addEventListener('input', debounce(() => {
            state.filters.search = elements.podSearch.value.toLowerCase();
            applyFilters();
        }, 300));

        // Botões de visualização (grid/lista)
        document.querySelectorAll('.view-button').forEach(button => {
            button.addEventListener('click', () => {
                const view = button.dataset.view;
                updateViewMode(view);
            });
        });

        // Formulário de limpeza
        elements.cleanupForm.addEventListener('submit', handleCleanup);

        // Formulário de monitoramento
        elements.monitoringForm.addEventListener('submit', handleMonitoringSettings);

        // Cards clicáveis no dashboard
        document.querySelectorAll('.stat-card.clickable').forEach(card => {
            card.addEventListener('click', () => {
                navigateToFilteredView(card.dataset.page, card.dataset.filter);
            });
        });

        // Links de navegação
        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navigateToPage(link.dataset.page);
            });
        });
    }

    // Funções de atualização de dados
    async function refreshData() {
        try {
            showLoading();
            
            const [podsData, nodesData, historyData] = await Promise.all([
                fetchPodsData(),
                fetchNodesData(),
                fetchHistoryData()
            ]);

            updateDashboard(podsData, nodesData);
            updatePodsList(podsData);
            updateNodesList(nodesData);
            updateHistory(historyData);
            updateCharts(podsData);
            
            state.lastUpdate = new Date();
            elements.lastRefresh.textContent = formatDate(state.lastUpdate);

            hideLoading();
            showNotification('Data refreshed successfully', 'success');
        } catch (error) {
            console.error('Error refreshing data:', error);
            showNotification('Failed to refresh data', 'error');
            hideLoading();
        }
    }


    // Funções de manipulação de dados
    async function fetchPodsData() {
        const response = await fetch('/api/pods');
        if (!response.ok) throw new Error('Failed to fetch pods data');
        return await response.json();
    }

    async function fetchNodesData() {
        const response = await fetch('/api/nodes');
        if (!response.ok) throw new Error('Failed to fetch nodes data');
        return await response.json();
    }

    async function fetchHistoryData() {
        const days = document.getElementById('historyFilter')?.value || 7;
        const response = await fetch(`/api/history?days=${days}`);
        if (!response.ok) throw new Error('Failed to fetch history data');
        return await response.json();
    }

    async function fetchPodMetrics(namespace, podName) {
        const response = await fetch(`/api/metrics/${namespace}/${podName}`);
        if (!response.ok) throw new Error('Failed to fetch pod metrics');
        return await response.json();
    }

    // Funções de atualização da UI
    function updateDashboard(podsData, nodesData) {
        // Contadores
        const stats = calculateStats(podsData);
        document.getElementById('runningPods').textContent = stats.running;
        document.getElementById('warningPods').textContent = stats.warning;
        document.getElementById('failedPods').textContent = stats.failed;
        document.getElementById('activeNodes').textContent = Object.keys(nodesData).length;

        // Atividades recentes
        updateRecentActivities(podsData);
        
        // Atualizar gráficos
        updateResourceCharts(podsData);
    }

    function updatePodsList(podsData) {
        const filteredPods = filterPods(podsData);
        const view = elements.podsList.dataset.view;
        let html = '';

        filteredPods.forEach(pod => {
            html += generatePodCard(pod, view);
        });

        elements.podsList.innerHTML = html;
        setupPodActions();
    }

    function generatePodCard(pod, view) {
        const statusClass = getStatusClass(pod.status);
        const isNew = pod.age_days < 7;
        
        return `
            <div class="pod-item ${view}" data-pod-name="${pod.name}" data-namespace="${pod.namespace}">
                <div class="pod-header">
                    <div class="pod-title">
                        <span class="pod-name">${pod.name}</span>
                        <div class="pod-badges">
                            ${isNew ? '<span class="badge new">New</span>' : ''}
                            ${pod.image_updated ? '<span class="badge updated"><i class="fas fa-star"></i></span>' : ''}
                            <span class="badge ${statusClass}">${pod.status}</span>
                        </div>
                    </div>
                    <div class="pod-actions">
                        <button class="action-button" onclick="showPodDetails('${pod.name}')" title="Details">
                            <i class="fas fa-info-circle"></i>
                        </button>
                        <button class="action-button restart-pod" data-pod="${pod.name}" title="Restart Pod">
                            <i class="fas fa-redo"></i>
                        </button>
                    </div>
                </div>

                <div class="pod-info">
                    <div class="pod-meta">
                        <span class="namespace">${pod.namespace}</span>
                        <span class="node">${pod.node}</span>
                    </div>

                    <div class="pod-ips">
                        ${pod.ips.external ? `
                            <a href="ssh://tiesse@${pod.ips.external}" class="ip-external" title="Connect via SSH">
                                <i class="fas fa-network-wired"></i> ${pod.ips.external}
                            </a>
                        ` : ''}
                        <div class="ip-internal">
                            <i class="fas fa-sitemap"></i> ${pod.ips.internal}
                        </div>
                    </div>

                    <div class="pod-resources">
                        ${generateResourceMetrics(pod.resources)}
                    </div>

                    ${generatePortsInfo(pod.ports)}
                </div>
            </div>
        `;
    }

    function generateResourceMetrics(resources) {
        return `
            <div class="resource-grid">
                <div class="resource-item" title="CPU Usage">
                    <div class="resource-icon">
                        <i class="fas fa-microchip"></i>
                    </div>
                    <div class="resource-data">
                        <div class="resource-value">${resources.cpu}</div>
                        <div class="resource-chart mini">
                            <canvas id="cpu-${generateRandomId()}"></canvas>
                        </div>
                    </div>
                </div>
                <div class="resource-item" title="Memory Usage">
                    <div class="resource-icon">
                        <i class="fas fa-memory"></i>
                    </div>
                    <div class="resource-data">
                        <div class="resource-value">${resources.memory}</div>
                        <div class="resource-chart mini">
                            <canvas id="mem-${generateRandomId()}"></canvas>
                        </div>
                    </div>
                </div>
                <div class="resource-item" title="Disk Usage">
                    <div class="resource-icon">
                        <i class="fas fa-hdd"></i>
                    </div>
                    <div class="resource-data">
                        <div class="resource-value">${resources.disk}</div>
                        <div class="resource-chart mini">
                            <canvas id="disk-${generateRandomId()}"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function generatePortsInfo(ports) {
        if (!ports || ports.length === 0) return '';

        return `
            <div class="pod-ports">
                <span class="ports-label">Ports:</span>
                ${ports.map(port => `
                    <span class="port-badge ${port.is_exposed ? 'exposed' : ''}" 
                          title="${port.name || 'Port'} ${port.is_exposed ? '(Exposed)' : ''}">
                        <i class="fas fa-plug"></i>
                        ${port.port}/${port.protocol}
                        ${port.service_name ? `
                            <span class="service-info">
                                ${port.service_name}:${port.service_port}
                            </span>
                        ` : ''}
                    </span>
                `).join('')}
            </div>
        `;
    }


    // Funções de gráficos e métricas
    function initializeCharts() {
        const defaultOptions = {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 1000
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        };

        // Inicializar gráficos principais
        state.charts = {
            cpu: new Chart(document.getElementById('cpuChart'), {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'CPU Usage',
                        data: [],
                        borderColor: '#4CAF50',
                        tension: 0.4
                    }]
                },
                options: defaultOptions
            }),
            memory: new Chart(document.getElementById('memoryChart'), {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Memory Usage',
                        data: [],
                        borderColor: '#2196F3',
                        tension: 0.4
                    }]
                },
                options: defaultOptions
            }),
            disk: new Chart(document.getElementById('diskChart'), {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Disk Usage',
                        data: [],
                        borderColor: '#FF9800',
                        tension: 0.4
                    }]
                },
                options: defaultOptions
            })
        };
    }

    function updateCharts(podsData) {
        const timestamps = [];
        const cpuData = [];
        const memoryData = [];
        const diskData = [];

        podsData.forEach(pod => {
            if (pod.metrics) {
                timestamps.push(formatTime(pod.metrics.timestamp));
                cpuData.push(parseFloat(pod.metrics.cpu.replace('m', '')));
                memoryData.push(parseFloat(pod.metrics.memory));
                diskData.push(parseFloat(pod.metrics.disk.replace('%', '')));
            }
        });

        Object.entries(state.charts).forEach(([type, chart]) => {
            const data = type === 'cpu' ? cpuData : 
                        type === 'memory' ? memoryData : diskData;

            chart.data.labels = timestamps;
            chart.data.datasets[0].data = data;
            chart.update('none');
        });
    }

    // Sistema de filtros
    function updateFilters() {
        state.filters = {
            namespace: elements.namespaceFilter.value,
            node: elements.nodeFilter.value,
            status: elements.statusFilter.value,
            type: elements.typeFilter.value,
            search: elements.podSearch.value.toLowerCase()
        };
    }

    function filterPods(pods) {
        return pods.filter(pod => {
            const matchesNamespace = !state.filters.namespace || 
                                   pod.namespace === state.filters.namespace;
            const matchesNode = !state.filters.node || 
                              pod.node === state.filters.node;
            const matchesStatus = !state.filters.status || 
                                getStatusClass(pod.status) === state.filters.status;
            const matchesType = !state.filters.type || 
                              matchesPodType(pod, state.filters.type);
            const matchesSearch = !state.filters.search || 
                                pod.name.toLowerCase().includes(state.filters.search) ||
                                pod.namespace.toLowerCase().includes(state.filters.search);

            return matchesNamespace && matchesNode && 
                   matchesStatus && matchesType && matchesSearch;
        });
    }

    function matchesPodType(pod, type) {
        switch(type) {
            case 'local':
                return pod.is_local;
            case 'new':
                return pod.is_new;
            case 'updated':
                return pod.image_updated;
            default:
                return true;
        }
    }

    // Sistema de notificações
    function showNotification(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas ${getNotificationIcon(type)}"></i>
            <span>${message}</span>
            <button class="close-notification">&times;</button>
        `;

        const container = document.getElementById('notificationContainer');
        container.appendChild(notification);

        // Animação de entrada
        setTimeout(() => notification.classList.add('show'), 10);

        // Auto-remoção
        const timeout = setTimeout(() => removeNotification(notification), duration);

        // Botão de fechar
        notification.querySelector('.close-notification').addEventListener('click', () => {
            clearTimeout(timeout);
            removeNotification(notification);
        });
    }

    function removeNotification(notification) {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }

    function getNotificationIcon(type) {
        switch(type) {
            case 'success': return 'fa-check-circle';
            case 'error': return 'fa-times-circle';
            case 'warning': return 'fa-exclamation-circle';
            default: return 'fa-info-circle';
        }
    }


    // Gerenciamento de modais
    function showPodDetails(podName) {
        const pod = state.podsData.find(p => p.name === podName);
        if (!pod) return;

        state.selectedPod = pod;
        const modal = elements.podDetailsModal;
        const content = modal.querySelector('.modal-body');

        content.innerHTML = `
            <div class="pod-details">
                <div class="details-section">
                    <h4>General Information</h4>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="label">Name:</span>
                            <span class="value">${pod.name}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Namespace:</span>
                            <span class="value">${pod.namespace}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Node:</span>
                            <span class="value">${pod.node}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Status:</span>
                            <span class="value status-${getStatusClass(pod.status)}">${pod.status}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Age:</span>
                            <span class="value">${pod.age_days} days</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Created:</span>
                            <span class="value">${formatDate(pod.creation_time)}</span>
                        </div>
                    </div>
                </div>

                <div class="details-section">
                    <h4>Resource Usage</h4>
                    <div class="metrics-grid">
                        <div class="metric-chart">
                            <canvas id="detailsCpuChart"></canvas>
                        </div>
                        <div class="metric-chart">
                            <canvas id="detailsMemoryChart"></canvas>
                        </div>
                        <div class="metric-chart">
                            <canvas id="detailsDiskChart"></canvas>
                        </div>
                    </div>
                </div>

                <div class="details-section">
                    <h4>Network Information</h4>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="label">Internal IP:</span>
                            <span class="value">${pod.ips.internal || 'N/A'}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">External IP:</span>
                            <span class="value">${pod.ips.external || 'N/A'}</span>
                        </div>
                    </div>
                    ${generateDetailedPortsTable(pod.ports)}
                </div>

                <div class="details-section">
                    <h4>Container Information</h4>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="label">Image:</span>
                            <span class="value">${pod.image}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Last Update:</span>
                            <span class="value">${pod.image_updated ? 'Recently Updated' : 'No Recent Updates'}</span>
                        </div>
                    </div>
                </div>

                <div class="details-actions">
                    <button class="btn" onclick="restartPod('${pod.name}', '${pod.namespace}')">
                        <i class="fas fa-redo"></i> Restart Pod
                    </button>
                    <button class="btn" onclick="showPodLogs('${pod.name}', '${pod.namespace}')">
                        <i class="fas fa-file-alt"></i> View Logs
                    </button>
                    <button class="btn" onclick="openSSH('${pod.ips.external}')">
                        <i class="fas fa-terminal"></i> SSH Connect
                    </button>
                </div>
            </div>
        `;

        initializeDetailCharts(pod);
        modal.classList.add('show');
    }

    function generateDetailedPortsTable(ports) {
        if (!ports || ports.length === 0) return '<p>No ports exposed</p>';

        return `
            <table class="ports-table">
                <thead>
                    <tr>
                        <th>Port</th>
                        <th>Protocol</th>
                        <th>Service</th>
                        <th>External</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${ports.map(port => `
                        <tr>
                            <td>${port.port}</td>
                            <td>${port.protocol}</td>
                            <td>${port.service_name || 'N/A'}</td>
                            <td>${port.service_port || 'N/A'}</td>
                            <td>
                                <span class="status-badge ${port.is_exposed ? 'exposed' : ''}">
                                    ${port.is_exposed ? 'Exposed' : 'Internal'}
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }


    // Funções de configuração
    async function saveConfig(config) {
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });

            if (!response.ok) throw new Error('Failed to save configuration');
            showNotification('Configuration saved successfully', 'success');
            return await response.json();
        } catch (error) {
            showNotification('Failed to save configuration', 'error');
            throw error;
        }
    }

    function updateConfigForms(config) {
        // Email settings
        document.getElementById('emailEnabled').checked = config.email.enabled;
        document.getElementById('smtpServer').value = config.email.smtp_server;
        document.getElementById('smtpPort').value = config.email.smtp_port;
        document.getElementById('emailUsername').value = config.email.username;
        document.getElementById('emailRecipients').innerHTML = generateRecipientTags(config.email.recipients);

        // WhatsApp settings
        document.getElementById('whatsappEnabled').checked = config.whatsapp.enabled;
        document.getElementById('whatsappApiUrl').value = config.whatsapp.api_url;
        document.getElementById('whatsappRecipients').innerHTML = generateRecipientTags(config.whatsapp.recipients);

        // Monitoring settings
        document.getElementById('refreshInterval').value = config.monitoring.refresh_interval;
        document.getElementById('retentionDays').value = config.monitoring.retention_days;
        document.getElementById('namespaces').innerHTML = generateNamespaceTags(config.monitoring.namespaces);
    }

    // Utilitários gerais
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

    function generateRandomId() {
        return Math.random().toString(36).substr(2, 9);
    }

    function getStatusClass(status) {
        status = status.toLowerCase();
        if (status === 'running') return 'healthy';
        if (status === 'pending' || status === 'unknown') return 'warning';
        return 'error';
    }

    // Formatação e helpers
    function formatDate(date) {
        if (typeof date === 'string') date = new Date(date);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatTime(time) {
        return new Date(time).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    function generateRecipientTags(recipients) {
        return recipients.map(recipient => `
            <div class="tag">
                <span>${recipient}</span>
                <button class="remove-tag" data-value="${recipient}">&times;</button>
            </div>
        `).join('');
    }

    function generateNamespaceTags(namespaces) {
        return namespaces.map(namespace => `
            <div class="tag">
                <span>${namespace}</span>
                <button class="remove-tag" data-value="${namespace}">&times;</button>
            </div>
        `).join('');
    }

    // Inicialização da aplicação
    function startApp() {
        initialize();
        initializeCharts();
        setupEventListeners();
        refreshData();

        // Atualizar a cada 10 minutos por padrão
        setInterval(refreshData, state.refreshInterval);
    }

    // Iniciar a aplicação quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp);
    } else {
        startApp();
    }
})(); // Final do IIFE (Immediately Invoked Function Expression)
    