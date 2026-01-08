// Web Worker for vanity address generation
// This runs in a separate thread for parallel processing

importScripts(
    'https://cdn.jsdelivr.net/npm/@solana/web3.js@latest/lib/index.iife.min.js',
    'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js'
);

let isRunning = false;
let attempts = 0;

// Listen for messages from main thread
self.onmessage = function (e) {
    const { action, config } = e.data;

    if (action === 'start') {
        isRunning = true;
        attempts = 0;
        generateAddress(config);
    } else if (action === 'stop') {
        isRunning = false;
    }
};

// Check if address matches pattern
function matchesPattern(address, pattern, position, caseSensitive) {
    const addr = caseSensitive ? address : address.toLowerCase();
    const pat = caseSensitive ? pattern : pattern.toLowerCase();

    if (position === 'prefix') {
        return addr.startsWith(pat);
    } else {
        return addr.endsWith(pat);
    }
}

// Generate Solana address
function generateSolanaAddress() {
    const keypair = solanaWeb3.Keypair.generate();
    const address = keypair.publicKey.toBase58();
    const privateKey = Buffer.from(keypair.secretKey).toString('hex');

    return { address, privateKey };
}

// Generate Ethereum address
function generateEthereumAddress() {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const privateKey = wallet.privateKey;
    const seedPhrase = wallet.mnemonic.phrase;

    return { address, privateKey, seedPhrase };
}

// Main generation loop
function generateAddress(config) {
    const BATCH_SIZE = 100; // Check every 100 attempts
    let batchAttempts = 0;

    function processBatch() {
        if (!isRunning) return;

        for (let i = 0; i < BATCH_SIZE; i++) {
            attempts++;
            batchAttempts++;

            // Generate address
            let result;
            if (config.chain === 'solana') {
                result = generateSolanaAddress();
            } else {
                result = generateEthereumAddress();
            }

            // Check match
            if (matchesPattern(result.address, config.pattern, config.position, config.caseSensitive)) {
                // Found match!
                self.postMessage({
                    type: 'found',
                    result: result,
                    attempts: attempts
                });
                isRunning = false;
                return;
            }
        }

        // Report incremental progress
        self.postMessage({
            type: 'progress',
            attempts: batchAttempts // Send batch count, not total
        });
        batchAttempts = 0; // Reset batch counter

        // Continue with next batch
        setTimeout(processBatch, 0);
    }

    processBatch();
}
