import { uint8ToBase64, debugLog, colorpaletteForBlueMarble } from "./utils.js";

/** An instance of a template.
 * Handles all mathematics, manipulation, and analysis regarding a single template.
 * @class Template
 * @since 0.65.2
 */
export default class Template {

  /** The constructor for the {@link Template} class with enhanced pixel tracking.
   * @param {Object} [params={}] - Object containing all optional parameters
   * @param {string} [params.displayName='My template'] - The display name of the template
   * @param {number} [params.sortID=0] - The sort number of the template for rendering priority
   * @param {string} [params.authorID=''] - The user ID of the person who exported the template (prevents sort ID collisions)
   * @param {string} [params.url=''] - The URL to the source image
   * @param {File} [params.file=null] - The template file (pre-processed File or processed bitmap)
   * @param {Array<number>} [params.coords=null] - The coordinates of the top left corner as (tileX, tileY, pixelX, pixelY)
   * @param {Object} [params.chunked=null] - The affected chunks of the template, and their template for each chunk
   * @param {Object} [params.chunked32={}] - The affected chunks as Uint32Array for fast pixel comparison
   * @param {number} [params.tileSize=1000] - The size of a tile in pixels (assumes square tiles)
   * @param {number} [params.pixelCount=0] - Total number of pixels in the template (calculated automatically during processing)
   * @since 0.65.2
   */
  constructor({
    displayName = 'My template',
    sortID = 0,
    authorID = '',
    url = '',
    file = null,
    coords = null,
    chunked = null,
    chunked32 = {},
    tileSize = 1000,
  } = {}) {
    this.displayName = displayName;
    this.sortID = sortID;
    this.authorID = authorID;
    this.url = url;
    this.file = file;
    this.coords = coords;
    this.chunked = chunked;
    this.chunked32 = chunked32;
    this.tileSize = tileSize;
    this.pixelCount = 0; // Total pixel count in template
    this.disabledColors = new Set(); // Set of disabled color RGB values as strings "r,g,b"
    this.enhancedColors = new Set(); // Set of enhanced color RGB values as strings "r,g,b"
    
    // Performance optimization: Cache enhanced tiles
    this.enhancedTilesCache = new Map(); // key: tileKey, value: ImageBitmap with crosshair effect
    this.enhancedCacheValid = false; // Track if cache needs to be regenerated
  }

  /** Creates chunks of the template for each tile.
   * Uses OffscreenCanvas and compositing mask for high-performance tile processing.
   * Stores Uint32Array per tile for fast pixel comparison.
   * @param {number} [tileSize] - The size of a tile in pixels (defaults to this.tileSize)
   * @param {Object} [paletteBM] - Palette LUT from colorpaletteForBlueMarble(). Auto-generated if not provided.
   * @returns {Object} Collection of template bitmaps & buffers organized by tile coordinates
   * @since 0.65.4
   */
  async createTemplateTiles(tileSize, paletteBM) {

    if (tileSize) this.tileSize = tileSize;
    if (!paletteBM) paletteBM = colorpaletteForBlueMarble(0);

    const shreadSize = 3; // Scale image factor for pixel art enhancement (must be odd)
    
    // Create bitmap using a more compatible approach
    let bitmap;
    let useFallback = false;
    try {
      bitmap = await createImageBitmap(this.file);
    } catch (error) {
      // Fallback: create image element and canvas
      const img = new Image();
      const fallbackCanvas = document.createElement('canvas');
      const fallbackCtx = fallbackCanvas.getContext('2d');
      
      await new Promise((resolve, reject) => {
        img.onload = () => {
          fallbackCanvas.width = img.width;
          fallbackCanvas.height = img.height;
          fallbackCtx.drawImage(img, 0, 0);
          resolve();
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(this.file);
      });
      
      bitmap = { width: fallbackCanvas.width, height: fallbackCanvas.height, canvas: fallbackCanvas, ctx: fallbackCtx };
      useFallback = true;
    }
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;
    
    // Persist original image dimensions for later calculations (e.g., screenshots)
    this.imageWidth = imageWidth;
    this.imageHeight = imageHeight;

    // -- Calculate total pixels using palette LUT (O(1) per pixel) --
    const totalPixelCanvas = new OffscreenCanvas(imageWidth, imageHeight);
    const totalPixelCtx = totalPixelCanvas.getContext('2d', { willReadFrequently: true });
    totalPixelCtx.imageSmoothingEnabled = false;
    
    if (useFallback) {
      totalPixelCtx.drawImage(bitmap.canvas, 0, 0);
    } else {
      totalPixelCtx.drawImage(bitmap, 0, 0);
    }
    
    const totalPixelMap = this.#calculateTotalPixelsFromImageData(
      totalPixelCtx.getImageData(0, 0, imageWidth, imageHeight), paletteBM
    );

    let totalPixels = 0;
    let validPixels = 0;
    let transparentPixels = 0;
    const transparentColorID = 0;

    for (const [color, total] of totalPixelMap) {
      if (color == transparentColorID) {
        transparentPixels += total;
        continue;
      }
      totalPixels += total;
      validPixels += total;
    }

    this.pixelCount = totalPixels;
    this.validPixelCount = validPixels;
    this.transparentPixelCount = transparentPixels;

    // -- Tile creation with OffscreenCanvas + compositing mask --
    const templateTiles = {};
    const templateTilesBuffers = {};

    const canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // Creates a mask where the middle pixel is white, and everything else is transparent
    const canvasMask = new OffscreenCanvas(3, 3);
    const contextMask = canvasMask.getContext("2d");
    contextMask.clearRect(0, 0, 3, 3);
    contextMask.fillStyle = "white";
    contextMask.fillRect(1, 1, 1, 1);

    // For every tile...
    for (let pixelY = this.coords[3]; pixelY < imageHeight + this.coords[3]; ) {

      const drawSizeY = Math.min(this.tileSize - (pixelY % this.tileSize), imageHeight - (pixelY - this.coords[3]));

      for (let pixelX = this.coords[2]; pixelX < imageWidth + this.coords[2];) {

        const drawSizeX = Math.min(this.tileSize - (pixelX % this.tileSize), imageWidth - (pixelX - this.coords[2]));

        // Change the canvas size and wipe the canvas
        const canvasWidth = drawSizeX * shreadSize;
        const canvasHeight = drawSizeY * shreadSize;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        context.imageSmoothingEnabled = false;

        // Draws the template segment on this tile segment
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        
        const drawSource = useFallback ? bitmap.canvas : bitmap;
        context.drawImage(
          drawSource,
          pixelX - this.coords[2],
          pixelY - this.coords[3],
          drawSizeX,
          drawSizeY,
          0,
          0,
          drawSizeX * shreadSize,
          drawSizeY * shreadSize
        );

        // Apply compositing mask to keep only center pixels of each 3x3 block
        context.save();
        context.globalCompositeOperation = "destination-in";
        context.fillStyle = context.createPattern(canvasMask, "repeat");
        context.fillRect(0, 0, canvasWidth, canvasHeight);
        context.restore();

        // Get image data for post-processing (disabled colors, #deface)
        const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
        let needsPutBack = false;

        // Post-process: handle #deface color and disabled colors
        for (let y = 0; y < canvasHeight; y++) {
          for (let x = 0; x < canvasWidth; x++) {
            const pixelIndex = (y * canvasWidth + x) * 4;
            const r = imageData.data[pixelIndex];
            const g = imageData.data[pixelIndex + 1];
            const b = imageData.data[pixelIndex + 2];
            const a = imageData.data[pixelIndex + 3];

            // Skip already transparent pixels (non-center pixels from mask)
            if (a === 0) continue;

            // Handle #deface color: draw translucent gray checkerboard
            if (r === 222 && g === 250 && b === 206) {
              if ((x + y) % 2 === 0) {
                imageData.data[pixelIndex] = 0;
                imageData.data[pixelIndex + 1] = 0;
                imageData.data[pixelIndex + 2] = 0;
                imageData.data[pixelIndex + 3] = 32;
              } else {
                imageData.data[pixelIndex + 3] = 0;
              }
              needsPutBack = true;
            } else if (this.isColorDisabled([r, g, b])) {
              // Make disabled colors transparent
              imageData.data[pixelIndex + 3] = 0;
              needsPutBack = true;
            }
          }
        }

        if (needsPutBack) {
          context.putImageData(imageData, 0, 0);
        }

        // Creates the "0000,0000,000,000" key name
        const templateTileName = `${(this.coords[0] + Math.floor(pixelX / 1000))
          .toString()
          .padStart(4, '0')},${(this.coords[1] + Math.floor(pixelY / 1000))
          .toString()
          .padStart(4, '0')},${(pixelX % 1000)
          .toString()
          .padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`;

        // Store Uint32Array for fast pixel comparison
        const finalImageData = needsPutBack ? imageData : context.getImageData(0, 0, canvasWidth, canvasHeight);
        this.chunked32[templateTileName] = new Uint32Array(finalImageData.data.buffer);

        // Create bitmap using compatible method
        try {
          templateTiles[templateTileName] = await createImageBitmap(canvas);
        } catch (error) {
          templateTiles[templateTileName] = canvas.transferToImageBitmap?.() ?? await createImageBitmap(canvas);
        }
        
        // Convert canvas to buffer
        try {
          const canvasBlob = await canvas.convertToBlob();
          const canvasBuffer = await canvasBlob.arrayBuffer();
          const canvasBufferBytes = Array.from(new Uint8Array(canvasBuffer));
          templateTilesBuffers[templateTileName] = uint8ToBase64(canvasBufferBytes);
        } catch (error) {
          debugLog('Canvas blob conversion failed for tile:', templateTileName);
          // OffscreenCanvas should always support convertToBlob, but handle edge cases
          templateTilesBuffers[templateTileName] = '';
        }

        pixelX += drawSizeX;
      }

      pixelY += drawSizeY;
    }

    return { templateTiles, templateTilesBuffers };
  }

  /** Calculates the total pixels for each color using the palette LUT for O(1) matching.
   * @param {ImageData} imageData - The image data to analyze
   * @param {Object} paletteBM - The palette and LUT from colorpaletteForBlueMarble()
   * @returns {Map<number, number>} Map of color ID to pixel count
   * @since 0.88.6
   */
  #calculateTotalPixelsFromImageData(imageData, paletteBM) {
    const buffer32Arr = new Uint32Array(imageData.data.buffer);
    const { LUT: lookupTable } = paletteBM;

    const colorCounts = new Map();

    for (let pixelIndex = 0; pixelIndex < buffer32Arr.length; pixelIndex++) {
      const pixel = buffer32Arr[pixelIndex];
      let bestColorID = -2; // Default to "Other"

      if ((pixel >>> 24) == 0) {
        bestColorID = 0; // Transparent
      } else {
        bestColorID = lookupTable.get(pixel) ?? -2;
      }

      const count = colorCounts.get(bestColorID);
      colorCounts.set(bestColorID, count ? count + 1 : 1);
    }

    return colorCounts;
  }

  /** Calculates top left coordinate of template from chunked tile keys.
   * Uses Template.chunked to update Template.coords
   * @since 0.88.504
   */
  calculateCoordsFromChunked() {
    let topLeftCoord = [Infinity, Infinity, Infinity, Infinity];
    const tileKeys = Object.keys(this.chunked).sort();
    tileKeys.forEach((key) => {
      const [tileX, tileY, pixelX, pixelY] = key.split(',').map(Number);
      if ((tileY < topLeftCoord[1]) || (tileY == topLeftCoord[1] && tileX < topLeftCoord[0])) {
        topLeftCoord = [tileX, tileY, pixelX, pixelY];
      }
    });
    this.coords = topLeftCoord;
  }

  /** Disables a specific color in the template
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @since 1.0.0
   */
  disableColor(rgbColor) {
    const colorKey = rgbColor.join(',');
    this.disabledColors.add(colorKey);
  }

  /** Enables a specific color in the template
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @since 1.0.0
   */
  enableColor(rgbColor) {
    const colorKey = rgbColor.join(',');
    this.disabledColors.delete(colorKey);
  }

  /** Checks if a color is disabled
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @returns {boolean} True if color is disabled
   * @since 1.0.0
   */
  isColorDisabled(rgbColor) {
    const colorKey = rgbColor.join(',');
    return this.disabledColors.has(colorKey);
  }

  /** Gets all disabled colors
   * @returns {string[]} Array of disabled color keys "r,g,b"
   * @since 1.0.0
   */
  getDisabledColors() {
    return Array.from(this.disabledColors);
  }

  /** Sets disabled colors from an array
   * @param {string[]} colorKeys - Array of color keys "r,g,b"
   * @since 1.0.0
   */
  setDisabledColors(colorKeys) {
    this.disabledColors = new Set(colorKeys);
  }

  /** Enables enhanced mode for a specific color
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @since 1.0.0
   */
  enableColorEnhanced(rgbColor) {
    const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
    this.enhancedColors.add(colorKey);
    this.invalidateEnhancedCache(); // Regenerate cache when enhanced colors change
  }

  /** Disables enhanced mode for a specific color
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @since 1.0.0
   */
  disableColorEnhanced(rgbColor) {
    const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
    this.enhancedColors.delete(colorKey);
    this.invalidateEnhancedCache(); // Regenerate cache when enhanced colors change
  }

  /** Checks if a specific color has enhanced mode enabled
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @returns {boolean} True if color is enhanced
   * @since 1.0.0
   */
  isColorEnhanced(rgbColor) {
    const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
    return this.enhancedColors.has(colorKey);
  }

  /** Gets the set of enhanced colors as an array
   * @returns {Array<string>} Array of enhanced color strings "r,g,b"
   * @since 1.0.0
   */
  getEnhancedColors() {
    return Array.from(this.enhancedColors);
  }

  /** Sets enhanced colors from an array
   * @param {Array<string>} enhancedColorsArray - Array of color strings "r,g,b"
   * @since 1.0.0
   */
  setEnhancedColors(enhancedColorsArray) {
    this.enhancedColors = new Set(enhancedColorsArray || []);
    this.invalidateEnhancedCache();
  }

  /** Applies color filter to existing chunked tiles without requiring original file
   * This method is used when templates are loaded from storage and don't have the original file
   * @returns {Object} Updated chunked tiles with color filter applied
   * @since 1.0.0
   */
  async applyColorFilterToExistingTiles() {
    if (!this.chunked) {
      throw new Error('No chunked tiles available to apply color filter');
    }

    const shreadSize = 3; // Must match the value used in createTemplateTiles
    const updatedChunked = {};

    for (const [tileName, bitmap] of Object.entries(this.chunked)) {
      // Create a canvas to work with the existing tile
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });

      // Get dimensions from the bitmap
      let width, height;
      if (bitmap.width !== undefined) {
        width = bitmap.width;
        height = bitmap.height;
      } else {
        // For canvas elements
        width = bitmap.width || 300; // fallback
        height = bitmap.height || 300;
      }

      canvas.width = width;
      canvas.height = height;
      context.imageSmoothingEnabled = false;

      // Draw the existing bitmap to canvas
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0);

      // Get image data to process pixels
      const imageData = context.getImageData(0, 0, width, height);

      // Process each pixel to apply color filter
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pixelIndex = (y * width + x) * 4;
          
          // Only process center pixels of the 3x3 shread blocks (same logic as createTemplateTiles)
          if (x % shreadSize !== 1 || y % shreadSize !== 1) {
            continue; // Skip non-center pixels
          }
          
          // Get current pixel RGB values
          const r = imageData.data[pixelIndex];
          const g = imageData.data[pixelIndex + 1];
          const b = imageData.data[pixelIndex + 2];
          const alpha = imageData.data[pixelIndex + 3];
          
          // Skip transparent pixels
          if (alpha === 0) continue;
          
          // Check if this color is disabled
          const isDisabled = this.isColorDisabled([r, g, b]);
          
          if (isDisabled) {
            // Make disabled colors transparent (same as createTemplateTiles logic)
            imageData.data[pixelIndex + 3] = 0;
          }
        }
      }

      // Put the processed image data back to canvas
      context.putImageData(imageData, 0, 0);

      // Create new bitmap from processed canvas
      try {
        updatedChunked[tileName] = await createImageBitmap(canvas);
      } catch (error) {
        console.warn('createImageBitmap failed for tile, using canvas directly');
        updatedChunked[tileName] = canvas.cloneNode(true);
      }
    }

    return updatedChunked;
  }

  /** Creates enhanced tiles with crosshair effect pre-processed for performance.
   * This avoids real-time pixel processing during drawing.
   * @param {Object} originalTiles - The original template tiles
   * @returns {Promise<Map>} Map of enhanced tiles
   * @since 1.0.0
   */
  async createEnhancedTiles(originalTiles) {
    const enhancedTiles = new Map();
    
    for (const [tileKey, originalBitmap] of Object.entries(originalTiles)) {
      try {
        // Create canvas for processing
        const canvas = document.createElement('canvas');
        canvas.width = originalBitmap.width;
        canvas.height = originalBitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        
        // Draw original bitmap
        ctx.drawImage(originalBitmap, 0, 0);
        
        // Get image data for processing
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;
        
        // Create copy of original data for reference
        const originalData = new Uint8ClampedArray(data);
        
        // Find ALL template pixels (non-transparent) - like the old code
        const templatePixels = new Set();
        let totalPixelsChecked = 0;
        let opaquePixelsFound = 0;
        
        console.group(`🔍 [TEMPLATE DETECTION] Scanning ALL template pixels (old logic)`);
        
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const alpha = originalData[i + 3];
            totalPixelsChecked++;
            
            if (alpha > 0) {
              opaquePixelsFound++;
              templatePixels.add(`${x},${y}`);
              
              if (templatePixels.size <= 5) {
                const r = originalData[i];
                const g = originalData[i + 1];
                const b = originalData[i + 2];
              }
            }
          }
        }
        
        debugLog(`Template pixels found: ${templatePixels.size}`);
        
        console.groupEnd();
        
        // Second pass: create crosshair effect around template pixels (OLD LOGIC)
        let crosshairCount = 0;
        let borderCount = 0;
        let transparentCount = 0;
        const borderEnabled = this.getBorderEnabled();
        
        debugLog(`Generating crosshairs for ${templatePixels.size} pixels`);
        // console.log(`Image dimensions: ${width}x${height}`);
        
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const alpha = originalData[i + 3];
            
            // Only modify transparent pixels (leave template pixels with original colors)
            if (alpha === 0) {
              transparentCount++;
              
              // Check for red center positions (orthogonal neighbors)
              const centerPositions = [
                [x, y-1], // top
                [x, y+1], // bottom  
                [x-1, y], // left
                [x+1, y]  // right
              ];
              
              let isCenter = false;
              for (const [cx, cy] of centerPositions) {
                // Skip if out of bounds
                if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
                
                // If there's a template pixel in orthogonal position
                if (templatePixels.has(`${cx},${cy}`)) {
                  isCenter = true;
                  break;
                }
              }
              
              // Check for blue corner positions (diagonal neighbors) 
              const cornerPositions = [
                [x+1, y+1], // bottom-right corner
                [x-1, y+1], // bottom-left corner  
                [x+1, y-1], // top-right corner
                [x-1, y-1]  // top-left corner
              ];
              
              let isCorner = false;
              if (borderEnabled) { // Only check corners if borders are enabled
                for (const [cx, cy] of cornerPositions) {
                  // Skip if out of bounds
                  if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
                  
                  // If there's a template pixel at diagonal position
                  if (templatePixels.has(`${cx},${cy}`)) {
                    isCorner = true;
                    break;
                  }
                }
              }
              
              if (isCenter) {
                // Make orthogonal neighbors red (crosshair center)
                const crosshairColor = this.getCrosshairColor();
                data[i] = crosshairColor.rgb[0];
                data[i + 1] = crosshairColor.rgb[1];
                data[i + 2] = crosshairColor.rgb[2];
                data[i + 3] = crosshairColor.alpha;
                crosshairCount++;
                
                if (crosshairCount <= 5) {
                  debugLog(`Applied crosshair at (${x},${y}) using user color`);
                }
              } else if (isCorner) {
                // Make diagonal neighbors blue (crosshair corners)
                data[i] = 0;       // No red
                data[i + 1] = 100; // Some green
                data[i + 2] = 255; // Full blue
                data[i + 3] = 200; // 80% opacity
                borderCount++;
                
                if (borderCount <= 5) {
                  debugLog(`Applied BLUE border at (${x},${y})`);
                }
              }
            }
          }
        }
        
        debugLog(`OLD LOGIC STATISTICS:`);
        debugLog(`  Template pixels: ${templatePixels.size}`);
        debugLog(`  Transparent pixels: ${transparentCount}`);
        debugLog(`  Crosshairs applied: ${crosshairCount}`);
        debugLog(`  Blue borders applied: ${borderCount}`);
        debugLog(`  Border enabled: ${borderEnabled}`);
        
        if (templatePixels.size === 0) {
          console.warn(`🚨 [CRITICAL] No template pixels found! Template might be completely transparent.`);
        } else if (crosshairCount === 0) {
          console.warn(`⚠️ [ISSUE] Template pixels found but no crosshairs applied! Check template structure.`);
        } else if (borderEnabled && borderCount === 0) {
          console.warn(`⚠️ [BORDER ISSUE] Borders enabled but none applied! Template might not have diagonal space.`);
        } else {
          debugLog(`Crosshairs applied successfully`);
        }
        
        console.groupEnd();
        
        // Put processed data back
        ctx.putImageData(imageData, 0, 0);
        
        // Create bitmap from processed canvas
        const enhancedBitmap = await createImageBitmap(canvas);
        enhancedTiles.set(tileKey, enhancedBitmap);
        
      } catch (error) {
        console.warn(`Failed to create enhanced tile for ${tileKey}:`, error);
        // Fallback to original tile
        enhancedTiles.set(tileKey, originalTiles[tileKey]);
      }
    }
    
    return enhancedTiles;
  }

  /** Invalidates enhanced tiles cache when color filter changes
   * @since 1.0.0
   */
  invalidateEnhancedCache() {
    this.enhancedCacheValid = false;
    this.enhancedTilesCache.clear();
  }

  /** Gets the saved crosshair color from storage
   * @returns {Object} The crosshair color configuration
   * @since 1.0.0 
   */
  getCrosshairColor() {
    try {
      let savedColor = null;
      
      // Try TamperMonkey storage first
      if (typeof GM_getValue !== 'undefined') {
        const saved = GM_getValue('bmCrosshairColor', null);
        if (saved) savedColor = JSON.parse(saved);
      }
      
      // Fallback to localStorage
      if (!savedColor) {
        const saved = localStorage.getItem('bmCrosshairColor');
        if (saved) savedColor = JSON.parse(saved);
      }
      
      if (savedColor) return savedColor;
    } catch (error) {
      console.warn('Failed to load crosshair color:', error);
    }
    
    // Default red color
    return {
      name: 'Red',
      rgb: [255, 0, 0],
      alpha: 255
    };
  }

  /** Gets the border enabled setting from storage
   * @returns {boolean} Whether borders are enabled
   * @since 1.0.0 
   */
  getBorderEnabled() {
    console.group('🔲 [BORDER SETTING] Loading border configuration');
    
    try {
      let borderEnabled = null;
      let source = 'none';
      
      // Try TamperMonkey storage first
      if (typeof GM_getValue !== 'undefined') {
        const saved = GM_getValue('bmCrosshairBorder', null);
        debugLog('TamperMonkey raw value:', saved);
        if (saved !== null) {
          borderEnabled = JSON.parse(saved);
          source = 'TamperMonkey';
        }
      }
      
      // Fallback to localStorage
      if (borderEnabled === null) {
        const saved = localStorage.getItem('bmCrosshairBorder');
        debugLog('localStorage raw value:', saved);
        if (saved !== null) {
          borderEnabled = JSON.parse(saved);
          source = 'localStorage';
        }
      }
      
      if (borderEnabled !== null) {
        debugLog(`Border setting loaded from ${source}:`, borderEnabled);
        return borderEnabled;
      }
    } catch (error) {
      console.error('❌ Failed to load border setting:', error);
    }
    
    // Default to disabled
    debugLog('Using default border setting: false (no saved value found)');
    return false;
  }
}
