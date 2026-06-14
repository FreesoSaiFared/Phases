/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CatalogManager coordinating storage limits, IndexedDB catalog operations,
 * Web Lock synchronizations, and atomic transaction flips.
 */
export class CatalogManager {
  constructor() {
    this.dbName = 'SubstrateCatalog';
    this.dbVersion = 1;
    /** @type {IDBDatabase|null} */
    this.db = null;
    this.safetyMarginBytes = 50 * 1024 * 1024; // 50MB safety ceiling
  }

  /**
   * Initializes the catalog IndexedDB instance.
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        // Jobs Store: tracks storage staging tasks and their state machine status
        if (!db.objectStoreNames.contains('jobs')) {
          const jobStore = db.createObjectStore('jobs', { keyPath: 'jobId' });
          jobStore.createIndex('datasetId', 'datasetId', { unique: false });
          jobStore.createIndex('status', 'status', { unique: false });
        }
        // Datasets Store: stores committed version catalogs and manifests
        if (!db.objectStoreNames.contains('datasets')) {
          const datasetStore = db.createObjectStore('datasets', { keyPath: 'datasetId' });
          datasetStore.createIndex('activeVersion', 'activeVersion', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this);
      };

      request.onerror = () => {
        reject(new Error(`IndexedDB failed to initialize: ${request.error?.message}`));
      };
    });
  }

  /**
   * Requests a resource execution under physical/logical transaction lock.
   * Utilizes Web Locks API, falling back to an IndexedDB timestamp lease schema if blocked.
   * @param {string} datasetId 
   * @param {() => Promise<any>} callback 
   */
  async withLock(datasetId, callback) {
    const lockKey = `substrate-lock-${datasetId}`;
    
    // 1. Try Native Web Locks API (Canary / Standard Secure Contexts)
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      try {
        return await navigator.locks.request(lockKey, async (lock) => {
          if (!lock) {
            throw new Error(`Web Lock negotiation failed for resource: ${lockKey}`);
          }
          return await callback();
        });
      } catch (err) {
        // If web locks failed due to context/iframe restrictions, fall back to DB manual lock lease
        console.warn('Native Web Locks failed or was blocked. Falling back to DB Lease System...', err);
      }
    }

    // 2. Custom IndexedDB Job-Lease Fallback (Safe inside sandboxed iframes)
    return await this._executeWithDBLease(datasetId, callback);
  }

  /**
   * Lock fallback using an IndexedDB timestamp-lease loop
   */
  async _executeWithDBLease(datasetId, callback) {
    const leaseId = `lease-${datasetId}`;
    const leaseTTL = 30000; // 30s TTL lease safety margin
    let acquired = false;
    let attempts = 0;
    const maxAttempts = 50;

    while (!acquired && attempts < maxAttempts) {
      acquired = await this._tryAcquireDBLease(leaseId, leaseTTL);
      if (!acquired) {
        attempts++;
        // progressive backoff
        await new Promise(r => setTimeout(r, Math.min(100 + attempts * 50, 1000)));
      }
    }

    if (!acquired) {
      throw new Error(`Database transaction lock timeout after ${maxAttempts} execution attempts for dataset: ${datasetId}`);
    }

    try {
      return await callback();
    } finally {
      await this._releaseDBLease(leaseId);
    }
  }

  /**
   * Write logical lease inside 'jobs' schema
   */
  async _tryAcquireDBLease(leaseId, ttl) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['jobs'], 'readwrite');
      const store = transaction.objectStore('jobs');
      const getReq = store.get(leaseId);

      getReq.onsuccess = () => {
        const now = Date.now();
        const currentLease = getReq.result;

        if (currentLease && currentLease.expiry > now) {
          // Lease is currently active and owned by another routine
          resolve(false);
        } else {
          // Resource open or lease expired -> grab ownership
          const newLease = {
            jobId: leaseId,
            expiry: now + ttl,
            createdAt: now,
            status: 'locked'
          };
          const putReq = store.put(newLease);
          putReq.onsuccess = () => resolve(true);
          putReq.onerror = () => resolve(false);
        }
      };

      getReq.onerror = () => resolve(false);
    });
  }

  /**
   * Release logical lease in DB
   */
  async _releaseDBLease(leaseId) {
    if (!this.db) return;
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['jobs'], 'readwrite');
      const store = transaction.objectStore('jobs');
      const delReq = store.delete(leaseId);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => resolve();
    });
  }

  /**
   * Analyzes browser quotas and computes preflight budget allocation limits
   */
  async checkQuotaBudget() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return {
        hasSufficientQuota: true, // Optimistic fallback
        freeBytes: 1024 * 1024 * 1024, // Assumed 1GB
        quotaBytes: 1024 * 1024 * 1024,
        usageBytes: 0,
        margin: this.safetyMarginBytes,
        persistent: false
      };
    }

    try {
      const estimate = await navigator.storage.estimate();
      const freeBytes = estimate.quota - estimate.usage;
      const isPersistent = await navigator.storage.persisted?.() || false;

      return {
        hasSufficientQuota: freeBytes > this.safetyMarginBytes,
        freeBytes,
        quotaBytes: estimate.quota,
        usageBytes: estimate.usage,
        margin: this.safetyMarginBytes,
        persistent: isPersistent
      };
    } catch (err) {
      return {
        hasSufficientQuota: false,
        freeBytes: 0,
        quotaBytes: 0,
        usageBytes: 0,
        margin: this.safetyMarginBytes,
        persistent: false,
        error: err.message
      };
    }
  }

  /**
   * Atomically commits a completed dataset manifest AND flips active version pointer.
   * State Machine loop transaction:idle -> staging -> writing-opfs -> manifest-ready -> committing-idb -> ready
   */
  async commitDatasetManifest(datasetId, jobId, manifest) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['jobs', 'datasets'], 'readwrite');
      const jobsStore = tx.objectStore('jobs');
      const datasetsStore = tx.objectStore('datasets');

      // Prepare operations
      const jobRecord = {
        jobId,
        datasetId,
        status: 'ready',
        stage: 'ready',
        error: null,
        updatedAt: Date.now(),
        manifestHash: manifest.manifestHash
      };

      const datasetRecord = {
        datasetId,
        activeVersion: jobId,
        manifest: manifest,
        createdAt: manifest.createdAt || Date.now()
      };

      // Perform updates
      jobsStore.put(jobRecord);
      datasetsStore.put(datasetRecord);

      tx.oncomplete = () => {
        resolve({
          status: 'success',
          datasetId,
          activeVersion: jobId,
          manifest
        });
      };

      tx.onerror = () => {
        reject(new Error(`Atomic IndexedDB Manifest Commit failed: ${tx.error?.message}`));
      };
    });
  }

  /**
   * Tracks or updates a specific job status in IndexedDB.
   */
  async updateJobStatus(jobId, datasetId, details) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['jobs'], 'readwrite');
      const store = tx.objectStore('jobs');

      const record = {
        jobId,
        datasetId,
        status: details.status, // e.g. 'staging', 'writing-opfs', 'paused-low-quota', 'failed-quota', 'ready'
        stage: details.stage || details.status,
        error: details.error || null,
        updatedAt: Date.now(),
        progress: details.progress || 0
      };

      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieves a dataset catalog by ID.
   */
  async getDataset(datasetId) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(['datasets'], 'readonly');
      const store = tx.objectStore('datasets');
      const req = store.get(datasetId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  /**
   * Retrieves job stats by ID.
   */
  async getJob(jobId) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(['jobs'], 'readonly');
      const store = tx.objectStore('jobs');
      const req = store.get(jobId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  /**
   * Requests physical storage persistence permissions
   */
  async requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        return await navigator.storage.persist();
      } catch (err) {
        console.warn('Storage persist request rejected.', err);
        return false;
      }
    }
    return false;
  }
}
