// Frontend controller for LOHAS Linear Regression Band Analyzer

let lohasChart = null;
let channelChart = null;
let vixChart = null;
let maChart = null;
let currentPeriod = 3.5; // Default period

// Monitor detail variables
let monitorLohasChart = null;
let monitorChannelChart = null;
let currentMonitorSymbol = null;
let currentMonitorPeriod = 3.5;

// Wait for DOM to load
// Tab state management
let activeTab = 'monitor';
let monitorData = [];

document.addEventListener('DOMContentLoaded', () => {
    // Parse URL parameters if present
    const urlParams = new URLSearchParams(window.location.search);
    const urlSymbol = urlParams.get('symbol');
    const urlPeriod = urlParams.get('period');
    
    if (urlSymbol) {
        document.getElementById('stock-symbol').value = urlSymbol;
    }
    if (urlPeriod) {
        currentPeriod = parseFloat(urlPeriod);
        // Update active period button
        const periodButtons = document.querySelectorAll('#period-selector .btn-period');
        periodButtons.forEach(btn => {
            if (parseFloat(btn.getAttribute('data-period')) === currentPeriod) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    initPeriodSelector();
    
    // Choose starting tab based on whether a symbol was linked
    if (urlSymbol) {
        switchTab('analysis');
    } else {
        switchTab('monitor');
    }

    // Resize chart when window resizing
    window.addEventListener('resize', () => {
        if (lohasChart) {
            lohasChart.resize();
        }
        if (channelChart) {
            channelChart.resize();
        }
        if (vixChart) {
            vixChart.resize();
        }
        if (maChart) {
            maChart.resize();
        }
        if (monitorLohasChart) {
            monitorLohasChart.resize();
        }
        if (monitorChannelChart) {
            monitorChannelChart.resize();
        }
    });
});

function switchTab(tab) {
    activeTab = tab;
    const tabMonitor = document.getElementById('tab-monitor');
    const tabAnalysis = document.getElementById('tab-analysis');
    const monitorView = document.getElementById('monitor-view');
    const analysisView = document.getElementById('analysis-view');
    
    if (tab === 'monitor') {
        tabMonitor.classList.add('active');
        tabAnalysis.classList.remove('active');
        monitorView.classList.remove('hidden');
        analysisView.classList.add('hidden');
        
        loadMonitorData();

        // Resize monitor detail charts since they might have been drawn while hidden
        setTimeout(() => {
            if (monitorLohasChart) monitorLohasChart.resize();
            if (monitorChannelChart) monitorChannelChart.resize();
        }, 100);
    } else {
        tabAnalysis.classList.add('active');
        tabMonitor.classList.remove('active');
        analysisView.classList.remove('hidden');
        monitorView.classList.add('hidden');
        
        // Render charts on resize since they might have been drawn while hidden
        setTimeout(() => {
            if (lohasChart) lohasChart.resize();
            if (channelChart) channelChart.resize();
            if (vixChart) vixChart.resize();
            if (maChart) maChart.resize();
        }, 100);
    }
}

// ─── 自訂監控清單 (localStorage) ─────────────────────────────────
const WATCHLIST_KEY = 'lohas_custom_watchlist';

function getCustomWatchlist() {
    try {
        const raw = localStorage.getItem(WATCHLIST_KEY);
        return raw ? JSON.parse(raw) : null;  // null = 尚未自訂，使用後端預設
    } catch { return null; }
}

function saveCustomWatchlist(list) {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

async function loadMonitorData() {
    const tableBody = document.getElementById('monitor-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = `
        <tr>
            <td colspan="6" style="text-align: center; padding: 3rem;">
                <div class="spinner-pulse" style="margin: 0 auto 1rem;"></div>
                <p style="color: var(--text-secondary);">正在加載即時商品與位階數據...</p>
            </td>
        </tr>
    `;
    
    try {
        // 若有自訂清單，把 symbols 傳給後端；否則用後端預設清單
        const customList = getCustomWatchlist();
        let url = '/api/monitor';
        if (customList && customList.length > 0) {
            const symbolsParam = customList.map(i => i.symbol).join(',');
            url = `/api/monitor?symbols=${encodeURIComponent(symbolsParam)}`;
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error('加載監控數據失敗');
        let data = await response.json();

        // 用本地自訂名稱覆蓋後端回傳的名稱
        if (customList && customList.length > 0) {
            const nameMap = {};
            customList.forEach(i => { nameMap[i.symbol.toUpperCase()] = i.name; });
            data = data.map(item => ({
                ...item,
                name: nameMap[item.symbol.toUpperCase()] || item.name
            }));
        }
        monitorData = data;
        renderMonitorTable(monitorData);
    } catch (error) {
        console.error(error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: #ef4444; padding: 3rem;">
                    <i class="fa-solid fa-circle-exclamation" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
                    <p style="font-weight: 600;">數據載入失敗</p>
                    <p style="font-size: 0.85rem; margin-top: 0.5rem; color: var(--text-secondary);">${error.message}</p>
                    <button class="btn-preset" style="margin-top: 1rem; padding: 0.4rem 1rem;" onclick="loadMonitorData()">重試</button>
                </td>
            </tr>
        `;
    }
}

function renderMonitorTable(data) {
    const tableBody = document.getElementById('monitor-table-body');
    if (!tableBody) return;

    // 從 localStorage 讀取使用者上次的排序，若有則依此順序重排資料
    const savedOrder = getSavedMonitorOrder();
    if (savedOrder.length > 0) {
        data = sortByOrder(data, savedOrder);
    }

    tableBody.innerHTML = '';
    
    data.forEach((item) => {
        const tr = createMonitorRow(item);
        tableBody.appendChild(tr);
    });

    // 初始化拖曳排序
    initDragSort(tableBody);

    // 自動加載第一個監控商品詳情，或是維持當前商品
    if (data.length > 0) {
        const stillExists = data.some(item => item.symbol.toUpperCase() === (currentMonitorSymbol || '').toUpperCase());
        if (stillExists) {
            loadMonitorDetail(currentMonitorSymbol, currentMonitorPeriod);
        } else {
            loadMonitorDetail(data[0].symbol, currentMonitorPeriod);
        }
    }
}


function createMonitorRow(item) {
    const tr = document.createElement('tr');
    tr.setAttribute('draggable', 'true');
    tr.setAttribute('data-symbol', item.symbol);

    // 點擊列（非操作區）→ 切換到單檔分析
    tr.addEventListener('click', (e) => {
        if (!e.target.closest('.row-actions')) {
            selectSymbolFromMonitor(item.symbol);
        }
    });

    const priceStr = formatNumber(item.price, 2);
    let changeClass = 'change-none';
    let changeSymbol = '';
    if (item.change > 0) { changeClass = 'change-up'; changeSymbol = '▲'; }
    else if (item.change < 0) { changeClass = 'change-down'; changeSymbol = '▼'; }

    const changeStr = item.change !== 0 ? `${changeSymbol}${Math.abs(item.change).toFixed(4)}` : '0.0000';
    const percentStr = item.change_percent !== 0 ? `${item.change > 0 ? '+' : ''}${item.change_percent.toFixed(2)}%` : '0.00%';
    const lohasBadgeClass = `lohas-badge-${item.lohas_level}`;
    const channelBadgeClass = `channel-badge-${item.channel_level}`;

    const symEsc = item.symbol.replace(/'/g, "\\'");
    const nameEsc = (item.name || item.symbol).replace(/'/g, "\\'");

    tr.innerHTML = `
        <td>
            <div style="font-weight: 700; font-size: 1.05rem; color: #ffffff;" class="item-name-display">${item.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">${item.symbol}</div>
        </td>
        <td style="font-family: monospace; font-size: 1.1rem; font-weight: 600; color: #f8fafc;">
            ${priceStr}
        </td>
        <td class="${changeClass}" style="font-family: monospace;">
            <div style="font-size: 1rem; font-weight: 600;">${changeStr}</div>
            <div style="font-size: 0.85rem; margin-top: 0.2rem;">${percentStr}</div>
        </td>
        <td>
            <span class="level-badge ${lohasBadgeClass}">${item.lohas_level}</span>
        </td>
        <td>
            <span class="level-badge ${channelBadgeClass}">${item.channel_level}</span>
        </td>
        <td>
            <div class="row-actions" style="display:flex; align-items:center; justify-content:center; gap:0.3rem;">
                <button title="改名" onclick="renameMonitorItem('${symEsc}','${nameEsc}')" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:0.95rem; padding:0.3rem 0.4rem; border-radius:6px; transition:color 0.15s;" onmouseover="this.style.color='#818cf8'" onmouseout="this.style.color='#94a3b8'"><i class="fa-solid fa-pen-to-square"></i></button>
                <button title="刪除" onclick="deleteMonitorItem('${symEsc}')" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:0.95rem; padding:0.3rem 0.4rem; border-radius:6px; transition:color 0.15s;" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#94a3b8'"><i class="fa-solid fa-trash"></i></button>
                <i class="fa-solid fa-grip-vertical drag-handle" title="拖曳排序" style="cursor:grab; color:#64748b; font-size:0.9rem; padding:0.3rem 0.4rem;"></i>
            </div>
        </td>
    `;
    return tr;
}

// ─── 刪除商品 ─────────────────────────────────────────────────────
function deleteMonitorItem(symbol) {
    if (!confirm(`確定要從監控清單移除「${symbol}」嗎？`)) return;

    let list = getCustomWatchlist();
    if (!list) {
        // 第一次操作，從目前顯示的資料初始化自訂清單
        list = monitorData.map(d => ({ symbol: d.symbol, name: d.name }));
    }
    list = list.filter(i => i.symbol.toUpperCase() !== symbol.toUpperCase());
    saveCustomWatchlist(list);

    // 同步移除排序記憶
    const orderKey = 'lohas_monitor_order';
    try {
        let order = JSON.parse(localStorage.getItem(orderKey) || '[]');
        order = order.filter(s => s.toUpperCase() !== symbol.toUpperCase());
        localStorage.setItem(orderKey, JSON.stringify(order));
    } catch {}

    loadMonitorData();
}

// ─── 改名商品 ─────────────────────────────────────────────────────
function renameMonitorItem(symbol, currentName) {
    const newName = prompt(`請輸入「${symbol}」的新顯示名稱：`, currentName);
    if (newName === null) return;  // 使用者取消
    const finalName = newName.trim() || currentName;

    let list = getCustomWatchlist();
    if (!list) {
        list = monitorData.map(d => ({ symbol: d.symbol, name: d.name }));
    }
    const idx = list.findIndex(i => i.symbol.toUpperCase() === symbol.toUpperCase());
    if (idx >= 0) {
        list[idx].name = finalName;
    } else {
        list.push({ symbol, name: finalName });
    }
    saveCustomWatchlist(list);
    loadMonitorData();
}

// ─── 新增商品 Modal ───────────────────────────────────────────────
function openAddMonitorModal() {
    document.getElementById('modal-symbol').value = '';
    document.getElementById('modal-name').value = '';
    document.getElementById('modal-error').style.display = 'none';
    const modal = document.getElementById('add-monitor-modal');
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('modal-symbol').focus(), 50);
}

function closeAddMonitorModal() {
    document.getElementById('add-monitor-modal').style.display = 'none';
}

async function confirmAddMonitor() {
    const symbolRaw = document.getElementById('modal-symbol').value.trim();
    const nameRaw   = document.getElementById('modal-name').value.trim();
    const errEl     = document.getElementById('modal-error');
    const confirmBtn = document.getElementById('modal-confirm');

    if (!symbolRaw) {
        errEl.textContent = '請輸入股票 / 商品代碼';
        errEl.style.display = 'block';
        return;
    }

    // 簡易驗證：呼叫後端確認代碼有效
    confirmBtn.textContent = '驗證中...';
    confirmBtn.disabled = true;
    errEl.style.display = 'none';
    try {
        const res = await fetch(`/api/lohas?symbol=${encodeURIComponent(symbolRaw)}&period_years=0.5&use_cache_only=false`);
        if (!res.ok) throw new Error('代碼無效或找不到資料，請確認是否正確');
        const data = await res.json();
        const autoName = nameRaw || data.company_name || symbolRaw.toUpperCase();
        const newSymbol = data.symbol; // 後端標準化後的代碼

        let list = getCustomWatchlist();
        if (!list) {
            // 把當前監控資料初始化為自訂清單
            list = monitorData.map(d => ({ symbol: d.symbol, name: d.name }));
        }
        // 避免重複新增
        if (list.some(i => i.symbol.toUpperCase() === newSymbol.toUpperCase())) {
            errEl.textContent = `「${newSymbol}」已在監控清單中`;
            errEl.style.display = 'block';
            confirmBtn.textContent = '確認新增';
            confirmBtn.disabled = false;
            return;
        }
        list.push({ symbol: newSymbol, name: autoName });
        saveCustomWatchlist(list);
        closeAddMonitorModal();
        loadMonitorData();
    } catch (e) {
        errEl.textContent = e.message || '驗證失敗，請確認代碼是否正確';
        errEl.style.display = 'block';
    } finally {
        confirmBtn.textContent = '確認新增';
        confirmBtn.disabled = false;
    }
}

// 點擊 Modal 背景關閉
document.addEventListener('click', (e) => {
    const modal = document.getElementById('add-monitor-modal');
    if (modal && e.target === modal) closeAddMonitorModal();
});

// Enter 鍵送出 Modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const modal = document.getElementById('add-monitor-modal');
        if (modal && modal.style.display === 'flex') confirmAddMonitor();
    }
    if (e.key === 'Escape') closeAddMonitorModal();
});


// ─── 拖曳排序邏輯 ────────────────────────────────────────────────
let dragSrc = null;

function initDragSort(tableBody) {
    tableBody.addEventListener('dragstart', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        dragSrc = tr;
        tr.style.opacity = '0.45';
        e.dataTransfer.effectAllowed = 'move';
    });

    tableBody.addEventListener('dragend', (e) => {
        const tr = e.target.closest('tr');
        if (tr) tr.style.opacity = '1';
        // 清除所有列的高亮
        tableBody.querySelectorAll('tr').forEach(r => {
            r.style.borderTop = '';
            r.style.borderBottom = '';
        });
        // 儲存新順序到 localStorage
        saveMonitorOrder(tableBody);
    });

    tableBody.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const tr = e.target.closest('tr');
        if (!tr || tr === dragSrc) return;
        // 高亮目標列
        tableBody.querySelectorAll('tr').forEach(r => {
            r.style.borderTop = '';
            r.style.borderBottom = '';
        });
        const rect = tr.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
            tr.style.borderTop = '2px solid var(--accent-primary)';
        } else {
            tr.style.borderBottom = '2px solid var(--accent-primary)';
        }
    });

    tableBody.addEventListener('drop', (e) => {
        e.preventDefault();
        const tr = e.target.closest('tr');
        if (!tr || tr === dragSrc) return;
        const rect = tr.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
            tableBody.insertBefore(dragSrc, tr);
        } else {
            tableBody.insertBefore(dragSrc, tr.nextSibling);
        }
        tr.style.borderTop = '';
        tr.style.borderBottom = '';
    });
}

// ─── localStorage 排序持久化 ──────────────────────────────────────
const MONITOR_ORDER_KEY = 'lohas_monitor_order';

function saveMonitorOrder(tableBody) {
    const order = [...tableBody.querySelectorAll('tr[data-symbol]')]
        .map(tr => tr.getAttribute('data-symbol'));
    localStorage.setItem(MONITOR_ORDER_KEY, JSON.stringify(order));
}

function getSavedMonitorOrder() {
    try {
        const raw = localStorage.getItem(MONITOR_ORDER_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function sortByOrder(data, order) {
    const orderMap = {};
    order.forEach((sym, idx) => { orderMap[sym] = idx; });
    return [...data].sort((a, b) => {
        const ia = orderMap[a.symbol] !== undefined ? orderMap[a.symbol] : 9999;
        const ib = orderMap[b.symbol] !== undefined ? orderMap[b.symbol] : 9999;
        return ia - ib;
    });
}



function selectSymbolFromMonitor(symbol) {
    if (activeTab === 'monitor') {
        loadMonitorDetail(symbol, currentMonitorPeriod, true);
    } else {
        switchTab('analysis');
        setSymbol(symbol);
    }
}

// Initialize Period Buttons
function initPeriodSelector() {
    const periodButtons = document.querySelectorAll('#period-selector .btn-period');
    periodButtons.forEach(button => {
        button.addEventListener('click', () => {
            periodButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentPeriod = parseFloat(button.getAttribute('data-period'));
            handleSearch();
        });
    });

    const monitorPeriodButtons = document.querySelectorAll('#monitor-detail-period-selector .btn-period');
    monitorPeriodButtons.forEach(button => {
        button.addEventListener('click', () => {
            monitorPeriodButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentMonitorPeriod = parseFloat(button.getAttribute('data-period'));
            if (currentMonitorSymbol) {
                loadMonitorDetail(currentMonitorSymbol, currentMonitorPeriod);
            }
        });
    });
}

// Update Navigation Links dynamically to preserve symbol & period state
function updateNavLinks(symbol, period) {
    const maLink = document.getElementById('nav-ma-link');
    if (maLink) {
        maLink.href = `/ma?symbol=${encodeURIComponent(symbol)}&period=${period}`;
    }
}

// Preset Symbols Handler
function setSymbol(symbol) {
    document.getElementById('stock-symbol').value = symbol;

    // Update active state in preset buttons
    const presetButtons = document.querySelectorAll('.presets .btn-preset');
    presetButtons.forEach(button => {
        const onClickStr = button.getAttribute('onclick') || '';
        const match = onClickStr.match(/setSymbol\(['"]([^'"]+)['"]\)/);
        const presetSymbol = match ? match[1] : '';
        if (presetSymbol.toUpperCase() === symbol.toUpperCase()) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });

    handleSearch();
}

// Format number helper
function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return '--';
    return Number(num).toLocaleString('zh-TW', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// Get Band Classification styling
function getLevelStyleClass(levelText) {
    if (levelText.includes('極樂觀')) return 'level-extreme-optimistic';
    if (levelText.includes('極悲觀')) return 'level-extreme-pessimistic';
    if (levelText.includes('偏樂觀')) return 'level-mid-optimistic';
    if (levelText.includes('偏悲觀')) return 'level-mid-pessimistic';
    if (levelText.includes('樂觀')) return 'level-optimistic';
    if (levelText.includes('悲觀')) return 'level-pessimistic';
    return '';
}

// Core action: Fetch data and Render
async function handleSearch() {
    const symbolInput = document.getElementById('stock-symbol');
    const symbol = symbolInput.value.trim();
    if (!symbol) return;

    // Update active state in preset buttons to match search input
    const presetButtons = document.querySelectorAll('.presets .btn-preset');
    presetButtons.forEach(button => {
        const onClickStr = button.getAttribute('onclick') || '';
        const match = onClickStr.match(/setSymbol\(['"]([^'"]+)['"]\)/);
        const presetSymbol = match ? match[1] : '';

        const symbolUpper = symbol.toUpperCase();
        const presetSymbolUpper = presetSymbol.toUpperCase();
        const textUpper = button.textContent.toUpperCase();

        if (presetSymbolUpper === symbolUpper ||
            (symbolUpper.length >= 3 && presetSymbolUpper.includes(symbolUpper)) ||
            (symbolUpper.length >= 3 && textUpper.includes(symbolUpper))) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });

    const placeholder = document.getElementById('insights-placeholder');
    const content = document.getElementById('insights-content');
    const submitBtn = document.getElementById('btn-submit');

    // Show loading spinner
    placeholder.classList.remove('hidden');
    content.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 計算中...';

    try {
        const response = await fetch(`/api/lohas?symbol=${encodeURIComponent(symbol)}&period_years=${currentPeriod}`);

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || '取得資料失敗');
        }

        const data = await response.json();

        // Render diagnostics & dashboard insights
        renderInsights(data);

        // Render ECharts
        renderChart(data);
        renderChannelChart(data);
        renderVixChart(data);
        renderMaChart(data);

    } catch (error) {
        console.error(error);
        alert(`錯誤: ${error.message}`);
        placeholder.innerHTML = `
            <div style="text-align: center; color: #ef4444; padding: 2rem;">
                <i class="fa-solid fa-circle-exclamation" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
                <p style="font-weight: 600;">資料載入失敗</p>
                <p style="font-size: 0.85rem; margin-top: 0.5rem; color: var(--text-muted);">${error.message}</p>
                <button class="btn-preset" style="margin-top: 1rem; padding: 0.4rem 1rem;" onclick="handleSearch()">重試</button>
            </div>
        `;
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> 開始分析';
    }
}

// Populate Insights Cards
function renderInsights(data) {
    const placeholder = document.getElementById('insights-placeholder');
    const content = document.getElementById('insights-content');

    placeholder.classList.add('hidden');
    content.classList.remove('hidden');

    // Title and Metadata: Display company name alongside the symbol
    const displayName = data.company_name && data.company_name !== data.symbol
        ? data.company_name
        : data.symbol;
    document.getElementById('info-symbol').textContent = displayName;
    document.getElementById('info-period').textContent = `${data.period_years} 年區間`;

    const latest = data.latest;

    document.getElementById('info-price').textContent = formatNumber(latest.actual);
    document.getElementById('info-date').textContent = `${latest.date} 收盤`;
    document.getElementById('info-central').textContent = formatNumber(latest.central);
    document.getElementById('info-sigma').textContent = formatNumber(latest.sigma);

    // Bias Z-score decoration
    const biasVal = latest.bias;
    const biasSign = biasVal >= 0 ? '+' : '';
    document.getElementById('info-bias').textContent = `${biasSign}${formatNumber(biasVal, 2)} σ`;

    // Level Badge styling
    const levelEl = document.getElementById('info-level');
    levelEl.textContent = latest.level;
    levelEl.className = 'value badge-level ' + getLevelStyleClass(latest.level);

    // Channel Diagnostics
    const channel = data.channel;
    let wClose = 0, wMA = 0, wUp = 0, wDown = 0;
    let hasChannel = channel && channel.actual.length > 0;
    if (hasChannel) {
        wClose = channel.actual[channel.actual.length - 1];
        wMA = channel.ma[channel.ma.length - 1];
        wUp = channel.up_band[channel.up_band.length - 1];
        wDown = channel.down_band[channel.down_band.length - 1];
        
        document.getElementById('info-channel-ma').textContent = formatNumber(wMA);
        
        let chPosText = '--';
        let chPosClass = '';
        if (wClose > wUp) {
            chPosText = '超漲 (高於上軌)';
            chPosClass = 'level-extreme-optimistic';
        } else if (wClose < wDown) {
            chPosText = '超跌 (低於下軌)';
            chPosClass = 'level-extreme-pessimistic';
        } else if (wClose >= wMA) {
            chPosText = '偏多 (高於中軌)';
            chPosClass = 'level-mid-optimistic';
        } else {
            chPosText = '偏空 (低於中軌)';
            chPosClass = 'level-mid-pessimistic';
        }
        const chPosEl = document.getElementById('info-channel-pos');
        chPosEl.textContent = chPosText;
        chPosEl.className = 'value badge-level ' + chPosClass;
    } else {
        document.getElementById('info-channel-ma').textContent = '--';
        document.getElementById('info-channel-pos').textContent = '--';
    }

    // 5y & 10y Moving Average Diagnostics
    const latestActual = latest.actual;
    const ma5y = data.ma_5y[data.ma_5y.length - 1];
    const ma10y = data.ma_10y[data.ma_10y.length - 1];

    document.getElementById('info-ma5y').textContent = formatNumber(ma5y);
    document.getElementById('info-ma10y').textContent = formatNumber(ma10y);

    const bias5y = ((latestActual - ma5y) / ma5y) * 100;
    const bias10y = ((latestActual - ma10y) / ma10y) * 100;

    const bias5ySign = bias5y >= 0 ? '+' : '';
    const bias10ySign = bias10y >= 0 ? '+' : '';

    const ma5yBiasEl = document.getElementById('info-ma5y-bias');
    ma5yBiasEl.textContent = `${bias5ySign}${formatNumber(bias5y, 2)}%`;
    ma5yBiasEl.style.color = bias5y >= 0 ? '#bbf7d0' : '#fca5a5';

    const ma10yBiasEl = document.getElementById('info-ma10y-bias');
    ma10yBiasEl.textContent = `${bias10ySign}${formatNumber(bias10y, 2)}%`;
    ma10yBiasEl.style.color = bias10y >= 0 ? '#bbf7d0' : '#fca5a5';

    // MA Alignment Analysis
    let maAlignmentText = '';
    let maAlignmentClass = '';

    const maDiffPercent = Math.abs(ma5y - ma10y) / ((ma5y + ma10y) / 2) * 100;
    const isTangled = maDiffPercent < 1.5;

    if (isTangled) {
        maAlignmentText = '均線糾結整理 (轉折期)';
        maAlignmentClass = 'level-mid-pessimistic';
    } else if (latestActual >= ma5y && ma5y >= ma10y) {
        maAlignmentText = '長線多頭排列 (強勢多頭)';
        maAlignmentClass = 'level-extreme-pessimistic';
    } else if (ma5y > latestActual && latestActual >= ma10y) {
        maAlignmentText = '多頭拉回整理 (十年線支撐)';
        maAlignmentClass = 'level-mid-optimistic';
    } else if (latestActual >= ma5y && ma5y < ma10y) {
        if (latestActual >= ma10y) {
            maAlignmentText = '空頭低檔反彈 (挑戰十年線)';
            maAlignmentClass = 'level-mid-pessimistic';
        } else {
            maAlignmentText = '空頭低檔反彈 (站上五年線)';
            maAlignmentClass = 'level-mid-pessimistic';
        }
    } else if (ma5y > ma10y && latestActual < ma10y) {
        maAlignmentText = '多頭轉折破位 (失守十年線)';
        maAlignmentClass = 'level-extreme-optimistic';
    } else {
        maAlignmentText = '長線空頭排列 (弱勢空頭)';
        maAlignmentClass = 'level-extreme-optimistic';
    }

    const alignmentEl = document.getElementById('info-ma-alignment');
    alignmentEl.textContent = maAlignmentText;
    alignmentEl.className = 'value badge-level ' + maAlignmentClass;

    // Guidance & Investment Strategy (Combined with Channel status)
    const guidanceCard = document.getElementById('info-guidance-card');
    const guidanceIcon = document.getElementById('info-guidance-icon');
    const guidanceDesc = document.getElementById('info-guidance-desc');

    let gClass = 'guidance-hold';
    let gIcon = 'fa-circle-info';
    let gDesc = '';

    if (biasVal >= 2.0) {
        gClass = 'guidance-sell';
        gIcon = 'fa-triangle-exclamation';
        if (hasChannel && wClose > wUp) {
            gDesc = '【極樂觀位階且突破通道上軌】股價與通道雙重過熱，雖多頭動能強勁，但隨時可能面臨高檔拉回。建議逢高積極落實分批獲利了結，切勿盲目追高。';
        } else {
            gDesc = '【極樂觀位階】股價偏離回歸中軌極大，市場情緒極度貪婪，此為歷史相對高檔風險區。強烈建議停止追高，分批減碼以規避價格拉回與修正風險。';
        }
    } else if (biasVal >= 1.0) {
        gClass = 'guidance-sell';
        gIcon = 'fa-shield-halved';
        gDesc = '【樂觀位階】股價已進入相對高檔區，獲利了結賣壓可能逐步浮現。建議逢高適度調節持股，不宜重倉追價或融資擴大槓桿。';
    } else if (biasVal >= 0.0) {
        gClass = 'guidance-hold';
        gIcon = 'fa-circle-check';
        gDesc = '【偏樂觀位階】股價略高於趨勢中軌，仍屬於常態隨機波動區間。目前多頭趨勢仍在，建議持股續抱，注意觀察大盤走勢與趨勢線斜率是否持續向上。';
    } else if (biasVal >= -1.0) {
        gClass = 'guidance-hold';
        gIcon = 'fa-circle-check';
        if (hasChannel && wClose < wDown) {
            gDesc = '【偏悲觀位階但跌破通道下軌】股價低於中軌且跌破樂活通道下緣，弱勢格局尚未止穩。建議先冷靜觀察，等股價站回通道下軌之內再行分批佈局。';
        } else {
            gDesc = '【偏悲觀位階】股價略低於中軌，處於中性偏低的位置。基本面健全的前提下，目前為健康的持股整理期，無須因短期價格下跌而過度恐慌。';
        }
    } else if (biasVal >= -2.0) {
        gClass = 'guidance-buy';
        gIcon = 'fa-chart-line-down';
        if (hasChannel && wClose < wDown) {
            gDesc = '【悲觀位階但跌破通道下軌】股價進入相對低估區，但樂活通道下軌失守，短線仍有慣性下跌動能。建議暫緩進場，靜待股價回升並重新站回下軌之上。';
        } else {
            gDesc = '【悲觀位階】股價進入相對低估機會區，市場情緒偏向悲觀，下行風險已大部分釋放。長線資金可考慮啟動定期定額或分批建倉計劃，累積便宜籌碼。';
        }
    } else {
        gClass = 'guidance-buy';
        gIcon = 'fa-gem';
        if (hasChannel && wClose < wDown) {
            gDesc = '【極悲觀位階但跌破通道下軌】市場恐懼蔓延且股價破通道底，長線極具吸引力。此時建議分批定期定額，或等待站回通道下軌之上再行重倉進場，以防價格過早探底。';
        } else {
            gDesc = '【極悲觀位階】市場恐懼蔓延，股價已出現嚴重超跌。對價值投資者而言，此時為歷史難得的「黃金買點」，長線建倉勝率極高，建議分批低吸佈局。';
        }
    }

    guidanceCard.className = `guidance-card ${gClass}`;
    guidanceIcon.className = `fa-solid ${gIcon} guidance-icon`;
    guidanceDesc.textContent = gDesc;
}

// Render the Apache ECharts Chart
function renderChart(data) {
    const chartDom = document.getElementById('lohas-chart');
    if (!lohasChart) {
        lohasChart = echarts.init(chartDom, 'dark');
    }

    const N = data.dates.length;
    const sigma = data.latest.sigma;

    // Stack differentials (each band is 1.0 sigma thick)
    const bottomStack = data.bottom;
    const bandWidth = Array(N).fill(sigma);

    const option = {
        backgroundColor: 'transparent',
        grid: {
            left: '3%',
            right: '4%',
            bottom: '5%',
            top: '8%',
            containLabel: true
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(148, 163, 184, 0.2)',
            textStyle: {
                color: '#f8fafc',
                fontSize: 12
            },
            padding: 15,
            // Custom Tooltip Formatter to display detailed regression data
            formatter: function (params) {
                // Find axis value index
                const dataIndex = params[0].dataIndex;
                const date = data.dates[dataIndex];
                const price = data.actual[dataIndex];
                const central = data.central[dataIndex];
                const top = data.top[dataIndex];
                const upper = data.upper[dataIndex];
                const lower = data.lower[dataIndex];
                const bottom = data.bottom[dataIndex];
                const bias = data.bias[dataIndex];

                // Determine Level description for tooltip
                let levelDesc = '';
                let dotColor = '#94a3b8';
                if (bias >= 2) { levelDesc = '極樂觀'; dotColor = '#ef4444'; }
                else if (bias >= 1) { levelDesc = '樂觀'; dotColor = '#f97316'; }
                else if (bias >= 0) { levelDesc = '偏樂觀'; dotColor = '#eab308'; }
                else if (bias >= -1) { levelDesc = '偏悲觀'; dotColor = '#0ea5e9'; }
                else if (bias >= -2) { levelDesc = '悲觀'; dotColor = '#22c55e'; }
                else { levelDesc = '極悲觀'; dotColor = '#10b981'; }

                const biasSign = bias >= 0 ? '+' : '';
                const formattedBias = `${biasSign}${formatNumber(bias, 2)}σ`;

                // Define all values to display in the tooltip
                const items = [
                    { name: '極度樂觀 (+2σ)', value: top, color: '#ef4444' },
                    { name: '樂觀 (+1σ)', value: upper, color: '#f97316' },
                    { name: '中性 (趨勢線)', value: central, color: '#0ea5e9' },
                    { name: '悲觀 (-1σ)', value: lower, color: '#22c55e' },
                    { name: '極度悲觀 (-2σ)', value: bottom, color: '#10b981' },
                    { name: '收盤價', value: price, color: '#ffffff', isPrice: true }
                ];

                // Sort items by value in descending order (highest price to lowest)
                items.sort((a, b) => b.value - a.value);

                // Build HTML list
                let itemsHtml = '';
                items.forEach(item => {
                    const formattedVal = formatNumber(item.value);
                    const isBold = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: #e2e8f0;';
                    const labelStyle = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: var(--text-secondary);';
                    itemsHtml += `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="display: flex; align-items: center; gap: 6px; ${labelStyle}">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${item.color};"></span>
                                ${item.name}
                            </span>
                            <span style="font-family: monospace; font-size: 13px; ${isBold}">${formattedVal}</span>
                        </div>
                    `;
                });

                return `
                    <div style="font-family: var(--font-body); min-width: 220px;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; color: #ffffff;">
                            ${date}
                        </div>
                        ${itemsHtml}
                        <div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: var(--text-muted); font-size: 11px;">當前偏離:</span>
                            <span style="font-weight: 600; font-size: 11px; color: ${dotColor};">${formattedBias}</span>
                        </div>
                        <div style="margin-top: 4px; display: flex; justify-content: space-between; align-items: center; background-color: rgba(255,255,255,0.05); padding: 5px 8px; border-radius: 4px;">
                            <span style="color: var(--text-muted); font-size: 11px;">股價位階:</span>
                            <span style="font-weight: 600; font-size: 11px; color: ${dotColor};">${levelDesc}</span>
                        </div>
                    </div>
                `;
            }
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            boundaryGap: false,
            axisLine: {
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.2)'
                }
            },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.05)'
                }
            }
        },
        yAxis: {
            type: 'value',
            scale: true, // Auto adjust min/max to fit data nicely
            axisLine: {
                show: false
            },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11,
                formatter: function (value) {
                    return formatNumber(value, 1);
                }
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.08)'
                }
            }
        },
        series: [
            // --- BACKDROP BANDS (Stacked Area) ---
            // Base layer: transparent to raise other stacks off the floor to Bottom Line
            {
                name: 'Base',
                type: 'line',
                data: bottomStack,
                stack: 'lohas_band',
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            // Band 1: Bottom to Lower (1.0 sigma thick) - Deep Green (Fear)
            {
                name: '悲觀~極悲觀',
                type: 'line',
                data: bandWidth,
                stack: 'lohas_band',
                areaStyle: {
                    color: 'rgba(34, 197, 94, 0.09)' // Green opacity
                },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            // Band 2: Lower to Central (1.0 sigma thick) - Light Green/Blue
            {
                name: '趨勢線~悲觀',
                type: 'line',
                data: bandWidth,
                stack: 'lohas_band',
                areaStyle: {
                    color: 'rgba(14, 165, 233, 0.05)' // Indigo/Blue opacity
                },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            // Band 3: Central to Upper (1.0 sigma thick) - Light Red/Orange
            {
                name: '樂觀~趨勢線',
                type: 'line',
                data: bandWidth,
                stack: 'lohas_band',
                areaStyle: {
                    color: 'rgba(249, 115, 22, 0.05)' // Orange opacity
                },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            // Band 4: Upper to Top (1.0 sigma thick) - Red (Greed)
            {
                name: '極樂觀~樂觀',
                type: 'line',
                data: bandWidth,
                stack: 'lohas_band',
                areaStyle: {
                    color: 'rgba(239, 68, 68, 0.09)' // Red opacity
                },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },

            // --- THE 5 BAND LINES (Dashed outlines) ---
            {
                name: '極樂觀線 (+2σ)',
                type: 'line',
                data: data.top,
                lineStyle: {
                    type: 'dashed',
                    width: 1,
                    color: '#ef4444'
                },
                showSymbol: false,
                z: 2
            },
            {
                name: '樂觀線 (+1σ)',
                type: 'line',
                data: data.upper,
                lineStyle: {
                    type: 'dashed',
                    width: 1,
                    color: '#f97316'
                },
                showSymbol: false,
                z: 2
            },
            {
                name: '趨勢線 (TL)',
                type: 'line',
                data: data.central,
                lineStyle: {
                    width: 1.5,
                    color: '#0ea5e9'
                },
                showSymbol: false,
                z: 3
            },
            {
                name: '悲觀線 (-1σ)',
                type: 'line',
                data: data.lower,
                lineStyle: {
                    type: 'dashed',
                    width: 1,
                    color: '#22c55e'
                },
                showSymbol: false,
                z: 2
            },
            {
                name: '極悲觀線 (-2σ)',
                type: 'line',
                data: data.bottom,
                lineStyle: {
                    type: 'dashed',
                    width: 1,
                    color: '#10b981'
                },
                showSymbol: false,
                z: 2
            },

            // --- ACTUAL PRICE LINE (Highlighted) ---
            {
                name: '實際收盤價',
                type: 'line',
                data: data.actual,
                lineStyle: {
                    width: 2.5,
                    color: '#ffffff'
                },
                symbol: 'circle',
                symbolSize: 4,
                itemStyle: {
                    color: '#ffffff',
                    borderWidth: 1,
                    borderColor: 'rgba(0,0,0,0.5)'
                },
                z: 10
            }
        ]
    };

    lohasChart.setOption(option);
}

// Render the Apache ECharts LOHAS Channel Chart
function renderChannelChart(data) {
    const chartDom = document.getElementById('channel-chart');
    if (!channelChart) {
        channelChart = echarts.init(chartDom, 'dark');
    }

    const channel = data.channel;
    if (!channel || !channel.dates || channel.dates.length === 0) {
        return;
    }

    const N = channel.dates.length;
    
    // Stack differentials for channel shading: Up Band - Down Band
    const bottomStack = channel.down_band;
    const bandWidth = [];
    for (let i = 0; i < N; i++) {
        bandWidth.push(channel.up_band[i] - channel.down_band[i]);
    }

    const option = {
        backgroundColor: 'transparent',
        grid: {
            left: '3%',
            right: '4%',
            bottom: '5%',
            top: '8%',
            containLabel: true
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(148, 163, 184, 0.2)',
            textStyle: {
                color: '#f8fafc',
                fontSize: 12
            },
            padding: 15,
            formatter: function (params) {
                const dataIndex = params[0].dataIndex;
                const date = channel.dates[dataIndex];
                const price = channel.actual[dataIndex];
                const ma = channel.ma[dataIndex];
                const up = channel.up_band[dataIndex];
                const down = channel.down_band[dataIndex];

                let positionDesc = '';
                let dotColor = '#94a3b8';
                if (price > up) { positionDesc = '超漲 (高於上軌)'; dotColor = '#ef4444'; }
                else if (price < down) { positionDesc = '超跌 (低於下軌)'; dotColor = '#10b981'; }
                else if (price >= ma) { positionDesc = '偏多 (中軌與上軌間)'; dotColor = '#f97316'; }
                else { positionDesc = '偏空 (中軌與下軌間)'; dotColor = '#0ea5e9'; }

                const items = [
                    { name: '通道上軌 (UB)', value: up, color: '#ec4899' },
                    { name: '20週均線 (20MA)', value: ma, color: '#94a3b8' },
                    { name: '通道下軌 (LB)', value: down, color: '#0ea5e9' },
                    { name: '實際收盤價 (週收盤)', value: price, color: '#ffffff', isPrice: true }
                ];

                items.sort((a, b) => b.value - a.value);

                let itemsHtml = '';
                items.forEach(item => {
                    const formattedVal = formatNumber(item.value);
                    const isBold = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: #e2e8f0;';
                    const labelStyle = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: var(--text-secondary);';
                    itemsHtml += `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="display: flex; align-items: center; gap: 6px; ${labelStyle}">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${item.color};"></span>
                                ${item.name}
                            </span>
                            <span style="font-family: monospace; font-size: 13px; ${isBold}">${formattedVal}</span>
                        </div>
                    `;
                });

                return `
                    <div style="font-family: var(--font-body); min-width: 220px;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; color: #ffffff;">
                            ${date} (週線)
                        </div>
                        ${itemsHtml}
                        <div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; display: flex; justify-content: space-between; align-items: center; background-color: rgba(255,255,255,0.05); padding: 5px 8px; border-radius: 4px;">
                            <span style="color: var(--text-muted); font-size: 11px;">通道位置:</span>
                            <span style="font-weight: 600; font-size: 11px; color: ${dotColor};">${positionDesc}</span>
                        </div>
                    </div>
                `;
            }
        },
        xAxis: {
            type: 'category',
            data: channel.dates,
            boundaryGap: false,
            axisLine: {
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.2)'
                }
            },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.05)'
                }
            }
        },
        yAxis: {
            type: 'value',
            scale: true,
            axisLine: {
                show: false
            },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11,
                formatter: function (value) {
                    return formatNumber(value, 1);
                }
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.08)'
                }
            }
        },
        series: [
            // Shaded channel background (stacked area)
            {
                name: 'Base',
                type: 'line',
                data: bottomStack,
                stack: 'channel_band',
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            {
                name: '通道範圍',
                type: 'line',
                data: bandWidth,
                stack: 'channel_band',
                areaStyle: {
                    color: 'rgba(99, 102, 241, 0.04)' // Soft translucent indigo
                },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            // The boundaries and 20MA lines
            {
                name: '通道上軌 (UB)',
                type: 'line',
                data: channel.up_band,
                lineStyle: {
                    width: 1.5,
                    color: '#ec4899'
                },
                showSymbol: false,
                z: 2
            },
            {
                name: '20週均線 (20MA)',
                type: 'line',
                data: channel.ma,
                lineStyle: {
                    width: 1.5,
                    color: '#94a3b8'
                },
                showSymbol: false,
                z: 2
            },
            {
                name: '通道下軌 (LB)',
                type: 'line',
                data: channel.down_band,
                lineStyle: {
                    width: 1.5,
                    color: '#0ea5e9'
                },
                showSymbol: false,
                z: 2
            },
            // Actual Weekly Price
            {
                name: '實際收盤價 (週線)',
                type: 'line',
                data: channel.actual,
                lineStyle: {
                    width: 2.2,
                    color: '#ffffff'
                },
                symbol: 'circle',
                symbolSize: 4,
                itemStyle: {
                    color: '#ffffff',
                    borderWidth: 1,
                    borderColor: 'rgba(0,0,0,0.5)'
                },
                z: 10
            }
        ]
    };

    channelChart.setOption(option);
}

// Render the Apache ECharts VIX Panic Index Chart
function renderVixChart(data) {
    const chartDom = document.getElementById('vix-chart');
    if (!vixChart) {
        vixChart = echarts.init(chartDom, 'dark');
    }

    const vix = data.vix;
    if (!vix || !vix.dates || vix.dates.length === 0) {
        chartDom.style.display = 'none';
        return;
    }
    chartDom.style.display = 'block';

    const option = {
        backgroundColor: 'transparent',
        grid: {
            left: '3%',
            right: '4%',
            bottom: '5%',
            top: '8%',
            containLabel: true
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(148, 163, 184, 0.2)',
            textStyle: {
                color: '#f8fafc',
                fontSize: 12
            },
            padding: 15,
            formatter: function (params) {
                const dataIndex = params[0].dataIndex;
                const date = vix.dates[dataIndex];
                const value = vix.actual[dataIndex];

                return `
                    <div style="font-family: var(--font-body); min-width: 180px;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; color: #ffffff;">
                            ${date}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #a855f7;"></span>
                                VIX 恐慌指數
                            </span>
                            <span style="font-family: monospace; font-size: 13px; font-weight: 700; color: #a855f7;">${formatNumber(value, 2)}</span>
                        </div>
                    </div>
                `;
            }
        },
        xAxis: {
            type: 'category',
            data: vix.dates,
            boundaryGap: false,
            axisLine: {
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.2)'
                }
            },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.05)'
                }
            }
        },
        yAxis: {
            type: 'value',
            scale: true,
            axisLine: {
                show: false
            },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11,
                formatter: function (value) {
                    return formatNumber(value, 1);
                }
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.08)'
                }
            }
        },
        series: [
            {
                name: 'VIX 恐慌指數',
                type: 'line',
                data: vix.actual,
                smooth: true,
                lineStyle: {
                    width: 2.5,
                    color: '#a855f7'
                },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(168, 85, 247, 0.15)' },
                        { offset: 1, color: 'rgba(168, 85, 247, 0.0)' }
                    ])
                },
                symbol: 'circle',
                symbolSize: 4,
                itemStyle: {
                    color: '#a855f7',
                    borderWidth: 1,
                    borderColor: 'rgba(0,0,0,0.5)'
                },
                z: 10
            }
        ]
    };

    vixChart.setOption(option);
}

// Render the Apache ECharts Long-term MA Chart
function renderMaChart(data) {
    const chartDom = document.getElementById('ma-chart');
    if (!maChart) {
        maChart = echarts.init(chartDom, 'dark');
    }

    const N = data.dates.length;

    const option = {
        backgroundColor: 'transparent',
        grid: {
            left: '3%',
            right: '4%',
            bottom: '5%',
            top: '8%',
            containLabel: true
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(148, 163, 184, 0.2)',
            textStyle: {
                color: '#f8fafc',
                fontSize: 12
            },
            padding: 15,
            formatter: function (params) {
                const dataIndex = params[0].dataIndex;
                const date = data.dates[dataIndex];
                const price = data.actual[dataIndex];
                const ma5y = data.ma_5y[dataIndex];
                const ma10y = data.ma_10y[dataIndex];

                const bias5y = ((price - ma5y) / ma5y) * 100;
                const bias10y = ((price - ma10y) / ma10y) * 100;

                const bias5ySign = bias5y >= 0 ? '+' : '';
                const bias10ySign = bias10y >= 0 ? '+' : '';

                const items = [
                    { name: '5年均線', value: ma5y, color: '#eab308' },
                    { name: '10年均線', value: ma10y, color: '#2dd4bf' },
                    { name: '收盤價', value: price, color: '#ffffff', isPrice: true }
                ];

                items.sort((a, b) => b.value - a.value);

                let itemsHtml = '';
                items.forEach(item => {
                    const formattedVal = formatNumber(item.value);
                    const isBold = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: #e2e8f0;';
                    const labelStyle = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: var(--text-secondary);';
                    itemsHtml += `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="display: flex; align-items: center; gap: 6px; ${labelStyle}">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${item.color};"></span>
                                ${item.name}
                            </span>
                            <span style="font-family: monospace; font-size: 13px; ${isBold}">${formattedVal}</span>
                        </div>
                    `;
                });

                return `
                    <div style="font-family: var(--font-body); min-width: 240px;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; color: #ffffff;">
                            ${date}
                        </div>
                        ${itemsHtml}
                        <div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                                <span style="color: var(--text-muted);">偏離 5年均線:</span>
                                <span style="font-weight: 600; color: ${bias5y >= 0 ? '#22c55e' : '#ef4444'};">${bias5ySign}${formatNumber(bias5y, 2)}%</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                                <span style="color: var(--text-muted);">偏離 10年均線:</span>
                                <span style="font-weight: 600; color: ${bias10y >= 0 ? '#22c55e' : '#ef4444'};">${bias10ySign}${formatNumber(bias10y, 2)}%</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            boundaryGap: false,
            axisLine: {
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.2)'
                }
            },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.05)'
                }
            }
        },
        yAxis: {
            type: 'value',
            scale: true,
            axisLine: {
                show: false
            },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11,
                formatter: function (value) {
                    return formatNumber(value, 1);
                }
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: 'rgba(148, 163, 184, 0.08)'
                }
            }
        },
        series: [
            // 5-Year MA
            {
                name: '5年均線',
                type: 'line',
                data: data.ma_5y,
                lineStyle: {
                    width: 1.8,
                    color: '#eab308'
                },
                showSymbol: false,
                z: 4
            },
            // 10-Year MA
            {
                name: '10年均線',
                type: 'line',
                data: data.ma_10y,
                lineStyle: {
                    width: 1.8,
                    color: '#2dd4bf'
                },
                showSymbol: false,
                z: 4
            },
            // Price Line
            {
                name: '實際收盤價',
                type: 'line',
                data: data.actual,
                lineStyle: {
                    width: 2.5,
                    color: '#ffffff'
                },
                symbol: 'circle',
                symbolSize: 4,
                itemStyle: {
                    color: '#ffffff',
                    borderWidth: 1,
                    borderColor: 'rgba(0,0,0,0.5)'
                },
                z: 10
            }
        ]
    };

    maChart.setOption(option);
}

// ─── 即時商品監控下方的五線譜與樂活通道詳情加載 ─────────────────────
async function loadMonitorDetail(symbol, period = 3.5, autoScroll = false) {
    if (!symbol) return;
    
    currentMonitorSymbol = symbol;
    currentMonitorPeriod = period;

    const detailSection = document.getElementById('monitor-detail-section');
    if (!detailSection) return;

    // 確保區塊顯示
    detailSection.style.display = 'block';

    if (autoScroll) {
        detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // 更新時間按鈕啟動狀態
    const periodButtons = document.querySelectorAll('#monitor-detail-period-selector .btn-period');
    periodButtons.forEach(btn => {
        if (parseFloat(btn.getAttribute('data-period')) === period) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 顯示載入中
    document.getElementById('monitor-detail-title').textContent = symbol;
    document.getElementById('monitor-detail-subtitle').textContent = '計算數據中，請稍候...';
    document.getElementById('monitor-detail-price').textContent = '--';
    document.getElementById('monitor-detail-bias').textContent = '--';
    
    const levelEl = document.getElementById('monitor-detail-level');
    levelEl.textContent = '--';
    levelEl.className = 'value badge-level';

    const chPosEl = document.getElementById('monitor-detail-channel-pos');
    chPosEl.textContent = '--';
    chPosEl.className = 'value badge-level';

    document.getElementById('monitor-detail-guidance-desc').textContent = '正在計算最新數據與指引...';

    try {
        const response = await fetch(`/api/lohas?symbol=${encodeURIComponent(symbol)}&period_years=${period}`);
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || '取得資料失敗');
        }
        const data = await response.json();

        // 渲染資訊
        renderMonitorDetailInsights(data);

        // 渲染圖表
        renderMonitorLohasChart(data);
        renderMonitorChannelChart(data);

        // 自動 resize 一次確保寬度正確
        setTimeout(() => {
            if (monitorLohasChart) monitorLohasChart.resize();
            if (monitorChannelChart) monitorChannelChart.resize();
        }, 100);

    } catch (error) {
        console.error(error);
        document.getElementById('monitor-detail-subtitle').textContent = `載入失敗: ${error.message}`;
        document.getElementById('monitor-detail-guidance-desc').textContent = `無法載入數據。錯誤詳情：${error.message}`;
    }
}

function renderMonitorDetailInsights(data) {
    const latest = data.latest;
    const displayName = data.company_name && data.company_name !== data.symbol
        ? data.company_name
        : data.symbol;

    document.getElementById('monitor-detail-title').textContent = displayName;
    document.getElementById('monitor-detail-subtitle').textContent = `${data.symbol} • ${data.period_years} 年區間 • ${latest.date} 收盤`;

    document.getElementById('monitor-detail-price').textContent = formatNumber(latest.actual);
    
    // Z-Score
    const biasVal = latest.bias;
    const biasSign = biasVal >= 0 ? '+' : '';
    document.getElementById('monitor-detail-bias').textContent = `${biasSign}${formatNumber(biasVal, 2)} σ`;

    // 五線譜位階
    const levelEl = document.getElementById('monitor-detail-level');
    levelEl.textContent = latest.level;
    levelEl.className = 'value badge-level ' + getLevelStyleClass(latest.level);

    // 樂活通道位置
    const channel = data.channel;
    let chPosText = '--';
    let chPosClass = '';
    if (channel && channel.actual.length > 0) {
        const wClose = channel.actual[channel.actual.length - 1];
        const wMA = channel.ma[channel.ma.length - 1];
        const wUp = channel.up_band[channel.up_band.length - 1];
        const wDown = channel.down_band[channel.down_band.length - 1];

        if (wClose > wUp) {
            chPosText = '超漲 (高於上軌)';
            chPosClass = 'level-extreme-optimistic';
        } else if (wClose < wDown) {
            chPosText = '超跌 (低於下軌)';
            chPosClass = 'level-extreme-pessimistic';
        } else if (wClose >= wMA) {
            chPosText = '偏多 (高於中軌)';
            chPosClass = 'level-mid-optimistic';
        } else {
            chPosText = '偏空 (低於中軌)';
            chPosClass = 'level-mid-pessimistic';
        }
    }
    const chPosEl = document.getElementById('monitor-detail-channel-pos');
    chPosEl.textContent = chPosText;
    chPosEl.className = 'value badge-level ' + chPosClass;

    // 策略指引
    const guidanceCard = document.getElementById('monitor-detail-guidance');
    const guidanceIcon = document.getElementById('monitor-detail-guidance-icon');
    const guidanceDesc = document.getElementById('monitor-detail-guidance-desc');

    let gClass = 'guidance-hold';
    let gIcon = 'fa-circle-info';
    let gDesc = '';

    const hasChannel = channel && channel.actual.length > 0;
    const wClose = hasChannel ? channel.actual[channel.actual.length - 1] : 0;
    const wUp = hasChannel ? channel.up_band[channel.up_band.length - 1] : 0;
    const wDown = hasChannel ? channel.down_band[channel.down_band.length - 1] : 0;

    if (biasVal >= 2.0) {
        gClass = 'guidance-sell';
        gIcon = 'fa-triangle-exclamation';
        if (hasChannel && wClose > wUp) {
            gDesc = '【極樂觀位階且突破通道上軌】股價與通道雙重過熱，雖多頭動能強勁，但隨時可能面臨高檔拉回。建議逢高積極落實分批獲利了結，切勿盲目追高。';
        } else {
            gDesc = '【極樂觀位階】股價偏離回歸中軌極大，市場情緒極度貪婪，此為歷史相對高檔風險區。強烈建議停止追高，分批減碼以規避價格拉回與修正風險。';
        }
    } else if (biasVal >= 1.0) {
        gClass = 'guidance-sell';
        gIcon = 'fa-shield-halved';
        gDesc = '【樂觀位階】股價已進入相對高檔區，獲利了結賣壓可能逐步浮現。建議逢高適度調節持股，不宜重倉追價或融資擴大槓桿。';
    } else if (biasVal >= 0.0) {
        gClass = 'guidance-hold';
        gIcon = 'fa-circle-check';
        gDesc = '【偏樂觀位階】股價略高於趨勢中軌，仍屬於常態隨機波動區間。目前多頭趨勢仍在，建議持股續抱，注意觀察大盤走勢與趨勢線斜率是否持續向上。';
    } else if (biasVal >= -1.0) {
        gClass = 'guidance-hold';
        gIcon = 'fa-circle-check';
        if (hasChannel && wClose < wDown) {
            gDesc = '【偏悲觀位階但跌破通道下軌】股價低於中軌且跌破樂活通道下緣，弱勢格局尚未止穩。建議先冷靜觀察，等股價站回通道下軌之內再行分批佈局。';
        } else {
            gDesc = '【偏悲觀位階】股價略低於中軌，處於中性偏低的位置。基本面健全的前提下，目前為健康的持股整理期，無須因短期價格下跌而過度恐慌。';
        }
    } else if (biasVal >= -2.0) {
        gClass = 'guidance-buy';
        gIcon = 'fa-chart-line-down';
        if (hasChannel && wClose < wDown) {
            gDesc = '【悲觀位階但跌破通道下軌】股價進入相對低估區，但樂活通道下軌失守，短線仍有慣性下跌動能。建議暫緩進場，靜待股價回升並重新站回下軌之上。';
        } else {
            gDesc = '【悲觀位階】股價進入相對低估機會區，市場情緒偏向悲觀，下行風險已大部分釋放。長線資金可考慮啟動定期定額或分批建倉計劃，累積便宜籌碼。';
        }
    } else {
        gClass = 'guidance-buy';
        gIcon = 'fa-gem';
        if (hasChannel && wClose < wDown) {
            gDesc = '【極悲觀位階但跌破通道下軌】市場恐懼蔓延且股價破通道底，長線極具吸引力。此時建議分批定期定額，或等待站回通道下軌之上再行重倉進場，以防價格過早探底。';
        } else {
            gDesc = '【極悲觀位階】市場恐懼蔓延，股價已出現嚴重超跌。對價值投資者而言，此時為歷史難得的「黃金買點」，長線建倉勝率極高，建議分批低吸佈局。';
        }
    }

    guidanceCard.className = `guidance-card ${gClass}`;
    guidanceIcon.className = `fa-solid ${gIcon} guidance-icon`;
    guidanceDesc.textContent = gDesc;
}

function renderMonitorLohasChart(data) {
    const chartDom = document.getElementById('monitor-detail-lohas-chart');
    if (!monitorLohasChart) {
        monitorLohasChart = echarts.init(chartDom, 'dark');
    }

    const N = data.dates.length;
    const sigma = data.latest.sigma;
    const bottomStack = data.bottom;
    const bandWidth = Array(N).fill(sigma);

    const option = {
        backgroundColor: 'transparent',
        grid: {
            left: '3%',
            right: '4%',
            bottom: '5%',
            top: '8%',
            containLabel: true
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(148, 163, 184, 0.2)',
            textStyle: {
                color: '#f8fafc',
                fontSize: 12
            },
            padding: 15,
            formatter: function (params) {
                const dataIndex = params[0].dataIndex;
                const date = data.dates[dataIndex];
                const price = data.actual[dataIndex];
                const central = data.central[dataIndex];
                const top = data.top[dataIndex];
                const upper = data.upper[dataIndex];
                const lower = data.lower[dataIndex];
                const bottom = data.bottom[dataIndex];
                const bias = data.bias[dataIndex];

                let levelDesc = '';
                let dotColor = '#94a3b8';
                if (bias >= 2) { levelDesc = '極樂觀'; dotColor = '#ef4444'; }
                else if (bias >= 1) { levelDesc = '樂觀'; dotColor = '#f97316'; }
                else if (bias >= 0) { levelDesc = '偏樂觀'; dotColor = '#eab308'; }
                else if (bias >= -1) { levelDesc = '偏悲觀'; dotColor = '#0ea5e9'; }
                else if (bias >= -2) { levelDesc = '悲觀'; dotColor = '#22c55e'; }
                else { levelDesc = '極悲觀'; dotColor = '#10b981'; }

                const biasSign = bias >= 0 ? '+' : '';
                const formattedBias = `${biasSign}${formatNumber(bias, 2)}σ`;

                const items = [
                    { name: '極度樂觀 (+2σ)', value: top, color: '#ef4444' },
                    { name: '樂觀 (+1σ)', value: upper, color: '#f97316' },
                    { name: '中性 (趨勢線)', value: central, color: '#0ea5e9' },
                    { name: '悲觀 (-1σ)', value: lower, color: '#22c55e' },
                    { name: '極度悲觀 (-2σ)', value: bottom, color: '#10b981' },
                    { name: '收盤價', value: price, color: '#ffffff', isPrice: true }
                ];

                items.sort((a, b) => b.value - a.value);

                let itemsHtml = '';
                items.forEach(item => {
                    const formattedVal = formatNumber(item.value);
                    const isBold = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: #e2e8f0;';
                    const labelStyle = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: var(--text-secondary);';
                    itemsHtml += `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="display: flex; align-items: center; gap: 6px; ${labelStyle}">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${item.color};"></span>
                                ${item.name}
                            </span>
                            <span style="font-family: monospace; font-size: 13px; ${isBold}">${formattedVal}</span>
                        </div>
                    `;
                });

                return `
                    <div style="font-family: var(--font-body); min-width: 220px;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; color: #ffffff;">
                            ${date}
                        </div>
                        ${itemsHtml}
                        <div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: var(--text-muted); font-size: 11px;">當前偏離:</span>
                            <span style="font-weight: 600; font-size: 11px; color: ${dotColor};">${formattedBias}</span>
                        </div>
                        <div style="margin-top: 4px; display: flex; justify-content: space-between; align-items: center; background-color: rgba(255,255,255,0.05); padding: 5px 8px; border-radius: 4px;">
                            <span style="color: var(--text-muted); font-size: 11px;">股價位階:</span>
                            <span style="font-weight: 600; font-size: 11px; color: ${dotColor};">${levelDesc}</span>
                        </div>
                    </div>
                `;
            }
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            boundaryGap: false,
            axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
            axisLabel: { color: '#94a3b8', fontSize: 11 },
            splitLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.05)' } }
        },
        yAxis: {
            type: 'value',
            scale: true,
            axisLine: { show: false },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11,
                formatter: function (value) { return formatNumber(value, 1); }
            },
            splitLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } }
        },
        series: [
            {
                name: 'Base',
                type: 'line',
                data: bottomStack,
                stack: 'lohas_band',
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            {
                name: '悲觀~極悲觀',
                type: 'line',
                data: bandWidth,
                stack: 'lohas_band',
                areaStyle: { color: 'rgba(34, 197, 94, 0.09)' },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            {
                name: '趨勢線~悲觀',
                type: 'line',
                data: bandWidth,
                stack: 'lohas_band',
                areaStyle: { color: 'rgba(14, 165, 233, 0.05)' },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            {
                name: '樂觀~趨勢線',
                type: 'line',
                data: bandWidth,
                stack: 'lohas_band',
                areaStyle: { color: 'rgba(249, 115, 22, 0.05)' },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            {
                name: '極樂觀~樂觀',
                type: 'line',
                data: bandWidth,
                stack: 'lohas_band',
                areaStyle: { color: 'rgba(239, 68, 68, 0.09)' },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            {
                name: '極樂觀線 (+2σ)',
                type: 'line',
                data: data.top,
                lineStyle: { type: 'dashed', width: 1, color: '#ef4444' },
                showSymbol: false,
                z: 2
            },
            {
                name: '樂觀線 (+1σ)',
                type: 'line',
                data: data.upper,
                lineStyle: { type: 'dashed', width: 1, color: '#f97316' },
                showSymbol: false,
                z: 2
            },
            {
                name: '趨勢線 (TL)',
                type: 'line',
                data: data.central,
                lineStyle: { width: 1.5, color: '#0ea5e9' },
                showSymbol: false,
                z: 3
            },
            {
                name: '悲觀線 (-1σ)',
                type: 'line',
                data: data.lower,
                lineStyle: { type: 'dashed', width: 1, color: '#22c55e' },
                showSymbol: false,
                z: 2
            },
            {
                name: '極悲觀線 (-2σ)',
                type: 'line',
                data: data.bottom,
                lineStyle: { type: 'dashed', width: 1, color: '#10b981' },
                showSymbol: false,
                z: 2
            },
            {
                name: '實際收盤價',
                type: 'line',
                data: data.actual,
                lineStyle: { width: 2.5, color: '#ffffff' },
                symbol: 'circle',
                symbolSize: 4,
                itemStyle: { color: '#ffffff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.5)' },
                z: 10
            }
        ]
    };

    monitorLohasChart.setOption(option);
}

function renderMonitorChannelChart(data) {
    const chartDom = document.getElementById('monitor-detail-channel-chart');
    if (!monitorChannelChart) {
        monitorChannelChart = echarts.init(chartDom, 'dark');
    }

    const channel = data.channel;
    if (!channel || !channel.dates || channel.dates.length === 0) {
        return;
    }

    const N = channel.dates.length;
    const bottomStack = channel.down_band;
    const bandWidth = [];
    for (let i = 0; i < N; i++) {
        bandWidth.push(channel.up_band[i] - channel.down_band[i]);
    }

    const option = {
        backgroundColor: 'transparent',
        grid: {
            left: '3%',
            right: '4%',
            bottom: '5%',
            top: '8%',
            containLabel: true
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(148, 163, 184, 0.2)',
            textStyle: { color: '#f8fafc', fontSize: 12 },
            padding: 15,
            formatter: function (params) {
                const dataIndex = params[0].dataIndex;
                const date = channel.dates[dataIndex];
                const price = channel.actual[dataIndex];
                const ma = channel.ma[dataIndex];
                const up = channel.up_band[dataIndex];
                const down = channel.down_band[dataIndex];

                let positionDesc = '';
                let dotColor = '#94a3b8';
                if (price > up) { positionDesc = '超漲 (高於上軌)'; dotColor = '#ef4444'; }
                else if (price < down) { positionDesc = '超跌 (低於下軌)'; dotColor = '#10b981'; }
                else if (price >= ma) { positionDesc = '偏多 (中軌與上軌間)'; dotColor = '#f97316'; }
                else { positionDesc = '偏空 (中軌與下軌間)'; dotColor = '#0ea5e9'; }

                const items = [
                    { name: '通道上軌 (UB)', value: up, color: '#ec4899' },
                    { name: '20週均線 (20MA)', value: ma, color: '#94a3b8' },
                    { name: '通道下軌 (LB)', value: down, color: '#0ea5e9' },
                    { name: '實際收盤價 (週收盤)', value: price, color: '#ffffff', isPrice: true }
                ];

                items.sort((a, b) => b.value - a.value);

                let itemsHtml = '';
                items.forEach(item => {
                    const formattedVal = formatNumber(item.value);
                    const isBold = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: #e2e8f0;';
                    const labelStyle = item.isPrice ? 'font-weight: 700; color: #ffffff;' : 'color: var(--text-secondary);';
                    itemsHtml += `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="display: flex; align-items: center; gap: 6px; ${labelStyle}">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${item.color};"></span>
                                ${item.name}
                            </span>
                            <span style="font-family: monospace; font-size: 13px; ${isBold}">${formattedVal}</span>
                        </div>
                    `;
                });

                return `
                    <div style="font-family: var(--font-body); min-width: 220px;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; color: #ffffff;">
                            ${date} (週線)
                        </div>
                        ${itemsHtml}
                        <div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; display: flex; justify-content: space-between; align-items: center; background-color: rgba(255,255,255,0.05); padding: 5px 8px; border-radius: 4px;">
                            <span style="color: var(--text-muted); font-size: 11px;">通道位置:</span>
                            <span style="font-weight: 600; font-size: 11px; color: ${dotColor};">${positionDesc}</span>
                        </div>
                    </div>
                `;
            }
        },
        xAxis: {
            type: 'category',
            data: channel.dates,
            boundaryGap: false,
            axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
            axisLabel: { color: '#94a3b8', fontSize: 11 },
            splitLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.05)' } }
        },
        yAxis: {
            type: 'value',
            scale: true,
            axisLine: { show: false },
            axisLabel: {
                color: '#94a3b8',
                fontSize: 11,
                formatter: function (value) { return formatNumber(value, 1); }
            },
            splitLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } }
        },
        series: [
            {
                name: 'Base',
                type: 'line',
                data: bottomStack,
                stack: 'channel_band',
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            {
                name: '通道範圍',
                type: 'line',
                data: bandWidth,
                stack: 'channel_band',
                areaStyle: { color: 'rgba(99, 102, 241, 0.05)' },
                lineStyle: { opacity: 0 },
                showSymbol: false,
                z: 1
            },
            {
                name: '通道上軌 (UB)',
                type: 'line',
                data: channel.up_band,
                lineStyle: { width: 1, color: '#ec4899' },
                showSymbol: false,
                z: 2
            },
            {
                name: '20週均線 (20MA)',
                type: 'line',
                data: channel.ma,
                lineStyle: { width: 1.5, color: '#94a3b8', type: 'dashed' },
                showSymbol: false,
                z: 2
            },
            {
                name: '通道下軌 (LB)',
                type: 'line',
                data: channel.down_band,
                lineStyle: { width: 1, color: '#0ea5e9' },
                showSymbol: false,
                z: 2
            },
            {
                name: '實際收盤價 (週)',
                type: 'line',
                data: channel.actual,
                lineStyle: { width: 2, color: '#ffffff' },
                symbol: 'circle',
                symbolSize: 4,
                itemStyle: { color: '#ffffff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.5)' },
                z: 10
            }
        ]
    };

    monitorChannelChart.setOption(option);
}

