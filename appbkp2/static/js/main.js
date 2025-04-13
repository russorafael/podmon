// main.js - Script principal para o sistema de monitoramento Falco
// Versão: 1.0.0

// Configurações e variáveis globais
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
  RECENT_ACTIVITIES: '/api/recent-activities'
};

let currentConfig = {};
let podData = {};
let nodeData = {};
let currentTheme = localStorage.getItem('theme') || 'light';

// Funções de inicialização
document.addEventListener('DOMContentLoaded', function() {
  setupThemeToggle();
  initializePage();
  setupEventListeners();
  refreshDashboard();
  
  // Atualizar dados a cada 60 segundos
  setInterval(refreshDashboard, 60000);
});

function setupThemeToggle() {
  document.body.classList.toggle('dark-mode', currentTheme === 'dark');
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.checked = currentTheme === 'dark';
    themeToggle.addEventListener('change', function() {
      currentTheme = this.checked ? 'dark' : 'light';
      document.body.classList.toggle('dark-mode', this.checked);
      localStorage.setItem('theme', currentTheme);
    });
  }
}

function initializePage() {
  // Carregar configuração
  fetchConfig();
  
  // Inicializar navegação por abas
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    button.addEventListener('click', function() {
      const tabId = this.getAttribute('data-tab');
      showTab(tabId);
    });
  });
  
  // Mostrar dashboard por padrão
  showTab('dashboard');
}

function setupEventListeners() {
  // Formulário de configuração
  const configForm = document.getElementById('config-form');
  if (configForm) {
    configForm.addEventListener('submit', saveConfig);
  }
  
  // Botões de ação
  const checkNowBtn = document.getElementById('check-now-btn');
  if (checkNowBtn) {
    checkNowBtn.addEventListener('click', runManualCheck);
  }
  
  const testEmailBtn = document.getElementById('test-email-btn');
  if (testEmailBtn) {
    testEmailBtn.addEventListener('click', testEmail);
  }
  
  const testWhatsappBtn = document.getElementById('test-whatsapp-btn');
  if (testWhatsappBtn) {
    testWhatsappBtn.addEventListener('click', testWhatsapp);
  }
  
  // Filtros de histórico
  const podHistoryFilterBtn = document.getElementById('pod-history-filter-btn');
  if (podHistoryFilterBtn) {
    podHistoryFilterBtn.addEventListener('click', function() {
      fetchPodHistory(getHistoryFilters('pod'));
    });
  }
  
  const nodeHistoryFilterBtn = document.getElementById('node-history-filter-btn');
  if (nodeHistoryFilterBtn) {
    nodeHistoryFilterBtn.addEventListener('click', function() {
      fetchNodeHistory(getHistoryFilters('node'));
    });
  }
  
  // Botão para mostrar logs
  document.body.addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('view-logs-btn')) {
      const namespace = e.target.getAttribute('data-namespace');
      const podName = e.target.getAttribute('data-pod');
      fetchPodLogs(namespace, podName);
    }
  });
}

// Funções de navegação
function showTab(tabId) {
  // Esconder todas as abas
  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => {
    tab.style.display = 'none';
  });
  
  // Remover classe ativa de todos os botões
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    button.classList.remove('active');
  });
  
  // Mostrar aba selecionada
  const selectedTab = document.getElementById(tabId);
  if (selectedTab) {
    selectedTab.style.display = 'block';
  }
  
  // Ativar botão correspondente
  const activeButton = document.querySelector(`.tab-button[data-tab="${tabId}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }
  
  // Carregar dados específicos para cada aba
  if (tabId === 'dashboard') {
    refreshDashboard();
  } else if (tabId === 'pod-history') {
    fetchPodHistory();
  } else if (tabId === 'node-history') {
    fetchNodeHistory();
  } else if (tabId === 'configuration') {
    loadNamespaces();
  }
}

// Funções para o Dashboard
function refreshDashboard() {
  fetchCurrentState();
  fetchRecentActivities();
}

// Chamadas à API
function fetchConfig() {
  fetch(API_ENDPOINTS.CONFIG)
    .then(response => response.json())
    .then(data => {
      currentConfig = data;
      populateConfigForm(data);
    })
    .catch(error => {
      showNotification('Erro ao carregar configuração', 'error');
      console.error('Erro ao buscar configuração:', error);
    });
}

function saveConfig(event) {
  event.preventDefault();
  
  const form = event.target;
  const formData = new FormData(form);
  
  // Construir objeto de configuração
  const config = {
    email: {
      enabled: formData.get('email_enabled') === 'on',
      smtp_server: formData.get('smtp_server'),
      port: parseInt(formData.get('smtp_port')) || 587,
      username: formData.get('smtp_username'),
      password: formData.get('smtp_password'),
      from_email: formData.get('from_email'),
      recipients: formData.get('email_recipients').split(',').map(email => email.trim()).filter(email => email)
    },
    whatsapp: {
      enabled: formData.get('whatsapp_enabled') === 'on',
      api_url: formData.get('whatsapp_api_url'),
      api_token: formData.get('whatsapp_api_token'),
      recipients: formData.get('whatsapp_recipients').split(',').map(phone => phone.trim()).filter(phone => phone)
    },
    monitoring: {
      namespaces: Array.from(document.getElementById('namespaces').selectedOptions).map(option => option.value),
      check_interval_minutes: parseInt(formData.get('check_interval')) || 15,
      alert_hours: formData.get('alert_hours').split(',').map(hour => parseInt(hour.trim())).filter(hour => !isNaN(hour)),
      check_images: formData.get('check_images') === 'on',
      check_status: formData.get('check_status') === 'on',
      monitor_all_namespaces: formData.get('monitor_all_namespaces') === 'on',
      monitor_nodes: formData.get('monitor_nodes') === 'on',
      history_days: parseInt(formData.get('history_days')) || 30
    }
  };
  
  // Enviar para a API
  fetch(API_ENDPOINTS.CONFIG, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(config)
  })
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        showNotification('Configuração salva com sucesso', 'success');
        currentConfig = config;
      } else {
        showNotification('Erro ao salvar configuração', 'error');
      }
    })
    .catch(error => {
      showNotification('Erro ao salvar configuração', 'error');
      console.error('Erro ao salvar configuração:', error);
    });
}

function populateConfigForm(config) {
  // Email
  document.getElementById('email_enabled').checked = config.email.enabled;
  document.getElementById('smtp_server').value = config.email.smtp_server || '';
  document.getElementById('smtp_port').value = config.email.port || 587;
  document.getElementById('smtp_username').value = config.email.username || '';
  document.getElementById('smtp_password').value = config.email.password || '';
  document.getElementById('from_email').value = config.email.from_email || '';
  document.getElementById('email_recipients').value = config.email.recipients.join(', ');
  
  // WhatsApp
  document.getElementById('whatsapp_enabled').checked = config.whatsapp.enabled;
  document.getElementById('whatsapp_api_url').value = config.whatsapp.api_url || '';
  document.getElementById('whatsapp_api_token').value = config.whatsapp.api_token || '';
  document.getElementById('whatsapp_recipients').value = config.whatsapp.recipients.join(', ');
  
  // Monitoramento
  document.getElementById('check_interval').value = config.monitoring.check_interval_minutes || 15;
  document.getElementById('alert_hours').value = config.monitoring.alert_hours.join(', ');
  document.getElementById('check_images').checked = config.monitoring.check_images;
  document.getElementById('check_status').checked = config.monitoring.check_status;
  document.getElementById('monitor_all_namespaces').checked = config.monitoring.monitor_all_namespaces;
  document.getElementById('monitor_nodes').checked = config.monitoring.monitor_nodes;
  document.getElementById('history_days').value = config.monitoring.history_days || 30;
  
  // Atualizar lista de namespaces depois que obtivermos as opções disponíveis
  loadNamespaces();
}

function loadNamespaces() {
  fetch(API_ENDPOINTS.NAMESPACES)
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        const namespaceSelect = document.getElementById('namespaces');
        namespaceSelect.innerHTML = '';
        
        data.namespaces.forEach(namespace => {
          const option = document.createElement('option');
          option.value = namespace;
          option.textContent = namespace;
          
          // Selecionar namespaces já configurados
          if (currentConfig.monitoring && currentConfig.monitoring.namespaces && 
              currentConfig.monitoring.namespaces.includes(namespace)) {
            option.selected = true;
          }
          
          namespaceSelect.appendChild(option);
        });
      }
    })
    .catch(error => {
      console.error('Erro ao carregar namespaces:', error);
    });
}

function fetchCurrentState() {
  fetch(API_ENDPOINTS.CURRENT_STATE)
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        podData = data.pods;
        nodeData = data.nodes;
        
        updateDashboardStats();
        updatePodsList();
        updateNodesList();
      }
    })
    .catch(error => {
      console.error('Erro ao buscar estado atual:', error);
    });
}

function fetchRecentActivities() {
  fetch(API_ENDPOINTS.RECENT_ACTIVITIES)
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        updateRecentActivities(data.activities);
      }
    })
    .catch(error => {
      console.error('Erro ao buscar atividades recentes:', error);
    });
}

function fetchPodHistory(filters = {}) {
  let url = new URL(API_ENDPOINTS.POD_HISTORY, window.location.href);
  
  // Adicionar filtros à URL
  Object.keys(filters).forEach(key => {
    if (filters[key]) {
      url.searchParams.append(key, filters[key]);
    }
  });
  
  fetch(url)
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        updatePodHistoryTable(data.history);
      }
    })
    .catch(error => {
      console.error('Erro ao buscar histórico de pods:', error);
    });
}

function fetchNodeHistory(filters = {}) {
  let url = new URL(API_ENDPOINTS.NODE_HISTORY, window.location.href);
  
  // Adicionar filtros à URL
  Object.keys(filters).forEach(key => {
    if (filters[key]) {
      url.searchParams.append(key, filters[key]);
    }
  });
  
  fetch(url)
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        updateNodeHistoryTable(data.history);
      }
    })
    .catch(error => {
      console.error('Erro ao buscar histórico de nós:', error);
    });
}

function fetchPodLogs(namespace, podName) {
  fetch(`${API_ENDPOINTS.LOGS}/${namespace}/${podName}?tail_lines=100`)
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        showLogsModal(podName, data.logs);
      } else {
        showNotification(`Erro ao buscar logs: ${data.message}`, 'error');
      }
    })
    .catch(error => {
      console.error('Erro ao buscar logs:', error);
      showNotification('Erro ao buscar logs do pod', 'error');
    });
}

// Funções auxiliares
function getHistoryFilters(type) {
  const filters = {};
  
  if (type === 'pod') {
    filters.namespace = document.getElementById('pod-filter-namespace').value;
    filters.pod_name = document.getElementById('pod-filter-name').value;
    filters.status = document.getElementById('pod-filter-status').value;
    filters.event_type = document.getElementById('pod-filter-event').value;
    filters.start_date = document.getElementById('pod-filter-start-date').value;
    filters.end_date = document.getElementById('pod-filter-end-date').value;
  } else if (type === 'node') {
    filters.node_name = document.getElementById('node-filter-name').value;
    filters.status = document.getElementById('node-filter-status').value;
    filters.event_type = document.getElementById('node-filter-event').value;
    filters.start_date = document.getElementById('node-filter-start-date').value;
    filters.end_date = document.getElementById('node-filter-end-date').value;
  }
  
  return filters;
}

function updateDashboardStats() {
  // Calcular estatísticas
  const podsCount = Object.keys(podData).length;
  const nodesCount = Object.keys(nodeData).length;
  
  let readyPods = 0;
  let failedPods = 0;
  
  for (const podKey in podData) {
    const status = podData[podKey].status;
    if (status === 'Running') {
      readyPods++;
    } else if (['Failed', 'Error', 'CrashLoopBackOff'].includes(status)) {
      failedPods++;
    }
  }
  
  let readyNodes = 0;
  let failedNodes = 0;
  
  for (const nodeName in nodeData) {
    const status = nodeData[nodeName].status;
    if (status === 'Ready') {
      readyNodes++;
    } else {
      failedNodes++;
    }
  }
  
  // Atualizar cards do dashboard
  document.getElementById('total-pods').textContent = podsCount;
  document.getElementById('ready-pods').textContent = readyPods;
  document.getElementById('failed-pods').textContent = failedPods;
  
  document.getElementById('total-nodes').textContent = nodesCount;
  document.getElementById('ready-nodes').textContent = readyNodes;
  document.getElementById('failed-nodes').textContent = failedNodes;
}

function updatePodsList() {
  const podListContainer = document.getElementById('pods-list');
  podListContainer.innerHTML = '';
  
  if (Object.keys(podData).length === 0) {
    podListContainer.innerHTML = '<p class="no-data">Nenhum pod encontrado</p>';
    return;
  }
  
  for (const podKey in podData) {
    const [namespace, podName] = podKey.split('/');
    const pod = podData[podKey];
    const status = pod.status;
    
    const podElement = document.createElement('div');
    podElement.className = `pod-item status-${status.toLowerCase()}`;
    
    podElement.innerHTML = `
      <div class="pod-header">
        <h3>${podName}</h3>
        <span class="badge status-badge ${status.toLowerCase()}">${status}</span>
      </div>
      <div class="pod-info">
        <p><strong>Namespace:</strong> ${namespace}</p>
        <p><strong>Última verificação:</strong> ${pod.last_check}</p>
      </div>
      <details>
        <summary>Imagens</summary>
        <ul class="images-list">
          ${pod.images.map(image => `<li>${image}</li>`).join('')}
        </ul>
      </details>
      <div class="pod-actions">
        <button class="view-logs-btn" data-namespace="${namespace}" data-pod="${podName}">
          Ver Logs
        </button>
      </div>
    `;
    
    podListContainer.appendChild(podElement);
  }
}

function updateNodesList() {
  const nodeListContainer = document.getElementById('nodes-list');
  nodeListContainer.innerHTML = '';
  
  if (Object.keys(nodeData).length === 0) {
    nodeListContainer.innerHTML = '<p class="no-data">Nenhum nó encontrado</p>';
    return;
  }
  
  for (const nodeName in nodeData) {
    const node = nodeData[nodeName];
    const status = node.status;
    
    const nodeElement = document.createElement('div');
    nodeElement.className = `node-item status-${status.toLowerCase()}`;
    
    nodeElement.innerHTML = `
      <div class="node-header">
        <h3>${nodeName}</h3>
        <span class="badge status-badge ${status.toLowerCase()}">${status}</span>
      </div>
      <div class="node-info">
        <p><strong>CPU:</strong> ${node.cpu}</p>
        <p><strong>Memória:</strong> ${node.memory}</p>
        <p><strong>Pods:</strong> ${node.pods_count}</p>
        <p><strong>Última verificação:</strong> ${node.last_check}</p>
      </div>
    `;
    
    nodeListContainer.appendChild(nodeElement);
  }
}

function updateRecentActivities(activities) {
  const activitiesContainer = document.getElementById('recent-activities');
  activitiesContainer.innerHTML = '';
  
  if (!activities || activities.length === 0) {
    activitiesContainer.innerHTML = '<p class="no-data">Nenhuma atividade recente</p>';
    return;
  }
  
  const activityList = document.createElement('ul');
  activityList.className = 'activity-list';
  
  activities.forEach(activity => {
    const activityItem = document.createElement('li');
    activityItem.className = 'activity-item';
    
    let eventIcon;
    let eventClass;
    
    switch (activity.event) {
      case 'new_pod':
        eventIcon = '🆕';
        eventClass = 'new';
        break;
      case 'pod_removed':
        eventIcon = '🗑️';
        eventClass = 'removed';
        break;
      case 'status_change':
        eventIcon = '🔄';
        eventClass = 'status';
        break;
      case 'image_change':
        eventIcon = '📦';
        eventClass = 'image';
        break;
      default:
        eventIcon = '📝';
        eventClass = 'default';
    }
    
    activityItem.innerHTML = `
      <span class="activity-icon ${eventClass}">${eventIcon}</span>
      <div class="activity-content">
        <p class="activity-resource">${activity.resource}</p>
        <p class="activity-detail">
          <span class="activity-namespace">${activity.namespace}</span>
          <span class="activity-event">${activity.event}</span>
        </p>
      </div>
      <span class="activity-time">${formatTimestamp(activity.timestamp)}</span>
    `;
    
    activityList.appendChild(activityItem);
  });
  
  activitiesContainer.appendChild(activityList);
}

function updatePodHistoryTable(history) {
  const tableContainer = document.getElementById('pod-history-table');
  tableContainer.innerHTML = '';
  
  if (!history || history.length === 0) {
    tableContainer.innerHTML = '<p class="no-data">Nenhum registro encontrado</p>';
    return;
  }
  
  const table = document.createElement('table');
  table.className = 'history-table';
  
  table.innerHTML = `
    <thead>
      <tr>
        <th>Data/Hora</th>
        <th>Namespace</th>
        <th>Pod</th>
        <th>Status</th>
        <th>Evento</th>
      </tr>
    </thead>
    <tbody>
      ${history.map(entry => `
        <tr>
          <td>${formatTimestamp(entry.timestamp)}</td>
          <td>${entry.namespace}</td>
          <td>${entry.pod_name}</td>
          <td><span class="badge status-badge ${entry.status.toLowerCase()}">${entry.status}</span></td>
          <td>${entry.event_type}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  
  tableContainer.appendChild(table);
}

function updateNodeHistoryTable(history) {
  const tableContainer = document.getElementById('node-history-table');
  tableContainer.innerHTML = '';
  
  if (!history || history.length === 0) {
    tableContainer.innerHTML = '<p class="no-data">Nenhum registro encontrado</p>';
    return;
  }
  
  const table = document.createElement('table');
  table.className = 'history-table';
  
  table.innerHTML = `
    <thead>
      <tr>
        <th>Data/Hora</th>
        <th>Nó</th>
        <th>Status</th>
        <th>CPU</th>
        <th>Memória</th>
        <th>Pods</th>
        <th>Evento</th>
      </tr>
    </thead>
    <tbody>
      ${history.map(entry => `
        <tr>
          <td>${formatTimestamp(entry.timestamp)}</td>
          <td>${entry.node_name}</td>
          <td><span class="badge status-badge ${entry.status.toLowerCase()}">${entry.status}</span></td>
          <td>${entry.cpu}</td>
          <td>${entry.memory}</td>
          <td>${entry.pods_count}</td>
          <td>${entry.event_type}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  
  tableContainer.appendChild(table);
}

function formatTimestamp(timestamp) {
  // Converter para formato mais legível
  const date = new Date(timestamp.replace(' ', 'T'));
  
  if (isNaN(date.getTime())) {
    return timestamp; // Retornar original se não conseguir converter
  }
  
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

// Ações e modais
function runManualCheck() {
  const checkButton = document.getElementById('check-now-btn');
  checkButton.disabled = true;
  checkButton.textContent = 'Verificando...';
  
  fetch(API_ENDPOINTS.CHECK_NOW, {
    method: 'POST'
  })
    .then(response => response.json())
    .then(data => {
      checkButton.disabled = false;
      checkButton.textContent = 'Verificar Agora';
      
      if (data.status === 'success') {
        showNotification('Verificação concluída', 'success');
        
        if (data.changes && data.changes.length > 0) {
          showChangesModal(data.changes);
        } else {
          showNotification('Nenhuma alteração detectada', 'info');
        }
        
        // Atualizar dashboard
        refreshDashboard();
      } else {
        showNotification('Erro ao executar verificação', 'error');
      }
    })
    .catch(error => {
      checkButton.disabled = false;
      checkButton.textContent = 'Verificar Agora';
      showNotification('Erro ao executar verificação', 'error');
      console.error('Erro na verificação manual:', error);
    });
}

function testEmail() {
  const testButton = document.getElementById('test-email-btn');
  testButton.disabled = true;
  testButton.textContent = 'Enviando...';
  
  fetch(API_ENDPOINTS.TEST_EMAIL, {
    method: 'POST'
  })
    .then(response => response.json())
    .then(data => {
      testButton.disabled = false;
      testButton.textContent = 'Testar E-mail';
      
      if (data.status === 'success') {
        showNotification('E-mail de teste enviado com sucesso', 'success');
      } else {
        showNotification(`Falha ao enviar e-mail: ${data.message}`, 'error');
      }
    })
    .catch(error => {
      testButton.disabled = false;
      testButton.textContent = 'Testar E-mail';
      showNotification('Erro ao enviar e-mail de teste', 'error');
      console.error('Erro no teste de e-mail:', error);
    });
}

function testWhatsapp() {
  const testButton = document.getElementById('test-whatsapp-btn');
  testButton.disabled = true;
  testButton.textContent = 'Enviando...';
  
  fetch(API_ENDPOINTS.TEST_WHATSAPP, {
    method: 'POST'
  })
    .then(response => response.json())
    .then(data => {
      testButton.disabled = false;
      testButton.textContent = 'Testar WhatsApp';
      
      if (data.status === 'success') {
        showNotification('WhatsApp de teste enviado com sucesso', 'success');
      } else {
        showNotification(`Falha ao enviar WhatsApp: ${data.message}`, 'error');
      }
    })
    .catch(error => {
      testButton.disabled = false;
      testButton.textContent = 'Testar WhatsApp';
      showNotification('Erro ao enviar WhatsApp de teste', 'error');
      console.error('Erro no teste de WhatsApp:', error);
    });
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  const container = document.getElementById('notification-container');
  if (!container) {
    const newContainer = document.createElement('div');
    newContainer.id = 'notification-container';
    document.body.appendChild(newContainer);
    newContainer.appendChild(notification);
  } else {
    container.appendChild(notification);
  }
  
  // Remover após 5 segundos
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => {
      notification.remove();
    }, 500);
  }, 5000);
}

function showChangesModal(changes) {
  // Criar modal
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  
  const modal = document.createElement('div');
  modal.className = 'modal changes-modal';
  
  modal.innerHTML = `
    <div class="modal-header">
      <h2>Alterações Detectadas</h2>
      <button class="close-modal">&times;</button>
    </div>
    <div class="modal-content">
      <ul class="changes-list">
        ${changes.map(change => `<li>${change}</li>`).join('')}
      </ul>
    </div>
    <div class="modal-footer">
      <button class="modal-btn close-btn">Fechar</button>
    </div>
  `;
  
  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);
  
  // Adicionar event listeners
  modalOverlay.querySelector('.close-modal').addEventListener('click', () => {
    modalOverlay.remove();
  });
  
  modalOverlay.querySelector('.close-btn').addEventListener('click', () => {
    modalOverlay.remove();
  });
}

function showLogsModal(podName, logs) {
  // Criar modal
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  
  const modal = document.createElement('div');
  modal.className = 'modal logs-modal';
  
  modal.innerHTML = `
    <div class="modal-header">
      <h2>Logs: ${podName}</h2>
      <button class="close-modal">&times;</button>
    </div>
    <div class="modal-content">
      <pre class="logs-container">${logs.join('\n')}</pre>
    </div>
    <div class="modal-footer">
      <button class="modal-btn close-btn">Fechar</button>
    </div>
  `;
  
  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);
  
  // Adicionar event listeners
  modalOverlay.querySelector('.close-modal').addEventListener('click', () => {
    modalOverlay.remove();
  });
  
  modalOverlay.querySelector('.close-btn').addEventListener('click', () => {
    modalOverlay.remove();
  });
}