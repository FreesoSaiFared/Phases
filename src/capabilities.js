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
