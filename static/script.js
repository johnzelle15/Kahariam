// ============ DEVICE LOCKING (PER DEVICE) ============
const DEVICE_ID = 'test-device'; // Hardcoded for now
function getUserId() {
    let uid = localStorage.getItem('fc_user_id');
    if (!uid) {
        uid = 'user-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('fc_user_id', uid);
    }
    return uid;
}

function checkDeviceLock() {
    // First check if counting is active from backend
    fetch('/get_state')
        .then(res => res.ok ? res.json() : null)
        .then(stateData => {
            const countingActive = stateData && stateData.active;
            const startBtn = document.getElementById('startBtn');
            const stopBtn = document.getElementById('stopBtn');
            const lockWarning = document.getElementById('lockWarning');

            if (countingActive) {
                // Counting is active - disable start, enable stop for everyone
                if (startBtn) startBtn.disabled = true;
                if (stopBtn) stopBtn.disabled = false;
                
                // Check who has the lock for display purposes only
                fetch(`/api/v1/devices/${DEVICE_ID}/lock_status`)
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                        if (data && data.locked) {
                            const userId = getUserId();
                            if (data.locked_by !== userId && lockWarning) {
                                lockWarning.textContent = `Started by another device`;
                                lockWarning.style.display = 'block';
                            } else if (lockWarning) {
                                lockWarning.style.display = 'none';
                            }
                        }
                    })
                    .catch(() => {});
            } else {
                // Counting is not active - enable start, disable stop
                if (startBtn) startBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = true;
                if (lockWarning) lockWarning.style.display = 'none';
            }
        })
        .catch(err => console.error('Failed to check state', err));
}

window.addEventListener('load', function() {
    checkDeviceLock();
});

// Override start/stopSystem to use locking
function startSystem() {
    const userId = getUserId();
    fetch(`/api/v1/devices/${DEVICE_ID}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
    })
    .then(res => {
        if (!res.ok) {
            console.error('Lock request failed', res.status);
            return null;
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            console.error('Lock request returned non-JSON', ct);
            return null;
        }
        return res.json();
    })
    .then(data => {
        if (!data) return;
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const lockWarning = document.getElementById('lockWarning');
        if (data.status === 'ok') {
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            if (lockWarning) lockWarning.style.display = 'none';
        } else if (data.status === 'locked') {
            if (lockWarning) {
                lockWarning.textContent = 'Device in use by another user.';
                lockWarning.style.display = 'block';
            }
        }
    })
    .catch(err => console.error('Failed to acquire lock', err));
}

// stopSystem is defined later in the file - see line ~1841
// ============ GLOBAL VARIABLES ============
let fishCount = 0;
let countersActive = false;
let selectedVariant = "";
let selectedCountMode = "";
let totalChart = null;
let variantChart = null;
let salesTrendRetailChart = null;
let salesTrendWholesaleChart = null;
let salesTrendChartData = null;
let salesTrendCompactMode = null;
let inventorySaveInProgress = false;
let addToTankInProgress = false;
let adjustmentSubmitInProgress = false;
let selectedAdjustmentSource = 'tank';
let pendingConfirmAction = null;

// Pagination state
let inventoryPage = 1;
let inventoryPerPage = 20;
let inventoryTotalPages = 1;
let adjustmentsPage = 1;
let adjustmentsPerPage = 20;
let adjustmentsTotalPages = 1;

const nativeBrowserAlert = window.alert.bind(window);

if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

function isLikelyRpi7Display() {
    const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`.toLowerCase();
    const isArmDevice = /(arm|aarch64|armv7l|raspbian|rpi)/.test(ua);

    const screenWidth = Math.max(window.screen.width || 0, window.screen.height || 0);
    const screenHeight = Math.min(window.screen.width || 0, window.screen.height || 0);
    const isRpi7Resolution =
        (screenWidth === 800 && screenHeight === 480) ||
        (screenWidth === 1024 && screenHeight === 600);

    return isArmDevice && isRpi7Resolution;
}

function applyDesktopZoomCompensation() {
    const root = document.documentElement;
    if (!root) return;

    const isRpi7 = isLikelyRpi7Display();
    let compensation = 1;

    root.classList.toggle('rpi7-display', isRpi7);

    if (isRpi7) compensation = 0.45;

    root.style.setProperty('--desktop-zoom-comp', String(compensation));
}

window.addEventListener('load', function() {
    applyDesktopZoomCompensation();
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const appMain = document.querySelector('.app-main');
    if (appMain) appMain.scrollTop = 0;
});

window.addEventListener('resize', applyDesktopZoomCompensation);

const variantPercentagePlugin = {
    id: 'variantPercentagePlugin',
    afterDatasetsDraw(chart) {
        const dataset = chart.data.datasets[0];
        if (!dataset || !Array.isArray(dataset.data)) return;

        const total = dataset.data.reduce((sum, value, index) => {
            if (!chart.getDataVisibility(index)) return sum;
            return sum + (Number(value) || 0);
        }, 0);
        if (total <= 0) return;

        const meta = chart.getDatasetMeta(0);
        const ctx = chart.ctx;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px Arial';

        meta.data.forEach((arc, index) => {
            if (!chart.getDataVisibility(index)) return;
            const value = Number(dataset.data[index]) || 0;
            if (value <= 0) return;

            const percentage = (value / total) * 100;
            const label = percentage.toFixed(1) + '%';

            const angle = (arc.startAngle + arc.endAngle) / 2;
            const radius = arc.innerRadius + (arc.outerRadius - arc.innerRadius) * 0.62;
            const x = arc.x + Math.cos(angle) * radius;
            const y = arc.y + Math.sin(angle) * radius;

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.lineWidth = 3;
            ctx.strokeText(label, x, y);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, x, y);
        });

        ctx.restore();
    }
};

function formatActionLabel(action, count) {
    const value = (action || '').toString().toUpperCase();
    const numericCount = parseInt(count, 10) || 0;
    if (value === 'INVENTORY') return 'WHOLESALE IN';
    if (value === 'WHOLESALE') return numericCount < 0 ? 'SOLD' : 'WHOLESALE IN';
    if (value === 'OUT') return 'SOLD';
    return value || 'IN';
}

function formatActionClass(action, count) {
    const value = (action || '').toString().toUpperCase();
    const numericCount = parseInt(count, 10) || 0;
    if (value === 'INVENTORY') return 'WHOLESALE_IN';
    if (value === 'WHOLESALE') return numericCount < 0 ? 'WHOLESALE_OUT' : 'WHOLESALE_IN';
    return value || 'IN';
}

// ============ INITIALIZATION ============
window.addEventListener('load', function() {
        // On load, sync counting state and lock buttons if needed
        // Attach event listeners for elements using data-* attributes to avoid inline handlers (CSP-friendly)
        try {
            // tabs
            document.querySelectorAll('[data-tab]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const t = btn.dataset.tab;
                    if (t) switchTab(t);
                });
            });

            // generic click actions
            document.querySelectorAll('[data-action]').forEach(el => {
                el.addEventListener('click', (e) => {
                    const action = el.dataset.action;
                    const arg = el.dataset.arg;
                    if (!action) return;
                    const fn = window[action];
                    if (typeof fn === 'function') {
                        if (typeof arg !== 'undefined') {
                            let parsed = arg;
                            if (arg === 'true') parsed = true;
                            else if (arg === 'false') parsed = false;
                            fn(parsed);
                        } else {
                            fn(e);
                        }
                    } else {
                        console.warn('Missing action function:', action);
                    }
                });
                // Mark statically bound action elements so delegated handler won't fire again.
                el.dataset.boundAction = '1';
            });

            // change handlers for selects and date inputs
            document.querySelectorAll('[data-change]').forEach(el => {
                const handler = () => {
                    const fnName = el.dataset.change;
                    const fn = window[fnName];
                    if (typeof fn === 'function') fn(true);
                };
                el.addEventListener('change', handler);
                // Date inputs may not fire 'change' reliably in all browsers;
                // use debounced 'input' as fallback to avoid excessive calls.
                if (el.type === 'date') {
                    let _dt = null;
                    el.addEventListener('input', () => {
                        clearTimeout(_dt);
                        _dt = setTimeout(handler, 300);
                    });
                }
            });

            // dialog overlay
            const overlay = document.getElementById('dialogOverlay');
            if (overlay) overlay.addEventListener('click', () => { if (typeof closeDialog === 'function') closeDialog(); });
        } catch (e) {
            console.warn('Failed to attach data-* event handlers', e);
        }
        fetch('/get_state').then(res => res.json()).then(data => {
            updateButtonsForCountingState(data.active);
        });
    loadYears();
    loadDashboard();
    renderLowStockAlerts();
    initCharts();
    loadSalesTrendChart();
    let salesTrendResizeTimer = null;
    window.addEventListener('resize', () => {
        if (salesTrendResizeTimer) clearTimeout(salesTrendResizeTimer);
        salesTrendResizeTimer = setTimeout(() => {
            refreshSalesTrendForViewport();
        }, 140);
    });
    initAdjustmentCards();
    initAdjustmentReasonCards();
    // Safety: remove any adjustments/history elements that ended up outside the adjustments tab
    setTimeout(() => {
        document.querySelectorAll('.adjustments-history, .history-container, #adjustmentsList').forEach(el => {
            if (!document.getElementById('adjustmentsTab')?.contains(el)) {
                el.remove();
            }
        });
    }, 100);
    // Initialize Socket.IO listener for live readings (if socket.io client is loaded)
    try {
        if (typeof io !== 'undefined') {
            const socket = io();
            let dashboardThrottle = null;
            socket.on('connect', () => {
                console.log('socket connected from script.js');
                // Sync current counting state from server on connect
                syncCountingState();
            });
            
            // Listen for counting state changes from other devices
            socket.on('counting_state', (data) => {
                console.log('counting_state event received:', data);
                updateButtonsForCountingState(data.active);
            });
            
            socket.on('reading', (data) => {
                try {
                    // Update global fishCount and counter display
                    if (data && typeof data.count !== 'undefined') {
                        fishCount = data.count;
                        const cd = document.getElementById('countDisplay');
                        if (cd) cd.textContent = formatCountMessage(fishCount, selectedVariant, false);
                    }

                    // Throttle dashboard refresh to at most once every 3s
                    if (!dashboardThrottle) {
                        dashboardThrottle = setTimeout(() => {
                            loadDashboard();
                            dashboardThrottle = null;
                        }, 3000);
                    }
                } catch (e) {
                    console.warn('Error handling reading event', e);
                }
            });
        }
    } catch (e) {
        console.warn('Socket init failed', e);
    }
    
    // Periodic sync every 5 seconds to catch missed socket events (backup sync)
    setInterval(() => {
        syncCountingState();
    }, 5000);
    
    // Global delegation for data-action buttons created dynamically
    try {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('button[data-action]');
            if (!btn) return;
            // Ignore elements that already have direct data-action listeners attached.
            if (btn.dataset.boundAction === '1') return;
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            const pageVal = btn.dataset.page;
            if (!action) return;
            const fn = window[action];
            if (typeof fn === 'function') {
                if (typeof pageVal !== 'undefined' && pageVal !== null) fn(parseInt(pageVal, 10));
                else if (typeof id !== 'undefined') fn(id);
                else fn(e);
            }
        });
    } catch (e) { console.warn('Failed to attach global data-action delegation', e); }

    // Click Total Fish card to jump to the pie chart
    try {
        const totalCard = document.querySelector('.stat-card.total');
        if (totalCard) {
            totalCard.style.cursor = 'pointer';
            totalCard.addEventListener('click', (e) => {
                // Ensure we're on dashboard tab
                switchTab('dashboard');
                // Scroll to pie chart and highlight its card
                setTimeout(() => {
                    const chartEl = document.getElementById('variantChart');
                    if (chartEl) {
                        chartEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        const container = chartEl.closest('.chart-container');
                        if (container) {
                            container.classList.add('flash-highlight');
                            setTimeout(() => container.classList.remove('flash-highlight'), 1400);
                        }
                    }
                }, 200);
            });
        }
    } catch (e) {
        console.warn('Failed to attach totalCard click handler', e);
    }

    // Setup modal close handlers
    try {
        const modal = document.getElementById("inventoryModal");
        const closeBtn = modal?.querySelector(".close");
        
        // Close button click
        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                closeInventoryModal();
            });
        }
        
        // Click outside modal to close
        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    closeInventoryModal();
                }
            });
        }
    } catch (e) {
        console.warn('Failed to setup modal handlers', e);
    }

    // Sales trend export handlers
    try {
        const csvBtn = document.getElementById('downloadCsvBtn');
        const pngBtn = document.getElementById('downloadPngBtn');
        if (csvBtn) csvBtn.addEventListener('click', downloadSalesTrendCsv);
        if (pngBtn) pngBtn.addEventListener('click', downloadSalesTrendPng);
    } catch (e) {
        console.warn('Failed to setup sales trend export handlers', e);
    }

    // Click Fish-in-Tank card to jump to the distribution bar chart
    try {
        const tankCard = document.querySelector('.stat-card.tank');
        if (tankCard) {
            tankCard.style.cursor = 'pointer';
            tankCard.addEventListener('click', (e) => {
                // Ensure dashboard is visible
                switchTab('dashboard');
                // scroll to the distribution chart (totalChart) and highlight its container
                setTimeout(() => {
                    const chartEl = document.getElementById('totalChart');
                    if (chartEl) {
                        chartEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        const container = chartEl.closest('.chart-container');
                        if (container) {
                            container.classList.add('flash-highlight');
                            setTimeout(() => container.classList.remove('flash-highlight'), 1400);
                        }
                    }
                }, 200);
            });
        }
    } catch (e) {
        console.warn('Failed to attach tankCard click handler', e);
    }

});

// ============ COUNTING STATE MANAGEMENT ============
/**
 * Format count message with proper pluralization and variant capitalization
 */
function formatCountMessage(count, variant, zeroText = true) {
    const variantLower = variant ? variant.toLowerCase() : 'fish';
    if (!count || count === 0) {
        return zeroText ? `No ${variantLower} counted` : `0 ${variantLower} fish`;
    }
    if (count === 1) return `1 ${variantLower} fish`;
    return `${count} ${variantLower} fish`;
}

/**
 * Sync current counting state from server
 */
function syncCountingState() {
    fetch('/get_state')
        .then(res => res.json())
        .then(data => {
            updateButtonsForCountingState(data.active);
        })
        .catch(err => console.warn('Failed to sync counting state:', err));
}

/**
 * Update button states based on counting active flag
 */
function updateButtonsForCountingState(active) {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const lockWarning = document.getElementById('lockWarning');
    
    if (!startBtn || !stopBtn) return; // Buttons not on this page
    
    if (active) {
        // Counting is active - disable start, ENABLE stop for everyone
        startBtn.disabled = true;
        startBtn.textContent = "🔄 Counting...";
        stopBtn.disabled = false;  // Anyone can stop
        stopBtn.textContent = "⏹ Stop Counting";
        countersActive = true;
    } else {
        // Counting is inactive - enable start, disable stop
        startBtn.disabled = false;
        startBtn.textContent = "▶ Start Counting";
        stopBtn.disabled = true;
        stopBtn.textContent = "⏹ Stop Counting";
        countersActive = false;
        if (lockWarning) lockWarning.style.display = 'none';
    }
}

// Remove any stray adjustment-related elements outside the adjustments tab
function removeStrayAdjustments() {
    const container = document.getElementById('adjustmentsTab');
    const ids = ['adjVariant','adjCount','adjReason','adjNotes','adjHistoryVariant','adjHistoryStartDate','adjHistoryEndDate','adjustmentsList'];
    const classes = ['adjustments-history','history-container','adjust-item','adjust-form'];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && !container?.contains(el)) el.remove();
    });

    classes.forEach(cls => {
        document.querySelectorAll('.' + cls).forEach(el => {
            if (!container?.contains(el)) el.remove();
        });
    });
}

// ============ TAB MANAGEMENT ============
function switchTab(tab) {
    // Hide all tabs
    document.getElementById('dashboardTab').classList.remove('active');
    document.getElementById('counterTab').classList.remove('active');
    document.getElementById('inventoryTab').classList.remove('active');
    document.getElementById('adjustmentsTab')?.classList.remove('active');
    document.getElementById('insightsTab')?.classList.remove('active');
    
    // Remove active class from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    // Show selected tab
    if (tab === 'dashboard') {
        document.getElementById('dashboardTab').classList.add('active');
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        loadDashboard();
    } else if (tab === 'counter') {
        document.getElementById('counterTab').classList.add('active');
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        // When opening counter tab and not actively counting, always show a neutral message
        if (!countersActive) {
            document.getElementById('countDisplay').textContent = 'Waiting to start...';
        }
    } else if (tab === 'inventory') {
        document.getElementById('inventoryTab').classList.add('active');
        document.querySelectorAll('.tab-btn')[2].classList.add('active');
        loadInventory();
    } else if (tab === 'adjustments') {
        document.getElementById('adjustmentsTab').classList.add('active');
        document.querySelectorAll('.tab-btn')[3].classList.add('active');
        // Adjustments is included inline like other tabs — just load data
        loadAdjustmentYears();
        loadAdjustments();
        if (typeof loadAdjustmentCardStocks === 'function') loadAdjustmentCardStocks();
    } else if (tab === 'insights') {
        // Show insights panel (charts + total revenue)
        document.getElementById('insightsTab').classList.add('active');
        document.querySelectorAll('.tab-btn')[4].classList.add('active');
        // Load charts and refresh revenue stat shown in Insights
        try { loadDashboard(); } catch(e) { /* ignore if function missing */ }
        try { loadSalesTrendChart(); } catch(e) { /* ignore if function missing */ }
        try { loadUnfilteredTotalChart(); } catch(e) { /* ignore */ }
    }
}

// ============ ADJUSTMENTS HISTORY ============
function loadAdjustments(resetPage) {
    if (resetPage) adjustmentsPage = 1;
    const variant = document.getElementById('adjHistoryVariant')?.value || '';
    const startDate = document.getElementById('adjHistoryStartDate')?.value || '';
    const endDate = document.getElementById('adjHistoryEndDate')?.value || '';

    let url = '/get_adjustments';
    const params = [];
    params.push(`page=${adjustmentsPage}`);
    params.push(`per_page=${adjustmentsPerPage}`);
    if (variant) params.push(`variant=${encodeURIComponent(variant)}`);
    if (startDate) params.push(`start_date=${encodeURIComponent(startDate)}`);
    if (endDate) params.push(`end_date=${encodeURIComponent(endDate)}`);
    if (selectedAdjustmentSource) params.push(`source=${encodeURIComponent(selectedAdjustmentSource)}`);
    if (params.length) url += '?' + params.join('&');

    fetch(url)
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById('adjustmentsList');
            const items = data.items || data;
            adjustmentsTotalPages = data.pages || 1;
            const totalRecords = data.total || (Array.isArray(items) ? items.length : 0);

            if (!items || items.length === 0) {
                list.innerHTML = '<p>No adjustments yet</p>';
                renderAdjustmentsPagination(totalRecords);
                return;
            }

            list.innerHTML = items.map(item => `
                <div class="adjust-item">
                    <div class="adjust-info">
                        <strong>${Math.abs(parseInt(item.count, 10) || 0)} ${item.variant}</strong>
                        <p>${item.date}</p>
                        ${(() => {
                            const notesText = (item.notes || '').trim();
                            const lower = notesText.toLowerCase();
                            const numericCount = parseInt(item.count, 10) || 0;
                            const isWholesale = (item.action || '').toUpperCase() === 'WHOLESALE';
                            let reasonLabel = '';
                            let reasonClass = '';
                            if (isWholesale) {
                                if (numericCount >= 0) {
                                    reasonLabel = 'Wholesale In';
                                    reasonClass = 'adjust-reason-in';
                                } else {
                                    reasonLabel = 'Sold';
                                    reasonClass = 'adjust-reason-out';
                                }
                            } else if (lower.includes('died')) {
                                reasonLabel = 'Died';
                                reasonClass = 'adjust-reason-died';
                            } else if (lower.includes('damaged')) {
                                reasonLabel = 'Damaged';
                                reasonClass = 'adjust-reason-died';
                            } else if (lower.includes('manual correction')) {
                                reasonLabel = 'Manual Correction';
                                reasonClass = 'adjust-reason-wholesale';
                            } else if (lower.includes('restock')) {
                                reasonLabel = 'Restock';
                                reasonClass = 'adjust-reason-in';
                            } else if (lower.includes('wholesale')) {
                                reasonLabel = 'Wholesale';
                                reasonClass = 'adjust-reason-wholesale';
                            } else if (lower.includes('sold')) {
                                reasonLabel = 'Sold';
                                reasonClass = 'adjust-reason-sold';
                            }

                            const cleanedNotes = notesText
                                .replace(/^sold\.?\s*/i, '')
                                .replace(/^died\.?\s*/i, '')
                                .replace(/^damaged\.?\s*/i, '')
                                .replace(/^manual\s*correction\.?\s*/i, '')
                                .replace(/^restock\.?\s*/i, '')
                                .replace(/^wholesale\s*in\.?\s*/i, '')
                                .replace(/^wholesale\s*out\.?\s*/i, '')
                                .replace(/^wholesale\.?\s*/i, '')
                                .trim();

                            const sourceLabel = item.source || (((item.action || '').toUpperCase() === 'WHOLESALE') ? 'Storage Box' : 'Fish Tank');

                            return `
                                ${reasonLabel ? `<p>Reason: <span class="adjust-reason-badge ${reasonClass}">${reasonLabel}</span></p>` : ''}
                                <p>Source: ${sourceLabel}</p>
                                ${cleanedNotes ? `<p>Notes: ${cleanedNotes}</p>` : ''}
                            `;
                        })()}
                    </div>
                    <div class="item-actions">
                        <button class="delete-btn" data-action="deleteInventory" data-id="${item.id}" aria-label="Archive record" title="Archive">
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 7H21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                                <path d="M6 7V19C6 20.1046 6.89543 21 8 21H16C17.1046 21 18 20.1046 18 19V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M9 4H15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                                <path d="M12 10V15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                                <path d="M10 13L12 15L14 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `).join('');
            renderAdjustmentsPagination(totalRecords);
        })
        .catch(err => {
            document.getElementById('adjustmentsList').innerHTML = '<p>Error loading adjustments</p>';
        });
}

function renderAdjustmentsPagination(totalRecords) {
    let container = document.getElementById('adjustmentsPagination');
    if (!container) {
        const list = document.getElementById('adjustmentsList');
        if (!list) return;
        container = document.createElement('div');
        container.id = 'adjustmentsPagination';
        container.className = 'pagination-bar';
        list.parentNode.insertBefore(container, list.nextSibling);
    }
    if (adjustmentsTotalPages <= 1) { container.innerHTML = ''; return; }
    container.innerHTML = buildPaginationHTML(adjustmentsPage, adjustmentsTotalPages, totalRecords, 'goAdjustmentsPage');
}

function goAdjustmentsPage(p) {
    if (p < 1 || p > adjustmentsTotalPages) return;
    adjustmentsPage = p;
    loadAdjustments();
}

function changeAdjustmentsPerPage(value) {
    adjustmentsPerPage = parseInt(value, 10) || 20;
    adjustmentsPage = 1;
    loadAdjustments();
}

// Populate years for adjustments history (reuse get_years)
function loadAdjustmentYears() {
    // No-op: year dropdowns replaced by date range inputs
}

function clearAdjustmentFilters() {
    const variant = document.getElementById('adjHistoryVariant');
    const startDate = document.getElementById('adjHistoryStartDate');
    const endDate = document.getElementById('adjHistoryEndDate');
    if (variant) variant.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    adjustmentsPage = 1;
    loadAdjustments();
}

// ============ DASHBOARD ============
function loadYears() {
    fetch("/get_years")
        .then(res => res.json())
        .then(data => {
            const salesYearSelect = document.getElementById("salesYearFilter");
            if (!salesYearSelect) return;

            const currentSalesYear = salesYearSelect.value;
            salesYearSelect.innerHTML = '<option value="">All Years</option>';

            const years = Array.isArray(data?.years) ? [...data.years] : [];
            years.sort((a, b) => Number(b) - Number(a));
            
            years.forEach(year => {
                const salesOption = document.createElement("option");
                salesOption.value = year;
                salesOption.textContent = year;
                salesYearSelect.appendChild(salesOption);
            });
            
            salesYearSelect.value = currentSalesYear;
            if (salesYearSelect.value !== currentSalesYear) {
                salesYearSelect.value = '';
            }
        })
        .catch(err => {
            console.error("Error loading years:", err);
            const salesYearSelect = document.getElementById("salesYearFilter");
            if (!salesYearSelect) return;

            const currentYear = new Date().getFullYear();
            salesYearSelect.innerHTML = '<option value="">All Years</option>';
            for (let year = currentYear; year >= currentYear - 4; year--) {
                const salesOption = document.createElement("option");
                salesOption.value = String(year);
                salesOption.textContent = String(year);
                salesYearSelect.appendChild(salesOption);
            }
        });
}

function applyDateFilter() {
    loadDashboard();
    loadSalesTrendChart();
}

function clearDashboardFilters() {
    const variant = document.getElementById('dashboardVariantFilter');
    const startDate = document.getElementById('dashStartDate');
    const endDate = document.getElementById('dashEndDate');
    if (variant) variant.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    applyDateFilter();
}

function formatIntegerDashboard(value) {
    const num = Number(value || 0);
    return num.toLocaleString();
}

function formatCurrencyDashboard(value) {
    const num = Number(value || 0);
    if (Math.abs(num) >= 100000) {
        return `₱${Math.round(num).toLocaleString()}`;
    }
    return `₱${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setDashboardStatText(elementId, displayValue, fullValue) {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.textContent = displayValue;
    el.title = fullValue || displayValue;

    const compactLen = String(displayValue).replace(/\s+/g, '').length;
    el.classList.remove('stat-number-long', 'stat-number-xlong');
    if (compactLen >= 12) {
        el.classList.add('stat-number-xlong');
    } else if (compactLen >= 9) {
        el.classList.add('stat-number-long');
    }
}

function renderTrendIndicator(elementId, currentValue, yesterdayValue, isCurrency) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const current = Number(currentValue || 0);
    const yesterday = Number(yesterdayValue || 0);
    const diff = current - yesterday;
    const pct = yesterday !== 0 ? ((diff / Math.abs(yesterday)) * 100) : (diff !== 0 ? 100 : 0);

    let arrow, cls, sign;
    if (diff > 0) {
        arrow = '↑'; cls = 'trend-up'; sign = '+';
    } else if (diff < 0) {
        arrow = '↓'; cls = 'trend-down'; sign = '';
    } else {
        arrow = '→'; cls = 'trend-neutral'; sign = '';
    }

    const pctDisplay = Math.abs(pct).toFixed(1);
    const diffDisplay = isCurrency
        ? `₱${Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : Math.abs(diff).toLocaleString();

    el.className = 'trend-indicator ' + cls;
    el.title = `Compared to yesterday (overall)\nYesterday: ${isCurrency ? '₱' : ''}${yesterday.toLocaleString()}\nChange: ${sign}${diffDisplay}`;
    el.innerHTML = `<span class="trend-badge ${cls}"><span class="trend-arrow">${arrow}</span> ${sign}${diff < 0 ? '-' : ''}${pctDisplay}%</span>`;
}

function loadUnfilteredTotalChart() {
    fetch('/get_statistics')
        .then(res => res.json())
        .then(data => {
            const fishInTankEl = document.getElementById('fishInTank');
            if (fishInTankEl) {
                const value = Number(data.tank_total || 0);
                setDashboardStatText('fishInTank', formatIntegerDashboard(value), formatIntegerDashboard(value));
            }

            const wholesaleStorageEl = document.getElementById('wholesaleStorage');
            if (wholesaleStorageEl) {
                const value = Number(data.wholesale_total || 0);
                setDashboardStatText('wholesaleStorage', formatIntegerDashboard(value), formatIntegerDashboard(value));
            }

            // Render trend indicators for Fish in Tank and Wholesale Storage (always unfiltered)
            if (data.yesterday) {
                renderTrendIndicator('trendFishInTank', data.global ? data.global.tank_total : data.tank_total, data.yesterday.tank_total, false);
                renderTrendIndicator('trendWholesaleStorage', data.global ? data.global.wholesale_total : data.wholesale_total, data.yesterday.wholesale_total, false);
            }
        })
        .catch(err => {
            console.warn('Error loading unfiltered stats:', err);
        });

    // Fish in Tank chart — always unfiltered, uses dedicated endpoint
    loadCurrentFishChart();
}

function loadCurrentFishChart() {
    fetch('/api/current-fish')
        .then(res => res.json())
        .then(data => {
            if (!totalChart) return;

            const netMap = {};
            (data.by_variant || []).forEach(item => {
                const name = item.variant || '';
                const normalized = name ? (name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()) : name;
                netMap[normalized] = item.count || 0;
            });

            totalChart.data.datasets[0].data = [
                netMap['Black'] || 0,
                netMap['Platinum'] || 0,
                netMap['Pineapple'] || 0
            ];
            totalChart.update();
        })
        .catch(err => {
            console.warn('Error loading current fish chart:', err);
        });
}

function loadDashboard() {
    // Get selected filters from dashboard
    const variant = document.getElementById("dashboardVariantFilter")?.value || "";
    const startDate = document.getElementById("dashStartDate")?.value || "";
    const endDate = document.getElementById("dashEndDate")?.value || "";
    
    // Build query parameters
    let url = "/get_statistics";
    const params = [];
    if (variant) params.push(`variant=${encodeURIComponent(variant)}`);
    if (startDate) params.push(`start_date=${encodeURIComponent(startDate)}`);
    if (endDate) params.push(`end_date=${encodeURIComponent(endDate)}`);
    if (params.length > 0) url += "?" + params.join("&");
    
    fetch(url)
        .then(res => res.json())
        .then(data => {
            // Keep Total Tank Stock and Wholesale Storage unfiltered (set in loadUnfilteredTotalChart)
            const revenueToday = Number(data.today_revenue || 0);
            const revenueDisplay = formatCurrencyDashboard(revenueToday);
            const revenueFull = `₱${revenueToday.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            setDashboardStatText('totalEntries', revenueDisplay, revenueFull);

            // Total revenue (uses filters) — new card
            try {
                const totalRevenueVal = Number(data.total_revenue || 0);
                const totalRevenueDisplay = formatCurrencyDashboard(totalRevenueVal);
                const totalRevenueFull = `₱${totalRevenueVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                setDashboardStatText('totalRevenue', totalRevenueDisplay, totalRevenueFull);
            } catch (e) {
                console.warn('Failed to set total revenue stat', e);
            }

            // Use additions-only counts for Total Fish and charts (do not reduce by OUT)
            const variantCounts = {
                "Black": 0,
                "Platinum": 0,
                "Pineapple": 0
            };
            (data.by_variant_additions || []).forEach(item => {
                const v = item.variant || '';
                const normalized = v ? (v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()) : v;
                variantCounts[normalized] = item.count;
            });

            const totalCount = data.additions_total || Object.values(variantCounts).reduce((a,b) => a + b, 0);
            setDashboardStatText('totalCount', formatIntegerDashboard(totalCount), formatIntegerDashboard(totalCount));

            // Render trend indicators using GLOBAL (unfiltered) data — trends always reflect real-time comparison
            if (data.global && data.yesterday) {
                renderTrendIndicator('trendTotalCount', data.global.additions_total, data.yesterday.additions_total, false);
                renderTrendIndicator('trendTodayRevenue', data.global.today_revenue, data.yesterday.today_revenue, true);
                renderTrendIndicator('trendTotalRevenue', data.global.total_revenue, data.yesterday.total_revenue, true);
            }

            // Update charts: pie/variant chart shows additions (affected by filters)
            updateCharts(totalCount, variantCounts);

            try {
                if (variantChart) {
                    variantChart.data.datasets[0].data = [
                        variantCounts['Black'] || 0,
                        variantCounts['Platinum'] || 0,
                        variantCounts['Pineapple'] || 0
                    ];
                    variantChart.update();
                }

                const countBlackEl = document.getElementById("countBlack");
                const countPlatinumEl = document.getElementById("countPlatinum");
                const countPineappleEl = document.getElementById("countPineapple");
                if (countBlackEl) countBlackEl.textContent = variantCounts['Black'] || 0;
                if (countPlatinumEl) countPlatinumEl.textContent = variantCounts['Platinum'] || 0;
                if (countPineappleEl) countPineappleEl.textContent = variantCounts['Pineapple'] || 0;
            } catch (e) {
                console.warn('Failed to update variant cards/chart with additions counts', e);
            }

            renderLowStockAlerts();

            // Load recent sessions (IN/OUT)
            loadRecentEntries(data.recent_additions || []);

            // Populate Inventory contents (additions per-variant)
            try {
                const tankList = document.getElementById('tankContentsList');
                if (tankList) {
                    const adds = data.by_variant_additions || [];
                    if (!adds || adds.length === 0) {
                        tankList.textContent = 'No inventory records';
                    } else {
                        tankList.innerHTML = adds.map(v => {
                            const name = v.variant || 'Unknown';
                            const count = v.count || 0;
                            return `<span class="variant-chip">${name}<strong>${count}</strong></span>`;
                        }).join('');
                    }
                }
            } catch (e) {
                // ignore
            }
        })
        .catch(err => {
            console.error("Error loading dashboard:", err);
        });

    loadUnfilteredTotalChart();
}

function removeSalesTrendNoData() {
    const prev = document.getElementById('salesTrendNoData');
    if (prev) prev.remove();
}

function showSalesTrendNoData(message) {
    removeSalesTrendNoData();
    const container = document.querySelector('.sales-trend-section .chart-container');
    if (!container) return;
    const msg = document.createElement('div');
    msg.id = 'salesTrendNoData';
    msg.style.padding = '18px';
    msg.style.textAlign = 'center';
    msg.style.color = '#6b7280';
    msg.textContent = message || 'No sales data available for the selected filters.';
    container.appendChild(msg);
}

function buildTrendChartConfig({ labels, datasets, compactMode, viewMode }) {
    const isAmount = viewMode === 'amount';
    const valuePrefix = isAmount ? '₱' : '';
    const compactLabel = (label) => {
        const text = String(label ?? '');
        return text.length > 8 ? `${text.slice(0, 7)}…` : text;
    };

    return {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: (ctx) => {
                            const val = Number(ctx.parsed.y || 0);
                            if (isAmount) {
                                return `${ctx.dataset.label}: ${valuePrefix}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                            }
                            return `${ctx.dataset.label}: ${val.toLocaleString()}`;
                        }
                    }
                }
            },
            interaction: { mode: 'nearest', intersect: false },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { size: compactMode ? 10 : 12 },
                        callback: (value) => `${valuePrefix}${Number(value).toLocaleString()}`
                    }
                },
                x: {
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: compactMode ? 6 : 12,
                        minRotation: compactMode ? 28 : 0,
                        maxRotation: compactMode ? 38 : 0,
                        font: { size: compactMode ? 10 : 12 },
                        callback: function (value, index) {
                            const rawLabel = labels[index] ?? (typeof this.getLabelForValue === 'function' ? this.getLabelForValue(value) : value);
                            return compactMode ? compactLabel(rawLabel) : rawLabel;
                        }
                    }
                }
            }
        }
    };
}

function renderSalesTrendCharts(labels, retailDatasets, wholesaleDatasets, viewMode) {
    const retailCanvas = document.getElementById('salesTrendRetailChart');
    const wholesaleCanvas = document.getElementById('salesTrendWholesaleChart');
    if (!retailCanvas || !wholesaleCanvas || typeof Chart === 'undefined') return;

    const isCompactScreen = window.innerWidth <= 480;
    salesTrendCompactMode = isCompactScreen;

    retailCanvas.style.height = isCompactScreen ? '220px' : '260px';
    wholesaleCanvas.style.height = isCompactScreen ? '220px' : '260px';

    const retailCtx = retailCanvas.getContext('2d');
    const wholesaleCtx = wholesaleCanvas.getContext('2d');
    if (!retailCtx || !wholesaleCtx) return;

    const retailConfig = buildTrendChartConfig({
        labels,
        datasets: retailDatasets,
        compactMode: isCompactScreen,
        viewMode
    });

    const wholesaleConfig = buildTrendChartConfig({
        labels,
        datasets: wholesaleDatasets,
        compactMode: isCompactScreen,
        viewMode
    });

    if (salesTrendRetailChart) {
        salesTrendRetailChart.data.labels = labels;
        salesTrendRetailChart.data.datasets = retailDatasets;
        salesTrendRetailChart.options = retailConfig.options;
        salesTrendRetailChart.update();
    } else {
        salesTrendRetailChart = new Chart(retailCtx, retailConfig);
    }

    if (salesTrendWholesaleChart) {
        salesTrendWholesaleChart.data.labels = labels;
        salesTrendWholesaleChart.data.datasets = wholesaleDatasets;
        salesTrendWholesaleChart.options = wholesaleConfig.options;
        salesTrendWholesaleChart.update();
    } else {
        salesTrendWholesaleChart = new Chart(wholesaleCtx, wholesaleConfig);
    }

    renderSalesTrendLegend([...(retailDatasets || []), ...(wholesaleDatasets || [])]);
}

function renderSalesTrendLegend(datasets) {
    const legendEl = document.getElementById('salesTrendLegend');
    if (!legendEl) return;
    legendEl.innerHTML = '';

    const retailCol = document.createElement('div');
    retailCol.className = 'sales-legend-col retail-col';

    const wholesaleCol = document.createElement('div');
    wholesaleCol.className = 'sales-legend-col wholesale-col';

    (datasets || []).forEach((dataset) => {
        const pill = document.createElement('span');
        pill.className = 'sales-legend-pill';
        const labelText = String(dataset.label || 'Series');

        const swatch = document.createElement('span');
        swatch.className = 'sales-legend-swatch';
        const lineColor = dataset.borderColor || '#2563eb';
        swatch.style.setProperty('--legend-color', lineColor);
        if (Array.isArray(dataset.borderDash) && dataset.borderDash.length) {
            swatch.classList.add('dashed');
        }

        const text = document.createElement('span');
        text.textContent = labelText;

        pill.appendChild(swatch);
        pill.appendChild(text);

        if (labelText.toLowerCase().includes('wholesale')) {
            wholesaleCol.appendChild(pill);
        } else {
            retailCol.appendChild(pill);
        }
    });

    legendEl.appendChild(retailCol);
    legendEl.appendChild(wholesaleCol);
}

function refreshSalesTrendForViewport() {
    if (!salesTrendChartData) return;
    loadSalesTrendChart();
}

function loadSalesTrendChart() {
    const retailCanvas = document.getElementById('salesTrendRetailChart');
    const wholesaleCanvas = document.getElementById('salesTrendWholesaleChart');
    if (!retailCanvas || !wholesaleCanvas) return;

    const selectedMonth = document.getElementById('salesMonthFilter')?.value || '';
    const selectedYear = document.getElementById('salesYearFilter')?.value || '';
    const viewMode = document.getElementById('salesViewMode')?.value || 'amount';

    const params = [];
    params.push(`period=${encodeURIComponent('month')}`);

    const url = '/get_time_series_by_variant' + (params.length ? ('?' + params.join('&')) : '');

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(js => {
            const periods = js.periods || [];
            const variants = js.variants || [];
            const prices = js.prices || {};
            const data = js.data || {};

            const monthlyPeriods = (periods || []).filter(periodLabel => {
                if (typeof periodLabel !== 'string') return false;
                return /^\d{4}-\d{2}$/.test(periodLabel);
            });

            const selectedIndices = [];
            monthlyPeriods.forEach((label, idx) => {
                const yearPart = label.slice(0, 4);
                const monthPart = label.slice(5, 7);
                if (selectedYear && selectedYear !== yearPart) return;
                if (selectedMonth && selectedMonth !== monthPart) return;
                selectedIndices.push(idx);
            });

            const filteredLabels = selectedIndices.map(idx => monthlyPeriods[idx]);
            const maxPeriods = 12;
            const finalLabels = filteredLabels.length > maxPeriods ? filteredLabels.slice(filteredLabels.length - maxPeriods) : filteredLabels;
            const finalSet = new Set(finalLabels);

            const priceInfoEl = document.getElementById('salesPriceInfo');
            if (priceInfoEl) {
                const retailPrice = Number(prices.retail || 5).toFixed(2);
                const wholesalePrice = Number(prices.wholesale || 1.75).toFixed(2);
                priceInfoEl.textContent = `Retail ₱${retailPrice} • Wholesale ₱${wholesalePrice}`;
            }

            const retailTitleEl = document.getElementById('salesRetailTitle');
            const wholesaleTitleEl = document.getElementById('salesWholesaleTitle');
            if (retailTitleEl) retailTitleEl.textContent = viewMode === 'amount' ? 'Retail Revenue' : 'Retail Stock';
            if (wholesaleTitleEl) wholesaleTitleEl.textContent = viewMode === 'amount' ? 'Wholesale Revenue' : 'Wholesale Stock';

            if (!finalLabels.length || !variants.length) {
                if (salesTrendRetailChart) {
                    salesTrendRetailChart.data.labels = [];
                    salesTrendRetailChart.data.datasets = [];
                    salesTrendRetailChart.update();
                }
                if (salesTrendWholesaleChart) {
                    salesTrendWholesaleChart.data.labels = [];
                    salesTrendWholesaleChart.data.datasets = [];
                    salesTrendWholesaleChart.update();
                }
                showSalesTrendNoData('No sales data available for the selected filters.');
                return;
            }

            removeSalesTrendNoData();
            const visibleData = {};
            variants.forEach((variantName) => {
                const byVariant = data[variantName] || {};
                const mapToLabel = (arr) => {
                    const source = Array.isArray(arr) ? arr : [];
                    const map = {};
                    monthlyPeriods.forEach((label, idx) => {
                        map[label] = Number(source[idx] || 0);
                    });
                    return map;
                };

                const retailAmountMap = mapToLabel(byVariant.tank_amount);
                const wholesaleAmountMap = mapToLabel(byVariant.wholesale_amount);
                const retailUnitsMap = mapToLabel(byVariant.tank);
                const wholesaleUnitsMap = mapToLabel(byVariant.wholesale);

                visibleData[variantName] = {
                    tank: finalLabels.map(label => finalSet.has(label) ? (retailUnitsMap[label] || 0) : 0),
                    wholesale: finalLabels.map(label => finalSet.has(label) ? (wholesaleUnitsMap[label] || 0) : 0),
                    tank_amount: finalLabels.map(label => finalSet.has(label) ? (retailAmountMap[label] || 0) : 0),
                    wholesale_amount: finalLabels.map(label => finalSet.has(label) ? (wholesaleAmountMap[label] || 0) : 0)
                };
            });
            salesTrendChartData = { labels: finalLabels, variants, data: visibleData, prices };

            const palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#9467bd', '#d62728', '#17becf'];
            const retailDatasets = variants.map((variantName, index) => ({
                label: `Retail • ${variantName}`,
                data: viewMode === 'amount' ? (visibleData[variantName]?.tank_amount || []) : (visibleData[variantName]?.tank || []),
                borderColor: palette[index % palette.length],
                backgroundColor: 'rgba(0,0,0,0)',
                borderWidth: 3,
                pointRadius: 2,
                pointHoverRadius: 4,
                tension: 0.2
            }));

            const wholesaleDatasets = variants.map((variantName, index) => ({
                label: `Wholesale • ${variantName}`,
                data: viewMode === 'amount' ? (visibleData[variantName]?.wholesale_amount || []) : (visibleData[variantName]?.wholesale || []),
                borderColor: palette[index % palette.length],
                borderDash: [6, 4],
                backgroundColor: 'rgba(0,0,0,0)',
                borderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 4,
                tension: 0.2
            }));

            renderSalesTrendCharts(finalLabels, retailDatasets, wholesaleDatasets, viewMode);
        })
        .catch(err => {
            console.warn('Failed to load sales trend chart', err);
            showSalesTrendNoData('Failed to load sales trend. Please refresh.');
        });
}

function downloadSalesTrendCsv() {
    if (!salesTrendChartData) return;
    const labels = salesTrendChartData.labels || [];
    const variants = salesTrendChartData.variants || [];
    const data = salesTrendChartData.data || {};

    const viewMode = document.getElementById('salesViewMode')?.value || 'amount';
    const valueKeyRetail = viewMode === 'amount' ? 'tank_amount' : 'tank';
    const valueKeyWholesale = viewMode === 'amount' ? 'wholesale_amount' : 'wholesale';
    const formatValue = (value) => {
        const num = Number(value || 0);
        if (viewMode === 'amount') {
            return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return num.toString();
    };

    const csvEscape = (value) => {
        const text = String(value ?? '');
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };

    const columns = ['period'];
    variants.forEach((variantName) => {
        columns.push(`retail_${variantName}`);
        columns.push(`wholesale_${variantName}`);
    });
    columns.push('retail_total');
    columns.push('wholesale_total');
    columns.push('monthly_total');

    let csv = columns.map(csvEscape).join(',') + '\n';

    labels.forEach((label, index) => {
        let retailTotal = 0;
        let wholesaleTotal = 0;
        const row = [label];

        variants.forEach((variantName) => {
            const retailValue = Number(data[variantName]?.[valueKeyRetail]?.[index] || 0);
            const wholesaleValue = Number(data[variantName]?.[valueKeyWholesale]?.[index] || 0);
            retailTotal += retailValue;
            wholesaleTotal += wholesaleValue;
            row.push(formatValue(retailValue));
            row.push(formatValue(wholesaleValue));
        });

        row.push(formatValue(retailTotal));
        row.push(formatValue(wholesaleTotal));
        row.push(formatValue(retailTotal + wholesaleTotal));
        csv += row.map(csvEscape).join(',') + '\n';
    });

    const csvWithBom = '\uFEFF' + csv;
    const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = viewMode === 'amount' ? 'sales_trend_revenue.csv' : 'sales_trend_stock.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
}

function downloadSalesTrendPng() {
    const exportCanvas = (canvasId, fileName) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    exportCanvas('salesTrendRetailChart', 'sales_trend_retail.png');
    exportCanvas('salesTrendWholesaleChart', 'sales_trend_wholesale.png');
}

function loadRecentEntries(entries) {
    const recentList = document.getElementById("recentList");
    if (entries.length === 0) {
        recentList.innerHTML = '<p class="recent-empty">No recent entries</p>';
        return;
    }

    const getRecentReason = (item) => {
        const action = String(item?.action || '').trim().toUpperCase();
        const count = Number(item?.count || 0);
        const notesText = String(item?.notes || '').trim();
        const notesLower = notesText.toLowerCase();

        if (notesLower.startsWith('sold')) return { label: 'sold', tone: 'deduct' };
        if (notesLower.startsWith('died')) return { label: 'died', tone: 'deduct' };
        if (notesLower.startsWith('wholesale out')) return { label: 'sold', tone: 'deduct' };
        if (notesLower.startsWith('wholesale in')) return { label: 'wholesale in', tone: 'add' };

        if (action === 'OUT') return { label: 'sold', tone: 'deduct' };
        if (action === 'WHOLESALE' && count < 0) return { label: 'sold', tone: 'deduct' };
        if (action === 'WHOLESALE' && count >= 0) return { label: 'wholesale in', tone: 'add' };
        if (action === 'IN') return { label: 'in', tone: 'add' };

        return { label: action ? action.toLowerCase() : 'unknown', tone: 'add' };
    };

    const formatRecentCount = (item, tone) => {
        const raw = Math.abs(Number(item?.count || 0));
        const sign = tone === 'deduct' ? '-' : '+';
        return `${sign}${raw.toLocaleString()}`;
    };

    const formatRecentDate = (value) => {
        if (!value) return '-';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getRecentVariantClass = (variant) => {
        const normalized = String(variant || '').trim().toLowerCase();
        if (normalized === 'black') return 'variant-black';
        if (normalized === 'platinum') return 'variant-platinum';
        if (normalized === 'pineapple') return 'variant-pineapple';
        return 'variant-default';
    };

    recentList.innerHTML = entries.map(item => `
        ${(() => {
            const reason = getRecentReason(item);
            const countText = formatRecentCount(item, reason.tone);
            const variantClass = getRecentVariantClass(item.variant);
            return `
        <div class="recent-item">
            <div class="recent-main" title="${item.notes || ''}">
                <span class="recent-fish-icon ${variantClass}">🐟</span>
                <span class="recent-variant">${item.variant || 'Unknown'} Fish</span>
            </div>
            <div class="recent-count ${reason.tone}">${countText}</div>
            <div class="recent-action ${reason.tone}">${reason.label}</div>
            <div class="recent-date">${formatRecentDate(item.date)}</div>
        </div>
    `;
        })()}
    `).join('');
}

function renderLowStockAlerts() {
    const alertsList = document.getElementById('lowStockAlertsList');
    if (!alertsList) return;

    fetch('/api/low-stock')
        .then(res => res.json())
        .then(data => {
            const alerts = (data.alerts || []).filter(a => a.status === 'critical' || a.status === 'warning');

            if (alerts.length === 0) {
                alertsList.innerHTML = '<div class="low-stock-item empty">No low stock alerts</div>';
                return;
            }

            alertsList.innerHTML = alerts.map((item) => `
                <div class="low-stock-item">
                    <div class="low-stock-item-main">
                        <div class="low-stock-variant">${item.variant} <span style="font-size:12px;font-weight:400;color:#6b7280">(${item.source})</span></div>
                        <div class="low-stock-meta">stock: ${item.stock}</div>
                        <div class="low-stock-status ${item.status}">status: ${item.status}</div>
                    </div>
                    <span class="low-stock-icon ${item.status}">${item.status === 'critical' ? '!' : '▲'}</span>
                </div>
            `).join('');
        })
        .catch(err => {
            console.warn('Error loading low stock alerts:', err);
            alertsList.innerHTML = '<div class="low-stock-item empty">Failed to load alerts</div>';
        });
}

// ============ INVENTORY MODAL ============
function showInventoryModal() {
    // Get current filter values from dashboard date range inputs
    const variant = document.getElementById("dashboardVariantFilter")?.value || "";
    const startDate = document.getElementById("dashStartDate")?.value || "";
    const endDate = document.getElementById("dashEndDate")?.value || "";
    const params = [];
    if (variant) params.push(`variant=${encodeURIComponent(variant)}`);
    if (startDate) params.push(`start_date=${encodeURIComponent(startDate)}`);
    if (endDate) params.push(`end_date=${encodeURIComponent(endDate)}`);
    const url = "/get_statistics" + (params.length ? `?${params.join('&')}` : '');

    fetch(url)
        .then(res => res.json())
        .then(data => {
            const modalTotalCountEl = document.getElementById("modalTotalCount");
            const modalCountBlackEl = document.getElementById("modalCountBlack");
            const modalCountPlatinumEl = document.getElementById("modalCountPlatinum");
            const modalCountPineappleEl = document.getElementById("modalCountPineapple");

            // Use additions-only totals (IN) for the inventory modal so it shows total added
            const adds = {};
            (data.by_variant_additions || []).forEach(v => {
                const name = v.variant || '';
                const normalized = name ? (name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()) : name;
                adds[normalized] = v.count || 0;
            });

            if (modalTotalCountEl) modalTotalCountEl.textContent = (data.additions_total || 0);
            if (modalCountBlackEl) modalCountBlackEl.textContent = adds['Black'] || 0;
            if (modalCountPlatinumEl) modalCountPlatinumEl.textContent = adds['Platinum'] || 0;
            if (modalCountPineappleEl) modalCountPineappleEl.textContent = adds['Pineapple'] || 0;

            const modal = document.getElementById("inventoryModal");
            if (modal) modal.style.display = 'flex';
        })
        .catch(e => {
            console.warn('Failed fetching statistics for modal', e);
            // Fallback to reading existing DOM values
            const totalCount = document.getElementById("totalCount")?.textContent?.trim() || "0";
            const countBlack = document.getElementById("countBlack")?.textContent?.trim() || "0";
            const countPlatinum = document.getElementById("countPlatinum")?.textContent?.trim() || "0";
            const countPineapple = document.getElementById("countPineapple")?.textContent?.trim() || "0";
            const modalTotalCountEl = document.getElementById("modalTotalCount");
            const modalCountBlackEl = document.getElementById("modalCountBlack");
            const modalCountPlatinumEl = document.getElementById("modalCountPlatinum");
            const modalCountPineappleEl = document.getElementById("modalCountPineapple");
            if (modalTotalCountEl) modalTotalCountEl.textContent = totalCount;
            if (modalCountBlackEl) modalCountBlackEl.textContent = countBlack;
            if (modalCountPlatinumEl) modalCountPlatinumEl.textContent = countPlatinum;
            if (modalCountPineappleEl) modalCountPineappleEl.textContent = countPineapple;
            const modal = document.getElementById("inventoryModal");
            if (modal) modal.style.display = 'flex';
        });
}

function closeInventoryModal() {
    const modal = document.getElementById("inventoryModal");
    if (modal) {
        modal.style.display = "none";
    }
}

// ============ CHARTS ============
function initCharts() {
    initTotalChart();
    initVariantChart();
}

function initTotalChart() {
    const ctx = document.getElementById('totalChart');
    if (!ctx) return;

    const onRpi = document.documentElement.classList.contains('rpi7-display');
    const yFontSize = onRpi ? 16 : 10;
    const xFontSize = onRpi ? 18 : 11;
    const dpr = onRpi ? 3 : undefined;

    // Create a vertical bar chart where the X axis lists variants and Y axis shows fish-in-tank counts
    totalChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Black', 'Platinum', 'Pineapple'],
            datasets: [
                { label: 'Total Tank Stock', data: [0,0,0], backgroundColor: ['#34495e', '#95a5a6', '#e67e22'] }
            ]
        },
        options: {
            indexAxis: 'x',
            responsive: true,
            maintainAspectRatio: true,
            devicePixelRatio: dpr,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
                            return context.dataset.label + ': ' + value + ' fish';
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: yFontSize, weight: onRpi ? '600' : undefined } } },
                x: { ticks: { font: { size: xFontSize, weight: onRpi ? '700' : undefined } } }
            }
        }
    });
}

function initVariantChart() {
    const ctx = document.getElementById('variantChart');
    if (!ctx) return;
    
    variantChart = new Chart(ctx, {
        type: 'pie',
        plugins: [variantPercentagePlugin],
        data: {
            labels: ['Black', 'Platinum', 'Pineapple'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: ['#34495e', '#95a5a6', '#e67e22'],
                borderColor: ['#2c3e50', '#7f8c8d', '#d35400'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            onClick: function(evt) {
                const chart = this;
                const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
                if (points && points.length) {
                    const p = points[0];
                    chart.tooltip.setActiveElements([{ datasetIndex: p.datasetIndex, index: p.index }], { x: evt.x, y: evt.y });
                    chart.update();
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { size: 9 },
                        padding: 6,
                        usePointStyle: true,
                        boxWidth: 8,
                        boxHeight: 8
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = Number(context.parsed) || 0;
                            const chart = context.chart;
                            const total = context.dataset.data.reduce((sum, item, index) => {
                                if (!chart.getDataVisibility(index)) return sum;
                                return sum + (Number(item) || 0);
                            }, 0);
                            if (total <= 0) return label + ': ' + value;

                            const percentage = (value / total) * 100;
                            const roundedPercentage = percentage.toFixed(1);
                            if (Number(roundedPercentage) <= 0) {
                                return label + ': ' + value;
                            }

                            return label + ': ' + value + ' (' + roundedPercentage + '%)';
                        }
                    }
                }
            }
        }
    });
}

function loadMonthlyTotalsByVariant(year) {
    // Fetch cumulative per-variant monthly totals
    let url = '/get_monthly_tank_by_variant';
    if (year) url += '?year=' + encodeURIComponent(year);
    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (!Array.isArray(data)) return;
            const labels = data.map(r => r.month);
            const black = data.map(r => r.Black || 0);
            const platinum = data.map(r => r.Platinum || 0);
            const pineapple = data.map(r => r.Pineapple || 0);
            if (totalChart) {
                totalChart.data.labels = labels;
                totalChart.data.datasets[0].data = black;
                totalChart.data.datasets[1].data = platinum;
                totalChart.data.datasets[2].data = pineapple;
                totalChart.update();
            }
        })
        .catch(err => console.warn('Failed to load monthly totals by variant', err));
}

function updateCharts(total, additionsCounts) {
    // variantChart shows additions (inventory totals) — affected by filters
    if (variantChart && additionsCounts) {
        variantChart.data.datasets[0].data = [
            additionsCounts["Black"] || 0,
            additionsCounts["Platinum"] || 0,
            additionsCounts["Pineapple"] || 0
        ];
        variantChart.update();
    }
    // Note: totalChart (Fish in Tank) is updated independently via loadCurrentFishChart()
}

// ============ COUNTER SYSTEM ============
function startSystem() {
    // Show count mode selection dialog first (tank or whole)
    selectedCountMode = "";
    document.getElementById("dialogOverlay").style.display = "block";
    document.getElementById("countModeDialog").style.display = "block";
}

function chooseCountMode(mode) {
    const normalized = (mode || '').toString().toLowerCase();
    if (normalized !== 'tank' && normalized !== 'whole') {
        alert('Please choose counting type.');
        return;
    }

    selectedCountMode = normalized;
    document.getElementById("countModeDialog").style.display = "none";
    document.getElementById("variantSelect").value = "";
    document.getElementById("dialogOverlay").style.display = "block";

    if (selectedCountMode === 'whole') {
        // For whole, show target setting dialog first
        document.getElementById("targetSettingDialog").style.display = "block";
        // Reset targets and UI
        document.getElementById("targetGeneral").value = "";
        const statusEl = document.getElementById('targetSetStatus');
        if (statusEl) statusEl.textContent = "";
        
        const startBtn = document.getElementById('targetStartBtn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = "Start"; // Revert text if changed
        }
    } else {
        // For tank (or anything else), proceed directly to variant selection
        document.getElementById("variantDialog").style.display = "block";
    }
}

// Global target storage
let wholeTarget = 0;

function setWholeTargets() {
    wholeTarget = parseInt(document.getElementById("targetGeneral").value) || 0;

    const statusEl = document.getElementById('targetSetStatus');
    if (wholeTarget <= 0) {
        if (statusEl) {
            statusEl.style.color = 'red';
            statusEl.textContent = "Please set target > 0.";
        } else {
            alert("Please set target greater than 0.");
        }
        return;
    }
    
    // Enable start button and indicate targets set
    const btn = document.getElementById('targetStartBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = "Start";
        // Update UI instead of alerting
        if (statusEl) {
            statusEl.style.color = 'green';
            statusEl.textContent = `Target Set: ${wholeTarget}`;
        }
    }
}

function proceedToVariantSelection() {
    document.getElementById("targetSettingDialog").style.display = "none";
    document.getElementById("variantDialog").style.display = "block";
}

function confirmVariant() {
        // Prevent if locked
        if (document.getElementById('startBtn').disabled) return;
    selectedVariant = document.getElementById("variantSelect").value;
    if (!selectedVariant) {
        alert("Please select a variant");
        return;
    }

    // Check if target matches variant for whole
    if (selectedCountMode === 'whole' && wholeTarget <= 0) {
        if (!confirm('Warning: Target is 0 or not set. Continue anyway?')) {
            return;
        }
    }

    closeDialog();

    // LOCK IMMEDIATELY - disable button and show loading state
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const countDisplay = document.getElementById("countDisplay");
    let modeText = selectedCountMode === 'whole' ? 'Whole' : 'Tank';
    
    // Add target info to display if whole
    if (selectedCountMode === 'whole' && wholeTarget > 0) {
        modeText += ` (Target: ${wholeTarget})`;
    }

    startBtn.disabled = true;
    startBtn.textContent = "🔄 Starting...";
    countDisplay.textContent = `Starting ${modeText} count for ${selectedVariant}...`;

    // First verify with server that counting isn't already active (defense-in-depth)
    fetch("/get_state")
        .then(res => res.json())
        .then(stateData => {
            if (stateData && stateData.active) {
                // Already counting, don't proceed
                closeDialog();
                startBtn.disabled = false;
                startBtn.textContent = "▶ Start Counting";
                countDisplay.textContent = "Error: Already counting on another device!";
                alert("Already counting on another device. Please stop first.");
                updateButtonsForCountingState(true); // Sync UI to show counting state
                return;
            }
            // Not counting, proceed to start
            actuallyStartCounting(startBtn, stopBtn, countDisplay, modeText);
        })
        .catch(err => {
            // If state check fails, proceed anyway (backend will reject if needed)
            actuallyStartCounting(startBtn, stopBtn, countDisplay, modeText);
        });
}

function actuallyStartCounting(startBtn, stopBtn, countDisplay, modeText) {
    // Start the counting process
    fetch("/start")
        .then(async res => {
            let data;
            try { data = await res.json(); } catch { data = {}; }
            if (!res.ok) {
                // Always close dialog, reset UI, and show error
                closeDialog();
                startBtn.disabled = false;
                startBtn.textContent = "▶ Start Counting";
                countDisplay.textContent = data.message ? `Error: ${data.message}` : `Error: Could not start counting.`;
                alert(data.message || "Failed to start counting.");
                return;
            }
            // Success - show counting state
            stopBtn.disabled = false;
            countDisplay.classList.remove('target-reached'); // reset style
            countDisplay.textContent = `Counting ${selectedVariant} (${modeText})... (0 fish)`;
            fishCount = 0;
            countersActive = true;
            pollForCount();
        })
        .catch(err => {
            // Always close dialog, reset UI, and show error
            closeDialog();
            startBtn.disabled = false;
            startBtn.textContent = "▶ Start Counting";
            countDisplay.textContent = `Error: ${err.message}`;
            alert("Failed to start counting: " + err.message);
        });
}

function stopSystem() {
    // Anyone can stop - no disabled check needed (server is source of truth)
    // LOCK IMMEDIATELY - disable button and show stopping state
    const stopBtn = document.getElementById("stopBtn");
    const countDisplay = document.getElementById("countDisplay");
    
    stopBtn.disabled = true;
    stopBtn.textContent = "⏹ Stopping...";
    countDisplay.textContent = "Stopping count...";
    
    countersActive = false;
    fetch("/stop")
        .then(res => res.text())
        .then(data => {
            // After stopping, fetch the latest count from server to avoid missed socket/poll updates
            fetch('/get_count')
                .then(r => r.json())
                .then(d => {
                    fishCount = d.count || 0;
                    // Success - show stopped state
                    document.getElementById("startBtn").disabled = false;
                    document.getElementById("startBtn").textContent = "▶ Start Counting";
                    stopBtn.disabled = true;
                    stopBtn.textContent = "⏹ Stop Counting";
                    if (fishCount && fishCount > 0) {
                        countDisplay.textContent = `${formatCountMessage(fishCount, selectedVariant, false)} have been counted!`;
                        countDisplay.style.color = '#4CAF50';
                        showSaveDialog();
                    } else {
                        const v = selectedVariant ? selectedVariant.toLowerCase() : 'fish';
                        countDisplay.textContent = `No ${v} counted`;
                        countDisplay.style.color = '#f39c12';
                    }
                })
                .catch(() => {
                    document.getElementById("startBtn").disabled = false;
                    document.getElementById("startBtn").textContent = "▶ Start Counting";
                    stopBtn.disabled = true;
                    stopBtn.textContent = "⏹ Stop Counting";
                    const v = selectedVariant ? selectedVariant.toLowerCase() : 'fish';
                    document.getElementById('countDisplay').textContent = `No ${v} counted`;
                    document.getElementById('countDisplay').style.color = '#f39c12';
                });
        })
        .catch(err => {
            // Error - unlock button
            stopBtn.disabled = false;
            stopBtn.textContent = "⏹ Stop Counting";
            countDisplay.textContent = `Error stopping: ${err.message}`;
            alert("Failed to stop counting: " + err.message);
            countersActive = true;
        });
}

function pollForCount() {
    if (!countersActive) {
        return;
    }
    fetch("/get_count")
        .then(res => res.json())
        .then(data => {
            fishCount = data.count || 0;
            const cd = document.getElementById("countDisplay");
            const target = (selectedCountMode === 'whole') ? wholeTarget : 0;
            
            let msg = formatCountMessage(fishCount, selectedVariant, false);
            if (target > 0) {
               msg = `${msg} / ${target}`;
            }
            cd.textContent = msg;

            if (target > 0 && fishCount >= target) {
                cd.classList.add('target-reached');
            } else {
                cd.classList.remove('target-reached');
            }

            setTimeout(pollForCount, 500);
        })
        .catch(err => {
            setTimeout(pollForCount, 500);
        });
}

function updateCounterDisplayFromInventory(variant) {
    // Show inventory additions for the selected variant (inventory view), not net tank
    const params = variant ? `?variant=${encodeURIComponent(variant)}` : '';
    fetch('/get_statistics' + params)
        .then(res => res.json())
        .then(data => {
            const additionsTotal = data.additions_total || 0;
            if (variant) {
                const found = (data.by_variant_additions || []).find(v => (v.variant || '').toLowerCase() === variant.toLowerCase());
                const vcount = found ? (found.count || 0) : 0;
                if (!vcount) {
                    document.getElementById('countDisplay').textContent = `No ${variant.toLowerCase()} in inventory`;
                } else {
                    document.getElementById('countDisplay').textContent = `${vcount} ${variant} in inventory`;
                }
            } else {
                if (!additionsTotal) {
                    document.getElementById('countDisplay').textContent = `No fish in inventory`;
                } else {
                    document.getElementById('countDisplay').textContent = `${additionsTotal} fish in inventory`;
                }
            }
        })
        .catch(() => {
            document.getElementById('countDisplay').textContent = 'Waiting to start...';
        });
}

// ============ DIALOGS ============
function showSaveDialog() {
    if (!fishCount || fishCount <= 0) {
        alert('Nothing to save. Count is 0.');
        return;
    }
    const saveWholeBtn = document.getElementById('btnSaveWhole');
    const addToTankBtn = document.getElementById('btnAddToTank');
    if (saveWholeBtn) {
        saveWholeBtn.style.display = selectedCountMode === 'tank' ? 'none' : '';
    }
    if (addToTankBtn) {
        addToTankBtn.style.display = selectedCountMode === 'whole' ? 'none' : '';
    }
    if (selectedCountMode === 'whole') {
        document.getElementById("dialogMessage").textContent = `Save ${formatCountMessage(fishCount, selectedVariant)} to wholesale storage?`;
    } else {
        document.getElementById("dialogMessage").textContent = `Add ${formatCountMessage(fishCount, selectedVariant)} to tank?`;
    }
    document.getElementById("notesInput").value = "";
    document.getElementById("dialogOverlay").style.display = "block";
    document.getElementById("saveDialog").style.display = "block";
}

function closeDialog() {
    const overlay = document.getElementById("dialogOverlay");
    if (overlay) {
        overlay.style.display = "none";
        overlay.classList.remove('confirm-active');
    }
    const countModeDialog = document.getElementById("countModeDialog");
    if (countModeDialog) countModeDialog.style.display = "none";
    const targetDialog = document.getElementById("targetSettingDialog");
    if (targetDialog) targetDialog.style.display = "none";
    document.getElementById("variantDialog").style.display = "none";
    document.getElementById("saveDialog").style.display = "none";
    const confirmDialog = document.getElementById("confirmDialog");
    if (confirmDialog) confirmDialog.style.display = "none";
    const noticeDialog = document.getElementById("noticeDialog");
    if (noticeDialog) noticeDialog.style.display = "none";
    pendingConfirmAction = null;
}

function showNoticeDialog(message, title) {
    const noticeTitle = title || 'Notice';
    const content = (message === undefined || message === null) ? '' : String(message);

    const titleEl = document.getElementById('noticeDialogTitle');
    const messageEl = document.getElementById('noticeDialogMessage');
    const overlay = document.getElementById('dialogOverlay');
    const dialog = document.getElementById('noticeDialog');

    if (!titleEl || !messageEl || !overlay || !dialog) {
        nativeBrowserAlert(content);
        return;
    }

    titleEl.textContent = noticeTitle;
    messageEl.textContent = content;
    overlay.style.display = 'block';
    overlay.classList.remove('confirm-active');
    dialog.style.display = 'block';
}

function closeNoticeDialog() {
    closeDialog();
}

window.alert = function(message) {
    showNoticeDialog(message, 'Notice');
};

function showConfirmDialog(options) {
    const config = options || {};
    const title = config.title || 'Confirm Action';
    const message = config.message || 'Are you sure?';
    const confirmText = config.confirmText || 'OK';
    const cancelText = config.cancelText || 'Cancel';
    const confirmVariant = config.confirmVariant || 'default';

    const titleEl = document.getElementById('confirmDialogTitle');
    const messageEl = document.getElementById('confirmDialogMessage');
    const okBtn = document.getElementById('confirmDialogOkBtn');
    const cancelBtn = document.getElementById('confirmDialogCancelBtn');
    const overlay = document.getElementById('dialogOverlay');
    const dialog = document.getElementById('confirmDialog');

    if (!titleEl || !messageEl || !okBtn || !cancelBtn || !overlay || !dialog) {
        if (confirm(message) && typeof config.onConfirm === 'function') config.onConfirm();
        return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    dialog.classList.remove('confirm-danger');
    okBtn.classList.remove('danger');
    if (confirmVariant === 'danger') {
        dialog.classList.add('confirm-danger');
        okBtn.classList.add('danger');
    }

    pendingConfirmAction = typeof config.onConfirm === 'function' ? config.onConfirm : null;

    overlay.style.display = 'block';
    overlay.classList.add('confirm-active');
    dialog.style.display = 'block';
}

function confirmDialogOk() {
    const action = pendingConfirmAction;
    closeDialog();
    if (typeof action === 'function') action();
}

function confirmDialogCancel() {
    closeDialog();
}

// ============ INVENTORY MANAGEMENT ============
function saveToInventory(save) {
    closeDialog();
    if (save) {
        if (inventorySaveInProgress) return;
        if (countersActive) {
            alert('Please stop counting before saving.');
            return;
        }
        if (!fishCount || fishCount <= 0) {
            alert('Cannot whole zero fish.');
            return;
        }
        inventorySaveInProgress = true;
        const notes = document.getElementById("notesInput").value;
        fetch("/save_inventory", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                count: fishCount,
                variant: selectedVariant,
                notes: notes,
                action: "WHOLESALE"
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status && data.status !== 'success') {
                alert(data.message || 'Error saving inventory');
                inventorySaveInProgress = false;
                return;
            }
            alert(data.message);
            document.getElementById("countDisplay").textContent = "Saved! Ready for next session.";
            fishCount = 0;
            selectedVariant = "";
            loadDashboard();
            inventorySaveInProgress = false;
        })
        .catch(() => {
            inventorySaveInProgress = false;
            alert('Error saving inventory');
        });
        
    } else {
        document.getElementById("countDisplay").textContent = "Count canceled.";
        fishCount = 0;
        selectedVariant = "";
    }
}

function addToTank() {
    closeDialog();
    if (addToTankInProgress) return;
    if (countersActive) {
        alert('Please stop counting before saving.');
        return;
    }
    if (!fishCount || fishCount <= 0) {
        alert('Cannot add zero fish to tank.');
        return;
    }
    addToTankInProgress = true;
    const notes = document.getElementById("notesInput").value;
    fetch('/add_to_tank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: fishCount, variant: selectedVariant, notes: notes })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status && data.status !== 'success') {
            alert(data.message || 'Error adding to tank');
            addToTankInProgress = false;
            return;
        }
        alert(data.message);
        document.getElementById("countDisplay").textContent = "Added to tank.";
        fishCount = 0;
        selectedVariant = "";
        loadDashboard();
        addToTankInProgress = false;
    })
    .catch(err => {
        addToTankInProgress = false;
        alert('Error adding to tank');
    });
}

function submitAdjustment() {
    let mode = (arguments.length > 0 && typeof arguments[0] === 'string') ? arguments[0] : selectedAdjustmentSource;
    if (mode !== 'tank' && mode !== 'wholesale') mode = selectedAdjustmentSource;

    if (adjustmentSubmitInProgress) return;

    const formSelector = mode === 'wholesale' ? '#adjustFormWholesale' : '#adjustFormTank';
    const items = [];
    document.querySelectorAll(`${formSelector} .adjust-variant-card`).forEach(card => {
        const variant = card.dataset.variant;
        const check = card.querySelector('.adjust-card-check');
        const countInput = card.querySelector('.adjust-card-count');
        if (!variant || !check || !countInput || !check.checked || check.disabled) return;
        const count = parseInt(countInput.value, 10) || 0;
        if (count > 0) items.push({ variant, count });
    });

    const wholesaleAction = mode === 'wholesale' ? 'OUT' : '';
    const reason = mode === 'wholesale' ? 'Sold' : getSelectedAdjustmentReason();
    const notesEl = document.getElementById(mode === 'wholesale' ? 'adjNotesWholesale' : 'adjNotesTank');
    const notes = notesEl ? (notesEl.value || '') : '';
    if (!items.length) {
        alert('Select at least one variant and enter a valid count');
        return;
    }

    const summary = items.map(item => `${item.count} ${item.variant}`).join(', ');
    const sourceLabel = mode === 'wholesale' ? 'Wholesale Sold' : 'Fish Tank';

    if (mode === 'wholesale' && wholesaleAction === 'OUT') {
        const totalRequested = items.reduce((sum, item) => sum + (item.count || 0), 0);
        if (totalRequested < 300) {
            alert(`Cannot submit wholesale adjustment. Minimum total quantity is 300 (current: ${totalRequested}).`);
            return;
        }
    }

    // If submitting from wholesale, require minimum wholesale stock per variant
    if (mode === 'wholesale' && wholesaleAction === 'OUT') {
        for (const item of items) {
            const stockEl = document.querySelector(`#adjustFormWholesale [data-stock-for="${item.variant}"]`);
            const available = stockEl ? (parseInt(stockEl.textContent, 10) || 0) : 0;
            if (item.count > available) {
                alert(`Insufficient wholesale stock for ${item.variant}. Available: ${available}.`);
                return;
            }
        }
    }

    showConfirmDialog({
        title: 'Confirm Adjustment',
        message: `Submit ${summary} as ${reason} from ${sourceLabel}?`,
        confirmText: 'Submit',
        cancelText: 'Cancel',
        onConfirm: function() {
            adjustmentSubmitInProgress = true;

            submitAdjustmentRequest(items, reason, notes, mode, wholesaleAction)
            .then((data) => {
                alert(data.message || 'Adjustment recorded');

                document.querySelectorAll(`${formSelector} .adjust-variant-card`).forEach(card => {
                    const check = card.querySelector('.adjust-card-check');
                    const countInput = card.querySelector('.adjust-card-count');
                    if (check) check.checked = false;
                    if (countInput) {
                        countInput.value = 1;
                        countInput.disabled = true;
                    }
                    card.classList.remove('selected');
                });

                if (notesEl) notesEl.value = '';
                loadDashboard();
                loadInventory();
                if (typeof loadAdjustments === 'function') loadAdjustments();
                if (typeof loadAdjustmentYears === 'function') loadAdjustmentYears();
                if (typeof loadArchive === 'function') loadArchive();
                if (typeof loadAdjustmentCardStocks === 'function') loadAdjustmentCardStocks();
                adjustmentSubmitInProgress = false;
            })
            .catch(err => {
                adjustmentSubmitInProgress = false;
                const msg = (err && err.message) ? err.message : 'Error submitting adjustment';
                alert(msg);
            });
        }
    });
}

async function submitAdjustmentRequest(items, reason, notes, source, wholesaleAction) {
    const isWholesale = source === 'wholesale';
    if (isWholesale || items.length > 1) {
        const res = await fetch('/adjust_stock_batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, reason, notes, source, wholesale_action: wholesaleAction })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.status !== 'success') {
            throw new Error(data.message || 'Unable to submit adjustment batch');
        }
        return data;
    }

    const only = items[0];
    const res = await fetch('/adjust_stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            variant: only.variant,
            count: only.count,
            reason: reason,
            notes: notes,
            source: source,
            wholesale_action: wholesaleAction
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || `Unable to submit adjustment for ${only.variant}`);
    }
    return data;
}

function getSelectedAdjustmentReason() {
    const active = document.querySelector('#adjustReasonCards .adjust-reason-card.selected');
    return active?.dataset.reason || 'Sold';
}

function initAdjustmentReasonCards() {
    const cards = document.querySelectorAll('#adjustReasonCards .adjust-reason-card');
    if (!cards.length) return;

    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
        });
    });

}

function initAdjustmentSourceSwitch() {
    const buttons = document.querySelectorAll('#adjustSourceSwitch .adjust-source-btn');
    if (!buttons.length) return;

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const source = (btn.dataset.source || '').toLowerCase();
            if (source !== 'tank' && source !== 'wholesale') return;
            selectedAdjustmentSource = source;
            buttons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            syncAdjustmentModeUI();
            loadAdjustmentCardStocks();
            loadAdjustments();
        });
    });
}

function syncAdjustmentModeUI() {
    const isWholesale = selectedAdjustmentSource === 'wholesale';

    const contextEl = document.getElementById('adjustSourceContext');
    if (contextEl) {
        contextEl.textContent = isWholesale
            ? 'Current tab: Wholesale Sold/OUT only (Wholesale IN uses Counter machine)'
            : 'Current tab: Fish Tank Sold/Died adjustments';
    }

    const titleEl = document.getElementById('adjustmentsHistoryTitle');
    if (titleEl) {
        titleEl.textContent = isWholesale
            ? 'Adjustment History (Wholesale Sold)'
            : 'Adjustment History (Fish Tank)';
    }

    const submitBtn = document.getElementById('adjustSubmitBtn');
    if (submitBtn) {
        submitBtn.textContent = isWholesale ? 'Submit Wholesale Sold Adjustment' : 'Submit Tank Adjustment';
    }

    const tankForm = document.getElementById('adjustFormTank');
    const wholesaleForm = document.getElementById('adjustFormWholesale');
    if (tankForm && wholesaleForm) {
        tankForm.classList.toggle('active', !isWholesale);
        wholesaleForm.classList.toggle('active', isWholesale);
    }

    const soldBtn = document.querySelector('#adjustReasonCards .adjust-reason-card.reason-sold');
    if (!document.querySelector('#adjustReasonCards .adjust-reason-card.selected') && soldBtn) {
        soldBtn.classList.add('selected');
    }
}

function syncAdjustCardState(card) {
    if (!card) return;
    const check = card.querySelector('.adjust-card-check');
    const countInput = card.querySelector('.adjust-card-count');
    const minusBtn = card.querySelector('.adjust-count-btn[data-action="adjMinus"]');
    const plusBtn = card.querySelector('.adjust-count-btn[data-action="adjPlus"]');
    if (!check || !countInput) return;

    const stockEl = card.querySelector('[data-stock-for]');
    const available = stockEl ? (parseInt(stockEl.textContent, 10) || 0) : 0;

    if (available <= 0) {
        check.checked = false;
        check.disabled = true;
        card.classList.remove('selected');
        card.classList.add('stock-empty');
        countInput.value = 0;
        countInput.disabled = true;
        if (minusBtn) minusBtn.disabled = true;
        if (plusBtn) plusBtn.disabled = true;
        return;
    }

    check.disabled = false;
    card.classList.remove('stock-empty');
    if (minusBtn) minusBtn.disabled = false;
    if (plusBtn) plusBtn.disabled = false;

    if (check.checked) {
        card.classList.add('selected');
        countInput.disabled = false;
        if (!countInput.value || parseInt(countInput.value, 10) <= 0) countInput.value = 1;
        if (available > 0 && parseInt(countInput.value, 10) > available) countInput.value = available;
    } else {
        card.classList.remove('selected');
        countInput.disabled = true;
    }
}

function updateAdjustCardCount(variant, delta) {
    const modeSelector = selectedAdjustmentSource === 'wholesale' ? '#adjustFormWholesale' : '#adjustFormTank';
    const card = document.querySelector(`${modeSelector} .adjust-variant-card[data-variant="${variant}"]`);
    if (!card) return;
    const check = card.querySelector('.adjust-card-check');
    const countInput = card.querySelector('.adjust-card-count');
    if (!check || !countInput) return;

    const stockEl = card.querySelector('[data-stock-for]');
    const available = stockEl ? (parseInt(stockEl.textContent, 10) || 0) : 0;
    if (available <= 0) {
        alert(`No stock left for ${variant}`);
        return;
    }

    if (!check.checked) {
        check.checked = true;
        syncAdjustCardState(card);
    }

    const current = parseInt(countInput.value, 10) || 1;
    const next = Math.max(1, Math.min(available, current + delta));
    countInput.value = next;
}

function initAdjustmentCards() {
    document.querySelectorAll('#adjustmentsTab .adjust-variant-card').forEach(card => {
        const check = card.querySelector('.adjust-card-check');
        const countInput = card.querySelector('.adjust-card-count');
        const minusBtn = card.querySelector('.adjust-count-btn[data-action="adjMinus"]');
        const plusBtn = card.querySelector('.adjust-count-btn[data-action="adjPlus"]');

        if (check) {
            check.addEventListener('change', () => syncAdjustCardState(card));
        }

        if (countInput) {
            countInput.addEventListener('input', () => {
                const numeric = parseInt(countInput.value, 10);
                const stockEl = card.querySelector('[data-stock-for]');
                const available = stockEl ? (parseInt(stockEl.textContent, 10) || 0) : 0;
                if (!numeric || numeric < 1) {
                    countInput.value = 1;
                } else if (available > 0 && numeric > available) {
                    countInput.value = available;
                }
            });
        }

        card.addEventListener('click', (e) => {
            const target = e.target;
            if (target.closest('button') || target.closest('input.adjust-card-count') || target.closest('input.adjust-card-check')) return;
            if (!check) return;
            if (check.disabled) return;
            check.checked = !check.checked;
            syncAdjustCardState(card);
        });

        const variant = card.dataset.variant;
        if (minusBtn && variant) {
            minusBtn.addEventListener('click', () => updateAdjustCardCount(variant, -1));
        }
        if (plusBtn && variant) {
            plusBtn.addEventListener('click', () => updateAdjustCardCount(variant, 1));
        }

        syncAdjustCardState(card);
    });

    initAdjustmentSourceSwitch();
    syncAdjustmentModeUI();
    loadAdjustmentCardStocks();
}

function loadAdjustmentCardStocks() {
    fetch('/get_statistics')
        .then(res => res.json())
        .then(data => {
            const netMap = {};
            (data.by_variant || []).forEach(item => {
                netMap[item.variant] = Math.max(0, parseInt(item.count, 10) || 0);
            });

            const wholesaleMap = {};
            (data.by_variant_wholesale || []).forEach(item => {
                wholesaleMap[item.variant] = Math.max(0, parseInt(item.count, 10) || 0);
            });

            document.querySelectorAll('#adjustmentsTab [data-stock-for]').forEach(el => {
                const variant = el.dataset.stockFor;
                const sourceMode = (el.dataset.source || 'tank').toLowerCase();
                const available = sourceMode === 'wholesale' ? (wholesaleMap[variant] || 0) : (netMap[variant] || 0);
                el.textContent = available;

                const card = el.closest('.adjust-variant-card');
                if (!card) return;
                const check = card.querySelector('.adjust-card-check');
                const countInput = card.querySelector('.adjust-card-count');

                if (available <= 0) {
                    if (check) check.checked = false;
                    if (countInput) {
                        countInput.value = 0;
                        countInput.disabled = true;
                    }
                } else {
                    if (countInput && (parseInt(countInput.value, 10) || 0) <= 0) {
                        countInput.value = 1;
                    }
                    if (countInput && parseInt(countInput.value, 10) > available) {
                        countInput.value = available;
                    }
                }

                syncAdjustCardState(card);
            });

            // Populate tank stock count summary
            const tankTotal = Object.values(netMap).reduce((s, v) => s + v, 0);
            const tankTotalEl = document.getElementById('tankStockTotal');
            if (tankTotalEl) tankTotalEl.textContent = tankTotal;
            ['Black', 'Platinum', 'Pineapple'].forEach(v => {
                const el = document.getElementById('tankStock' + v);
                if (el) el.textContent = netMap[v] || 0;
            });
        })
        .catch(() => {});
}

function loadInventory() {
    // Load inventory (additions-only) statistics first to show inventory summary
    fetch('/get_statistics')
        .then(res => res.json())
        .then(stats => {
            const variants = stats.by_variant_additions || [];
            const available = variants.filter(v => (v.count || 0) > 0).length;
            const variantsAvailableEl = document.getElementById('variantsAvailable');
            if (variantsAvailableEl) {
                variantsAvailableEl.textContent = `Variants available: ${available}`;
            }
            // set only the numeric total; the label is shown in the card
            const totalStockEl = document.getElementById('totalStock');
            if (totalStockEl) {
                totalStockEl.textContent = stats.additions_total || 0;
            }

            const per = document.getElementById('perVariantStock');
            if (!per) {
                return;
            }

            if (variants.length === 0) {
                per.innerHTML = '';
            } else {
                // render as chips for a cleaner look
                per.innerHTML = variants.map(v => {
                    const name = (v.variant || 'Unknown');
                    const count = v.count || 0;
                    return `<span class="variant-chip">${name} <strong>${count}</strong></span>`;
                }).join('');
            }
        })
        .catch(() => {
            const variantsAvailableEl = document.getElementById('variantsAvailable');
            if (variantsAvailableEl) {
                variantsAvailableEl.textContent = 'Variants available: ?';
            }

            const totalStockEl = document.getElementById('totalStock');
            if (totalStockEl) {
                totalStockEl.textContent = '?';
            }
        })
        .finally(() => {
            // Use paginated filterInventory instead of raw fetch
            filterInventory();
        });
}

function filterInventory(resetPage) {
    if (resetPage) inventoryPage = 1;
    // Get filter values
    const variant = document.getElementById("inventoryVariantFilter")?.value || "";
    const startDate = document.getElementById("inventoryStartDate")?.value || "";
    const endDate = document.getElementById("inventoryEndDate")?.value || "";
    
    // Build query parameters
    let url = "/get_inventory";
    const params = [];
    params.push(`page=${inventoryPage}`);
    params.push(`per_page=${inventoryPerPage}`);
    if (variant) params.push(`variant=${encodeURIComponent(variant)}`);
    if (startDate) params.push(`start_date=${encodeURIComponent(startDate)}`);
    if (endDate) params.push(`end_date=${encodeURIComponent(endDate)}`);
    if (params.length > 0) url += "?" + params.join("&");
    
    fetch(url)
        .then(res => res.json())
        .then(data => {
            const inventoryList = document.getElementById("inventoryList");
            const items = data.items || data;
            inventoryTotalPages = data.pages || 1;
            const totalRecords = data.total || items.length;
            // show only additions in inventory tab
            const additions = Array.isArray(items) ? items.filter(item => item.action === 'IN') : [];
            if (additions.length === 0) {
                inventoryList.innerHTML = "<p>No records match the filters</p>";
                renderInventoryPagination(totalRecords);
                return;
            }

            inventoryList.innerHTML = additions.map(item => `
                <div class="inventory-item">
                    <div class="inventory-info">
                        <strong>${item.count} ${item.variant} fish</strong>
                        <p>Date: ${item.date}</p>
                        ${item.notes ? `<p>Notes: ${item.notes}</p>` : ''}
                    </div>
                    <button class="delete-btn" data-action="deleteInventory" data-id="${item.id}" aria-label="Archive record" title="Archive">
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 7H21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                            <path d="M6 7V19C6 20.1046 6.89543 21 8 21H16C17.1046 21 18 20.1046 18 19V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M9 4H15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                            <path d="M12 10V15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                            <path d="M10 13L12 15L14 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            `).join('');
            renderInventoryPagination(totalRecords);
        })
        .catch(err => {
            document.getElementById("inventoryList").innerHTML = "<p>Error loading inventory</p>";
        });
}

function renderInventoryPagination(totalRecords) {
    let container = document.getElementById('inventoryPagination');
    if (!container) {
        const list = document.getElementById('inventoryList');
        if (!list) return;
        container = document.createElement('div');
        container.id = 'inventoryPagination';
        container.className = 'pagination-bar';
        list.parentNode.insertBefore(container, list.nextSibling);
    }
    if (inventoryTotalPages <= 1) { container.innerHTML = ''; return; }
    container.innerHTML = buildPaginationHTML(inventoryPage, inventoryTotalPages, totalRecords, 'goInventoryPage');
}

function goInventoryPage(p) {
    if (p < 1 || p > inventoryTotalPages) return;
    inventoryPage = p;
    filterInventory();
}

function changeInventoryPerPage(value) {
    inventoryPerPage = parseInt(value, 10) || 20;
    inventoryPage = 1;
    filterInventory();
}

function buildPaginationHTML(currentPage, totalPages, totalRecords, goFnName) {
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);

    let html = '<div class="pagination-controls">';
    html += `<span class="pagination-info">${totalRecords} records</span>`;
    html += `<button class="pagination-btn" ${currentPage <= 1 ? 'disabled' : ''} data-action="${goFnName}" data-page="${currentPage - 1}">&lsaquo; Prev</button>`;
    for (let i = start; i <= end; i++) {
        html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-action="${goFnName}" data-page="${i}">${i}</button>`;
    }
    html += `<button class="pagination-btn" ${currentPage >= totalPages ? 'disabled' : ''} data-action="${goFnName}" data-page="${currentPage + 1}">Next &rsaquo;</button>`;
    html += '</div>';
    return html;
}

function loadInventoryYears() {
    // No-op: year dropdowns replaced by date range inputs
}

function clearInventoryFilters() {
    const variant = document.getElementById('inventoryVariantFilter');
    const startDate = document.getElementById('inventoryStartDate');
    const endDate = document.getElementById('inventoryEndDate');
    if (variant) variant.value = '';
    inventoryPage = 1;
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    filterInventory();
}

function deleteInventory(id) {
    showConfirmDialog({
        title: 'Archive Record',
        message: 'Archive this record?',
        confirmText: 'Archive',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
        onConfirm: function() {
            fetch(`/delete_inventory/${id}`, {
                method: "DELETE"
            })
            .then(res => res.json())
            .then(data => {
                alert(data.message);
                loadInventory();
                loadDashboard();
                if (typeof loadAdjustments === 'function') loadAdjustments();
                if (typeof loadArchive === 'function') loadArchive();
            })
            .catch(err => alert("Error archiving record"));
        }
    });
}

function clearAllInventory() {
    showConfirmDialog({
        title: 'Clear Inventory',
        message: 'Are you sure? This will delete ALL inventory records.',
        confirmText: 'Delete All',
        cancelText: 'Cancel',
        onConfirm: function() {
            fetch("/clear_inventory", {
                method: "POST"
            })
            .then(res => res.json())
            .then(data => {
                alert(data.message);
                loadInventory();
                loadDashboard();
                if (typeof loadArchive === 'function') loadArchive();
            })
            .catch(err => alert("Error clearing inventory"));
        }
    });
}
function loadArchive() {
    filterArchive();
    loadArchiveYears();
}

function toggleArchive() {
    const archiveSection = document.getElementById("archiveSection");
    const archiveBtn = document.querySelector(".archive-toggle-btn");
    
    if (archiveSection.style.display === "none" || archiveSection.style.display === "") {
        archiveSection.style.display = "block";
        archiveBtn.classList.add("active");
        loadArchive();
    } else {
        archiveSection.style.display = "none";
        archiveBtn.classList.remove("active");
    }
}

function filterArchive() {
    // Get filter values
    const variant = document.getElementById("archiveVariantFilter")?.value || "";
    const startDate = document.getElementById("archiveStartDate")?.value || "";
    const endDate = document.getElementById("archiveEndDate")?.value || "";
    
    // Build query parameters
    let url = "/get_deleted_records";
    const params = [];
    if (variant) params.push(`variant=${encodeURIComponent(variant)}`);
    if (startDate) params.push(`start_date=${encodeURIComponent(startDate)}`);
    if (endDate) params.push(`end_date=${encodeURIComponent(endDate)}`);
    if (params.length > 0) url += "?" + params.join("&");
    
    fetch(url)
        .then(res => res.json())
        .then(data => {
            const archiveList = document.getElementById("archiveList");
            if (data.length === 0) {
                archiveList.innerHTML = "<p>No deleted records match the filters</p>";
                return;
            }

            archiveList.innerHTML = data.map(item => `
                <div class="archive-item">
                    <div class="archive-info">
                        <strong>${item.count} ${item.variant} fish</strong>
                        <p>Date: ${item.date}</p>
                        <p>Action: <span class="action-badge action-${formatActionClass(item.action, item.count)}">${formatActionLabel(item.action, item.count)}</span></p>
                        ${item.notes ? `<p>Notes: ${item.notes}</p>` : ''}
                    </div>
                    <button class="restore-btn" data-action="restoreRecord" data-id="${item.id}">Restore</button>
                </div>
            `).join('');
        })
        .catch(err => {
            document.getElementById("archiveList").innerHTML = "<p>Error loading archive</p>";
        });
}

function loadArchiveYears() {
    // No-op: year dropdowns replaced by date range inputs
}

function clearArchiveFilters() {
    const variant = document.getElementById('archiveVariantFilter');
    const startDate = document.getElementById('archiveStartDate');
    const endDate = document.getElementById('archiveEndDate');
    if (variant) variant.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    filterArchive();
}

function restoreRecord(id) {
    showConfirmDialog({
        title: 'Restore Record',
        message: 'Restore this record?',
        confirmText: 'Restore',
        cancelText: 'Cancel',
        onConfirm: function() {
            fetch(`/restore_record/${id}`, {
                method: "POST"
            })
            .then(res => res.json())
            .then(data => {
                alert(data.message || "Record restored successfully");
                loadInventory();
                loadArchive();
                loadDashboard();
            })
            .catch(err => alert("Error restoring record"));
        }
    });
}

// Toggle visibility for the tank contents card and remember preference
function toggleTankContents() {
    const card = document.getElementById('tankContentsCard');
    if (!card) return;
    if (card.style.display === 'none' || card.classList.contains('collapsed')) {
        card.style.display = '';
        card.classList.remove('collapsed');
        try { localStorage.setItem('tankCollapsed', '0'); } catch (e) {}
    } else {
        card.style.display = 'none';
        card.classList.add('collapsed');
        try { localStorage.setItem('tankCollapsed', '1'); } catch (e) {}
    }
}

// Restore tank collapsed state on load
try {
    document.addEventListener('DOMContentLoaded', () => {
        const collapsed = (localStorage.getItem('tankCollapsed') || '0') === '1';
        if (collapsed) {
            const card = document.getElementById('tankContentsCard');
            if (card) {
                card.style.display = 'none';
                card.classList.add('collapsed');
            }
        }
        // Attach click handler to the Fish in Tank stat card to toggle tank contents
        try {
            const stat = document.getElementById('tankStatCard');
            if (stat) {
                stat.addEventListener('click', (e) => {
                    // ignore clicks on actionable elements inside the card
                    const target = e.target || e.srcElement;
                    if (target && (target.tagName === 'BUTTON' || target.closest && target.closest('button'))) return;
                    toggleTankContents();
                });
            }
        } catch (e) {}
    });
} catch (e) {}