/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Worker Environment Message Handler
self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'PING') {
    self.postMessage({ type: 'PONG' });
    return;
  }

  if (type === 'START_STAGING') {
    try {
      await executeStagingJob(payload);
    } catch (err) {
      self.postMessage({
        type: 'STAGING_FAILED',
        error: err.message || 'Unknown worker runtime error'
      });
    }
  }
};

/**
 * Executes a chunk-and-digest ingestion staging job inside OPFS.
 */
async function executeStagingJob(payload) {
  const { datasetId, jobId, content, maxChunkSize = 256 * 1024, safetyMarginBytes = 50 * 1024 * 1024, parentVersionId = null } = payload;
  
  // Transition State Machine
  self.postMessage({ type: 'STAGE_CHANGED', stage: 'staging', progress: 0 });

  // 1. Check Quota / Storage Limits Preflight Budget allocation
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const freeSpace = estimate.quota - estimate.usage;
    
    // Explicit low-quota threshold checking
    if (freeSpace < safetyMarginBytes) {
      self.postMessage({
        type: 'STAGE_CHANGED',
        stage: 'paused-low-quota',
        error: `Insufficient system storage: ${Math.round(freeSpace / 1024 / 1024)}MB free space is below the safety threshold of ${Math.round(safetyMarginBytes / 1024 / 1024)}MB.`
      });
      self.postMessage({
        type: 'STAGING_FAILED',
        error: `Insufficient system storage: ${Math.round(freeSpace / 1024 / 1024)}MB free space is below the safety threshold of ${Math.round(safetyMarginBytes / 1024 / 1024)}MB.`
      });
      return;
    }
  }

  // 2. Fragment source text content into binary chunks
  const encoder = new TextEncoder();
  const binaryContent = encoder.encode(content);
  const totalLength = binaryContent.byteLength;
  const chunkCount = Math.ceil(totalLength / maxChunkSize);

  // Measure total rows in the entire input content
  const totalRows = (content.match(/\r?\n/g) || []).length + 1;

  self.postMessage({ 
    type: 'STAGE_CHANGED', 
    stage: 'writing-opfs', 
    progress: 5,
    details: `Splitting payload into ${chunkCount} discrete blocks...` 
  });

  // Access the Origin Private File System (OPFS)
  let opfsRoot;
  try {
    opfsRoot = await navigator.storage.getDirectory();
  } catch (err) {
    throw new Error(`OPFS Storage Root inaccessible inside worker sandbox: ${err.message}`);
  }

  // Ensure staging folder path structure recursively:
  // /datasets/{datasetId}/staging/{jobId}/
  const datasetsDir = await opfsRoot.getDirectoryHandle('datasets', { create: true });
  const datasetDir = await datasetsDir.getDirectoryHandle(datasetId, { create: true });
  const stagingDir = await datasetDir.getDirectoryHandle('staging', { create: true });
  const jobDir = await stagingDir.getDirectoryHandle(jobId, { create: true });

  const chunkMetadataList = [];
  let bytePointer = 0;

  // Process and write individual chunks
  for (let i = 0; i < chunkCount; i++) {
    const startByte = bytePointer;
    const endByte = Math.min(bytePointer + maxChunkSize, totalLength);
    const chunkSlice = binaryContent.subarray(startByte, endByte);
    const chunkSize = chunkSlice.byteLength;

    const chunkId = `chunk-${String(i).padStart(4, '0')}`;
    const chunkFileName = `${chunkId}.bin`;
    const relativeOpfsPath = `/datasets/${datasetId}/staging/${jobId}/${chunkFileName}`;

    // Write slice to discrete file handle
    try {
      const fileHandle = await jobDir.getFileHandle(chunkFileName, { create: true });
      
      // Attempt synchronous access write if supported, fallback to standard writable stream
      if (typeof fileHandle.createSyncAccessHandle === 'function') {
        const accessHandle = await fileHandle.createSyncAccessHandle();
        accessHandle.write(chunkSlice);
        accessHandle.flush();
        accessHandle.close();
      } else {
        // Standard async fallback writable stream
        const writable = await fileHandle.createWritable();
        await writable.write(chunkSlice);
        await writable.close();
      }
    } catch (err) {
      if (err.name === 'QuotaExceededError' || err.message.includes('Quota')) {
        self.postMessage({
          type: 'STAGE_CHANGED',
          stage: 'failed-quota',
          error: `Staging aborted: System storage limit exceeded while writing ${chunkId}.`
        });
        self.postMessage({
          type: 'STAGING_FAILED',
          error: `Staging aborted: System storage limit exceeded while writing ${chunkId}.`
        });
        return;
      }
      throw new Error(`Failed writing chunk ${chunkId} to OPFS: ${err.message}`);
    }

    // Cryptographic hashing of completed chunk slice
    const hashBuffer = await crypto.subtle.digest('SHA-256', chunkSlice);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Decode chunk binary to string directly to locate row counts
    const chunkText = new TextDecoder().decode(chunkSlice);
    const chunkRowCount = (chunkText.match(/\r?\n/g) || []).length + 1;

    chunkMetadataList.push({
      chunkId,
      fileName: chunkFileName,
      opfsPath: relativeOpfsPath,
      byteRange: [startByte, endByte],
      size: chunkSize,
      rowCount: chunkRowCount,
      sha256: hashHex
    });

    bytePointer = endByte;

    // Report localized completion checkpoints to main thread
    const itemProgress = Math.round(5 + (i + 1) / chunkCount * 85);
    self.postMessage({
      type: 'PROGRESS_UPDATE',
      progress: itemProgress,
      stage: 'writing-opfs',
      details: `Staged and digested chunk ${i + 1} of ${chunkCount}`
    });
  }

  // 3. Finalize Manifest construction
  self.postMessage({ 
    type: 'STAGE_CHANGED', 
    stage: 'manifest-ready', 
    progress: 92,
    details: 'Assembling dataset integrity manifests...' 
  });

  // Calculate top-level manifest security checksum over ordered chunks
  const manifestDataString = JSON.stringify(chunkMetadataList);
  const manifestEncoder = new TextEncoder();
  const manifestRawBytes = manifestEncoder.encode(manifestDataString);
  const manifestHashBuffer = await crypto.subtle.digest('SHA-256', manifestRawBytes);
  const manifestHashHex = Array.from(new Uint8Array(manifestHashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const finalManifest = {
    datasetId,
    jobId,
    parentVersionId: parentVersionId || null,
    totalBytes: totalLength,
    totalRows: totalRows,
    chunks: chunkMetadataList,
    manifestHash: manifestHashHex,
    schemaSignature: 'SHA256-BINARY-CHUNKS-V1',
    createdAt: Date.now()
  };

  // Complete thread loop, send back manifest
  self.postMessage({
    type: 'STAGING_COMPLETED',
    manifest: finalManifest,
    progress: 100
  });
}
