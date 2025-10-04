import { debugLog } from './utils.js';

/** Art Extractor - Extracts pixel art from canvas areas */

let extractorCoordinates = {
  from: null,
  to: null
};

export function getExtractorCoordinates() {
  return { ...extractorCoordinates };
}

export function setFromCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length !== 4) {
    console.warn('Invalid coordinates format. Expected [tileX, tileY, pixelX, pixelY]');
    return;
  }
  // Ensure all coordinates are stored as numbers
  extractorCoordinates.from = coords.map(c => Number(c));
}

export function setToCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length !== 4) {
    console.warn('Invalid coordinates format. Expected [tileX, tileY, pixelX, pixelY]');
    return;
  }
  // Ensure all coordinates are stored as numbers
  extractorCoordinates.to = coords.map(c => Number(c));
}

export function clearExtractorCoordinates() {
  extractorCoordinates.from = null;
  extractorCoordinates.to = null;
}

export function formatCoordinates(coords) {
  if (!coords || !Array.isArray(coords) || coords.length !== 4) {
    return '';
  }
  return coords.map(c => c.toString().padStart(4, '0')).join(', ');
}

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

export function validateCoordinateRange(from, to) {
  if (!from || !to) {
    return { valid: false, error: 'Both coordinates must be set' };
  }
  
  const fromX = from[0] * 1000 + from[2];
  const fromY = from[1] * 1000 + from[3];
  const toX = to[0] * 1000 + to[2];
  const toY = to[1] * 1000 + to[3];
  
  if (fromX > toX || fromY > toY) {
    return { valid: false, error: '"From" coordinates must be top-left of "To" coordinates' };
  }
  
  const width = toX - fromX + 1;
  const height = toY - fromY + 1;
  
  if (width <= 0 || height <= 0) {
    return { valid: false, error: 'Invalid rectangle dimensions' };
  }
  
  return { valid: true, error: null };
}

export function calculateDimensions(from, to) {
  if (!from || !to) {
    return { width: 0, height: 0, pixels: 0 };
  }
  
  if (!Array.isArray(from) || from.length !== 4 || !Array.isArray(to) || to.length !== 4) {
    console.error('[Art Extractor] Invalid coordinate format:', { from, to });
    return { width: 0, height: 0, pixels: 0 };
  }

  const fromX = Number(from[0]) * 1000 + Number(from[2]);
  const fromY = Number(from[1]) * 1000 + Number(from[3]);
  const toX = Number(to[0]) * 1000 + Number(to[2]);
  const toY = Number(to[1]) * 1000 + Number(to[3]);
  
  const width = Math.max(0, toX - fromX + 1);
  const height = Math.max(0, toY - fromY + 1);
  
  return {
    width,
    height,
    pixels: width * height
  };
}

export async function extractArt(from, to, templateManager, apiManager, progressCallback = null) {
  const dims = calculateDimensions(from, to);
  const tileServerBase = apiManager?.tileServerBase || 'https://backend.wplace.live/files/s0/tiles';
  
  try {
    const blob = await templateManager.buildTemplateAreaScreenshot(
      tileServerBase,
      from,
      [dims.width, dims.height]
    );
    
    return blob;
  } catch (error) {
    console.error('[Art Extractor] Extraction failed:', error);
    throw error;
  }
}

export function startCoordinateDetection(type, callback, apiManager) {
  const initialCoords = apiManager?.coordsTilePixel ? [...apiManager.coordsTilePixel] : null;
  const initialCoordsString = initialCoords ? initialCoords.join(',') : '';
  
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
  
  let isActive = true;
  let hasDetected = false;
  
  const checkInterval = setInterval(() => {
    if (!isActive || hasDetected) {
      clearInterval(checkInterval);
      return;
    }
    
    const currentCoords = apiManager?.coordsTilePixel;
    if (!currentCoords || currentCoords.length !== 4) {
      return;
    }
    
    const currentCoordsString = currentCoords.join(',');
    
    if (currentCoordsString !== initialCoordsString) {
      hasDetected = true;
      
      if (typeof callback === 'function') {
        callback([...currentCoords]);
      }
      
      cleanup();
    }
  }, 100);
  
  const handleEscKey = (event) => {
    if (event.key === 'Escape') {
      cleanup();
    }
  };
  
  const cleanup = () => {
    isActive = false;
    clearInterval(checkInterval);
    indicator.remove();
    document.removeEventListener('keydown', handleEscKey);
  };
  
  document.addEventListener('keydown', handleEscKey);
  
  return cleanup;
}
