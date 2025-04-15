/**
 * Name: script.js
 * Function: Frontend JavaScript for PodMon monitoring system
 * Version: 2.0.0
 * Author: russorafael
 * Date: 2025-04-15 10:22:30
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
        smsSettings: document.getElementById('sms-settings'), // Adicionado SMS settings
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
        confirmation: document.getElementById('confirmationModal'),
        timeSlot: document.getElementById('timeSlotModal') // Adicionado modal de timeslot
    },
    forms: {
        emailSettings: document.getElementById('emailSettingsForm'),
        whatsappSettings: document.getElementById('whatsappSettingsForm'),
        smsSettings: document.getElementById('smsSettingsForm'), // Adicionado formulário SMS
        monitorSettings: document.getElementById('monitorSettingsForm'),
        cleanupSettings: document.getElementById('cleanupSettingsForm')
    },
    lastRefresh: document.getElementById('lastRefresh'),
    notificationContainer: document.getElementById('notificationContainer'),
    themeToggle: document.getElementById('toggleTheme'),
    refreshButton: document.getElementById('refreshButton'),
    // Status indicators
    statusIndicators: {
        email: document.getElementById('emailStatus'),
        whatsapp: document.getElementById('whatsappStatus'),
        sms: document.getElementById('smsStatus')
    }
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
    },

    // Adicionar método para testar o envio de email
    async testEmail(password) {
        try {
            const response = await fetch('/api/test/email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to send test email');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error sending test email:', error);
            showNotification(error.message, 'error');
            throw error;
        }
    },
    
    // Adicionar método para testar o envio de WhatsApp
    async testWhatsApp(password) {
        try {
            const response = await fetch('/api/test/whatsapp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to send test WhatsApp message');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error sending test WhatsApp message:', error);
            showNotification(error.message, 'error');
            throw error;
        }
    },
    
    // Adicionar método para testar o envio de SMS
    async testSms(password) {
        try {
            const response = await fetch('/api/test/sms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to send test SMS');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error sending test SMS:', error);
            showNotification(error.message, 'error');
            throw error;
        }
    },

    // Obter informações sobre o uso de armazenamento
    async getStorageInfo() {
        try {
            const response = await fetch('/api/storage/info');
            if (!response.ok) throw new Error('Failed to fetch storage info');
            return await response.json();
        } catch (error) {
            console.error('Error fetching storage info:', error);
            showNotification('Failed to fetch storage information', 'error');
            return {
                usedSpace: 'Unknown',
                totalSpace: 'Unknown',
                oldestRecord: null,
                nextCleanup: null
            };
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
        
        // Atualizar indicadores de status
        updateStatusIndicators();
        
        // Carregar informações de armazenamento
        await loadStorageInfo();
        
    } catch (error) {
        console.error('Error initializing app:', error);
        showNotification('Failed to initialize application', 'error');
    } finally {
        showLoading(false);
    }
}

// Nova função para atualizar os indicadores de status dos alertas
function updateStatusIndicators() {
    const settings = dashboardData.settings;
    
    if (settings.email && elements.statusIndicators.email) {
        updateStatusIndicator(elements.statusIndicators.email, settings.email.enabled);
    }
    
    if (settings.whatsapp && elements.statusIndicators.whatsapp) {
        updateStatusIndicator(elements.statusIndicators.whatsapp, settings.whatsapp.enabled);
    }
    
    if (settings.sms && elements.statusIndicators.sms) {
        updateStatusIndicator(elements.statusIndicators.sms, settings.sms.enabled);
    }
}

// Atualizar um indicador de status específico
function updateStatusIndicator(element, isEnabled) {
    if (!element) return;
    
    element.className = 'status-indicator';
    if (isEnabled) {
        element.classList.add('enabled');
        element.setAttribute('title', 'Enabled');
    } else {
        element.classList.add('disabled');
        element.setAttribute('title', 'Disabled');
    }
}

// Nova função para carregar informações de armazenamento
async function loadStorageInfo() {
    try {
        const storageInfo = await api.getStorageInfo();
        
        // Atualizar elementos na página de limpeza de dados
        const dataRangeElement = document.getElementById('dataRange');
        const nextCleanupElement = document.getElementById('nextCleanup');
        const storageUsedElement = document.getElementById('storageUsed');
        const retentionDateElement = document.getElementById('retentionDate');
        
        if (dataRangeElement && storageInfo.oldestRecord) {
            const oldestDate = new Date(storageInfo.oldestRecord);
            const today = new Date();
            dataRangeElement.textContent = `${oldestDate.toLocaleDateString()} to ${today.toLocaleDateString()}`;
        }
        
        if (nextCleanupElement && storageInfo.nextCleanup) {
            const nextCleanup = new Date(storageInfo.nextCleanup);
            nextCleanupElement.textContent = nextCleanup.toLocaleString();
        }
        
        if (storageUsedElement) {
            storageUsedElement.textContent = storageInfo.usedSpace;
        }
        
        if (retentionDateElement && storageInfo.oldestRecord) {
            const oldestDate = new Date(storageInfo.oldestRecord);
            retentionDateElement.textContent = oldestDate.toLocaleDateString();
        }
        
    } catch (error) {
        console.error('Error loading storage info:', error);
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
    
    // Tabs na dashboard
    setupTabListeners();
    
    // Botões de visualização (lista/grade)
    setupViewToggleListeners();
}

// Nova função para configurar os listeners das abas
function setupTabListeners() {
    document.querySelectorAll('.tab-button').forEach(tabButton => {
        tabButton.addEventListener('click', (event) => {
            // Remover a classe active de todos os botões e conteúdos
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            // Adicionar a classe active ao botão clicado
            event.currentTarget.classList.add('active');
            
            // Ativar o conteúdo correspondente
            const tabId = event.currentTarget.dataset.tab;
            const contentId = tabId === 'restarts' ? 'restartsContent' : 'imagesContent';
            document.getElementById(contentId).classList.add('active');
        });
    });
}

// Nova função para configurar os listeners dos botões de visualização
function setupViewToggleListeners() {
    document.querySelectorAll('.view-button').forEach(viewButton => {
        viewButton.addEventListener('click', (event) => {
            // Remover a classe active de todos os botões
            document.querySelectorAll('.view-button').forEach(btn => btn.classList.remove('active'));
            
            // Adicionar a classe active ao botão clicado
            event.currentTarget.classList.add('active');
            
            // Alternar entre visualizações de lista e grade
            const viewType = event.currentTarget.dataset.view;
            const podsContainer = document.querySelector('.pods-container');
            
            if (podsContainer) {
                podsContainer.className = 'pods-container';
                podsContainer.classList.add(`view-${viewType}`);
            }
            
            // Atualizar a lista de pods para refletir a nova visualização
            updatePodsList();
        });
    });
}

function setupFormListeners() {
    // Email Settings
    elements.forms.emailSettings?.addEventListener('submit', handleEmailSettings);
    document.getElementById('testEmail')?.addEventListener('click', handleTestEmail);

    // WhatsApp Settings
    elements.forms.whatsappSettings?.addEventListener('submit', handleWhatsAppSettings);
    document.getElementById('testWhatsApp')?.addEventListener('click', handleTestWhatsApp);
    
    // SMS Settings
    elements.forms.smsSettings?.addEventListener('submit', handleSmsSettings);
    document.getElementById('testSms')?.addEventListener('click', handleTestSms);

    // Monitor Settings
    elements.forms.monitorSettings?.addEventListener('submit', handleMonitorSettings);

    // Cleanup Settings
    elements.forms.cleanupSettings?.addEventListener('submit', handleCleanupSettings);
    document.getElementById('runCleanup')?.addEventListener('click', handleManualCleanup);

    // Time slots
    setupTimeSlotListeners();
    
    // Tag inputs
    setupTagInputs();
}

// Nova função para configurar os listeners dos time slots
function setupTimeSlotListeners() {
    const addTimeButtons = document.querySelectorAll('.add-time');
    
    addTimeButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const parentId = event.currentTarget.closest('.time-slots').id;
            openTimeSlotModal(parentId);
        });
    });
    
    // Salvar time slot
    document.getElementById('saveTimeSlot')?.addEventListener('click', () => {
        saveTimeSlot();
    });
    
    // Cancelar adição de time slot
    document.getElementById('cancelTimeSlot')?.addEventListener('click', () => {
        closeTimeSlotModal();
    });
    
    // Fechar modal com o botão X
    elements.modals.timeSlot?.querySelector('.close-button')?.addEventListener('click', () => {
        closeTimeSlotModal();
    });
}

// Abrir modal de time slot
function openTimeSlotModal(parentId) {
    const modal = elements.modals.timeSlot;
    if (!modal) return;
    
    // Armazenar o ID do container pai para uso posterior
    modal.dataset.parentId = parentId;
    
    // Resetar formulário
    document.getElementById('alertTime').value = '08:00';
    document.querySelectorAll('.day-checkbox input').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Mostrar modal
    modal.classList.add('active');
}

// Fechar modal de time slot
function closeTimeSlotModal() {
    const modal = elements.modals.timeSlot;
    if (!modal) return;
    
    modal.classList.remove('active');
}

// Salvar time slot
function saveTimeSlot() {
    const modal = elements.modals.timeSlot;
    if (!modal) return;
    
    const parentId = modal.dataset.parentId;
    const timeValue = document.getElementById('alertTime').value;
    
    // Obter dias selecionados
    const selectedDays = [];
    document.querySelectorAll('.day-checkbox input:checked').forEach(checkbox => {
        selectedDays.push(checkbox.value);
    });
    
    // Validar entrada
    if (!timeValue || selectedDays.length === 0) {
        showNotification('Please select time and at least one day', 'error');
        return;
    }
    
    // Criar o elemento time slot
    const timeSlot = document.createElement('div');
    timeSlot.className = 'time-slot';
    timeSlot.innerHTML = `
        <span class="time-slot-info">
            ${timeValue} (${selectedDays.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')})
        </span>
        <button class="remove-time" title="Remove">×</button>
    `;
    
    // Adicionar handler para remover time slot
    timeSlot.querySelector('.remove-time').addEventListener('click', () => {
        timeSlot.remove();
    });
    
    // Adicionar ao container pai
    const parentContainer = document.getElementById(parentId);
    if (parentContainer) {
        parentContainer.insertBefore(timeSlot, parentContainer.querySelector('.add-time'));
    }
    
    // Fechar modal
    closeTimeSlotModal();
}

// Manipulador de configurações SMS
async function handleSmsSettings(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const settings = {
        sms: {
            enabled: formData.get('smsEnabled') === 'on',
            api_url: formData.get('smsApiUrl'),
            api_token: formData.get('smsApiToken'),
            recipients: getTagsFromContainer('smsPhoneTags'),
            schedule: getTimeSlots('smsTimeSlots')
        }
    };
    
    try {
        await api.updateSettings(settings, config.adminPassword);
        showNotification('Configurações de SMS atualizadas com sucesso', 'success');
        updateStatusIndicators();
    } catch (error) {
        showNotification('Falha ao atualizar configurações de SMS', 'error');
    }
}

// Manipulador para teste de SMS
async function handleTestSms() {
    try {
        const password = await promptForPassword('Teste de SMS requer autenticação. Por favor, insira a senha de administrador.');
        if (!password) return;
        
        await api.testSms(password);
        showNotification('SMS de teste enviado com sucesso', 'success');
    } catch (error) {
        showNotification('Falha ao enviar SMS de teste', 'error');
    }
}

// Manipulador para teste de Email
async function handleTestEmail() {
    try {
        const password = await promptForPassword('Teste de Email requer autenticação. Por favor, insira a senha de administrador.');
        if (!password) return;
        
        await api.testEmail(password);
        showNotification('Email de teste enviado com sucesso', 'success');
    } catch (error) {
        showNotification('Falha ao enviar email de teste', 'error');
    }
}

// Manipulador para teste de WhatsApp
async function handleTestWhatsApp() {
    try {
        const password = await promptForPassword('Teste de WhatsApp requer autenticação. Por favor, insira a senha de administrador.');
        if (!password) return;
        
        await api.testWhatsApp(password);
        showNotification('Mensagem de WhatsApp de teste enviada com sucesso', 'success');
    } catch (error) {
        showNotification('Falha ao enviar mensagem de WhatsApp de teste', 'error');
    }
}

// Nova função para solicitar senha
function promptForPassword(message) {
    return new Promise((resolve) => {
        showConfirmationModal(message, (password) => {
            resolve(password);
        });
    });
}

// Obter time slots de um container
function getTimeSlots(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    
    const slots = [];
    container.querySelectorAll('.time-slot').forEach(slot => {
        const infoText = slot.querySelector('.time-slot-info').textContent;
        const timeMatch = infoText.match(/(\d{2}:\d{2})/);
        const daysMatch = infoText.match(/\((.*?)\)/);
        
        if (timeMatch && daysMatch) {
            const time = timeMatch[1];
            const days = daysMatch[1].split(', ').map(d => d.toLowerCase());
            
            slots.push({
                time,
                days
            });
        }
    });
    
    return slots;
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
    
    // Verificar tipo de visualização atual
    const viewType = document.querySelector('.view-button.active')?.dataset.view || 'list';
    document.querySelector('.pods-container')?.classList.add(`view-${viewType}`);
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

function getChartData(type) {
    // Extract and format data for charts
    const labels = [];
    const values = [];
    
    // Get top 10 pods or nodes based on resource usage
    const view = document.getElementById('resourceView')?.value || 'pods';
    const items = view === 'pods' ? dashboardData.pods : Object.entries(dashboardData.nodes).map(([name, info]) => ({
        name,
        resources: {
            cpu: parseFloat(info.cpu),
            memory: parseMemoryValue(info.memory),
            disk: 0 // Nodes don't have disk usage in this view
        }
    }));
    
    // Sort items by the specified resource type
    const sortedItems = [...items].sort((a, b) => {
        const aValue = a.resources[type];
        const bValue = b.resources[type];
        return bValue - aValue; // Sort descending
    });
    
    // Take top 10
    const topItems = sortedItems.slice(0, 10);
    
    // Extract labels and values
    topItems.forEach(item => {
        labels.push(item.name);
        values.push(item.resources[type]);
    });
    
    return { labels, values };
}

function getChartColors(count) {
    const baseColors = [
        '#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b',
        '#5a5c69', '#6f42c1', '#fd7e14', '#20c9a6', '#36b9cc'
    ];
    
    // Return colors as needed
    return baseColors.slice(0, count);
}

function updateCounters() {
    const counters = {
        runningPods: 0,
        warningPods: 0,
        failedPods: 0,
        activeNodes: 0,
        totalPods: dashboardData.pods.length,
        totalNodes: Object.keys(dashboardData.nodes).length
    };
    
    // Count pods by status
    dashboardData.pods.forEach(pod => {
        switch (pod.status.toLowerCase()) {
            case 'running':
                counters.runningPods++;
                break;
            case 'warning':
            case 'pending':
                counters.warningPods++;
                break;
            case 'failed':
            case 'crashloopbackoff':
            case 'error':
                counters.failedPods++;
                break;
        }
    });
    
    // Count active nodes
    Object.values(dashboardData.nodes).forEach(node => {
        if (node.status === 'Ready') {
            counters.activeNodes++;
        }
    });
    
    // Update DOM elements
    Object.entries(counters).forEach(([key, value]) => {
        if (elements.counters[key]) {
            elements.counters[key].textContent = value;
        }
    });
    
    // Update notification badges
    document.getElementById('dashboardUpdates').textContent = counters.warningPods + counters.failedPods;
}

function updateActivityLists() {
    updateRestartsList();
    updateImageUpdatesList();
}

function updateRestartsList() {
    if (!elements.lists.podRestarts) return;
    
    const restartEvents = dashboardData.history.restarts || [];
    const restartsHTML = restartEvents.length > 0 
        ? restartEvents.map(createRestartEventItem).join('')
        : '<div class="no-data">No restart events in the last 7 days</div>';
        
    elements.lists.podRestarts.innerHTML = restartsHTML;
}

function createRestartEventItem(event) {
    const date = new Date(event.timestamp);
    return `
        <div class="activity-item">
            <div class="activity-time">${formatTime(date)}</div>
            <div class="activity-content">
                <h4>${event.pod_name}</h4>
                <p>Namespace: ${event.namespace}</p>
                <p>Reason: ${event.reason || 'Unknown'}</p>
            </div>
        </div>
    `;
}

function updateImageUpdatesList() {
    if (!elements.lists.imageUpdates) return;
    
    const updateEvents = dashboardData.history.image_updates || [];
    const updatesHTML = updateEvents.length > 0 
        ? updateEvents.map(createImageUpdateItem).join('')
        : '<div class="no-data">No image updates in the last 7 days</div>';
        
    elements.lists.imageUpdates.innerHTML = updatesHTML;
}

function createImageUpdateItem(event) {
    const date = new Date(event.timestamp);
    return `
        <div class="activity-item">
            <div class="activity-time">${formatTime(date)}</div>
            <div class="activity-content">
                <h4>${event.pod_name}</h4>
                <p>Namespace: ${event.namespace}</p>
                <p>Old Image: ${event.old_image}</p>
                <p>New Image: ${event.new_image}</p>
            </div>
        </div>
    `;
}

// Navigation Handlers
function handleNavigation(event) {
    event.preventDefault();
    const pageName = event.currentTarget.dataset.page;
    
    // Hide all pages and remove active class from nav links
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    document.querySelectorAll('[data-page]').forEach(link => {
        link.classList.remove('active');
    });
    
    // Show selected page and add active class to nav link
    elements.pages[pageName]?.classList.add('active');
    event.currentTarget.classList.add('active');
    
    // Apply filters if specific link clicked
    const filter = event.currentTarget.dataset.filter;
    if (filter) {
        document.getElementById('statusFilter').value = filter;
        handleFilterChange();
    }
}

// Filter Handlers
function handleFilterChange() {
    updatePodsList();
}

function applyFilters(pod) {
    const namespace = elements.filters.namespace?.value;
    const node = elements.filters.node?.value;
    const status = elements.filters.status?.value;
    const type = elements.filters.type?.value;
    const search = elements.filters.search?.value?.toLowerCase();
    
    if (namespace && pod.namespace !== namespace) return false;
    if (node && pod.node !== node) return false;
    
    if (status) {
        switch (status) {
            case 'running':
                if (pod.status.toLowerCase() !== 'running') return false;
                break;
            case 'warning':
                if (!['warning', 'pending'].includes(pod.status.toLowerCase())) return false;
                break;
            case 'failed':
                if (!['failed', 'crashloopbackoff', 'error'].includes(pod.status.toLowerCase())) return false;
                break;
        }
    }
    
    if (type) {
        switch (type) {
            case 'local':
                if (!pod.image.includes('local/')) return false;
                break;
            case 'new':
                if (!isNewPod(pod)) return false;
                break;
            case 'updated':
                if (!pod.image_updated) return false;
                break;
        }
    }
    
    if (search && !pod.name.toLowerCase().includes(search)) return false;
    
    return true;
}

function populateFilters() {
    // Namespaces
    const namespaces = [...new Set(dashboardData.pods.map(pod => pod.namespace))];
    populateFilterOptions(elements.filters.namespace, namespaces);
    populateFilterOptions(elements.filters.quickNamespace, namespaces);
    
    // Nodes
    const nodes = [...new Set(dashboardData.pods.map(pod => pod.node))];
    populateFilterOptions(elements.filters.node, nodes);
    populateFilterOptions(elements.filters.quickNode, nodes);
}

function populateFilterOptions(selectElement, options) {
    if (!selectElement) return;
    
    // Keep the first option (usually "All...")
    const firstOption = selectElement.options[0];
    selectElement.innerHTML = '';
    selectElement.appendChild(firstOption);
    
    // Add new options
    options.sort().forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        selectElement.appendChild(optionElement);
    });
}

// Pod Details and Actions
function showPodDetails(podName, namespace) {
    const pod = dashboardData.pods.find(p => p.name === podName && p.namespace === namespace);
    if (!pod) return;
    
    const modal = elements.modals.podDetails;
    if (!modal) return;
    
    const modalBody = modal.querySelector('.modal-body');
    modalBody.innerHTML = createPodDetailsHTML(pod);
    
    // Show modal
    modal.classList.add('active');
    
    // Add close button handler
    modal.querySelector('.close-button').addEventListener('click', () => {
        modal.classList.remove('active');
    });
    
    // Initialize metrics chart
    initializePodMetricsChart(pod);
}

function createPodDetailsHTML(pod) {
    return `
        <div class="pod-details">
            <div class="details-section">
                <h4>Basic Information</h4>
                <div class="details-grid">
                    <div class="details-item">
                        <span class="label">Name:</span>
                        <span class="value">${pod.name}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Namespace:</span>
                        <span class="value">${pod.namespace}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Node:</span>
                        <span class="value">${pod.node}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Status:</span>
                        <span class="value ${getPodStatusClass(pod.status)}">${pod.status}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Created:</span>
                        <span class="value">${new Date(pod.created_at).toLocaleString()}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Restart Count:</span>
                        <span class="value">${pod.restart_count}</span>
                    </div>
                </div>
            </div>
            
            <div class="details-section">
                <h4>Container Details</h4>
                <div class="details-grid">
                    <div class="details-item">
                        <span class="label">Image:</span>
                        <span class="value">${pod.image}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Image Updated:</span>
                        <span class="value">${pod.image_updated ? 'Yes' : 'No'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Ports:</span>
                        <span class="value">${formatPorts(pod.ports)}</span>
                    </div>
                </div>
            </div>
            
            <div class="details-section">
                <h4>Resource Usage</h4>
                <div class="metrics-chart-container">
                    <canvas id="podMetricsChart"></canvas>
                </div>
                <div class="timeframe-selector">
                    <button class="timeframe-button active" data-timeframe="1h">1h</button>
                    <button class="timeframe-button" data-timeframe="6h">6h</button>
                    <button class="timeframe-button" data-timeframe="24h">24h</button>
                    <button class="timeframe-button" data-timeframe="7d">7d</button>
                </div>
            </div>
            
            <div class="details-actions">
                <button class="button primary" onclick="exportPodLogs('${pod.name}', '${pod.namespace}')">
                    Export Logs
                </button>
                <button class="button danger" onclick="confirmPodRestart('${pod.name}', '${pod.namespace}')">
                    Restart Pod
                </button>
            </div>
        </div>
    `;
}

function formatPorts(ports) {
    if (!ports || !ports.length) return 'None';
    
    return ports.map(port => {
        return `${port.port}${port.protocol !== 'TCP' ? '/' + port.protocol : ''}`;
    }).join(', ');
}

async function initializePodMetricsChart(pod) {
    const canvas = document.getElementById('podMetricsChart');
    if (!canvas) return;
    
    try {
        const metrics = await api.getMetrics('pod', `${pod.namespace}/${pod.name}`, '1h');
        renderMetricsChart(canvas, metrics);
        
        // Add event listeners to timeframe buttons
        document.querySelectorAll('.timeframe-button').forEach(button => {
            button.addEventListener('click', async (event) => {
                // Update active state
                document.querySelectorAll('.timeframe-button').forEach(b => b.classList.remove('active'));
                event.currentTarget.classList.add('active');
                
                // Get new metrics and update chart
                const timeframe = event.currentTarget.dataset.timeframe;
                const newMetrics = await api.getMetrics('pod', `${pod.namespace}/${pod.name}`, timeframe);
                renderMetricsChart(canvas, newMetrics);
            });
        });
    } catch (error) {
        console.error('Error loading pod metrics:', error);
        canvas.parentNode.innerHTML = '<div class="no-data">Failed to load metrics data</div>';
    }
}

function renderMetricsChart(canvas, metrics) {
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart if it exists
    if (window.podMetricsChart) {
        window.podMetricsChart.destroy();
    }
    
    // Format labels (timestamps)
    const labels = metrics.timestamps.map(timestamp => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    });
    
    // Create new chart
    window.podMetricsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'CPU',
                    data: metrics.cpu,
                    borderColor: '#4e73df',
                    backgroundColor: 'rgba(78, 115, 223, 0.1)',
                    yAxisID: 'cpu'
                },
                {
                    label: 'Memory',
                    data: metrics.memory,
                    borderColor: '#1cc88a',
                    backgroundColor: 'rgba(28, 200, 138, 0.1)',
                    yAxisID: 'memory'
                },
                {
                    label: 'Disk',
                    data: metrics.disk,
                    borderColor: '#36b9cc',
                    backgroundColor: 'rgba(54, 185, 204, 0.1)',
                    yAxisID: 'disk'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                cpu: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'CPU (cores)'
                    }
                },
                memory: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Memory (MB)'
                    }
                },
                disk: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Disk Usage (%)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

function exportPodLogs(podName, namespace) {
    showNotification('Log export feature will be available in a future update', 'info');
}

function confirmPodRestart(podName, namespace) {
    const message = `Are you sure you want to restart pod "${podName}" in namespace "${namespace}"?`;
    showConfirmationModal(message, async (password) => {
        if (!password) return;
        
        try {
            await api.restartPod(podName, namespace, password);
            showNotification(`Pod ${podName} restart initiated successfully`, 'success');
            setTimeout(() => {
                loadDashboardData();
            }, 2000);
        } catch (error) {
            showNotification(`Failed to restart pod: ${error.message}`, 'error');
        }
    });
}

// Settings handlers
function updateSettingsForms() {
    const settings = dashboardData.settings;
    
    // Email settings
    if (elements.forms.emailSettings && settings.email) {
        document.getElementById('emailEnabled').checked = settings.email.enabled;
        document.getElementById('smtpServer').value = settings.email.smtp_server;
        document.getElementById('smtpPort').value = settings.email.smtp_port;
        document.getElementById('smtpUsername').value = settings.email.username || '';
        document.getElementById('smtpPassword').value = settings.email.password ? '••••••••' : '';
        
        // Update email tags
        const emailTagsContainer = document.getElementById('emailTags');
        if (emailTagsContainer) {
            emailTagsContainer.innerHTML = '';
            settings.email.recipients.forEach(email => {
                addTag(emailTagsContainer, email);
            });
        }
        
        // Update time slots
        updateTimeSlots('emailTimeSlots', settings.email.schedule || []);
    }
    
    // WhatsApp settings
    if (elements.forms.whatsappSettings && settings.whatsapp) {
        document.getElementById('whatsappEnabled').checked = settings.whatsapp.enabled;
        document.getElementById('apiUrl').value = settings.whatsapp.api_url || '';
        document.getElementById('apiToken').value = settings.whatsapp.api_token ? '••••••••' : '';
        
        // Update phone tags
        const phoneTagsContainer = document.getElementById('phoneTags');
        if (phoneTagsContainer) {
            phoneTagsContainer.innerHTML = '';
            settings.whatsapp.recipients.forEach(phone => {
                addTag(phoneTagsContainer, phone);
            });
        }
        
        // Update time slots
        updateTimeSlots('whatsappTimeSlots', settings.whatsapp.schedule || []);
    }
    
    // SMS settings
    if (elements.forms.smsSettings && settings.sms) {
        document.getElementById('smsEnabled').checked = settings.sms.enabled;
        document.getElementById('smsApiUrl').value = settings.sms.api_url || '';
        document.getElementById('smsApiToken').value = settings.sms.api_token ? '••••••••' : '';
        
        // Update SMS phone tags
        const smsPhoneTagsContainer = document.getElementById('smsPhoneTags');
        if (smsPhoneTagsContainer) {
            smsPhoneTagsContainer.innerHTML = '';
            settings.sms.recipients.forEach(phone => {
                addTag(smsPhoneTagsContainer, phone);
            });
        }
        
        // Update time slots
        updateTimeSlots('smsTimeSlots', settings.sms.schedule || []);
    }
    
    // Monitor settings
    if (elements.forms.monitorSettings && settings.monitor) {
        document.getElementById('refreshInterval').value = settings.monitor.refresh_interval / 60000; // Convert ms to minutes
        document.getElementById('historyRetention').value = settings.monitor.history_retention;
        document.getElementById('alertStatusChange').checked = settings.monitor.alert_on_status_change;
        document.getElementById('alertImageUpdate').checked = settings.monitor.alert_on_image_update;
        
        // Update namespace tags
        const namespaceTagsContainer = document.getElementById('namespaceTags');
        if (namespaceTagsContainer) {
            namespaceTagsContainer.innerHTML = '';
            settings.monitor.namespaces.forEach(namespace => {
                addTag(namespaceTagsContainer, namespace);
            });
        }
    }
    
    // Cleanup settings
    if (elements.forms.cleanupSettings && settings.cleanup) {
        document.getElementById('retentionDays').value = settings.cleanup.retention_days;
        document.getElementById('cleanupTime').value = settings.cleanup.cleanup_time;
    }
}

function updateTimeSlots(containerId, slots) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Remove existing slots (except the add button)
    const addButton = container.querySelector('.add-time');
    container.innerHTML = '';
    container.appendChild(addButton);
    
    // Add slots from settings
    slots.forEach(slot => {
        const timeSlot = document.createElement('div');
        timeSlot.className = 'time-slot';
        
        // Format days
        const daysFormatted = slot.days.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ');
        
        timeSlot.innerHTML = `
            <span class="time-slot-info">
                ${slot.time} (${daysFormatted})
            </span>
            <button class="remove-time" title="Remove">×</button>
        `;
        
        // Add handler for removing time slot
        timeSlot.querySelector('.remove-time').addEventListener('click', () => {
            timeSlot.remove();
        });
        
        // Add to container before the add button
        container.insertBefore(timeSlot, addButton);
    });
}

// Email settings handler
async function handleEmailSettings(event) {
    event.preventDefault();
    
    // Get form values
    const formData = new FormData(event.target);
    const settings = {
        email: {
            enabled: formData.get('emailEnabled') === 'on',
            smtp_server: formData.get('smtpServer'),
            smtp_port: parseInt(formData.get('smtpPort')),
            username: formData.get('smtpUsername'),
            password: formData.get('smtpPassword') !== '••••••••' ? formData.get('smtpPassword') : undefined,
            recipients: getTagsFromContainer('emailTags'),
            schedule: getTimeSlots('emailTimeSlots')
        }
    };
    
    try {
        const password = await promptForPassword('Changing email settings requires authentication. Please enter the admin password.');
        if (!password) return;
        
        await api.updateSettings(settings, password);
        showNotification('Email settings updated successfully', 'success');
        updateStatusIndicators();
    } catch (error) {
        showNotification('Failed to update email settings', 'error');
    }
}

// WhatsApp settings handler
async function handleWhatsAppSettings(event) {
    event.preventDefault();
    
    // Get form values
    const formData = new FormData(event.target);
    const settings = {
        whatsapp: {
            enabled: formData.get('whatsappEnabled') === 'on',
            api_url: formData.get('apiUrl'),
            api_token: formData.get('apiToken') !== '••••••••' ? formData.get('apiToken') : undefined,
            recipients: getTagsFromContainer('phoneTags'),
            schedule: getTimeSlots('whatsappTimeSlots')
        }
    };
    
    try {
        const password = await promptForPassword('Changing WhatsApp settings requires authentication. Please enter the admin password.');
        if (!password) return;
        
        await api.updateSettings(settings, password);
        showNotification('WhatsApp settings updated successfully', 'success');
        updateStatusIndicators();
    } catch (error) {
        showNotification('Failed to update WhatsApp settings', 'error');
    }
}

// Monitor settings handler
async function handleMonitorSettings(event) {
    event.preventDefault();
    
    // Get form values
    const refreshInterval = parseInt(document.getElementById('refreshInterval').value);
    const historyRetention = parseInt(document.getElementById('historyRetention').value);
    
    const settings = {
        monitor: {
            refresh_interval: refreshInterval * 60000, // Convert minutes to ms
            history_retention: historyRetention,
            alert_on_status_change: document.getElementById('alertStatusChange').checked,
            alert_on_image_update: document.getElementById('alertImageUpdate').checked,
            namespaces: getTagsFromContainer('namespaceTags')
        }
    };
    
    try {
        const password = await promptForPassword('Changing monitor settings requires authentication. Please enter the admin password.');
        if (!password) return;
        
        await api.updateSettings(settings, password);
        showNotification('Monitor settings updated successfully', 'success');
        
        // Update refresh interval if changed
        if (refreshInterval * 60000 !== config.refreshInterval) {
            config.refreshInterval = refreshInterval * 60000;
            resetAutoRefresh();
        }
    } catch (error) {
        showNotification('Failed to update monitor settings', 'error');
    }
}

// Cleanup settings handler
async function handleCleanupSettings(event) {
    event.preventDefault();
    
    // Get form values
    const retentionDays = parseInt(document.getElementById('retentionDays').value);
    const cleanupTime = document.getElementById('cleanupTime').value;
    
    const settings = {
        cleanup: {
            retention_days: retentionDays,
            cleanup_time: cleanupTime
        }
    };
    
    try {
        const password = await promptForPassword('Changing cleanup settings requires authentication. Please enter the admin password.');
        if (!password) return;
        
        await api.updateSettings(settings, password);
        showNotification('Cleanup settings updated successfully', 'success');
        
        // Refresh storage info
        await loadStorageInfo();
    } catch (error) {
        showNotification('Failed to update cleanup settings', 'error');
    }
}

// Manual cleanup handler
async function handleManualCleanup() {
    try {
        const password = await promptForPassword('Running manual cleanup requires authentication. Please enter the admin password.');
        if (!password) return;
        
        await api.runCleanup(password);
        showNotification('Cleanup process started successfully', 'success');
        
        // Refresh storage info after a short delay
        setTimeout(async () => {
            await loadStorageInfo();
        }, 5000);
    } catch (error) {
        showNotification('Failed to run cleanup process', 'error');
    }
}

// Tag Input Handlers
function setupTagInputs() {
    // Email recipients
    setupTagInput('recipientInput', 'emailTags', validateEmail);
    
    // WhatsApp recipients
    setupTagInput('phoneInput', 'phoneTags', validatePhone);
    
    // SMS recipients
    setupTagInput('smsPhoneInput', 'smsPhoneTags', validatePhone);
    
    // Namespaces
    setupTagInput('namespaceInput', 'namespaceTags');
}

function setupTagInput(inputId, containerId, validationFunc) {
    const input = document.getElementById(inputId);
    const container = document.getElementById(containerId);
    
    if (!input || !container) return;
    
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            
            const value = input.value.trim();
            if (!value) return;
            
            // Validate value if validation function provided
            if (validationFunc && !validationFunc(value)) {
                showNotification(`Invalid value: ${value}`, 'error');
                return;
            }
            
            // Add tag
            addTag(container, value);
            input.value = '';
        }
    });
}

function addTag(container, value) {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `
        <span>${value}</span>
        <button class="remove-tag">×</button>
    `;
    
    // Add remove handler
    tag.querySelector('.remove-tag').addEventListener('click', () => {
        tag.remove();
    });
    
    container.appendChild(tag);
}

function getTagsFromContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    
    const tags = [];
    container.querySelectorAll('.tag').forEach(tag => {
        tags.push(tag.querySelector('span').textContent);
    });
    
    return tags;
}

function validateEmail(email) {
    // Basic email validation
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
    // Basic phone validation (starts with + and has at least 8 digits)
    return /^\+\d{8,}$/.test(phone);
}

// Confirmation Modal
function showConfirmationModal(message, callback) {
    const modal = elements.modals.confirmation;
    if (!modal) return;
    
    document.getElementById('confirmationMessage').textContent = message;
    document.getElementById('confirmPassword').value = '';
    
    // Show modal
    modal.classList.add('active');
    
    // Set up event handlers
    const handleYes = () => {
        const password = document.getElementById('confirmPassword').value;
        closeConfirmationModal();
        callback(password);
    };
    
    const handleNo = () => {
        closeConfirmationModal();
        callback(null);
    };
    
    const closeConfirmationModal = () => {
        modal.classList.remove('active');
        
        // Remove event handlers
        document.getElementById('confirmYes').removeEventListener('click', handleYes);
        document.getElementById('confirmNo').removeEventListener('click', handleNo);
        modal.querySelector('.close-button').removeEventListener('click', handleNo);
    };
    
    // Add event handlers
    document.getElementById('confirmYes').addEventListener('click', handleYes);
    document.getElementById('confirmNo').addEventListener('click', handleNo);
    modal.querySelector('.close-button').addEventListener('click', handleNo);
    
    // Focus password field
    document.getElementById('confirmPassword').focus();
}

// Theme Handling
function toggleTheme() {
    config.darkMode = !config.darkMode;
    localStorage.setItem('darkMode', config.darkMode);
    updateTheme();
}

function updateTheme() {
    if (config.darkMode) {
        document.body.classList.add('dark-mode');
        elements.themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    } else {
        document.body.classList.remove('dark-mode');
// Continuação da linha 1815
        elements.themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
    }
}

// Refresh Handling
function startAutoRefresh() {
    setInterval(() => {
        loadDashboardData();
    }, config.refreshInterval);
}

function resetAutoRefresh() {
    clearInterval(window.refreshInterval);
    startAutoRefresh();
}

function handleManualRefresh() {
    loadDashboardData();
    showNotification('Dashboard atualizado com sucesso', 'success');
}

function updateLastRefreshTime() {
    if (!elements.lastRefresh) return;
    elements.lastRefresh.textContent = `Última atualização: ${new Date().toLocaleTimeString()}`;
}

// Utility Functions
function showLoading(show) {
    // Adicionar classe loading ao corpo do documento
    if (show) {
        document.body.classList.add('loading');
    } else {
        document.body.classList.remove('loading');
    }
}

function showNotification(message, type = 'info') {
    if (!elements.notificationContainer) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="message">${message}</span>
        <button class="close-notification">&times;</button>
    `;

    // Adicionar handler para fechar notificação
    notification.querySelector('.close-notification').addEventListener('click', () => {
        notification.remove();
    });

    // Adicionar ao container
    elements.notificationContainer.appendChild(notification);

    // Remover automaticamente após 5 segundos
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

function formatTime(date) {
    return new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' }).format(
        Math.round((date - new Date()) / (1000 * 60 * 60 * 24)),
        'day'
    );
}

function formatCPU(value) {
    return `${value.toFixed(2)} Cores`;
}

function formatMemory(value) {
    if (value < 1024) return `${value.toFixed(2)} MB`;
    return `${(value / 1024).toFixed(2)} GB`;
}

function formatDisk(value) {
    return `${value.toFixed(2)}%`;
}

function getPodStatusClass(status) {
    status = status.toLowerCase();
    switch (status) {
        case 'running':
            return 'status-healthy';
        case 'warning':
        case 'pending':
            return 'status-warning';
        case 'failed':
        case 'crashloopbackoff':
        case 'error':
            return 'status-error';
        default:
            return 'status-unknown';
    }
}

function isNewPod(pod) {
    const createdDate = new Date(pod.created_at);
    const now = new Date();
    const diffDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
    return diffDays <= config.newPodThreshold;
}

function parseMemoryValue(memoryString) {
    const value = parseFloat(memoryString);
    if (memoryString.includes('Gi')) return value * 1024;
    if (memoryString.includes('Mi')) return value;
    return value;
}

// Inicialização de Charts
function initializeCharts() {
    if (!elements.charts.cpu) return;

    // Configurar charts vazios inicialmente
    ['cpu', 'memory', 'disk'].forEach(type => {
        const canvas = elements.charts[type];
        const ctx = canvas.getContext('2d');
        
        config.charts[type] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
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
            }
        });
    });
}

// Exportar funções para uso global
window.showPodDetails = showPodDetails;
window.confirmPodRestart = confirmPodRestart;
window.exportPodLogs = exportPodLogs;