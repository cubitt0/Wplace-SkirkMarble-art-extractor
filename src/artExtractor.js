import { debugLog } from './utils.js';

/** Art Extractor module for extracting pixel art from the canvas
 * @module artExtractor
 * @since 1.0.0
 */

/** Coordinates state for the art extractor
 * @type {{from: Array<number>|null, to: Array<number>|null}}
 */
let extractorCoordinates = {
  from: null, // [tileX, tileY, pixelX, pixelY]
  to: null    // [tileX, tileY, pixelX, pixelY]
};

/** Get current extractor coordinates
 * @returns {{from: Array<number>|null, to: Array<number>|null}}
 */
export function getExtractorCoordinates() {
  return { ...extractorCoordinates };
}

/** Set extractor "from" coordinates
 * @param {Array<number>} coords - [tileX, tileY, pixelX, pixelY]
 */
export function setFromCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length !== 4) {
    console.warn('Invalid coordinates format. Expected [tileX, tileY, pixelX, pixelY]');
    return;
  }
  extractorCoordinates.from = [...coords];
  debugLog('[Art Extractor] From coordinates set:', coords);
}

/** Set extractor "to" coordinates
 * @param {Array<number>} coords - [tileX, tileY, pixelX, pixelY]
 */
export function setToCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length !== 4) {
    console.warn('Invalid coordinates format. Expected [tileX, tileY, pixelX, pixelY]');
    return;
  }
  extractorCoordinates.to = [...coords];
  debugLog('[Art Extractor] To coordinates set:', coords);
}

/** Clear all extractor coordinates
 */
export function clearExtractorCoordinates() {
  extractorCoordinates.from = null;
  extractorCoordinates.to = null;
  debugLog('[Art Extractor] Coordinates cleared');
}

/** Format coordinates as "tileX, tileY, pixelX, pixelY"
 * @param {Array<number>|null} coords - Coordinates array
 * @returns {string} Formatted string
 */
export function formatCoordinates(coords) {
  if (!coords || !Array.isArray(coords) || coords.length !== 4) {
    return '';
  }
  return coords.map(c => c.toString().padStart(4, '0')).join(', ');
}

/** Parse coordinates from string "tileX, tileY, pixelX, pixelY"
 * @param {string} coordString - Coordinate string
 * @returns {Array<number>|null} Parsed coordinates or null if invalid
 */
export function parseCoordinates(coordString) {
  if (!coordString || typeof coordString !== 'string') {
    return null;
  }
  
  const parts = coordString.split(',').map(s => s.trim()).filter(s => s !== '');
  if (parts.length !== 4) {
    return null;
  }
  
  const coords = parts.map(p => parseInt(p, 10));
  if (coords.some(c => isNaN(c))) {
    return null;
  }
  
  return coords;
}

/** Validate coordinate range
 * @param {Array<number>} from - From coordinates [tileX, tileY, pixelX, pixelY]
 * @param {Array<number>} to - To coordinates [tileX, tileY, pixelX, pixelY]
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateCoordinateRange(from, to) {
  if (!from || !to) {
    return { valid: false, error: 'Both coordinates must be set' };
  }
  
  // Convert to global canvas coordinates
  // Each tile is 1000x1000 pixels, local coordinates range from 0-999
  const fromX = from[0] * 1000 + from[2];
  const fromY = from[1] * 1000 + from[3];
  const toX = to[0] * 1000 + to[2];
  const toY = to[1] * 1000 + to[3];
  
  if (fromX > toX || fromY > toY) {
    return { valid: false, error: '"From" coordinates must be top-left of "To" coordinates' };
  }
  
  // Calculate dimensions (inclusive)
  const width = toX - fromX + 1;
  const height = toY - fromY + 1;
  
  if (width <= 0 || height <= 0) {
    return { valid: false, error: 'Invalid rectangle dimensions' };
  }
  
  if (width > 10000 || height > 10000) {
    return { valid: false, error: 'Rectangle too large (max 10000x10000 pixels)' };
  }
  
  return { valid: true, error: null };
}

/** Calculate dimensions from coordinate range
 * @param {Array<number>} from - From coordinates [tileX, tileY, pixelX, pixelY]
 * @param {Array<number>} to - To coordinates [tileX, tileY, pixelX, pixelY]
 * @returns {{width: number, height: number, pixels: number}}
 * 
 * Note: WPlace tiles are 1000x1000 pixels, local coords are 0-999
 * Width/height are inclusive (add 1 to the difference)
 */
export function calculateDimensions(from, to) {
  if (!from || !to) {
    return { width: 0, height: 0, pixels: 0 };
  }
  
  // Convert to global canvas coordinates
  // Each tile is 1000x1000 pixels, local coordinates range from 0-999
  const fromX = from[0] * 1000 + from[2];
  const fromY = from[1] * 1000 + from[3];
  const toX = to[0] * 1000 + to[2];
  const toY = to[1] * 1000 + to[3];
  
  // Calculate dimensions (inclusive on both ends, so add 1)
  // Example: from pixel 0 to pixel 0 = 1 pixel (0 - 0 + 1)
  // Example: from pixel 0 to pixel 999 = 1000 pixels (999 - 0 + 1)
  const width = Math.max(0, toX - fromX + 1);
  const height = Math.max(0, toY - fromY + 1);
  
  return {
    width,
    height,
    pixels: width * height
  };
}

/** Extracts artwork from the canvas based on coordinates using templateManager's screenshot method
 * @param {Array<number>} from - From coordinates [tileX, tileY, pixelX, pixelY]
 * @param {Array<number>} to - To coordinates [tileX, tileY, pixelX, pixelY]
 * @param {Object} templateManager - The templateManager instance with buildTemplateAreaScreenshot method
 * @param {Object} apiManager - The API manager instance to get tileServerBase
 * @param {Function} progressCallback - Optional callback for progress updates (not used with buildTemplateAreaScreenshot)
 * @returns {Promise<Blob>} The extracted art as a PNG blob
 */
export async function extractArt(from, to, templateManager, apiManager, progressCallback = null) {
  debugLog('[Extract Art] Starting extraction...');
  debugLog('[Extract Art] From:', from);
  debugLog('[Extract Art] To:', to);
  
  // Calculate dimensions
  const dims = calculateDimensions(from, to);
  debugLog(`[Extract Art] Area: ${dims.width}×${dims.height} pixels`);
  
  // Get tile server base URL
  const tileServerBase = apiManager?.tileServerBase || 'https://backend.wplace.live/files/s0/tiles';
  debugLog(`[Extract Art] Using tile server: ${tileServerBase}`);
  
  try {
    // Use templateManager's existing buildTemplateAreaScreenshot method
    // Signature: buildTemplateAreaScreenshot(tileServerBase, templateCoords, sizePx)
    const blob = await templateManager.buildTemplateAreaScreenshot(
      tileServerBase,              // Tile server base URL
      from,                        // Starting coordinates [tileX, tileY, pixelX, pixelY]
      [dims.width, dims.height]    // Size in pixels [width, height]
    );
    
    debugLog(`[Extract Art] PNG blob created, size: ${blob.size} bytes`);
    return blob;
  } catch (error) {
    debugLog('[Extract Art] Extraction failed:', error);
    throw error;
  }
}

/** Starts coordinate detection for a specific coordinate type
 * @param {'from'|'to'} type - Which coordinate to detect
 * @param {Function} callback - Callback function when coordinates are detected
 * @param {Object} apiManager - API manager instance to get coordinates from
 * @returns {Function} Cleanup function to stop detection
 */
export function startCoordinateDetection(type, callback, apiManager) {
  debugLog(`[Art Extractor] Starting coordinate detection for "${type}"`);
  
  // Store the initial coordinates to detect changes
  const initialCoords = apiManager?.coordsTilePixel ? [...apiManager.coordsTilePixel] : null;
  const initialCoordsString = initialCoords ? initialCoords.join(',') : '';
  
  debugLog(`[Art Extractor] Initial coordinates:`, initialCoords);
  
  // Create detection overlay indicator
  const indicator = document.createElement('div');
  indicator.id = 'bm-art-extractor-detection';
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    color: white;
    padding: 12px 24px;
    border-radius: 12px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-weight: 600;
    font-size: 14px;
    z-index: 100001;
    box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
    pointer-events: none;
    animation: fadeIn 0.2s ease;
  `;
  indicator.textContent = `Click on canvas to set "${type}" coordinates (ESC to cancel)`;
  document.body.appendChild(indicator);
  
  // Track if detection is active
  let isActive = true;
  let hasDetected = false;
  
  // Check for coordinate updates periodically
  const checkInterval = setInterval(() => {
    if (!isActive || hasDetected) {
      clearInterval(checkInterval);
      return;
    }
    
    // Get current coordinates from API manager
    const currentCoords = apiManager?.coordsTilePixel;
    
    if (!currentCoords || currentCoords.length !== 4) {
      return;
    }
    
    // Create string representation for comparison
    const currentCoordsString = currentCoords.join(',');
    
    // Check if coordinates have changed from initial state
    if (currentCoordsString !== initialCoordsString) {
      // Coordinates have changed - user clicked on canvas
      debugLog(`[Art Extractor] Detected ${type} coordinates change:`, currentCoords);
      debugLog(`[Art Extractor] Old: ${initialCoordsString}, New: ${currentCoordsString}`);
      
      hasDetected = true;
      
      // Call the callback with detected coordinates
      if (typeof callback === 'function') {
        callback([...currentCoords]); // Pass a copy
      }
      
      // Clean up
      cleanup();
    }
  }, 100);
  
  // ESC key handler to cancel
  const handleEscKey = (event) => {
    if (event.key === 'Escape') {
      debugLog('[Art Extractor] Detection cancelled by user');
      cleanup();
    }
  };
  
  // Cleanup function
  const cleanup = () => {
    isActive = false;
    clearInterval(checkInterval);
    indicator.remove();
    document.removeEventListener('keydown', handleEscKey);
    debugLog('[Art Extractor] Detection mode ended');
  };
  
  // Add ESC key listener
  document.addEventListener('keydown', handleEscKey);
  
  // Return cleanup function
  return cleanup;
}
