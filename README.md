# Substrate Subsystem & Sandbox Diagnostics

A Chrome Canary-first experimental diagnostic browser substrate mapping native experimental capabilities and platform sandbox boundaries.

## Chrome Canary / Experimental Feature Notes

This application directly probes bleeding-edge Chromium primitives. If running inside a standard stable consumer browser, some or all of these features will report as `missing-api` or require manual runtime flag activation inside `chrome://flags`.

The following experimental systems are analyzed:
1. **WebGPU Core Rendering** (`navigator.gpu`): Hardware-accelerated computation and parallel pipeline shaders.
2. **Origin Private File System** (`navigator.storage.getDirectory`): Highly-optimized, low-overhead secure storage system suitable for multi-threaded fast access operations.
3. **Chrome Built-In AI** (`window.ai`): Local models (e.g., Gemini Nano) embedded execution client-side.
4. **Web Locks API** (`navigator.locks`): Global asynchronous resource coordination and transaction safe locks.
5. **Scheduler postTask** (`window.scheduler`): Progressive execution scheduler preventing viewport stutter and main-thread blocks.
6. **Navigation API** (`window.navigation`): Streamlined state and navigation flow control.
7. **View Transitions API** (`document.startViewTransition`): State-to-state animated visual transitions.
8. **CSS Anchor Positioning** (`CSS.supports`): Target-relative dynamic floating layouts resolved by the browser CSS rendering engine.

## Fallback Behavior

Whenever a native API probe fails, the engine analyzes the failure to categorize it into one of four distinct states:
- **`missing-api`**: The browser engine lacks the necessary developer implementation.
- **`blocked-by-iframe-or-permission-policy`**: The resource is fully implemented but blocked by parent security constraints such as sandbox permissions (`allow-same-origin`, `allow-wasm`, etc.) or iframe permission policies.
- **`blocked-by-header-requirement`**: The resource lacks prerequisite secure environments or required isolation headers (`COOP`/`COEP`).
- **`runtime-error`**: programmatic initialization threw an unexpected exception during execution.

The Subsystem UI gracefully adapts, notifying users of the precise source of failure with context-aware troubleshooting advice instead of breaking the browser loop.

## What This Intentionally Does Not Use

This project rejects the performance tax of heavy frameworks and abstraction layers to maximize Canary performance and runtime visibility:
- **No React / Vue / Angular**: Completely eliminated complex virtual tree reconciliation runs.
- **No Virtual DOM**: Directly coordinates rendering via standard native DOM manipulation and responsive template updates.
- **No Traditional Hydration Layers**: Avoids hydration latency; uses native modules and native `importmap` resolutions directly inside the browser substrate.
- **No Bundled Dependencies**: Relies solely on platform standards and native ESM resolutions.
