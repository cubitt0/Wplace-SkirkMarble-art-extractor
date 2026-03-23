/** @file Template Placer - Drag-to-place image overlay on the wplace.live map
 * Allows users to visually position a template image on the map by dragging
 * or using arrow keys, then confirm to set coordinates.
 * @since 1.1.0
 */

// ─── State ───────────────────────────────────────────────────────────────────
let placerActive = false;
let placerImage = null;       // The <img> overlay element
let placerContainer = null;   // Wrapper div for the image + controls
let placerControls = null;    // The confirm/cancel bar
let placerFile = null;        // The original File object (for later template upload)
let placerFileName = '';
let placerImageWidth = 0;     // Natural width of the image in pixels (= template pixels)
let placerImageHeight = 0;

// Position state – stored as absolute map pixels (0..2048000)
let anchorX = 0;  // Top-left X in absolute map pixel coords
let anchorY = 0;  // Top-left Y in absolute map pixel coords

// Drag state
let isDragging = false;
let dragStartScreenX = 0;
let dragStartScreenY = 0;
let dragStartAnchorX = 0;
let dragStartAnchorY = 0;

// Callbacks
let onConfirmCallback = null;
let onCancelCallback = null;

// Optional initial position for move operations
let _initialPosition = null;

// Map references (cached)
let _map = null;
let _mapCanvas = null;

const MAP_SIZE = 2048000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMap() {
  if (!_map) {
    try { _map = unsafeWindow.bmmap; } catch { /* will retry */ }
  }
  return _map;
}

function getMapCanvas() {
  if (!_mapCanvas || !_mapCanvas.isConnected) {
    _mapCanvas = document.querySelector('div#map canvas.maplibregl-canvas');
  }
  return _mapCanvas;
}

function getMapContainer() {
  return document.querySelector('div#map');
}

/** Convert absolute map pixel → lng/lat */
function absoluteToLngLat(absX, absY) {
  const x = absX / MAP_SIZE;
  const y = absY / MAP_SIZE;
  const lng = 360 * x - 180;
  const lat = (Math.atan(Math.exp(Math.PI - 2 * Math.PI * y)) - Math.PI / 4) * 360 / Math.PI;
  return { lng, lat };
}

/** Convert lng/lat → absolute map pixel */
function lngLatToAbsolute(lng, lat) {
  const x = (lng + 180) / 360;
  const latRad = lat * Math.PI / 180;
  const y = (Math.PI - Math.log(Math.tan(Math.PI / 4 + latRad / 2))) / (2 * Math.PI);
  return {
    absX: x * MAP_SIZE,
    absY: y * MAP_SIZE
  };
}

/** Convert absolute map pixel → position relative to the map container */
function absoluteToScreen(absX, absY) {
  const map = getMap();
  if (!map || !map.transform) return null;

  const { lng, lat } = absoluteToLngLat(absX, absY);

  const t = map.transform;
  const center = t.center;
  const zoom = t.zoom;
  const width = t.width || window.innerWidth;
  const height = t.height || window.innerHeight;

  const centerLng = center['lng'];
  const centerLat = center['lat'];
  if (centerLng === undefined || centerLat === undefined || zoom === undefined) return null;

  const worldSize = 512 * Math.pow(2, zoom);
  const canvasCenterX = width / 2;
  const canvasCenterY = height / 2;

  // Reverse of screen→absolute: from lng/lat → canvas offset
  const lngPerPixel = 360 / worldSize;
  const offsetX = (lng - centerLng) / lngPerPixel;

  const centerLatRad = centerLat * Math.PI / 180;
  const centerMercY = Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2));
  const latRad = lat * Math.PI / 180;
  const targetMercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const mercYPerPixel = 2 * Math.PI / worldSize;
  const offsetY = (centerMercY - targetMercY) / mercYPerPixel;

  return {
    x: canvasCenterX + offsetX,
    y: canvasCenterY + offsetY
  };
}

/** Convert screen pixel → absolute map pixel */
function screenToAbsolute(screenX, screenY) {
  const map = getMap();
  const canvas = getMapCanvas();
  if (!map || !map.transform || !canvas) return null;

  const rect = canvas.getBoundingClientRect();
  const canvasX = screenX - rect.left;
  const canvasY = screenY - rect.top;

  const t = map.transform;
  const center = t.center;
  const zoom = t.zoom;
  const width = t.width || window.innerWidth;
  const height = t.height || window.innerHeight;

  const centerLng = center['lng'];
  const centerLat = center['lat'];
  if (centerLng === undefined || centerLat === undefined || zoom === undefined) return null;

  const worldSize = 512 * Math.pow(2, zoom);
  const canvasCenterX = width / 2;
  const canvasCenterY = height / 2;
  const offsetX = canvasX - canvasCenterX;
  const offsetY = canvasY - canvasCenterY;

  const lngPerPixel = 360 / worldSize;
  const lng = centerLng + offsetX * lngPerPixel;

  const centerLatRad = centerLat * Math.PI / 180;
  const mercY = Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2));
  const mercYPerPixel = 2 * Math.PI / worldSize;
  const newMercY = mercY - offsetY * mercYPerPixel;
  const lat = (2 * Math.atan(Math.exp(newMercY)) - Math.PI / 2) * 180 / Math.PI;

  return lngLatToAbsolute(lng, lat);
}

/** Get the current scale: how many screen pixels per one map pixel */
function getMapScale() {
  const map = getMap();
  if (!map || !map.transform) return 1;

  const zoom = map.transform.zoom;
  const worldSize = 512 * Math.pow(2, zoom);
  // worldSize screen pixels cover 360 degrees of longitude
  // MAP_SIZE absolute pixels also cover 360 degrees
  return worldSize / MAP_SIZE;
}

/** Convert absolute pixel coords to tile/pixel coordinates */
function absoluteToTilePixel(absX, absY) {
  const ax = Math.floor(absX);
  const ay = Math.floor(absY);
  return {
    tileX: Math.floor(ax / 1000),
    tileY: Math.floor(ay / 1000),
    pixelX: ((ax % 1000) + 1000) % 1000,
    pixelY: ((ay % 1000) + 1000) % 1000
  };
}

// ─── Overlay positioning ─────────────────────────────────────────────────────

function updateOverlayPosition() {
  if (!placerImage || !placerActive) return;

  const topLeft = absoluteToScreen(anchorX, anchorY);
  if (!topLeft) return;

  const scale = getMapScale();

  // The image represents placerImageWidth × placerImageHeight map pixels
  const displayW = placerImageWidth * scale;
  const displayH = placerImageHeight * scale;

  placerImage.style.left = `${topLeft.x}px`;
  placerImage.style.top = `${topLeft.y}px`;
  placerImage.style.width = `${displayW}px`;
  placerImage.style.height = `${displayH}px`;

  // Update coordinate display
  updateCoordsDisplay();
}

function updateCoordsDisplay() {
  const coordsEl = placerContainer?.querySelector('#bm-placer-coords');
  if (!coordsEl) return;
  const tp = absoluteToTilePixel(anchorX, anchorY);
  coordsEl.textContent = `Tile: ${tp.tileX}, ${tp.tileY}  Pixel: ${tp.pixelX}, ${tp.pixelY}`;
}

// ─── Event handlers ──────────────────────────────────────────────────────────

function onMouseDown(e) {
  if (!placerActive || e.button !== 0) return;

  // Only start drag if clicking on the image
  const rect = placerImage.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

  e.preventDefault();
  e.stopPropagation();

  isDragging = true;
  dragStartScreenX = e.clientX;
  dragStartScreenY = e.clientY;
  dragStartAnchorX = anchorX;
  dragStartAnchorY = anchorY;
  placerImage.style.cursor = 'grabbing';
}

function onMouseMove(e) {
  if (!isDragging) return;

  e.preventDefault();
  e.stopPropagation();

  const scale = getMapScale();
  if (scale <= 0) return;

  const dx = (e.clientX - dragStartScreenX) / scale;
  const dy = (e.clientY - dragStartScreenY) / scale;

  anchorX = dragStartAnchorX + dx;
  anchorY = dragStartAnchorY + dy;

  updateOverlayPosition();
}

function onMouseUp(e) {
  if (!isDragging) return;
  e.preventDefault();
  e.stopPropagation();
  isDragging = false;
  placerImage.style.cursor = 'grab';
}

function onKeyDown(e) {
  if (!placerActive) return;

  // Ignore if typing in an input
  const tag = e.target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;

  let dx = 0;
  let dy = 0;
  const step = e.shiftKey ? 10 : 1;

  switch (e.key) {
    case 'ArrowUp':    dy = -step; break;
    case 'ArrowDown':  dy =  step; break;
    case 'ArrowLeft':  dx = -step; break;
    case 'ArrowRight': dx =  step; break;
    case 'Escape':     cancelPlacer(); return;
    case 'Enter':      confirmPlacer(); return;
    default: return;
  }

  e.preventDefault();
  e.stopPropagation();

  anchorX += dx;
  anchorY += dy;
  updateOverlayPosition();
}

function onMapRender() {
  updateOverlayPosition();
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Start the template placer.
 * @param {File} file - Image file to place
 * @param {Object} options
 * @param {Function} options.onConfirm - Called with { file, fileName, tileX, tileY, pixelX, pixelY }
 * @param {Function} [options.onCancel] - Called when user cancels
 * @param {Object} [options.initialPosition] - Optional starting position { absX, absY } in absolute map pixels
 */
export function startPlacer(file, { onConfirm, onCancel, initialPosition } = {}) {
  if (placerActive) {
    cancelPlacer();
  }

  onConfirmCallback = onConfirm || null;
  onCancelCallback = onCancel || null;
  placerFile = file;
  placerFileName = file.name.replace(/\.[^/.]+$/, '');
  _initialPosition = initialPosition || null;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      placerImageWidth = img.naturalWidth;
      placerImageHeight = img.naturalHeight;
      initOverlay(img.src);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function initOverlay(imageSrc) {
  const map = getMap();
  const mapContainer = getMapContainer();
  if (!map || !mapContainer) {
    console.error('[TemplatePlacer] Map not ready');
    return;
  }

  placerActive = true;

  // Use initial position if provided, otherwise center on viewport
  if (_initialPosition) {
    anchorX = _initialPosition.absX;
    anchorY = _initialPosition.absY;
    _initialPosition = null;
  } else {
    const canvas = getMapCanvas();
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const centerScreen = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };

    const centerAbs = screenToAbsolute(centerScreen.x, centerScreen.y);
    if (centerAbs) {
      anchorX = centerAbs.absX - placerImageWidth / 2;
      anchorY = centerAbs.absY - placerImageHeight / 2;
    }
  }

  // Create container (absolute, covers the map)
  placerContainer = document.createElement('div');
  placerContainer.id = 'bm-template-placer';
  placerContainer.style.cssText = `
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
    overflow: hidden;
  `;

  // Create the image overlay
  placerImage = document.createElement('img');
  placerImage.src = imageSrc;
  placerImage.draggable = false;
  placerImage.style.cssText = `
    position: absolute;
    pointer-events: auto;
    cursor: grab;
    opacity: 0.65;
    image-rendering: pixelated;
    border: 2px dashed #22d3ee;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.5);
    user-select: none;
    z-index: 1;
    max-width: none !important;
    max-height: none !important;
  `;

  placerContainer.appendChild(placerImage);

  // Create control bar
  placerControls = document.createElement('div');
  placerControls.id = 'bm-placer-controls';
  placerControls.style.cssText = `
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 12px;
    padding: 10px 20px;
    z-index: 999999;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
    box-shadow: 0 8px 30px rgba(0,0,0,0.4);
    pointer-events: auto;
  `;

  // Info text
  const info = document.createElement('span');
  info.textContent = 'Drag image or use Arrow keys • ';
  info.style.cssText = 'opacity: 0.8; white-space: nowrap;';

  // Coords display
  const coords = document.createElement('span');
  coords.id = 'bm-placer-coords';
  coords.style.cssText = 'font-family: "Roboto Mono", monospace; color: #38bdf8; white-space: nowrap;';

  // Confirm button
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✓ Confirm';
  confirmBtn.style.cssText = `
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: white;
    border: none;
    padding: 6px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    white-space: nowrap;
  `;
  confirmBtn.onmouseenter = () => { confirmBtn.style.transform = 'translateY(-1px)'; confirmBtn.style.boxShadow = '0 4px 12px rgba(34,197,94,0.4)'; };
  confirmBtn.onmouseleave = () => { confirmBtn.style.transform = ''; confirmBtn.style.boxShadow = ''; };
  confirmBtn.onclick = () => confirmPlacer();

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✕ Cancel';
  cancelBtn.style.cssText = `
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: white;
    border: none;
    padding: 6px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    white-space: nowrap;
  `;
  cancelBtn.onmouseenter = () => { cancelBtn.style.transform = 'translateY(-1px)'; cancelBtn.style.boxShadow = '0 4px 12px rgba(239,68,68,0.4)'; };
  cancelBtn.onmouseleave = () => { cancelBtn.style.transform = ''; cancelBtn.style.boxShadow = ''; };
  cancelBtn.onclick = () => cancelPlacer();

  placerControls.appendChild(info);
  placerControls.appendChild(coords);
  placerControls.appendChild(confirmBtn);
  placerControls.appendChild(cancelBtn);

  // Insert into map container (not document.body — so it moves with the map div)
  mapContainer.appendChild(placerContainer);
  document.body.appendChild(placerControls);

  // Initial position
  updateOverlayPosition();

  // Bind events
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keydown', onKeyDown, true);

  // Listen to map render events to keep the overlay in sync during pan/zoom
  try {
    map.on('move', onMapRender);
    map.on('zoom', onMapRender);
    map.on('resize', onMapRender);
  } catch { /* map might not support .on() in all cases */ }
}

function confirmPlacer() {
  if (!placerActive) return;

  const tp = absoluteToTilePixel(anchorX, anchorY);

  const result = {
    file: placerFile,
    fileName: placerFileName,
    tileX: tp.tileX,
    tileY: tp.tileY,
    pixelX: tp.pixelX,
    pixelY: tp.pixelY
  };

  console.log('[TemplatePlacer] Confirming placement:', result.fileName,
    `Tile(${result.tileX}, ${result.tileY}) Pixel(${result.pixelX}, ${result.pixelY})`,
    'file:', result.file);

  // Save callback reference BEFORE cleanup (cleanup nullifies it)
  const callback = onConfirmCallback;

  cleanup();

  if (typeof callback === 'function') {
    console.log('[TemplatePlacer] Calling onConfirm callback');
    callback(result);
  } else {
    console.error('[TemplatePlacer] No onConfirm callback!');
  }
}

function cancelPlacer() {
  const callback = onCancelCallback;
  cleanup();
  if (typeof callback === 'function') {
    callback();
  }
}

function cleanup() {
  placerActive = false;
  isDragging = false;

  const map = getMap();
  try {
    map?.off('move', onMapRender);
    map?.off('zoom', onMapRender);
    map?.off('resize', onMapRender);
  } catch { /* ignore */ }

  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('keydown', onKeyDown, true);

  placerContainer?.remove();
  placerControls?.remove();

  placerImage = null;
  placerContainer = null;
  placerControls = null;
  placerFile = null;
  onConfirmCallback = null;
  onCancelCallback = null;
}

/** Whether the placer is currently active */
export function isPlacerActive() {
  return placerActive;
}

/** Programmatically cancel the placer */
export { cancelPlacer };
