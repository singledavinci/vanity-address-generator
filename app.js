// Vanity Address Generator - Main Script with Web Workers

let workers = [];
let isGenerating = false;
let totalAttempts = 0;
let startTime = 0;
let updateInterval = null;
const NUM_WORKERS = navigator.hardwareConcurrency || 4; // Use all CPU cores

// Get form values
function getConfig() {
    return {
        chain: document.querySelector('input[name="chain"]:checked').value,
        position: document.querySelector('input[name="position"]:checked').value,
        pattern: document.getElementById('pattern').value.trim(),
        caseSensitive: document.getElementById('caseSensitive').checked
    };
}

// Validate pattern
function validatePattern(pattern, chain) {
    if (!pattern) {
        alert('Please enter a pattern');
        return false;
    }

    if (chain === 'solana') {
        const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
        if (!base58Regex.test(pattern)) {
            alert('Invalid Solana pattern! Use Base58 characters (no 0, O, I, l)');
            return false;
        }
    } else {
        const hexPattern = pattern.replace('0x', '');
        const hexRegex = /^[0-9a-fA-F]+$/;
        if (!hexRegex.test(hexPattern)) {
            alert('Invalid Ethereum pattern! Use hex characters (0-9, a-f)');
            return false;
        }
    }

    if (pattern.length > 5) {
        const confirmed = confirm(
            `Warning: ${pattern.length} character patterns can take a VERY long time. Continue?`
        );
        return confirmed;
    }

    return true;
}

// Inline worker code as string (to bypass file:// protocol restrictions)
const workerCode = `
importScripts(
    'https://cdn.jsdelivr.net/npm/@solana/web3.js@latest/lib/index.iife.min.js',
    'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js'
);

let isRunning = false;
let attempts = 0;

self.onmessage = function(e) {
    const { action, config } = e.data;
    if (action === 'start') {
        isRunning = true;
        attempts = 0;
        generateAddress(config);
    } else if (action === 'stop') {
        isRunning = false;
    }
};

function matchesPattern(address, pattern, position, caseSensitive) {
    const addr = caseSensitive ? address : address.toLowerCase();
    const pat = caseSensitive ? pattern : pattern.toLowerCase();
    return position === 'prefix' ? addr.startsWith(pat) : addr.endsWith(pat);
}

function generateSolanaAddress() {
    const keypair = solanaWeb3.Keypair.generate();
    // Convert Uint8Array to hex without Buffer (not available in workers)
    const hexString = Array.from(keypair.secretKey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return {
        address: keypair.publicKey.toBase58(),
        privateKey: hexString
    };
}

function generateEthereumAddress() {
    const wallet = ethers.Wallet.createRandom();
    return {
        address: wallet.address,
        privateKey: wallet.privateKey,
        seedPhrase: wallet.mnemonic.phrase
    };
}

function generateAddress(config) {
    const BATCH_SIZE = 100;
    let batchAttempts = 0;
    
    function processBatch() {
        if (!isRunning) return;
        
        for (let i = 0; i < BATCH_SIZE; i++) {
            attempts++;
            batchAttempts++;
            
            const result = config.chain === 'solana' 
                ? generateSolanaAddress() 
                : generateEthereumAddress();
            
            if (matchesPattern(result.address, config.pattern, config.position, config.caseSensitive)) {
                self.postMessage({ type: 'found', result, attempts });
                isRunning = false;
                return;
            }
        }
        
        self.postMessage({ type: 'progress', attempts: batchAttempts });
        batchAttempts = 0;
        setTimeout(processBatch, 0);
    }
    
    processBatch();
}
`;

// Create workers using Blob URL
function createWorkers(config) {
    workers = [];
    totalAttempts = 0;

    console.log(`Creating ${NUM_WORKERS} inline workers...`);

    // Create blob URL from worker code
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);

    for (let i = 0; i < NUM_WORKERS; i++) {
        const worker = new Worker(workerUrl);

        worker.onmessage = function (e) {
            if (e.data.type === 'found') {
                console.log('Match found!', e.data.result);
                stopGeneration();
                displayResult(e.data.result, config.chain);
            } else if (e.data.type === 'progress') {
                totalAttempts += e.data.attempts;
            }
        };

        worker.onerror = function (error) {
            console.error('Worker error:', error);
        };

        workers.push(worker);
    }

    console.log(`${NUM_WORKERS} workers created successfully`);
}

// Start generation
function startGeneration() {
    const config = getConfig();

    if (!validatePattern(config.pattern, config.chain)) {
        return;
    }

    // Reset
    totalAttempts = 0;
    startTime = Date.now();
    isGenerating = true;

    // Update UI
    document.getElementById('generateBtn').disabled = true;
    document.getElementById('progressSection').classList.add('active');
    document.getElementById('resultSection').classList.remove('active');
    document.getElementById('workers').textContent = NUM_WORKERS;

    // Create workers
    createWorkers(config);

    // Start all workers
    workers.forEach(worker => {
        worker.postMessage({ action: 'start', config: config });
    });

    // Start progress updates
    let lastAttempts = 0;
    updateInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const speed = elapsed > 0 ? Math.floor(totalAttempts / elapsed) : 0;

        document.getElementById('attempts').textContent = totalAttempts.toLocaleString();
        document.getElementById('speed').textContent = speed.toLocaleString() + '/s';
        document.getElementById('elapsed').textContent = elapsed + 's';

        lastAttempts = totalAttempts;
    }, 100);
}

// Stop generation
function stopGeneration() {
    isGenerating = false;

    // Stop all workers
    workers.forEach(worker => {
        worker.postMessage({ action: 'stop' });
        worker.terminate();
    });
    workers = [];

    clearInterval(updateInterval);
    document.getElementById('generateBtn').disabled = false;
    document.getElementById('progressSection').classList.remove('active');
}

// Update progress display
function updateProgress() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const speed = elapsed > 0 ? Math.floor(attempts / elapsed) : 0;

    document.getElementById('attempts').textContent = attempts.toLocaleString();
    document.getElementById('speed').textContent = speed.toLocaleString() + '/s';
    document.getElementById('elapsed').textContent = elapsed + 's';
}

// Display result
function displayResult(result, chain) {
    document.getElementById('resultAddress').textContent = result.address;
    document.getElementById('resultPrivateKey').textContent = result.privateKey;

    // Show seed phrase for Ethereum
    if (chain === 'ethereum' && result.seedPhrase) {
        document.getElementById('resultSeedPhrase').textContent = result.seedPhrase;
        document.getElementById('seedPhraseSection').style.display = 'block';
    } else {
        document.getElementById('seedPhraseSection').style.display = 'none';
    }

    document.getElementById('resultSection').classList.add('active');
}

// Copy to clipboard
function copyToClipboard(elementId) {
    const text = document.getElementById(elementId).textContent;
    navigator.clipboard.writeText(text).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
}

// Reset
function resetGeneration() {
    document.getElementById('resultSection').classList.remove('active');
    document.getElementById('pattern').value = '';
    attempts = 0;
}

// Initialize
console.log('🔑 Vanity Address Generator loaded');
console.log('Solana Web3.js:', typeof solanaWeb3 !== 'undefined' ? '✓' : '✗');
console.log('Ethers.js:', typeof ethers !== 'undefined' ? '✓' : '✗');
