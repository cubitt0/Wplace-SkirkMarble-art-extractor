import { debugLog } from './utils.js';

/** Art Extractor - Extracts pixel art from canvas areas */

let extractorCoordinates = {
  from: null,
  to: null
};

let previewTemplate = null; // Stores the temporary preview template

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

export function clearPreviewTemplate() {
  previewTemplate = null;
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

export async function updatePreviewRectangle(templateManager) {
  if (previewTemplate) {
    await templateManager.deleteTemplate(previewTemplate);
    previewTemplate = null;
    
    // Small delay to ensure deletion is complete and caches are cleared
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  if (!extractorCoordinates.from || !extractorCoordinates.to) {
    return;
  }

  const dims = calculateDimensions(extractorCoordinates.from, extractorCoordinates.to);
  if (dims.width <= 0 || dims.height <= 0) {
    return;
  }

  const [fromTileX, fromTileY, fromPixelX, fromPixelY] = extractorCoordinates.from;
  const [toTileX, toTileY, toPixelX, toPixelY] = extractorCoordinates.to;

  // Calculate absolute pixel coordinates
  const startX = fromTileX * 1000 + fromPixelX;
  const startY = fromTileY * 1000 + fromPixelY;
  const endX = toTileX * 1000 + toPixelX;
  const endY = toTileY * 1000 + toPixelY;

  // Determine which tiles we need to cover
  const tileStartX = Math.floor(startX / 1000);
  const tileStartY = Math.floor(startY / 1000);
  const tileEndX = Math.floor(endX / 1000);
  const tileEndY = Math.floor(endY / 1000);

  // Create template JSON structure
  const templateJSON = {
    templates: {
      '10000 extractor-preview': {
        name: '🎯 Art Extractor Preview',
        coords: `${fromTileX}, ${fromTileY}, ${fromPixelX}, ${fromPixelY}`,
        createdAt: new Date().toISOString(),
        pixelCount: dims.pixels,
        enabled: true,
        disabledColors: [],
        enhancedColors: [],
        tiles: {}
      }
    }
  };

  for (let tileY = tileStartY; tileY <= tileEndY; tileY++) {
    for (let tileX = tileStartX; tileX <= tileEndX; tileX++) {
      const tileAbsX = tileX * 1000;
      const tileAbsY = tileY * 1000;
      
      const localStartX = Math.max(0, startX - tileAbsX);
      const localStartY = Math.max(0, startY - tileAbsY);
      const localEndX = Math.min(999, endX - tileAbsX);
      const localEndY = Math.min(999, endY - tileAbsY);
      
      const tileWidth = localEndX - localStartX + 1;
      const tileHeight = localEndY - localStartY + 1;
      
      if (tileWidth <= 0 || tileHeight <= 0) continue;

      const drawMult = 3;
      const scaledWidth = tileWidth * drawMult;
      const scaledHeight = tileHeight * drawMult;
      
      const canvas = new OffscreenCanvas(scaledWidth, scaledHeight);
      const ctx = canvas.getContext('2d');
      
      const borderWidth = 1 * drawMult;
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
      
      // Top edge
      if (tileY === tileStartY) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(scaledWidth, 0);
        ctx.stroke();
      }
      
      // Bottom edge
      if (tileY === tileEndY) {
        ctx.beginPath();
        ctx.moveTo(0, scaledHeight);
        ctx.lineTo(scaledWidth, scaledHeight);
        ctx.stroke();
      }
      
      // Left edge
      if (tileX === tileStartX) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, scaledHeight);
        ctx.stroke();
      }
      
      // Right edge
      if (tileX === tileEndX) {
        ctx.beginPath();
        ctx.moveTo(scaledWidth, 0);
        ctx.lineTo(scaledWidth, scaledHeight);
        ctx.stroke();
      }
      
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      
      const tileKey = `${tileX.toString().padStart(4, '0')},${tileY.toString().padStart(4, '0')},${localStartX.toString().padStart(3, '0')},${localStartY.toString().padStart(3, '0')}`;
      
      templateJSON.templates['10000 extractor-preview'].tiles[tileKey] = base64;
    }
  }

  await templateManager.importFromObject(templateJSON, { merge: true });
  previewTemplate = '10000 extractor-preview';
}
