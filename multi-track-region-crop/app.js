/**
 * Multi-Track Region Cropping Demo
 * Demonstrates CropTarget production, dynamic cropTo() invocation,
 * and track.clone() with independent dynamic crop targets.
 */

// ============================================================================
// State Management
// ============================================================================
const state = {
  isAnimating: true,
  animIntervalId: null,
  counterIntervalId: null,
  frameCount: 0,
  counterSeconds: 0,
  hueGreater: 210,
  hueInner1: 30,

  // CropTarget instances
  cropTargets: {
    uncropped: undefined,
    greater: null,
    inner1: null,
    inner2: null
  },

  // Active MediaStreams & Tracks
  primaryStream: null,
  primaryTrack: null,
  activeTracks: [], // Array of { id, type: 'primary'|'clone', track, stream, element, currentCrop }
  nextTrackId: 0
};

// ============================================================================
// DOM Elements
// ============================================================================
const DOM = {
  // Status & Alerts
  apiStatusBadge: document.getElementById('api-status-badge'),
  apiAlert: document.getElementById('api-alert'),
  apiAlertTitle: document.getElementById('api-alert-title'),
  apiAlertMessage: document.getElementById('api-alert-message'),
  captureStatusDot: document.getElementById('capture-status-dot'),

  // Target Elements
  targetGreater: document.getElementById('target-greater-region'),
  targetInner1: document.getElementById('target-inner-region-1'),
  targetInner2: document.getElementById('target-inner-region-2'),

  // Target Content Displays
  greaterFpsCounter: document.getElementById('greater-fps-counter'),
  greaterColorLabel: document.getElementById('greater-color-label'),
  inner1ColorLabel: document.getElementById('inner1-color-label'),
  counterValue: document.getElementById('counter-value'),
  counterTime: document.getElementById('counter-time'),
  counterProgressFill: document.getElementById('counter-progress-fill'),

  // Target Actions
  btnToggleAnim: document.getElementById('btn-toggle-anim'),
  btnResizeToggle: document.getElementById('btn-resize-toggle'),

  // Capture Controls
  btnStartCapture: document.getElementById('btn-start-capture'),
  btnAddClone: document.getElementById('btn-add-clone'),
  btnStopAll: document.getElementById('btn-stop-all'),

  // Containers
  captureEmptyState: document.getElementById('capture-empty-state'),
  tracksContainer: document.getElementById('tracks-container'),
  trackCardTemplate: document.getElementById('track-card-template'),
  logConsole: document.getElementById('log-console'),
  btnClearLog: document.getElementById('btn-clear-log')
};

// ============================================================================
// Logger Utility
// ============================================================================
function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = 'log-line';

  const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${timeStr}]`;

  const tagSpan = document.createElement('span');
  tagSpan.className = `log-tag log-tag-${type}`;
  tagSpan.textContent = type.toUpperCase();

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = msg;

  line.appendChild(timeSpan);
  line.appendChild(tagSpan);
  line.appendChild(msgSpan);

  DOM.logConsole.appendChild(line);
  DOM.logConsole.scrollTop = DOM.logConsole.scrollHeight;

  // Also log to browser console
  if (type === 'error') console.error(msg);
  else if (type === 'warn') console.warn(msg);
  else console.log(`[${type.toUpperCase()}] ${msg}`);
}

// ============================================================================
// Animation Engine (10 FPS Color Cycles & 1s Counter)
// ============================================================================
function startAnimations() {
  if (state.animIntervalId) clearInterval(state.animIntervalId);
  if (state.counterIntervalId) clearInterval(state.counterIntervalId);

  // 10 FPS = 100ms interval
  state.animIntervalId = setInterval(() => {
    if (!state.isAnimating) return;

    state.frameCount++;
    state.hueGreater = (state.hueGreater + 2) % 360;
    state.hueInner1 = (state.hueInner1 + 4) % 360;

    // Update Greater Area
    const colorGreater = `hsl(${state.hueGreater}, 65%, 22%)`;
    DOM.targetGreater.style.backgroundColor = colorGreater;
    DOM.greaterFpsCounter.textContent = `Frame: ${state.frameCount}`;
    DOM.greaterColorLabel.textContent = colorGreater;

    // Update Inner Region 1
    const colorInner1 = `hsl(${state.hueInner1}, 80%, 28%)`;
    DOM.targetInner1.style.backgroundColor = colorInner1;
    DOM.inner1ColorLabel.textContent = `HSL(${state.hueInner1}°, 80%, 28%)`;
  }, 100);

  // 1 FPS = 1000ms interval for Counter
  state.counterIntervalId = setInterval(() => {
    if (!state.isAnimating) return;

    state.counterSeconds++;
    DOM.counterValue.textContent = state.counterSeconds;

    // Format HH:MM:SS
    const hrs = String(Math.floor(state.counterSeconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((state.counterSeconds % 3600) / 60)).padStart(2, '0');
    const secs = String(state.counterSeconds % 60).padStart(2, '0');
    DOM.counterTime.textContent = `${hrs}:${mins}:${secs}`;

    // Reset and trigger progress bar
    DOM.counterProgressFill.style.transition = 'none';
    DOM.counterProgressFill.style.width = '0%';
    setTimeout(() => {
      DOM.counterProgressFill.style.transition = 'width 0.95s linear';
      DOM.counterProgressFill.style.width = '100%';
    }, 20);
  }, 1000);
}

function toggleAnimation() {
  state.isAnimating = !state.isAnimating;
  DOM.btnToggleAnim.textContent = state.isAnimating ? '⏸ Pause Animation' : '▶ Resume Animation';
  log(`Animations ${state.isAnimating ? 'resumed' : 'paused'}.`, 'info');
}

// ============================================================================
// Feature Detection & CropTarget Initialization
// ============================================================================
function checkAPISupport() {
  const hasGetDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  const hasCropTargetSpec = !!(window.CropTarget && typeof CropTarget.fromElement === 'function');
  const hasCropTargetLegacy = !!(navigator.mediaDevices && typeof navigator.mediaDevices.produceCropTarget === 'function');
  const hasCropTarget = hasCropTargetSpec || hasCropTargetLegacy;
  const hasCropTo = !!(MediaStreamTrack.prototype && typeof MediaStreamTrack.prototype.cropTo === 'function');

  if (hasCropTarget && hasCropTo && hasGetDisplayMedia) {
    DOM.apiStatusBadge.className = 'badge badge-success';
    DOM.apiStatusBadge.textContent = 'Region Capture: Supported';
    log('Region Capture API (CropTarget & cropTo) is fully supported in this browser.', 'success');
    return true;
  } else {
    DOM.apiStatusBadge.className = 'badge badge-warning';
    DOM.apiStatusBadge.textContent = 'Region Capture: Limited / Unsupported';

    let missing = [];
    if (!hasGetDisplayMedia) missing.push('getDisplayMedia()');
    if (!hasCropTarget) missing.push('CropTarget.fromElement()');
    if (!hasCropTo) missing.push('MediaStreamTrack.prototype.cropTo()');

    DOM.apiAlert.className = 'alert-box alert-warning';
    DOM.apiAlertTitle.textContent = 'Browser Compatibility Notice';
    DOM.apiAlertMessage.innerHTML = `Your browser does not have full Region Capture API support (Missing: <code>${missing.join(', ')}</code>).
      <br>To test full Region Capture functionality, please use Google Chrome / Chromium 104+ (or enable <code>chrome://flags/#region-capture</code>).`;

    log(`API Support warning: missing [${missing.join(', ')}].`, 'warn');
    return false;
  }
}

async function produceCropTargets() {
  try {
    async function produce(el) {
      if (window.CropTarget && typeof CropTarget.fromElement === 'function') {
        return await CropTarget.fromElement(el);
      } else if (navigator.mediaDevices && typeof navigator.mediaDevices.produceCropTarget === 'function') {
        return await navigator.mediaDevices.produceCropTarget(el);
      }
      return null;
    }

    log('Producing CropTarget instances for DOM elements...', 'info');
    state.cropTargets.greater = await produce(DOM.targetGreater);
    state.cropTargets.inner1 = await produce(DOM.targetInner1);
    state.cropTargets.inner2 = await produce(DOM.targetInner2);

    log('CropTargets produced successfully for Greater Region, Inner 1, and Inner 2.', 'success');
  } catch (err) {
    log(`Failed to produce CropTargets: ${err.message}`, 'error');
  }
}

// ============================================================================
// Capture & Multi-Track Cloning Lifecycle
// ============================================================================
async function startCapture() {
  try {
    log('Requesting tab capture via getDisplayMedia()...', 'info');

    // Prefer current tab if supported by user agent
    const displayMediaOptions = {
      video: {
        displaySurface: 'browser'
      },
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
      systemAudio: 'exclude'
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    } catch (e) {
      // Fallback with standard constraints
      log('Retrying getDisplayMedia with default video constraints...', 'info');
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    }

    state.primaryStream = stream;
    const [videoTrack] = stream.getVideoTracks();

    if (!videoTrack) {
      throw new Error('No video track returned from getDisplayMedia.');
    }

    state.primaryTrack = videoTrack;

    // Track ended listener (e.g. user clicks browser "Stop sharing" button)
    videoTrack.addEventListener('ended', () => {
      log('Primary capture track ended by user/browser.', 'warn');
      stopAllCaptures();
    });

    // Update UI state
    DOM.btnStartCapture.disabled = true;
    DOM.btnAddClone.disabled = false;
    DOM.btnStopAll.disabled = false;
    DOM.captureEmptyState.style.display = 'none';
    DOM.captureStatusDot.className = 'dot active';

    // Produce CropTargets if not yet done
    if (!state.cropTargets.greater) {
      await produceCropTargets();
    }

    // Add Primary Track Card
    addTrackCard(videoTrack, stream, 'primary');

    log('Capture started successfully. Primary track preview active.', 'success');
  } catch (err) {
    log(`Capture failed or cancelled: ${err.message}`, 'error');
  }
}

function cloneTrack(sourceTrack = state.primaryTrack) {
  if (!sourceTrack || sourceTrack.readyState === 'ended') {
    log('Cannot clone track: source track is inactive or ended.', 'error');
    return;
  }

  try {
    log(`Cloning video track (Original ID: ${sourceTrack.id.substring(0, 8)}...)...`, 'info');
    const clonedTrack = sourceTrack.clone();
    const clonedStream = new MediaStream([clonedTrack]);

    clonedTrack.addEventListener('ended', () => {
      log(`Cloned track #${clonedTrack.id.substring(0, 8)} ended.`, 'info');
    });

    addTrackCard(clonedTrack, clonedStream, 'clone');
    log('Cloned track created successfully with independent crop capability.', 'success');
  } catch (err) {
    log(`Track clone failed: ${err.message}`, 'error');
  }
}

function stopAllCaptures() {
  log('Stopping all tracks and releasing capture streams...', 'info');

  state.activeTracks.forEach(item => {
    try {
      item.track.stop();
      if (item.element && item.element.parentElement) {
        item.element.remove();
      }
    } catch (e) {
      console.warn(e);
    }
  });

  state.activeTracks = [];
  state.primaryStream = null;
  state.primaryTrack = null;

  DOM.tracksContainer.innerHTML = '';
  DOM.captureEmptyState.style.display = 'flex';
  DOM.btnStartCapture.disabled = false;
  DOM.btnAddClone.disabled = true;
  DOM.btnStopAll.disabled = true;
  DOM.captureStatusDot.className = 'dot';

  log('All tracks stopped.', 'info');
}

function removeTrack(trackId) {
  const index = state.activeTracks.findIndex(t => t.id === trackId);
  if (index === -1) return;

  const item = state.activeTracks[index];
  log(`Removing Track #${trackId} (${item.type})...`, 'info');

  try {
    item.track.stop();
  } catch (e) {
    console.warn(e);
  }

  if (item.element && item.element.parentElement) {
    item.element.remove();
  }

  state.activeTracks.splice(index, 1);

  if (state.activeTracks.length === 0) {
    stopAllCaptures();
  }
}

// ============================================================================
// Track Card UI & Dynamic cropTo() Handler
// ============================================================================
function addTrackCard(track, stream, type = 'primary') {
  const trackId = state.nextTrackId++;
  const template = DOM.trackCardTemplate.content.cloneNode(true);
  const cardElement = template.querySelector('.track-card');

  if (type === 'clone') {
    cardElement.classList.add('is-clone');
  }

  // Populate info
  const typeBadge = cardElement.querySelector('.track-type-badge');
  typeBadge.textContent = type === 'primary' ? 'Primary Track' : 'Cloned Track';

  const idLabel = cardElement.querySelector('.track-id-label');
  idLabel.textContent = `ID: #${trackId} (${track.id.substring(0, 6)})`;

  const resBadge = cardElement.querySelector('.res-badge');
  const overlayTag = cardElement.querySelector('.video-overlay-tag');
  const statusVal = cardElement.querySelector('.status-val');
  const videoEl = cardElement.querySelector('video');

  videoEl.srcObject = stream;
  videoEl.play().catch(err => log(`Autoplay preview error: ${err.message}`, 'warn'));

  // Update resolution badge on metadata load & resize
  function updateResolution() {
    if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      resBadge.textContent = `${videoEl.videoWidth}x${videoEl.videoHeight}`;
    }
  }
  videoEl.addEventListener('loadedmetadata', updateResolution);
  videoEl.addEventListener('resize', updateResolution);

  // Crop Selector Buttons
  const cropButtons = cardElement.querySelectorAll('.btn-crop');
  cropButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const cropKey = btn.dataset.crop;
      await applyCropToTrack(trackId, track, cropKey, cardElement, cropButtons, overlayTag, statusVal);
    });
  });

  // Action Buttons
  const btnClose = cardElement.querySelector('.btn-close-track');
  btnClose.addEventListener('click', () => removeTrack(trackId));

  const btnCloneThis = cardElement.querySelector('.btn-clone-this');
  btnCloneThis.addEventListener('click', () => cloneTrack(track));

  // Store active track reference
  const trackItem = {
    id: trackId,
    type,
    track,
    stream,
    element: cardElement,
    currentCrop: 'uncropped'
  };
  state.activeTracks.push(trackItem);

  DOM.tracksContainer.appendChild(cardElement);
  log(`Initialized Preview Card for Track #${trackId} (${type}).`, 'info');
}

async function applyCropToTrack(trackId, track, cropKey, cardElement, cropButtons, overlayTag, statusVal) {
  const cropLabels = {
    uncropped: 'Uncropped (Full View)',
    greater: 'Greater Area',
    inner1: 'Inner Region 1 (Color Anim)',
    inner2: 'Inner Region 2 (1s Counter)'
  };

  const target = state.cropTargets[cropKey];

  log(`Track #${trackId}: Invoking cropTo(${cropKey})...`, 'info');
  statusVal.textContent = 'Cropping...';
  statusVal.style.color = '#d29922';

  // Check if cropTo exists on track
  if (typeof track.cropTo !== 'function') {
    const errorMsg = 'track.cropTo() is not supported on this MediaStreamTrack.';
    log(`Track #${trackId} crop error: ${errorMsg}`, 'error');
    statusVal.textContent = 'cropTo unsupported';
    statusVal.style.color = '#f85149';
    alert(errorMsg + '\n\nPlease ensure you are using Chrome 104+ with Region Capture enabled.');
    return;
  }

  try {
    // If target is undefined or null, track reverts to uncropped state
    await track.cropTo(target);

    // Update active button state
    cropButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.crop === cropKey);
    });

    // Update overlay and status
    overlayTag.textContent = cropLabels[cropKey];
    statusVal.textContent = 'Active: ' + cropLabels[cropKey];
    statusVal.style.color = '#3fb950';

    log(`Track #${trackId}: Successfully cropped to [${cropLabels[cropKey]}].`, 'success');
  } catch (err) {
    log(`Track #${trackId}: cropTo() failed: ${err.message}`, 'error');
    statusVal.textContent = `Error: ${err.message}`;
    statusVal.style.color = '#f85149';
  }
}

// ============================================================================
// Layout Dynamic Resizing Toggle
// ============================================================================
let isCompact = false;
function toggleTargetResize() {
  isCompact = !isCompact;
  DOM.targetGreater.classList.toggle('compact-size', isCompact);
  DOM.btnResizeToggle.textContent = isCompact ? '📐 Expand Size' : '📐 Toggle Resize';
  log(`Toggled Target Area size: ${isCompact ? 'Compact (300px)' : 'Standard (420px)'}. Observe how crop bounds adapt seamlessly!`, 'info');
}

// ============================================================================
// Event Listeners & Initialization
// ============================================================================
function init() {
  log('Initializing Multi-Track Region Cropping Demo...', 'info');

  // Animation Controls
  DOM.btnToggleAnim.addEventListener('click', toggleAnimation);
  DOM.btnResizeToggle.addEventListener('click', toggleTargetResize);

  // Capture Controls
  DOM.btnStartCapture.addEventListener('click', startCapture);
  DOM.btnAddClone.addEventListener('click', () => cloneTrack());
  DOM.btnStopAll.addEventListener('click', stopAllCaptures);
  DOM.btnClearLog.addEventListener('click', () => {
    DOM.logConsole.innerHTML = '';
  });

  // Start continuous 10 FPS color animation & 1s counter
  startAnimations();

  // Check API support and produce targets
  checkAPISupport();
  produceCropTargets();
}

window.addEventListener('DOMContentLoaded', init);
