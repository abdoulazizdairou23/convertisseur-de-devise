// ================================================
// script.js - Convertisseur de devises + Crypto
// Fonctionnalités : Conversion multiple, Mode hors ligne (IndexedDB)
// ================================================

// Sélection des éléments
const fromCurrency = document.getElementById("fromCurrency");
const toCurrency = document.getElementById("toCurrency");
const amount = document.getElementById("amount");
const result = document.getElementById("result");
const rateDiv = document.getElementById("rate");
const convertBtn = document.getElementById("convertBtn");
const quickInput = document.getElementById("quickInput");
const quickBtn = document.getElementById("quickBtn");
const swapBtn = document.getElementById("swapBtn");
const cryptoToggle = document.getElementById("cryptoToggle");
const offlineModeToggle = document.getElementById("offlineModeToggle");
const offlineStatusBtn = document.getElementById("offlineStatusBtn");
const lastUpdateInfo = document.getElementById("lastUpdateInfo");
const themeOptions = document.querySelectorAll(".theme-option");
const chartPeriods = document.querySelectorAll(".chart-period");
const addMultiCurrencyBtn = document.getElementById("addMultiCurrencyBtn");
const multiCurrencyList = document.getElementById("multiCurrencyList");

let myChart = null;
let conversionTimeout = null;
let rateCache = new Map();
let currentPeriod = 180;
let cryptoEnabled = false;
let offlineMode = false;
let db = null;
let savedRates = null;

// Configuration
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Devises
const FIAT_CURRENCIES = [
    "XAF", "XOF", "EUR", "USD", "GBP", "CAD", 
    "JPY", "CNY", "INR", "KRW", "THB", "VND", 
    "IDR", "MYR", "SGD", "PHP", "HKD", "TWD", 
    "NGN", "GHS", "CHF", "AUD", "NZD", "ZAR"
];

const CRYPTO_CURRENCIES = [
    "BTC", "ETH", "USDT", "BNB", "XRP", "ADA", 
    "SOL", "DOGE", "DOT", "MATIC", "SHIB", "LTC"
];

const CRYPTO_SYMBOLS = {
    BTC: "₿", ETH: "Ξ", USDT: "₮", BNB: "BNB",
    XRP: "XRP", ADA: "ADA", SOL: "◎", DOGE: "Ð",
    DOT: "DOT", MATIC: "MATIC", SHIB: "SHIB", LTC: "Ł"
};

// ========== CONVERSION MULTIPLE ==========
let multiCurrencies = [];

function addMultiCurrency(currencyCode = null) {
    const currencies = cryptoEnabled ? [...FIAT_CURRENCIES, ...CRYPTO_CURRENCIES] : FIAT_CURRENCIES;
    const defaultCurrency = currencyCode || (cryptoEnabled ? "BTC" : "EUR");
    
    multiCurrencies.push({
        id: Date.now() + Math.random(),
        currency: defaultCurrency
    });
    renderMultiCurrencyList();
}

function removeMultiCurrency(id) {
    multiCurrencies = multiCurrencies.filter(c => c.id !== id);
    renderMultiCurrencyList();
}

async function updateMultiConversion() {
    const amt = parseFloat(amount.value);
    if (!amt || amt <= 0 || multiCurrencies.length === 0) return;
    
    const from = fromCurrency.value;
    
    for (const item of multiCurrencies) {
        const resultSpan = document.querySelector(`.multi-result[data-id="${item.id}"]`);
        const selectEl = document.querySelector(`.multi-select[data-id="${item.id}"]`);
        
        if (resultSpan && selectEl) {
            const to = selectEl.value;
            try {
                const rate = await getRate(from, to);
                const converted = (amt * rate).toFixed(2);
                const toSymbol = CRYPTO_SYMBOLS[to] || to;
                resultSpan.textContent = `${converted} ${toSymbol}`;
            } catch (error) {
                resultSpan.textContent = "Erreur";
            }
        }
    }
}

function renderMultiCurrencyList() {
    if (!multiCurrencyList) return;
    
    if (multiCurrencies.length === 0) {
        multiCurrencyList.innerHTML = '<div class="empty-multi" style="padding: 10px; text-align: center; color: #888;">✨ Cliquez sur "Ajouter" pour convertir plusieurs devises</div>';
        return;
    }
    
    const currencies = cryptoEnabled ? [...FIAT_CURRENCIES, ...CRYPTO_CURRENCIES] : FIAT_CURRENCIES;
    
    multiCurrencyList.innerHTML = multiCurrencies.map(item => `
        <div class="multi-item">
            <select class="multi-select" data-id="${item.id}">
                ${currencies.map(c => `
                    <option value="${c}" ${item.currency === c ? 'selected' : ''}>
                        ${CRYPTO_SYMBOLS[c] ? CRYPTO_SYMBOLS[c] + ' ' : ''}${c}
                    </option>
                `).join('')}
            </select>
            <span class="multi-result" data-id="${item.id}">--</span>
            <button class="remove-btn" data-id="${item.id}">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
    
    // Attacher les événements
    document.querySelectorAll('.multi-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const id = parseFloat(e.target.dataset.id);
            const currency = e.target.value;
            const item = multiCurrencies.find(c => c.id === id);
            if (item) item.currency = currency;
            updateMultiConversion();
        });
    });
    
    document.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseFloat(e.target.closest('.remove-btn').dataset.id);
            removeMultiCurrency(id);
        });
    });
    
    updateMultiConversion();
}

// ========== INDEXEDDB POUR MODE HORS LIGNE ==========
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("CurrencyConverterDB", 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("rates")) {
                db.createObjectStore("rates", { keyPath: "id" });
            }
        };
    });
}

async function saveRatesToDB(rates, baseCurrency) {
    if (!db) return;
    try {
        const transaction = db.transaction(["rates"], "readwrite");
        const store = transaction.objectStore("rates");
        const data = {
            id: "latest_rates",
            base: baseCurrency,
            rates: rates,
            timestamp: Date.now()
        };
        await store.put(data);
        console.log("✅ Taux sauvegardés en local");
    } catch (error) {
        console.error("Erreur sauvegarde:", error);
    }
}

async function loadRatesFromDB() {
    if (!db) return null;
    try {
        const transaction = db.transaction(["rates"], "readonly");
        const store = transaction.objectStore("rates");
        const data = await store.get("latest_rates");
        
        if (data && (Date.now() - data.timestamp) < CACHE_DURATION) {
            console.log("📦 Taux chargés depuis IndexedDB");
            return data;
        }
        return null;
    } catch (error) {
        console.error("Erreur chargement:", error);
        return null;
    }
}

// ========== GESTION DU MODE HORS LIGNE ==========
function updateOfflineStatus() {
    if (offlineMode) {
        if (offlineStatusBtn) {
            offlineStatusBtn.innerHTML = '<i class="fas fa-database"></i>';
            offlineStatusBtn.classList.add("offline");
            offlineStatusBtn.classList.remove("online");
            offlineStatusBtn.title = "Mode hors ligne actif";
        }
        if (lastUpdateInfo) lastUpdateInfo.textContent = "📴 Mode hors ligne";
    } else {
        if (offlineStatusBtn) {
            offlineStatusBtn.innerHTML = '<i class="fas fa-wifi"></i>';
            offlineStatusBtn.classList.add("online");
            offlineStatusBtn.classList.remove("offline");
            offlineStatusBtn.title = "Mode en ligne";
        }
        const lastUpdate = localStorage.getItem('lastOnlineUpdate');
        if (lastUpdate && lastUpdateInfo) {
            const date = new Date(parseInt(lastUpdate));
            lastUpdateInfo.textContent = `🕐 Dernière mise à jour: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        }
    }
}

async function refreshRatesForOffline() {
    try {
        const from = fromCurrency.value;
        const url = `https://open.er-api.com/v6/latest/${from}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.result === "success") {
            await saveRatesToDB(data.rates, from);
            savedRates = data.rates;
            localStorage.setItem('lastOnlineUpdate', Date.now().toString());
            updateOfflineStatus();
            console.log("✅ Taux mis à jour pour le mode hors ligne");
        }
    } catch (error) {
        console.log("⚠️ Impossible de mettre à jour les taux (hors ligne)");
    }
}

// ========== CONVERSION ==========
async function getRateOffline(from, to) {
    if (!savedRates) {
        const cached = await loadRatesFromDB();
        if (cached) {
            savedRates = cached.rates;
        }
    }
    
    if (savedRates && savedRates[to]) {
        return savedRates[to];
    }
    return null;
}

async function getFiatRate(from, to) {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.result === "success" && data.rates && data.rates[to]) {
        return data.rates[to];
    }
    throw new Error("Taux non disponible");
}

async function getCryptoRate(from, to) {
    if (CRYPTO_CURRENCIES.includes(from) && CRYPTO_CURRENCIES.includes(to)) {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${from.toLowerCase()},${to.toLowerCase()}&vs_currencies=usd`;
        const res = await fetch(url);
        const data = await res.json();
        const rateFrom = data[from.toLowerCase()]?.usd;
        const rateTo = data[to.toLowerCase()]?.usd;
        if (rateFrom && rateTo) return rateFrom / rateTo;
    } else if (CRYPTO_CURRENCIES.includes(from)) {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${from.toLowerCase()}&vs_currencies=${to.toLowerCase()}`;
        const res = await fetch(url);
        const data = await res.json();
        const rate = data[from.toLowerCase()]?.[to.toLowerCase()];
        if (rate) return rate;
    } else if (CRYPTO_CURRENCIES.includes(to)) {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${to.toLowerCase()}&vs_currencies=${from.toLowerCase()}`;
        const res = await fetch(url);
        const data = await res.json();
        const rate = data[to.toLowerCase()]?.[from.toLowerCase()];
        if (rate) return 1 / rate;
    }
    throw new Error("Taux crypto non disponible");
}

async function getRate(from, to) {
    // Mode hors ligne : utiliser les taux sauvegardés
    if (offlineMode) {
        const rate = await getRateOffline(from, to);
        if (rate !== null) {
            return rate;
        }
        throw new Error("Mode hors ligne : taux non disponibles");
    }
    
    // Mode normal avec cache
    const cacheKey = `${from}_${to}`;
    const cached = rateCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
        return cached.rate;
    }
    
    const isFromCrypto = CRYPTO_CURRENCIES.includes(from);
    const isToCrypto = CRYPTO_CURRENCIES.includes(to);
    
    let rate;
    if (isFromCrypto || isToCrypto) {
        rate = await getCryptoRate(from, to);
    } else {
        rate = await getFiatRate(from, to);
    }
    
    rateCache.set(cacheKey, { rate, timestamp: now });
    
    // Sauvegarder pour le mode hors ligne
    setTimeout(() => refreshRatesForOffline(), 1000);
    
    return rate;
}

async function convertCurrency(showLoading = true) {
    if (!amount.value || parseFloat(amount.value) <= 0) {
        showError("Veuillez entrer un montant valide (> 0)");
        return false;
    }
    
    const amt = parseFloat(amount.value);
    if (isNaN(amt)) {
        showError("Montant invalide");
        return false;
    }
    
    if (showLoading) {
        result.textContent = "Conversion en cours...";
        result.style.color = "";
    }
    
    try {
        const from = fromCurrency.value;
        const to = toCurrency.value;
        
        localStorage.setItem('lastFromCurrency', from);
        localStorage.setItem('lastToCurrency', to);
        localStorage.setItem('lastAmount', amt.toString());
        
        const rate = await getRate(from, to);
        const converted = (amt * rate).toFixed(2);
        const fromSymbol = CRYPTO_SYMBOLS[from] || from;
        const toSymbol = CRYPTO_SYMBOLS[to] || to;
        
        rateDiv.textContent = `Taux : 1 ${fromSymbol} = ${rate.toFixed(6)} ${toSymbol}`;
        showSuccess(`${amt.toLocaleString('fr-CM')} ${fromSymbol} = ${converted} ${toSymbol}`);
        
        // Mettre à jour la conversion multiple
        updateMultiConversion();
        updateChart();
        
        return true;
        
    } catch (error) {
        console.error("Erreur conversion :", error);
        showError(`Conversion impossible. ${offlineMode ? "Mode hors ligne : taux non disponibles" : "Vérifiez votre connexion."}`);
        return false;
    }
}

// ========== GRAPHIQUE ==========
async function updateChart() {
    const ctx = document.getElementById('chart');
    if (!ctx) return;
    
    if (!myChart) {
        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: `Taux de change`,
                    data: [],
                    borderColor: '#4facfe',
                    backgroundColor: 'rgba(79, 172, 254, 0.1)',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { mode: 'index', intersect: false }
                }
            }
        });
    }
    
    try {
        const from = fromCurrency.value;
        const to = toCurrency.value;
        
        // Données simulées pour le graphique (évite les erreurs API)
        const dates = [];
        const rates = [];
        const today = new Date();
        
        for (let i = currentPeriod; i >= 0; i--) {
            const date = new Date();
            date.setDate(today.getDate() - i);
            dates.push(date.toLocaleDateString());
            // Taux simulé avec variation
            const baseRate = await getRate(from, to);
            const variation = 1 + (Math.sin(i / 5) * 0.02);
            rates.push(baseRate * variation);
        }
        
        myChart.data.labels = dates;
        myChart.data.datasets[0].data = rates;
        myChart.data.datasets[0].label = `${from} → ${to}`;
        myChart.update();
        
    } catch (error) {
        console.error("Erreur graphique:", error);
    }
}

// ========== CHARGEMENT DES DEVISES ==========
async function loadCurrencies() {
    const currencies = cryptoEnabled ? [...FIAT_CURRENCIES, ...CRYPTO_CURRENCIES] : FIAT_CURRENCIES;
    
    fromCurrency.innerHTML = "";
    toCurrency.innerHTML = "";
    
    currencies.forEach(code => {
        const opt = document.createElement("option");
        opt.value = code;
        const displayName = CRYPTO_SYMBOLS[code] ? `${CRYPTO_SYMBOLS[code]} ${code}` : code;
        opt.textContent = displayName;
        fromCurrency.appendChild(opt.cloneNode(true));
        toCurrency.appendChild(opt.cloneNode(true));
    });
    
    const lastFrom = localStorage.getItem('lastFromCurrency');
    const lastTo = localStorage.getItem('lastToCurrency');
    const lastAmount = localStorage.getItem('lastAmount');
    
    if (lastFrom && currencies.includes(lastFrom)) fromCurrency.value = lastFrom;
    else fromCurrency.value = cryptoEnabled ? "BTC" : "XAF";
    
    if (lastTo && currencies.includes(lastTo)) toCurrency.value = lastTo;
    else toCurrency.value = "EUR";
    
    if (lastAmount && !isNaN(lastAmount) && lastAmount > 0) amount.value = lastAmount;
}

// ========== THÈMES ==========
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
}

function setTheme(theme) {
    document.body.classList.remove('theme-light', 'theme-dark', 'theme-blue', 'theme-purple', 'theme-green');
    document.body.classList.add(`theme-${theme}`);
    
    themeOptions.forEach(opt => {
        if (opt.dataset.theme === theme) {
            opt.classList.add('active');
        } else {
            opt.classList.remove('active');
        }
    });
    
    localStorage.setItem('theme', theme);
}

// ========== UTILITAIRES ==========
function showError(message) {
    result.textContent = message;
    result.style.color = "#ff5252";
    rateDiv.textContent = "";
}

function showSuccess(message) {
    result.textContent = message;
    result.style.color = "#2e7d32";
}

function debouncedConvert() {
    if (conversionTimeout) clearTimeout(conversionTimeout);
    conversionTimeout = setTimeout(() => {
        if (amount.value && parseFloat(amount.value) > 0) convertCurrency(true);
    }, 500);
}

// ========== ÉVÉNEMENTS ==========
if (convertBtn) convertBtn.addEventListener("click", () => convertCurrency(true));

if (swapBtn) {
    swapBtn.addEventListener("click", () => {
        const temp = fromCurrency.value;
        fromCurrency.value = toCurrency.value;
        toCurrency.value = temp;
        convertCurrency(true);
    });
}

if (cryptoToggle) {
    cryptoToggle.addEventListener("change", (e) => {
        cryptoEnabled = e.target.checked;
        loadCurrencies().then(() => {
            if (amount.value && parseFloat(amount.value) > 0) convertCurrency(true);
            renderMultiCurrencyList();
        });
    });
}

if (offlineModeToggle) {
    offlineModeToggle.addEventListener("change", (e) => {
        offlineMode = e.target.checked;
        updateOfflineStatus();
        if (amount.value && parseFloat(amount.value) > 0) convertCurrency(true);
    });
}

if (quickBtn) {
    quickBtn.addEventListener("click", () => {
        const parts = quickInput.value.trim().toUpperCase().split(/\s+/);
        if (parts.length === 3) {
            const amountValue = parseFloat(parts[2]);
            if (!isNaN(amountValue) && amountValue > 0) {
                fromCurrency.value = parts[0];
                toCurrency.value = parts[1];
                amount.value = amountValue;
                convertCurrency(true);
            } else {
                showError("Montant invalide");
            }
        } else {
            showError("Format: XAF EUR 10000");
        }
    });
}

if (addMultiCurrencyBtn) {
    addMultiCurrencyBtn.addEventListener("click", () => addMultiCurrency());
}

if (amount) amount.addEventListener("input", debouncedConvert);

[fromCurrency, toCurrency].forEach(el => {
    if (el) {
        el.addEventListener("change", () => {
            if (amount.value && parseFloat(amount.value) > 0) convertCurrency(true);
            updateChart();
            updateMultiConversion();
        });
    }
});

if (chartPeriods.length) {
    chartPeriods.forEach(btn => {
        btn.addEventListener("click", () => {
            chartPeriods.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentPeriod = parseInt(btn.dataset.period);
            updateChart();
        });
    });
}

themeOptions.forEach(opt => {
    opt.addEventListener('click', () => setTheme(opt.dataset.theme));
});

// ========== INITIALISATION ==========
async function init() {
    await initDB();
    initTheme();
    await loadCurrencies();
    
    if (amount.value && parseFloat(amount.value) > 0) {
        setTimeout(() => convertCurrency(true), 500);
    }
    
    updateChart();
    updateOfflineStatus();
    
    // Ajouter quelques devises par défaut pour la conversion multiple
    setTimeout(() => {
        addMultiCurrency("EUR");
        addMultiCurrency("USD");
    }, 1000);
}

init();
