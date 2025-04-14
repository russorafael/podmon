// Nome: script.js
// Função: Lógica de interface e interações da aplicação
// Versão: 1.2.0
// Autor: russorafael
// Data: 2025-04-14 09:27:24

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
        retentionDate: document.getElementById('retentionDate')
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
        lastUpdate: new Date()
    };

    // Inicialização
    function initialize() {
        applyTheme();
        setupEventListeners();
        refreshData();
        startRefreshTimer();
        updateRetentionDate();
    }

    // Configuração de Event Listeners
    function setupEventListeners() {
        // Botão de atualização
        elements.refreshButton.addEventListener('click', () => {
            refreshData();
            animateRefreshButton();
        });

        // Alternador de tema
        elements.toggleTheme.addEventListener('click', () => {
            state.theme = state.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', state.theme);
            applyTheme();
        });

        // Filtros
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

        // Pesquisa
        elements.podSearch.addEventListener('input', debounce(() => {
            state.filters.search = elements.podSearch.value.toLowerCase();
            applyFilters();
        }, 300));

        // Navegação
        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navigateToPage(link.getAttribute('data-page'));
            });
        });

        // Cards clicáveis
        document.querySelectorAll('.stat-card.clickable').forEach(card => {
            card.addEventListener('click', () => {
                const page = card.getAttribute('data-page');
                const filter = card.getAttribute('data-filter');
                navigateToPageWithFilter(page, filter);
            });
        });
    }

    // Funções de Atualização de Dados
    async function refreshData() {
        try {
            const response = await fetch('/api/pods');
            state.podsData = await response.json();
            
            updateDashboard();
            updatePodsList();
            updateCharts();
            updateLastRefresh();
            
            showNotification('Data refreshed successfully', 'success');
        } catch (error) {
            console.error('Error fetching data:', error);
            showNotification('Failed to refresh data', 'error');
        }
    }

    function updateDashboard() {
        const stats = calculateStats();
        
        // Atualizar contadores
        document.getElementById('runningPods').textContent = stats.running;
        document.getElementById('warningPods').textContent = stats.warning;
        document.getElementById('failedPods').textContent = stats.failed;
        document.getElementById('activeNodes').textContent = stats.nodes.size;

        // Atualizar histórico de atividades
        updateActivityHistory();
    }

    function calculateStats() {
        const stats = {
            running: 0,
            warning: 0,
            failed: 0,
            nodes: new Set(),
            resources: {
                cpu: 0,
                memory: 0,
                disk: 0
            }
        };

        state.podsData.forEach(pod => {
            stats.nodes.add(pod.node);
            
            switch(pod.status.toLowerCase()) {
                case 'running':
                    stats.running++;
                    break;
                case 'pending':
                    stats.warning++;
                    break;
                default:
                    stats.failed++;
            }

            // Acumular recursos
            stats.resources.cpu += parseFloat(pod.resources.cpu) || 0;
            stats.resources.memory += parseFloat(pod.resources.memory) || 0;
            stats.resources.disk += parseFloat(pod.resources.disk) || 0;
        });

        return stats;
    }

    // Continua no próximo comentário...
    
    
// Nome: script.js
// Função: Lógica de interface e interações da aplicação
// Versão: 1.2.0
// Autor: russorafael
// Data: 2025-04-14 09:33:18

// Continuação do arquivo...

    // Funções de Atualização da Interface
    function updatePodsList() {
        if (!elements.podsList) return;

        const filteredPods = filterPods(state.podsData);
        let html = '';

        filteredPods.forEach(pod => {
            const isNew = pod.age_days < 7;
            const imageUpdated = pod.image_updated;
            const statusClass = getStatusClass(pod.status);

            html += `
                <div class="pod-item" data-pod-name="${pod.name}" data-namespace="${pod.namespace}">
                    <div class="pod-header">
                        <div class="pod-title">
                            <span class="pod-name">${pod.name}</span>
                            <div class="pod-badges">
                                ${isNew ? '<span class="badge new">New</span>' : ''}
                                ${imageUpdated ? '<span class="badge updated"><i class="fas fa-star"></i></span>' : ''}
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
                                <a href="ssh://${pod.ips.external}" class="ip-external" title="Connect via SSH">
                                    <i class="fas fa-network-wired"></i> ${pod.ips.external}
                                </a>
                            ` : ''}
                            <div class="ip-internal">
                                <i class="fas fa-sitemap"></i> ${pod.ips.internal}
                            </div>
                        </div>

                        <div class="pod-resources">
                            <div class="resource-item" title="CPU Usage">
                                <i class="fas fa-microchip"></i>
                                <span>${formatResource(pod.resources.cpu, 'cpu')}</span>
                            </div>
                            <div class="resource-item" title="Memory Usage">
                                <i class="fas fa-memory"></i>
                                <span>${formatResource(pod.resources.memory, 'memory')}</span>
                            </div>
                            <div class="resource-item" title="Disk Usage">
                                <i class="fas fa-hdd"></i>
                                <span>${formatResource(pod.resources.disk, 'disk')}</span>
                            </div>
                        </div>

                        ${pod.ports.length > 0 ? `
                            <div class="pod-ports">
                                <span class="ports-label">Ports:</span>
                                ${pod.ports.map(port => `
                                    <span class="port-badge" title="${port.name}">
                                        <i class="fas fa-plug"></i>
                                        ${port.port}/${port.protocol}
                                    </span>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        elements.podsList.innerHTML = html;
        setupPodActions();
    }

    function updateCharts() {
        updateResourceChart('cpuChart', 'CPU Usage', state.podsData.map(pod => ({
            label: pod.name,
            value: parseResourceValue(pod.resources.cpu, 'cpu')
        })));

        updateResourceChart('memoryChart', 'Memory Usage', state.podsData.map(pod => ({
            label: pod.name,
            value: parseResourceValue(pod.resources.memory, 'memory')
        })));

        updateResourceChart('diskChart', 'Disk Usage', state.podsData.map(pod => ({
            label: pod.name,
            value: parseResourceValue(pod.resources.disk, 'disk')
        })));
    }

    function updateActivityHistory() {
        const restartsContent = document.getElementById('podRestarts');
        const imagesContent = document.getElementById('imageUpdates');

        if (restartsContent) {
            const recentRestarts = getRecentRestarts();
            restartsContent.innerHTML = generateActivityList(recentRestarts);
        }

        if (imagesContent) {
            const recentUpdates = getRecentImageUpdates();
            imagesContent.innerHTML = generateActivityList(recentUpdates);
        }
    }

    // Funções de Formatação e Utilidades
    function formatResource(value, type) {
        if (!value) return '0';

        switch(type) {
            case 'cpu':
                return value.includes('m') ? value : `${value}m CPU`;
            case 'memory':
                return formatMemory(value);
            case 'disk':
                return value.endsWith('%') ? value : `${value}%`;
            default:
                return value;
        }
    }

    function formatMemory(value) {
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        let number = parseInt(value);
        let i = 0;

        while (number >= 1024 && i < sizes.length - 1) {
            number /= 1024;
            i++;
        }

        return `${number.toFixed(2)} ${sizes[i]}`;
    }

    // Funções de Filtragem
    function filterPods(pods) {
        return pods.filter(pod => {
            const matchesNamespace = !state.filters.namespace || 
                                   pod.namespace === state.filters.namespace;
            const matchesNode = !state.filters.node || 
                              pod.node === state.filters.node;
            const matchesStatus = !state.filters.status || 
                                pod.status.toLowerCase() === state.filters.status;
            const matchesType = matchPodType(pod, state.filters.type);
            const matchesSearch = !state.filters.search || 
                                pod.name.toLowerCase().includes(state.filters.search) ||
                                pod.namespace.toLowerCase().includes(state.filters.search);

            return matchesNamespace && matchesNode && matchesStatus && 
                   matchesType && matchesSearch;
        });
    }

    function matchPodType(pod, type) {
        if (!type) return true;
        
        switch(type) {
            case 'local':
                return pod.is_local;
            case 'new':
                return pod.age_days < 7;
            case 'updated':
                return pod.image_updated;
            default:
                return true;
        }
    }

    // Continua no próximo comentário...


// Nome: script.js
// Função: Lógica de interface e interações da aplicação
// Versão: 1.2.0
// Autor: russorafael
// Data: 2025-04-14 09:34:40

// Continuação do arquivo...

    // Funções de Modal e Interação
    function showPodDetails(podName) {
        const pod = state.podsData.find(p => p.name === podName);
        if (!pod) return;

        const modal = elements.podDetailsModal;
        const modalBody = modal.querySelector('.modal-body');

        modalBody.innerHTML = `
            <div class="pod-details">
                <div class="detail-section">
                    <h4>General Information</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="label">Name:</span>
                            <span class="value">${pod.name}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Namespace:</span>
                            <span class="value">${pod.namespace}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Node:</span>
                            <span class="value">${pod.node}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Status:</span>
                            <span class="value ${getStatusClass(pod.status)}">${pod.status}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Age:</span>
                            <span class="value">${formatAge(pod.age_days)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Image:</span>
                            <span class="value">${pod.image}</span>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h4>Resource Usage</h4>
                    <div class="resource-charts">
                        <div class="mini-chart">
                            <canvas id="podCpuChart"></canvas>
                        </div>
                        <div class="mini-chart">
                            <canvas id="podMemoryChart"></canvas>
                        </div>
                        <div class="mini-chart">
                            <canvas id="podDiskChart"></canvas>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h4>Network Information</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="label">Internal IP:</span>
                            <span class="value">${pod.ips.internal}</span>
                        </div>
                        ${pod.ips.external ? `
                            <div class="detail-item">
                                <span class="label">External IP:</span>
                                <span class="value">
                                    <a href="ssh://${pod.ips.external}" class="ip-link">
                                        ${pod.ips.external}
                                    </a>
                                </span>
                            </div>
                        ` : ''}
                    </div>
                    ${pod.ports.length > 0 ? `
                        <div class="ports-grid">
                            <h5>Open Ports</h5>
                            ${pod.ports.map(port => `
                                <div class="port-item">
                                    <span class="port-number">${port.port}</span>
                                    <span class="port-protocol">${port.protocol}</span>
                                    ${port.name ? `<span class="port-name">${port.name}</span>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Inicializar mini gráficos
        initializePodDetailCharts(pod);
        
        modal.style.display = 'block';
        setupModalClose(modal);
    }

    function showRestartConfirmation(podName) {
        state.selectedPod = podName;
        const message = `Are you sure you want to restart pod "${podName}"?`;
        elements.confirmationModal.querySelector('#confirmationMessage').textContent = message;
        elements.confirmPassword.value = '';
        elements.confirmationModal.style.display = 'block';
    }

    // Funções de Gráficos
    function initializePodDetailCharts(pod) {
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: getComputedStyle(document.body)
                            .getPropertyValue('--chart-grid')
                    }
                },
                x: {
                    display: false
                }
            }
        };

        // CPU Chart
        new Chart(document.getElementById('podCpuChart'), {
            type: 'line',
            data: {
                labels: Array(10).fill(''),
                datasets: [{
                    label: 'CPU Usage',
                    data: generateMockData(10),
                    borderColor: getComputedStyle(document.body)
                        .getPropertyValue('--accent-color'),
                    tension: 0.4
                }]
            },
            options: chartOptions
        });

        // Similar charts for memory and disk...
    }

    function updateResourceChart(chartId, label, data) {
        const ctx = document.getElementById(chartId);
        if (!ctx) return;

        if (state.charts[chartId]) {
            state.charts[chartId].destroy();
        }

        state.charts[chartId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.label),
                datasets: [{
                    label: label,
                    data: data.map(d => d.value),
                    backgroundColor: state.theme === 'dark' 
                        ? 'rgba(52, 152, 219, 0.5)' 
                        : 'rgba(52, 152, 219, 0.8)',
                    borderColor: state.theme === 'dark'
                        ? 'rgba(52, 152, 219, 0.8)'
                        : 'rgba(52, 152, 219, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: getComputedStyle(document.body)
                                .getPropertyValue('--chart-grid')
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }

    // Continua no próximo comentário...


// Nome: script.js
// Função: Lógica de interface e interações da aplicação
// Versão: 1.2.0
// Autor: russorafael
// Data: 2025-04-14 09:40:29

// Continuação do arquivo...

    // Funções de Notificação e Feedback
    function showNotification(message, type = 'info', duration = 5000) {
        const container = document.getElementById('notificationContainer');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas ${getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(notification);

        // Adicionar classe para animação
        setTimeout(() => notification.classList.add('show'), 10);

        // Setup do botão de fechar
        notification.querySelector('.notification-close').addEventListener('click', () => {
            removeNotification(notification);
        });

        // Auto-remove após duração
        setTimeout(() => removeNotification(notification), duration);
    }

    function removeNotification(notification) {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }

    function getNotificationIcon(type) {
        switch(type) {
            case 'success': return 'fa-check-circle';
            case 'error': return 'fa-exclamation-circle';
            case 'warning': return 'fa-exclamation-triangle';
            default: return 'fa-info-circle';
        }
    }

    // Funções de Gerenciamento de Dados
    async function restartPod(podName, password) {
        try {
            const response = await fetch('/api/pod/restart', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pod_name: podName,
                    namespace: getPodNamespace(podName),
                    password: password
                })
            });

            const data = await response.json();

            if (response.ok) {
                showNotification(`Pod ${podName} restart initiated`, 'success');
                setTimeout(refreshData, 2000);
            } else {
                throw new Error(data.error || 'Failed to restart pod');
            }
        } catch (error) {
            showNotification(error.message, 'error');
        }
    }

    function updateRetentionDate() {
        const date = new Date();
        date.setDate(date.getDate() - 7); // 7 dias de retenção
        elements.retentionDate.textContent = date.toLocaleDateString();
    }

    // Funções de Navegação e UI
    function navigateToPage(pageId) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });

        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.classList.remove('active');
        });

        const newPage = document.getElementById(pageId);
        if (newPage) {
            newPage.classList.add('active');
            document.querySelector(`[data-page="${pageId}"]`).classList.add('active');
        }
    }

    function navigateToPageWithFilter(pageId, filter) {
        navigateToPage(pageId);
        
        // Resetar filtros
        Object.keys(state.filters).forEach(key => {
            state.filters[key] = '';
        });

        // Aplicar novo filtro
        if (filter) {
            const filterMap = {
                'running': 'status',
                'warning': 'status',
                'failed': 'status',
                'local': 'type',
                'new': 'type'
            };

            const filterType = filterMap[filter];
            if (filterType) {
                state.filters[filterType] = filter;
                const filterElement = document.getElementById(`${filterType}Filter`);
                if (filterElement) {
                    filterElement.value = filter;
                }
            }
        }

        applyFilters();
    }

    // Funções de Utilidade
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

    function applyTheme() {
        document.body.setAttribute('data-theme', state.theme);
        elements.toggleTheme.innerHTML = `
            <i class="fas fa-${state.theme === 'dark' ? 'sun' : 'moon'}"></i>
        `;
        updateCharts(); // Atualizar cores dos gráficos
    }

    function getPodNamespace(podName) {
        const pod = state.podsData.find(p => p.name === podName);
        return pod ? pod.namespace : '';
    }

    function formatAge(days) {
        if (days < 1) return 'Less than a day';
        return `${days} day${days === 1 ? '' : 's'}`;
    }

    function getStatusClass(status) {
        switch(status.toLowerCase()) {
            case 'running': return 'status-success';
            case 'pending': return 'status-warning';
            case 'failed': return 'status-error';
            default: return 'status-unknown';
        }
    }

    function startRefreshTimer() {
        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
        }
        state.refreshTimer = setInterval(refreshData, state.refreshInterval);
    }

    function updateLastRefresh() {
        state.lastUpdate = new Date();
        elements.lastRefresh.textContent = `Last refresh: ${state.lastUpdate.toLocaleTimeString()}`;
    }

    // Funções de Limpeza de Dados
    function setupDataCleanup() {
        const cleanupForm = document.getElementById('cleanupForm');
        if (!cleanupForm) return;

        cleanupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const days = document.getElementById('cleanupDays').value;
            
            try {
                await fetch('/api/cleanup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ days: parseInt(days) })
                });
                
                showNotification('Data cleanup completed successfully', 'success');
                refreshData();
            } catch (error) {
                showNotification('Failed to cleanup data', 'error');
            }
        });
    }

    // Inicialização da aplicação
    initialize();
});


// Nome: script.js
// Função: Lógica de interface e interações da aplicação
// Versão: 1.2.0
// Autor: russorafael
// Data: 2025-04-14 09:42:42

// Funções melhoradas para exibição de recursos
function updateResourceVisuals(podName) {
    const pod = state.podsData.find(p => p.name === podName);
    if (!pod) return;

    // Mini gráficos para CPU, Memória e Disco
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 800,
            easing: 'easeInOutQuart'
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const value = context.raw;
                        const type = context.dataset.label.toLowerCase();
                        return formatResourceValue(value, type);
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    callback: function(value) {
                        const type = this.chart.data.datasets[0].label.toLowerCase();
                        return formatResourceValue(value, type);
                    }
                }
            }
        }
    };

    // Atualização do gráfico de CPU
    updateResourceChart('cpuChart', {
        label: 'CPU Usage',
        data: generateResourceData(pod.resources.cpu, 'cpu'),
        options: {
            ...chartOptions,
            scales: {
                y: {
                    ...chartOptions.scales.y,
                    max: 100,
                    title: {
                        display: true,
                        text: 'CPU %'
                    }
                }
            }
        }
    });

    // Atualização do gráfico de Memória
    updateResourceChart('memoryChart', {
        label: 'Memory Usage',
        data: generateResourceData(pod.resources.memory, 'memory'),
        options: {
            ...chartOptions,
            scales: {
                y: {
                    ...chartOptions.scales.y,
                    title: {
                        display: true,
                        text: 'Memory'
                    }
                }
            }
        }
    });

    // Atualização do gráfico de Disco
    updateResourceChart('diskChart', {
        label: 'Disk Usage',
        data: generateResourceData(pod.resources.disk, 'disk'),
        options: {
            ...chartOptions,
            scales: {
                y: {
                    ...chartOptions.scales.y,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Disk %'
                    }
                }
            }
        }
    });
}

function formatResourceValue(value, type) {
    switch(type) {
        case 'cpu':
            return value < 1000 ? `${value}m` : `${(value/1000).toFixed(1)}`;
        case 'memory':
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            let i = 0;
            while (value >= 1024 && i < sizes.length - 1) {
                value /= 1024;
                i++;
            }
            return `${value.toFixed(1)} ${sizes[i]}`;
        case 'disk':
            return `${value}%`;
        default:
            return value;
    }
}

// Atualização da exibição de portas
function updatePortsDisplay(pod) {
    const portsContainer = document.createElement('div');
    portsContainer.className = 'ports-container';

    if (pod.ports && pod.ports.length > 0) {
        pod.ports.forEach(port => {
            const portElement = document.createElement('div');
            portElement.className = `port-item ${port.is_exposed ? 'exposed' : ''}`;
            
            portElement.innerHTML = `
                <div class="port-header">
                    <span class="port-number">${port.port}</span>
                    <span class="port-protocol">${port.protocol}</span>
                    ${port.is_exposed ? '<span class="port-exposed">EXPOSED</span>' : ''}
                </div>
                ${port.name ? `<div class="port-name">${port.name}</div>` : ''}
                ${port.service_name ? `
                    <div class="port-service">
                        <span>Service: ${port.service_name}</span>
                        <span>Port: ${port.service_port}</span>
                    </div>
                ` : ''}
            `;

            portsContainer.appendChild(portElement);
        });
    } else {
        portsContainer.innerHTML = '<div class="no-ports">No ports exposed</div>';
    }

    return portsContainer;
}    