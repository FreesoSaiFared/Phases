/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks a specific experimental browser capability and returns a status block.
 * Status can be: 'supported' | 'missing-api' | 'blocked-by-iframe-or-permission-policy' | 'blocked-by-header-requirement' | 'runtime-error'
 */

export async function checkWebGPU() {
  if (!navigator.gpu) {
    if (!window.isSecureContext) {
      return { 
        status: 'blocked-by-header-requirement', 
        reason: 'WebGPU requires a Secure Context (HTTPS/localhost) and cross-origin isolation headers' 
      };
    }
    return { 
      status: 'missing-api', 
      reason: 'navigator.gpu is entirely unimplemented in this browser engine' 
    };
  }
  
  try {
    // Try requesting adapter to test runtime access
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { 
        status: 'runtime-error', 
        reason: 'navigator.gpu exists, but requestAdapter() returned null. Hardware acceleration may be disabled or GPU hardware not found.' 
      };
    }
    return { 
      status: 'supported', 
      details: 'WebGPU is supported and requestAdapter succeeded' 
    };
  } catch (err) {
    const errMsg = err.message || '';
    const errName = err.name || '';
    if (
      errName === 'SecurityError' || 
      errMsg.includes('sandbox') || 
      errMsg.includes('SecurityError') || 
      errMsg.includes('Permissions-Policy') || 
      errMsg.includes('not allowed')
    ) {
      return { 
        status: 'blocked-by-iframe-or-permission-policy', 
        reason: 'WebGPU access was blocked by iframe sandbox flags or Permissions-Policy headers.' 
      };
    }
    return { 
      status: 'runtime-error', 
      reason: `WebGPU programmatic initialization threw exception: ${errMsg}` 
    };
  }
}

export async function checkOPFS() {
  if (!navigator.storage || !navigator.storage.getDirectory) {
    return { 
      status: 'missing-api', 
      reason: 'navigator.storage.getDirectory is entirely unimplemented' 
    };
  }
  
  try {
    const root = await navigator.storage.getDirectory();
    if (!root) {
      return { 
        status: 'runtime-error', 
        reason: 'getDirectory() returned empty/null reference' 
      };
    }
    return { 
      status: 'supported', 
      details: 'OPFS is supported and root directory handle retrieved successfully' 
    };
  } catch (err) {
    const errMsg = err.message || '';
    const errName = err.name || '';
    if (
      errName === 'SecurityError' || 
      errName === 'NotAllowedError' ||
      errMsg.includes('sandbox') || 
      errMsg.includes('SecurityError') || 
      errMsg.includes('Permissions-Policy') || 
      errMsg.includes('not allowed')
    ) {
      return { 
        status: 'blocked-by-iframe-or-permission-policy', 
        reason: 'OPFS access was blocked by iframe sandbox restrictions (requires allow-same-origin) or user permission policy.' 
      };
    }
    return { 
      status: 'runtime-error', 
      reason: `OPFS programmatic initialization threw exception: ${errMsg}` 
    };
  }
}

export async function checkBuiltInAI() {
  if (!window.ai) {
    return { 
      status: 'missing-api', 
      reason: 'window.ai is entirely unimplemented by this browser' 
    };
  }
  
  try {
    // Current Chrome Canary built-in AI naming standard is window.ai.languageModel or window.ai.assistant
    const modelNamespace = window.ai.languageModel || window.ai.assistant;
    if (!modelNamespace) {
      return { 
        status: 'missing-api', 
        reason: 'window.ai exists, but lacks languageModel / assistant sub-modules. The APIs may be obsolete or under a different namespace.' 
      };
    }
    
    const capabilities = await modelNamespace.capabilities();
    if (!capabilities || capabilities.available === 'no') {
      return { 
        status: 'runtime-error', 
        reason: 'Built-in Gemini AI languageModel capability available status is "no". Canary flags are enabled but the on-device model is not downloaded.' 
      };
    }
    return { 
      status: 'supported', 
      details: `Gemini LanguageModel status is "${capabilities.available}" (Default Temp: ${capabilities.defaultTemperature || 'N/A'})` 
    };
  } catch (err) {
    const errMsg = err.message || '';
    const errName = err.name || '';
    if (
      errName === 'SecurityError' || 
      errName === 'NotAllowedError' ||
      errMsg.includes('sandbox') || 
      errMsg.includes('SecurityError') || 
      errMsg.includes('not-allowed')
    ) {
      return { 
        status: 'blocked-by-iframe-or-permission-policy', 
        reason: 'Built-in Chrome AI access was blocked by iframe sandbox or Permissions-Policy. On-device models are typically disabled inside untrusted cross-origin frames.' 
      };
    }
    return { 
      status: 'runtime-error', 
      reason: `Built-in AI initialization threw exception: ${errMsg}` 
    };
  }
}

export async function checkWebLocks() {
  if (!navigator.locks) {
    if (!window.isSecureContext) {
      return { 
        status: 'blocked-by-header-requirement', 
        reason: 'Web Locks requires a Secure Context (HTTPS/localhost)' 
      };
    }
    return { 
      status: 'missing-api', 
      reason: 'navigator.locks is entirely unimplemented in this browser engine' 
    };
  }
  
  try {
    let queried = false;
    // Fast check querying lock status
    await Promise.race([
      navigator.locks.query().then(() => { queried = true; }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Web Locks query timeout')), 250))
    ]);
    if (!queried) {
      return { 
        status: 'runtime-error', 
        reason: 'Web Locks API is present, but query() query resolved too slowly or hung' 
      };
    }
    return { 
      status: 'supported', 
      details: 'Web Locks API is queryable and functional' 
    };
  } catch (err) {
    const errMsg = err.message || '';
    const errName = err.name || '';
    if (
      errName === 'SecurityError' || 
      errMsg.includes('sandbox') || 
      errMsg.includes('Security') || 
      errMsg.includes('not allowed')
    ) {
      return { 
        status: 'blocked-by-iframe-or-permission-policy', 
        reason: 'Web Locks API was blocked by iframe sandbox restrictions.' 
      };
    }
    return { 
      status: 'runtime-error', 
      reason: `Web Locks query threw exception: ${errMsg}` 
    };
  }
}

export async function checkScheduler() {
  if (!window.scheduler || !window.scheduler.postTask) {
    return { 
      status: 'missing-api', 
      reason: 'scheduler.postTask / scheduler.yield is entirely unimplemented' 
    };
  }
  
  try {
    let executed = false;
    await window.scheduler.postTask(() => { executed = true; }, { priority: 'background' });
    if (!executed) {
      return { 
        status: 'runtime-error', 
        reason: 'Scheduler task scheduled successfully but did not execute programmatically' 
      };
    }
    return { 
      status: 'supported', 
      details: 'scheduler.postTask / scheduler.yield is supported and functional' 
    };
  } catch (err) {
    return { 
      status: 'runtime-error', 
      reason: `Scheduler execution threw exception: ${err.message}` 
    };
  }
}

export async function checkNavigation() {
  if (!window.navigation) {
    return { 
      status: 'missing-api', 
      reason: 'Navigation API (window.navigation) is unimplemented in this browser engine' 
    };
  }
  return { 
    status: 'supported', 
    details: 'Navigation API is supported and active' 
  };
}

export async function checkViewTransitions() {
  if (!document.startViewTransition) {
    return { 
      status: 'missing-api', 
      reason: 'View Transitions API is unimplemented in this browser engine' 
    };
  }
  return { 
    status: 'supported', 
    details: 'View Transitions API is supported and active' 
  };
}

export async function checkCSSAnchor() {
  const supported = CSS.supports('anchor-name', '--test') || CSS.supports('position-anchor', '--test');
  if (!supported) {
    return { 
      status: 'missing-api', 
      reason: 'CSS Anchor Positioning syntax is not recognized by the browser engine' 
    };
  }
  return { 
    status: 'supported', 
    details: 'CSS Anchor Positioning syntax is fully supported' 
  };
}

export async function runDiagnosticsMatrix() {
  const [
    webgpu,
    opfs,
    builtInAI,
    webLocks,
    scheduler,
    navigation,
    viewTransitions,
    cssAnchor
  ] = await Promise.all([
    checkWebGPU(),
    checkOPFS(),
    checkBuiltInAI(),
    checkWebLocks(),
    checkScheduler(),
    checkNavigation(),
    checkViewTransitions(),
    checkCSSAnchor()
  ]);

  return {
    webgpu,
    opfs,
    builtInAI,
    webLocks,
    scheduler,
    navigation,
    viewTransitions,
    cssAnchor
  };
}

/**
 * Renders a highly polished capability status card matching Sandbox isolation categories.
 */
export function renderCapabilityCard(name, capability, description) {
  const status = capability?.status || 'missing-api';
  const reason = capability?.reason || '';
  const details = capability?.details || '';

  let statusText = '';
  let dotColor = 'bg-gray-500';
  let borderColor = 'border-[#2A2D35]';
  let badgeColor = 'bg-[#1E2229] text-gray-400';

  if (status === 'supported') {
    statusText = 'Supported';
    dotColor = 'bg-[#34D399]';
    borderColor = 'border-[#34D399]/35';
    badgeColor = 'bg-[#101915] text-[#34D399] border-[#34D399]/20';
  } else if (status === 'blocked-by-iframe-or-permission-policy') {
    statusText = 'Blocked by Iframe / Policies';
    dotColor = 'bg-amber-400';
    borderColor = 'border-amber-500/35';
    badgeColor = 'bg-amber-950/20 text-amber-400 border-amber-500/20';
  } else if (status === 'blocked-by-header-requirement') {
    statusText = 'Blocked by Header / Context';
    dotColor = 'bg-violet-400';
    borderColor = 'border-violet-500/35';
    badgeColor = 'bg-violet-950/20 text-violet-400 border-violet-500/20';
  } else if (status === 'runtime-error') {
    statusText = 'Runtime Error';
    dotColor = 'bg-rose-500';
    borderColor = 'border-rose-500/35';
    badgeColor = 'bg-rose-950/20 text-rose-400 border-rose-500/20';
  } else {
    // missing-api
    statusText = 'Missing API';
    dotColor = 'bg-gray-600';
    borderColor = 'border-[#2A2D35]';
    badgeColor = 'bg-[#1E2229] text-gray-500';
  }

  return `
    <article class="bg-[#12151B] border ${borderColor} p-5 flex flex-col justify-between gap-4 transition-all hover:border-[#4F5666]/30">
      <div class="space-y-2">
        <div class="flex justify-between items-start gap-2">
          <h3 class="font-sans font-medium text-sm tracking-tight text-white">${name}</h3>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[9px] font-mono font-bold border rounded-none ${badgeColor} uppercase tracking-wider">
            <span class="w-1.5 h-1.5 rounded-full ${dotColor}"></span>
            ${statusText}
          </span>
        </div>
        <p class="text-[11px] font-sans text-gray-400 leading-relaxed">${description.trim()}</p>
      </div>
      
      ${reason ? `
        <div class="mt-2 bg-[#0A0C10] border border-rose-950/25 p-3 text-[10px] font-mono text-rose-300 leading-normal">
          <span class="text-rose-400 font-bold uppercase block mb-1">Blocked Reason:</span>
          ${reason}
        </div>
      ` : ''}

      ${details ? `
        <div class="mt-2 bg-[#0A0C10] border border-[#2A2D35] p-3 text-[10px] font-mono text-[#34D399] leading-normal">
          <span class="text-cyan-400 font-bold uppercase block mb-1">Runtime Status:</span>
          ${details}
        </div>
      ` : ''}
    </article>
  `;
}

