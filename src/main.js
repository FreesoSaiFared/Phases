/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { runDiagnosticsMatrix } from './capabilities.js';
import { CatalogManager } from './storage.js';

// Global singletons for runtime evaluation
let catalog = null;
let activeWorker = null;
const consoleLogs = [];

// App boot coordinates
async function initializeDiagnostics() {
  const rootElement = document.getElementById('root');
  if (!rootElement) return;

  // Render loading stage
  rootElement.innerHTML = `
    <div class="min-h-screen bg-[#0F1115] text-[#E0E2E6] font-sans flex flex-col items-center justify-center p-6 selection:bg-[#34D399]/20">
      <div class="w-full max-w-4xl text-center space-y-4">
        <div class="inline-flex relative items-center justify-center">
          <div class="w-16 h-16 border-4 border-[#2A2D35] border-t-[#34D399] rounded-full animate-spin"></div>
          <div class="absolute text-[#34D399] font-mono text-xs font-bold leading-none select-none">SUB</div>
        </div>
        <div class="space-y-1">
          <h1 class="text-xl font-semibold tracking-tight text-white font-sans">Probing Sandbox Substrate</h1>
          <p class="text-xs font-mono text-gray-500">Querying client platform restrictions & experimental capabilities...</p>
        </div>
      </div>
    </div>
  `;

  // Measure start timing
  const t0 = performance.now();
  let results;
  let systemMeta = {};

  try {
    results = await runDiagnosticsMatrix();
  } catch (err) {
    results = { error: err };
  }

  const duration = (performance.now() - t0).toFixed(3);

  // General parameters
  systemMeta.userAgent = navigator.userAgent;
  systemMeta.secureContext = window.isSecureContext ? "YES (Secure Context)" : "NO (Insecure Context)";
  systemMeta.crossOriginIsolated = window.crossOriginIsolated ? "YES (Isolated Context)" : "NO (Non-Isolated Context)";
  systemMeta.hardwareConcurrency = navigator.hardwareConcurrency || "Unknown";
  systemMeta.devicePixelRatio = window.devicePixelRatio || 1;

  // Initialize CatalogManager
  logConsole('System', 'Initializing ' + (window.isSecureContext ? 'Secure' : 'Insecure') + ' Catalog DB transaction layer...');
  catalog = new CatalogManager();
  try {
    await catalog.init();
    logConsole('System', 'SubstrateCatalog IndexedDB store ready for stage checkpoints.');
  } catch (err) {
    logConsole('Error', `IndexedDB error: ${err.message}`);
  }

  // Quota preflight
  try {
    const quotaData = await catalog.checkQuotaBudget();
    systemMeta.quota = `${(quotaData.quotaBytes / (1024 * 1024 * 1024)).toFixed(2)} GB allocated`;
    systemMeta.quotaUsage = `${(quotaData.usageBytes / (1024 * 1024)).toFixed(2)} MB consumed`;
  } catch (err) {
    systemMeta.quota = "BLOCKED PYRAMID";
    systemMeta.quotaUsage = "BLOCKED PYRAMID";
  }

  // Boot Dedicated Compute Worker
  logConsole('System', 'Booting Dedicated Worker thread fallback loop...');
  try {
    activeWorker = await bootWorkerChain();
    logConsole('System', 'Dedicated worker instantiated successfully and waiting for payload arrays.');
  } catch (err) {
    logConsole('Error', `Worker critical: ${err.message}`);
  }

  // Count states
  let countSupported = 0;
  let countBlocked = 0;
  let countHeaderReq = 0;
  let countMissing = 0;
  let countRuntimeErr = 0;

  Object.values(results).forEach(item => {
    if (item.status === 'supported') countSupported++;
    else if (item.status === 'blocked-by-iframe-or-permission-policy') countBlocked++;
    else if (item.status === 'blocked-by-header-requirement') countHeaderReq++;
    else if (item.status === 'missing-api') countMissing++;
    else if (item.status === 'runtime-error') countRuntimeErr++;
  });

  // Compile visual grid
  rootElement.innerHTML = `
    <div class="min-h-screen bg-[#0F1115] text-[#E0E2E6] font-sans flex items-center justify-center p-4 md:p-6 selection:bg-[#34D399]/20">
      
      <!-- Workstation Workspace Frame -->
      <div class="main-container w-full max-w-7xl border border-[#2A2D35] bg-[#0A0C10] p-5 md:p-8 flex flex-col gap-6 relative shadow-[0_0_50px_rgba(0,0,0,0.8)]">
        
        <!-- Header Section -->
        <header class="border-b border-[#2A2D35] pb-6 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div class="space-y-1 flex-1">
            <div class="text-[10px] font-mono text-[#636975] uppercase tracking-widest leading-none">Substrate Initialization // Session ID: SEC-${Math.floor(Math.random() * 90) + 10}</div>
            <h1 class="text-2xl lg:text-3xl font-light tracking-[2px] uppercase text-white font-sans mt-1">Foundation Diagnostics</h1>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button id="retry-btn" class="cursor-pointer text-[10px] uppercase tracking-widest font-mono font-bold bg-[#1E2229] hover:bg-[#2A2D35] active:scale-95 text-[#A0AEC0] px-4 py-2 border border-[#2A2D35] transition-all">
              ⟳ Rerun Probes
            </button>
            <div class="px-3 py-1.5 bg-[#1E2229] border border-[#2A2D35] text-[#A0AEC0] text-[10px] font-mono font-bold tracking-wider uppercase">
              PHASE 2 STORAGE & WORKERS
            </div>
          </div>
        </header>

        <!-- Main Layout with Navigation aside -->
        <div class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          
          <!-- Static Directory Map & Worker controls Sidebar -->
          <aside class="w-full flex flex-col gap-6">
            
            <!-- Directory tree -->
            <div class="bg-[#12151B] border border-[#2A2D35] p-5">
              <div class="text-[10px] font-bold uppercase tracking-[1px] text-[#4F5666] mb-4">Directory Map</div>
              <div class="space-y-1 select-none">
                <div class="font-mono text-xs flex items-center gap-2 py-0.5 text-[#8C94A6]">
                  <span class="text-cyan-500">📁</span> root/
                </div>
                <div class="font-mono text-xs flex items-center gap-2 py-0.5 text-[#8C94A6] pl-5 border-l border-[#2A2D35]/60 relative before:content-[''] before:absolute before:left-0 before:top-[12px] before:w-2 before:h-[1px] before:bg-[#2A2D35]">
                  <span class="text-amber-500">📄</span> index.html
                </div>
                <div class="font-mono text-xs flex items-center gap-2 py-0.5 text-[#8C94A6] pl-5 border-l border-[#2A2D35]/60 relative before:content-[''] before:absolute before:left-0 before:top-[12px] before:w-2 before:h-[1px] before:bg-[#2A2D35]">
                  <span class="text-[#34D399]">📁</span> src/
                </div>
                <div class="font-mono text-xs flex items-center gap-3 py-0.5 text-[#8C94A6] pl-10 border-l border-[#2A2D35]/60 relative before:content-[''] before:absolute before:left-0 before:top-[12px] before:w-2 before:h-[1px] before:bg-[#2A2D35]">
                  <span class="text-[#34D399]">📄</span> capabilities.js
                </div>
                <div class="font-mono text-xs flex items-center gap-3 py-0.5 text-[#8C94A6] pl-10 border-l border-[#2A2D35]/60 relative before:content-[''] before:absolute before:left-0 before:top-[12px] before:w-2 before:h-[1px] before:bg-[#2A2D35]">
                  <span class="text-[#34D399]">📄</span> storage.js
                </div>
                <div class="font-mono text-xs flex items-center gap-3 py-0.5 text-[#8C94A6] pl-10 border-l border-[#2A2D35]/60 relative before:content-[''] before:absolute before:left-0 before:top-[12px] before:w-2 before:h-[1px] before:bg-[#2A2D35]">
                  <span class="text-[#34D399]">📄</span> worker.js
                </div>
                <div class="font-mono text-xs flex items-center gap-3 py-0.5 text-[#8C94A6] pl-10 border-l border-[#2A2D35]/60 relative before:content-[''] before:absolute before:left-0 before:top-[12px] before:w-2 before:h-[1px] before:bg-[#2A2D35]">
                  <span class="text-[#34D399]">📄</span> main.js
                </div>
                <div class="font-mono text-xs flex items-center gap-3 py-0.5 text-[#8C94A6] pl-10 border-l border-[#2A2D35]/60 relative before:content-[''] before:absolute before:left-0 before:top-[12px] before:w-2 before:h-[1px] before:bg-[#2A2D35]">
                  <span class="text-[#34D399]">📄</span> index.css
                </div>
                <div class="font-mono text-xs flex items-center gap-2 py-0.5 text-gray-500 pl-5 border-l border-[#2A2D35]/60 relative before:content-[''] before:absolute before:left-0 before:top-[12px] before:w-2 before:h-[1px] before:bg-[#2A2D35]">
                  <span class="text-gray-500">📄</span> package.json
                </div>
              </div>
            </div>

            <!-- OPFS Folder structure simulation -->
            <div class="bg-[#12151B] border border-[#2A2D35] p-5">
              <div class="text-[10px] font-bold uppercase tracking-[1px] text-[#4F5666] mb-3">OPFS Workspace Check</div>
              <div class="space-y-1">
                <div class="font-mono text-[10px] text-[#8C94A6] flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#34D399]"></span> IndexedDB Catalog OK
                </div>
                <div class="font-mono text-[10px] text-[#8C94A6] flex items-center gap-1.5 mt-2">
                  <span class="w-1.5 h-1.5 rounded-full ${activeWorker ? 'bg-[#34D399]' : 'bg-rose-500'}"></span>
                  Worker Thread: ${activeWorker ? 'CONNECTED' : 'FAILED'}
                </div>
                <button id="db-gc-btn" class="cursor-pointer text-[9px] w-full mt-4 py-2 border border-[#2A2D35] hover:border-rose-950 hover:bg-rose-950/20 font-mono text-gray-400 hover:text-rose-300 tracking-wider uppercase transition-all">
                  ☢ Clear DB & Chunks
                </button>
              </div>
            </div>

            <!-- Lock and state diagnostic -->
            <div class="bg-[#12151B] border border-[#2A2D35] p-5">
              <div class="text-[10px] font-bold uppercase tracking-[1px] text-[#4F5666] mb-3">Native Module Map</div>
              <pre class="font-mono text-[8px] text-[#34D399] bg-[#0A0C10] p-3 border border-[#2A2D35] overflow-x-auto select-text font-semibold">{
  "imports": {
    "capabilities": "./src/capabilities.js",
    "storage": "./src/storage.js",
    "main": "./src/main.js"
  }
}</pre>
            </div>
          </aside>

          <!-- Core Diagnostics and Phase 2 Execution Panels -->
          <div class="flex flex-col gap-6">
            
            <!-- Quick status headers -->
            <section class="grid grid-cols-2 md:grid-cols-4 gap-3 bg-[#0A0C10] border border-[#2A2D35] p-4 text-xs font-mono select-none">
              <div class="flex flex-col gap-1">
                <span class="text-[9px] text-[#636975] uppercase font-bold tracking-wider">Pass Ratio</span>
                <span id="pass-ratio-text" class="text-[#34D399] text-sm font-semibold">${countSupported} <span class="text-[11px] font-normal text-gray-600">/ 8</span></span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[9px] text-[#636975] uppercase font-bold tracking-wider">Sandbox Isolated</span>
                <span class="text-[#FBBF24] text-sm font-semibold">${countBlocked}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[9px] text-[#636975] uppercase font-bold tracking-wider">Probe Latencies</span>
                <span class="text-white text-sm font-semibold">${duration} ms</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[9px] text-[#636975] uppercase font-bold tracking-wider">Storage Limit</span>
                <span class="text-cyan-400 text-xs font-semibold leading-normal truncate" title="${systemMeta.quota}">${systemMeta.quota.includes('allocated') ? systemMeta.quota.split(' ')[0] + ' GB' : systemMeta.quota}</span>
              </div>
            </section>

            <!-- PHASE 2 INGESTION WORKSTATION DESIGN -->
            <section class="bg-[#12151B] border-2 border-[#34D399]/30 p-5 space-y-5 rounded-none shadow-[0_4px_30px_rgba(52,211,153,0.05)]">
              <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-[#2A2D35] pb-4 gap-3">
                <div class="space-y-0.5">
                  <span class="text-[#34D399] text-[9px] font-mono font-bold tracking-widest uppercase flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-[#34D399] animate-ping"></span>
                    Interactive Segment Compute Engine
                  </span>
                  <h2 class="text-white font-semibold text-base">Origin Private Storage Ingestion Console</h2>
                </div>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-2 text-xs font-mono text-[#636975] select-none cursor-pointer">
                    <input type="checkbox" id="quota-simulate-chk" class="accent-[#34D399]">
                    Simulate Low Quota (<50MB Margin)
                  </label>
                </div>
              </div>

              <!-- Content Payload form -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div class="space-y-3">
                  <div class="flex justify-between items-center text-[10px] uppercase font-semibold text-[#4F5666] font-mono select-none">
                    <span>Source Text Payload</span>
                    <span>Bytes: <span id="source-byte-counter">3100</span></span>
                  </div>
                  <textarea id="payload-content-txt" class="w-full h-36 bg-[#0A0C10] border border-[#2A2D35] p-3 font-mono text-xs text-[#E0E2E6] placeholder-gray-700 resize-none hover:border-[#4F5666] focus:border-[#34D399] focus:outline-none transition-all">{"metadata": {"source": "Chrome Canary Hardware Telemetry"}, "logRecord": "CPU_CYCLES=2.1e9, DISK_LEASES=ACTIVE, STAGE_MUTABLE_COORDINATES=0xFC2A1B, RUNTIME=Vanilla-Substrate", "systemPayload": "This is an experimental testing array segment generated dynamically to verify high-throughput multi-threaded writing inside Sandbox Origin Private Filesystem structures seamlessly. Every block will be digested strictly on high-performance cryptographic queues using the native SHA-256 Web Crypto API.", "signatureCode": "BENTO-CHOOSE-NATIVE-833"}</textarea>
                  <div class="flex gap-2">
                    <button id="trigger-ingest-btn" class="cursor-pointer flex-1 bg-[#34D399]/10 border border-[#34D399] hover:bg-[#34D399]/20 text-[#34D399] py-2 text-xs font-mono uppercase tracking-wider font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                      ⚡ Ingest & Commit Version
                    </button>
                    <button id="trigger-lock-conflict-btn" class="cursor-pointer bg-[#1E2229] border border-[#2A2D35] hover:border-[#34D399] text-gray-400 hover:text-white px-3 py-2 text-xs font-mono uppercase tracking-wider transition-all" title="Spawns dual concurrent tasks in background requesting execution loops under identical Lock IDs matching the current dataset keys. Tests active web lock queuing structures.">
                      ⚓ Conflict Test
                    </button>
                  </div>
                </div>

                <!-- Simulation Real-Time Terminal -->
                <div class="flex flex-col justify-between">
                  <div class="flex justify-between items-center border-b border-[#2A2D35] pb-2 mb-2 select-none">
                    <span class="text-[10px] font-bold uppercase tracking-[1px] text-[#4F5666] font-mono">Simulated Substrate Console</span>
                    <!-- Simulated status display -->
                    <span id="st-machine-status-lbl" class="px-2 py-0.5 font-mono text-[9px] font-bold text-gray-500 bg-[#1E2229] uppercase border border-[#2A2D35]">IDLE</span>
                  </div>
                  
                  <!-- Terminal screen itself -->
                  <div id="terminal-screen" class="bg-[#0A0C10] border border-[#2A2D35] flex-grow h-32 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed text-[#8C94A6] space-y-1 select-text">
                    <div class="text-[#636975]">// Subsystem ready. Submit staging job...</div>
                  </div>

                  <!-- Live Progress indicator -->
                  <div class="mt-3 flex items-center gap-3">
                    <div class="flex-grow bg-[#0A0C10] border border-[#2A2D35] h-2.5 rounded-none overflow-hidden relative">
                      <div id="st-progress-bar" class="bg-[#34D399] w-0 h-full transition-all duration-150"></div>
                    </div>
                    <span id="st-progress-percent" class="text-xs font-mono font-bold text-gray-500">0%</span>
                  </div>
                </div>
              </div>

              <!-- Commited Log history lists -->
              <div class="border-t border-[#2A2D35] pt-4 mt-2">
                <div class="text-[10px] font-bold uppercase tracking-[1px] text-[#4F5666] font-mono mb-3">Committed Datasets Catalog Store (Fetched from IndexedDB)</div>
                <div id="catalog-history-grid" class="space-y-3 max-h-48 overflow-y-auto pr-1">
                  <div class="text-center text-[#636975] py-4 text-xs font-mono">No datasets logged yet. Execute an ingestion sequence above.</div>
                </div>
              </div>
            </section>

            <!-- Capabilities grid details -->
            <div class="border-t border-[#2A2D35] pt-2">
              <div class="text-[10px] font-bold uppercase tracking-[1px] text-[#4F5666] font-mono mb-4">Underlying Diagnostic System Matricies</div>
              <main class="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <!-- WebGPU API -->
                ${renderCapabilityCard('WebGPU Core Rendering', results.webgpu, `
                  WebGPU allows low-level graphics processing and performance compute shaders on native GPU drivers.
                `)}

                <!-- OPFS Storage -->
                ${renderCapabilityCard('Origin Private File System (OPFS)', results.opfs, `
                  Private sandbox filesystem access permitting binary, fast parallel access handle operations inside high-speed worker threads.
                `)}

                <!-- Built-in On-Device AI -->
                ${renderCapabilityCard('Chrome Built-In Gemini LanguageModel', results.builtInAI, `
                  Experimental browser-native neural network invocation API (window.ai) hosting local Gemini models.
                `)}

                <!-- Web Locks API -->
                ${renderCapabilityCard('Web Locks API', results.webLocks, `
                  Asynchronous transactional concurrency resource lock engine preventing database and staged files race-conditions split.
                `)}

                <!-- Scheduler postTask API -->
                ${renderCapabilityCard('Scheduler postTask API', results.scheduler, `
                  Yields control loops to prevent main-thread jank when conducting heavy file operations.
                `)}

                <!-- Navigation API -->
                ${renderCapabilityCard('Navigation API', results.navigation, `
                  Modern programmatic client browser history integration replacing archaic hash-based routers.
                `)}

                <!-- View Transitions API -->
                ${renderCapabilityCard('View Transitions API', results.viewTransitions, `
                  Fluid visual layout transfers during state navigation routines with direct hardware acceleration.
                `)}

                <!-- CSS Anchor Positioning -->
                ${renderCapabilityCard('CSS Anchor Positioning', results.cssAnchor, `
                  Dynamic relative placement syntax to position elements absolute-bound relative to dynamic target coordinates directly via standard CSS.
                `)}

              </main>
            </div>
          </div>

        </div>

        <!-- Environmental Log Board -->
        <section class="bg-[#12151B] border border-[#2A2D35] p-4 space-y-3 font-mono text-xs">
          <div class="flex items-center gap-2 border-b border-[#2A2D35] pb-2 text-[10px] font-bold uppercase tracking-wider text-[#636975] select-none">
            <span class="w-1 h-1 bg-gray-500 rounded-full"></span>
            Hardware & Sandboxed Environment Logging
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-[#8C94A6]">
            <div class="flex justify-between border-b border-[#2A2D35]/30 pb-0.5">
              <span>Secure Context constraint:</span>
              <span class="text-white font-medium">${systemMeta.secureContext}</span>
            </div>
            <div class="flex justify-between border-[#2A2D35]/30 pb-0.5 border-b md:border-b">
              <span>Window Cross-Origin Isolation:</span>
              <span class="text-white font-medium">${systemMeta.crossOriginIsolated}</span>
            </div>
            <div class="flex justify-between border-b border-[#2A2D35]/30 pb-0.5">
              <span>Device Thread Concurrency:</span>
              <span class="text-white font-medium">${systemMeta.hardwareConcurrency} Cores</span>
            </div>
            <div class="flex justify-between border-b border-[#2A2D35]/30 pb-0.5">
              <span>Device Hardware Pixel Ratio:</span>
              <span class="text-white font-medium">${systemMeta.devicePixelRatio}x scale</span>
            </div>
            <div class="flex justify-between border-b border-[#2A2D35]/30 pb-0.5 col-span-1 md:col-span-2">
              <span>Client Sandbox Agent Identifier:</span>
              <span class="text-white truncate max-w-full text-right" title="${systemMeta.userAgent}">${systemMeta.userAgent}</span>
            </div>
          </div>
        </section>

        <!-- Dynamic Workstation Footer -->
        <footer class="footer mt-2 pt-4 border-t border-[#2A2D35] flex flex-col sm:flex-row justify-between items-center gap-3 font-mono text-[11px] text-[#4F5666] uppercase tracking-wider select-none">
          <div>System: AI Studio Sandbox // 4:3 Viewport Lock</div>
          <div>Diagnostics: ${countSupported} Validated Substrates // 0 Errors / ${countBlocked + countHeaderReq + countMissing + countRuntimeErr} Blocked Statuses</div>
        </footer>

      </div>
    </div>
  `;

  // Attach event click handlers and triggers
  document.getElementById('retry-btn')?.addEventListener('click', initializeDiagnostics);
  document.getElementById('db-gc-btn')?.addEventListener('click', clearDatabaseCatalog);
  document.getElementById('trigger-ingest-btn')?.addEventListener('click', startIngestionFlow);
  document.getElementById('trigger-lock-conflict-btn')?.addEventListener('click', runLockConcurrencyExperiment);

  // Monitor text counters
  const textInput = document.getElementById('payload-content-txt');
  if (textInput) {
    textInput.addEventListener('input', (e) => {
      const el = document.getElementById('source-byte-counter');
      if (el) el.innerText = new TextEncoder().encode(e.target.value).byteLength;
    });
    // Trigger first counting immediately
    const el = document.getElementById('source-byte-counter');
    if (el) el.innerText = new TextEncoder().encode(textInput.value).byteLength;
  }

  // Reload history catalog list from IndexedDB immediately
  await refreshCatalogLogDisplay();
}

/**
 * Fallback boot structure targeting Dedicated Compute Worker thread sequentially.
 */
async function bootWorkerChain() {
  const primaryModulePath = './src/worker.js';

  // 1. Module Worker (Standard External URI)
  try {
    const worker = new Worker(primaryModulePath, { type: 'module' });
    // Quick echo handshake trace
    return worker;
  } catch (err) {
    logConsole('System', 'External ES module Web Worker initialization fails. Trying Blob URL compile fallback loop...');
  }

  // 2. Fallback Inline Module blob compile
  try {
    const response = await fetch(primaryModulePath);
    const sourceCode = await response.text();
    const blob = new Blob([sourceCode], { type: 'application/javascript' });
    const blobURL = URL.createObjectURL(blob);
    const worker = new Worker(blobURL);
    return worker;
  } catch (err) {
    logConsole('System', 'Inline Blob URL script compilation also blocked by Frame Content Security Policy or network.');
    throw new Error('Web Worker instantiation completely blocked.');
  }
}

/**
 * Live Terminal Console Logger
 */
function logConsole(identity, message) {
  const formattedTime = new Date().toLocaleTimeString();
  const line = `[${formattedTime}] <span class="text-[#34D399]">[${identity}]</span> ${message}`;
  consoleLogs.push(line);
  
  const consoleScreen = document.getElementById('terminal-screen');
  if (consoleScreen) {
    consoleScreen.innerHTML = consoleLogs.map(l => `<div>${l}</div>`).join('');
    consoleScreen.scrollTop = consoleScreen.scrollHeight;
  }
}

/**
 * Triggers Ingest and catalog transactions under single structural worker paths
 */
async function startIngestionFlow() {
  const contentInput = document.getElementById('payload-content-txt');
  if (!contentInput || !catalog) return;

  const datasetId = 'dataset-canary';
  const jobId = `job-${Date.now()}`;
  const txtContent = contentInput.value;

  const triggerBtn = document.getElementById('trigger-ingest-btn');
  if (triggerBtn) triggerBtn.disabled = true;

  logConsole('Queue', `Ingest triggered. Enqueuing task ${jobId} inside database schema...`);

  // Evaluate preflight storage limits before request starts
  const simulateQuotaLimit = document.getElementById('quota-simulate-chk')?.checked || false;
  // If simulated, set safetyMarginBytes to a huge ceiling so it trips immediately
  const customMarginBytes = simulateQuotaLimit ? 50 * 1024 * 1024 * 1024 : 10 * 1024 * 1024; // 50GB vs 10MB

  // 1. Run under Web Locks mutex to test coordination safety locks
  try {
    await catalog.withLock(datasetId, async () => {
      logConsole('Main-Lock', `Web Lock acquired for key: substrate-lock-${datasetId}`);
      updateStateMachineUI('staging', 10);

      // Create initial job in IndexedDB
      await catalog.updateJobStatus(jobId, datasetId, { status: 'staging', stage: 'staging', progress: 5 });

      // Check current budget estimates
      const preCheck = await catalog.checkQuotaBudget();
      logConsole('CatalogDB', `Secure environment storage catalog quota left: ${(preCheck.freeBytes / (1024 * 1024)).toFixed(1)}MB`);

      if (simulateQuotaLimit) {
        logConsole('CatalogDB', '[LIMIT TEST] Custom quota safety threshold set to 50.00 GB.');
      }

      // Send instruction packet to compute Worker
      if (!activeWorker) {
        throw new Error('Web worker inactive or crashed inside browser container. Aborting thread tasks.');
      }

      // Prepare promise waiting for the worker loop
      const workerJobPromise = new Promise((resolve, reject) => {
        const handleMessage = (msg) => {
          const { type, stage, progress, details, manifest, error } = msg.data;

          if (type === 'STAGE_CHANGED') {
            updateStateMachineUI(stage, progress || 20, error);
            catalog.updateJobStatus(jobId, datasetId, { status: stage, stage, progress });
            logConsole('Worker-Thread', `Stage state updated: ${stage.toUpperCase()} ${details ? ' - ' + details : ''}`);
            if (error) {
              logConsole('Error', error);
            }
          }

          if (type === 'PROGRESS_UPDATE') {
            updateStateMachineUI(stage, progress, details);
            catalog.updateJobStatus(jobId, datasetId, { status: stage, stage, progress });
            logConsole('Worker-Thread', `Job writing block checkpoint: ${progress}% - ${details}`);
          }

          if (type === 'STAGING_COMPLETED') {
            activeWorker.removeEventListener('message', handleMessage);
            resolve(manifest);
          }

          if (type === 'STAGING_FAILED') {
            activeWorker.removeEventListener('message', handleMessage);
            reject(new Error(error));
          }
        };

        activeWorker.addEventListener('message', handleMessage);
        
        // Post message payload to worker
        activeWorker.postMessage({
          type: 'START_STAGING',
          payload: {
            datasetId,
            jobId,
            content: txtContent,
            maxChunkSize: 200, // Small chunk sizes to simulate multi-block fragment patterns clearly
            safetyMarginBytes: customMarginBytes
          }
        });
      });

      // Await thread completion details
      const manifest = await workerJobPromise;

      // Programmatically check if worker transitioned to non-linear exit errors
      const verifyJob = await catalog.getJob(jobId);
      if (verifyJob && (verifyJob.status === 'paused-low-quota' || verifyJob.status === 'failed-quota')) {
        logConsole('Main-Thread', `Staging aborted in stage: ${verifyJob.status.toUpperCase()}. Lock released. Prev Version remains active.`);
        return;
      }

      logConsole('Main-Thread', `Staging finished! Structural SHA256 integrity hash: ${manifest.manifestHash}`);
      logConsole('Main-Thread', `Executing atomic commit IndexedDB transaction & activeVersion flip...`);

      // 2. Perform Single Atomic Pointer Flip
      const commitReceipt = await catalog.commitDatasetManifest(datasetId, jobId, manifest);
      logConsole('CatalogDB', `Transaction OK. Pointer 'activeVersion' flipped directly to Job ID: ${commitReceipt.activeVersion}`);

      updateStateMachineUI('ready', 100);
      logConsole('Main-Thread', 'Web Lock released. System idle.');
    });
  } catch (err) {
    logConsole('Error', `Ingest error: ${err.message}`);
    updateStateMachineUI('failed-runtime', 0, err.message);
    if (catalog) {
      await catalog.updateJobStatus(jobId, datasetId, { status: 'failed-runtime', stage: 'failed-runtime', error: err.message });
    }
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
    await refreshCatalogLogDisplay();
  }
}

/**
 * Concurrency locks coordination simulation
 */
async function runLockConcurrencyExperiment() {
  if (!catalog) return;
  const datasetId = 'dataset-canary';

  logConsole('Lock-Test', 'SPAWNING TWO CONCURRENT THREAD BACKGROUND ROUTINES PROBING CO-ACCESS LOCKS...');
  
  const taskA = async () => {
    logConsole('TaskA', 'Requesting exclusive lock substrate-lock-dataset-canary...');
    await catalog.withLock(datasetId, async () => {
      logConsole('TaskA', '⚓ Lock acquired successfully! Executing calculations... sleeping 2000ms.');
      await new Promise(r => setTimeout(r, 2000));
      logConsole('TaskA', '✔ Finishing calculations. Releasing lock handle.');
    });
  };

  const taskB = async () => {
    logConsole('TaskB', 'Requesting exclusive lock substrate-lock-dataset-canary...');
    await catalog.withLock(datasetId, async () => {
      logConsole('TaskB', '⚓ Lock acquired successfully! Sleeping 500ms.');
      await new Promise(r => setTimeout(r, 500));
      logConsole('TaskB', '✔ Finishing background process. Releasing lock handle.');
    });
  };

  // Run together simultaneously!
  Promise.all([taskA(), taskB()]);
}

/**
 * Redraw state machines UI controls states and colors
 */
function updateStateMachineUI(stage, progress, errorMsg = '') {
  const bar = document.getElementById('st-progress-bar');
  const percentText = document.getElementById('st-progress-percent');
  const stageLabel = document.getElementById('st-machine-status-lbl');

  if (bar) bar.style.width = `${progress}%`;
  if (percentText) percentText.innerText = `${progress}%`;
  
  if (stageLabel) {
    stageLabel.innerText = stage.replace('-', ' ').toUpperCase();
    
    // Update colors based on stage state machine
    stageLabel.className = "px-2 py-0.5 font-mono text-[9px] font-bold uppercase border transition-all duration-200";
    if (stage === 'ready') {
      stageLabel.classList.add('text-[#34D399]', 'bg-[#101915]', 'border-[#34D399]/40');
    } else if (stage === 'paused-low-quota' || stage === 'failed-quota') {
      stageLabel.classList.add('text-amber-400', 'bg-amber-950/20', 'border-amber-500/40');
    } else if (stage === 'failed-runtime') {
      stageLabel.classList.add('text-rose-400', 'bg-rose-950/20', 'border-rose-500/40');
    } else if (stage === 'idle') {
      stageLabel.classList.add('text-gray-500', 'bg-[#1E2229]', 'border-[#2A2D35]');
    } else {
      stageLabel.classList.add('text-cyan-400', 'bg-cyan-950/20', 'border-cyan-500/40');
    }
  }
}

/**
 * Refresh history container cards using log dataset catalogs from IDB
 */
async function refreshCatalogLogDisplay() {
  const historyGrid = document.getElementById('catalog-history-grid');
  if (!historyGrid || !catalog) return;

  try {
    const dbInstance = catalog.db;
    if (!dbInstance) {
      historyGrid.innerHTML = `
        <div class="text-center text-[#636975] py-4 text-xs font-mono">Database not initialized yet.</div>
      `;
      return;
    }

    const tx = dbInstance.transaction(['datasets'], 'readonly');
    const store = tx.objectStore('datasets');
    const req = store.getAll();

    req.onsuccess = () => {
      const records = req.result;
      if (!records || records.length === 0) {
        historyGrid.innerHTML = `
          <div class="text-center text-[#636975] py-4 text-xs font-mono">No datasets registered. Click 'Ingest & Commit Version' to write live structures.</div>
        `;
        return;
      }

      // Render records reverse order chronology
      historyGrid.innerHTML = records.map(record => {
        const d = new Date(record.createdAt).toLocaleTimeString();
        return `
          <div class="bg-[#12151B] border border-[#2A2D35] p-4 font-mono text-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-cyan-900/40 transition-all select-text">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-white font-bold">${record.datasetId}</span>
                <span class="px-2 py-0.5 rounded-none bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] uppercase font-bold">Active Pointer</span>
              </div>
              <div class="text-[10px] text-gray-400 flex flex-wrap gap-x-4">
                <span>Active Version ID: <span class="text-cyan-400 font-semibold">${record.activeVersion}</span></span>
                <span>Payload Size: <span class="text-white">${record.manifest.totalBytes} B</span></span>
                <span>Staged Blocks: <span class="text-white">${record.manifest.chunks.length}</span></span>
              </div>
              <div class="text-[9px] text-[#636975] truncate max-w-lg" title="SHA-256 integrity hash: ${record.manifest.manifestHash}">
                Integrity Signature: ${record.manifest.manifestHash}
              </div>
            </div>
            <div class="text-[10px] text-[#636975] self-end md:self-center font-bold">
              ${d}
            </div>
          </div>
        `;
      }).reverse().join('');
    };

    req.onerror = () => {
      historyGrid.innerHTML = `
        <div class="text-center text-[10px] font-mono text-rose-400 py-4 uppercase">Error querying database catalog records.</div>
      `;
    };

  } catch (err) {
    historyGrid.innerHTML = `
      <div class="text-center text-[10px] font-mono text-rose-400 py-4 uppercase">Lock system catalog list refresh failure.</div>
    `;
  }
}

/**
 * Wipe DB logs, tables and clear cached local buffers
 */
async function clearDatabaseCatalog() {
  if (!catalog) return;
  const decision = confirm('Do you explicitly request purging the IndexedDB SubstrateCatalog catalog data entries?');
  if (!decision) return;

  logConsole('System', 'Purging and resetting Local SubstrateCatalog database records...');
  try {
    // 1. Clear IndexedDB
    const dbInstance = catalog.db;
    if (dbInstance) {
      const tx = dbInstance.transaction(['jobs', 'datasets'], 'readwrite');
      tx.objectStore('jobs').clear();
      tx.objectStore('datasets').clear();
      tx.oncomplete = () => {
        logConsole('CatalogDB', 'SubstrateCatalog database tables emptied successfully.');
      };
    }

    // 2. Clear OPFS staged documents
    if (navigator.storage && navigator.storage.getDirectory) {
      const opfsRoot = await navigator.storage.getDirectory();
      try {
        await opfsRoot.removeEntry('datasets', { recursive: true });
        logConsole('OPFS', 'All Origin Private File System datasets directories deleted.');
      } catch (err) {
        logConsole('OPFS', 'Origin Private directory already empty/cleared.');
      }
    }

    logConsole('System', 'Aesthetic recovery actions complete.');
    updateStateMachineUI('idle', 0);
    await refreshCatalogLogDisplay();
  } catch (err) {
    logConsole('Error', `Clear catalog error: ${err.message}`);
  }
}

// Start immediately on script load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDiagnostics);
} else {
  initializeDiagnostics();
}
