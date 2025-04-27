import type { ImageResolutions } from '../types';
import { safeGet } from '../utils';

// Define screen coverage thresholds for different resolutions (in percentage)
export const COVERAGE_THRESHOLDS = {
  HIGH: 150,     // Original resolution when overlay covers 15% or more of the screen
  MEDIUM: 0.5,   // Medium resolution when overlay covers between 5-15% of the screen
  LOW: 0.1,      // Small resolution when overlay covers between 0.5-5% of the screen
  // Below 0.5% coverage, use thumbnail
};

/**
 * Get appropriate image URL based on how much screen the overlay covers
 */
export function getImageUrlForCoverage(imageResolutions: ImageResolutions | undefined, coveragePercent: number): string {
  if (!imageResolutions) return '';
  
  // Get original image URL with fallback to empty string
  const original = imageResolutions.original || '';
  
  // If only original is available, use it
  if (!imageResolutions.medium && !imageResolutions.small && !imageResolutions.thumbnail) {
    return original;
  }

  // Select resolution based on coverage thresholds
  if (coveragePercent >= COVERAGE_THRESHOLDS.HIGH) {
    return original;
  } else if (coveragePercent >= COVERAGE_THRESHOLDS.MEDIUM) {
    return imageResolutions.medium || original;
  } else if (coveragePercent >= COVERAGE_THRESHOLDS.LOW) {
    return imageResolutions.small || imageResolutions.medium || original;
  } else {
    return imageResolutions.thumbnail || imageResolutions.small || imageResolutions.medium || original;
  }
}

/**
 * Generate lower resolution versions of an image
 */
export async function generateImageResolutions(originalImageUrl: string): Promise<ImageResolutions> {
  // Initialize with original URL
  const resolutions: ImageResolutions = { original: originalImageUrl };

  try {
    const img = await loadImage(originalImageUrl);
    
    // Skip resizing for small images
    if (img.width < 500 && img.height < 500) {
      return {
        original: originalImageUrl,
        medium: originalImageUrl,
        small: originalImageUrl,
        thumbnail: originalImageUrl
      };
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolutions;

    // Generate medium resolution (50% of original)
    resolutions.medium = await generateResizedImage(
      img, canvas, ctx, 
      Math.floor(img.width * 0.5), 
      Math.floor(img.height * 0.5), 
      0.8
    ) || originalImageUrl;

    // Generate small resolution (25% of original)
    resolutions.small = await generateResizedImage(
      img, canvas, ctx, 
      Math.floor(img.width * 0.25), 
      Math.floor(img.height * 0.25), 
      0.7
    ) || originalImageUrl;

    // Generate thumbnail (10% of original or 100px width, whichever is smaller)
    const thumbnailWidth = Math.min(Math.floor(img.width * 0.1), 100);
    const thumbnailHeight = Math.floor((thumbnailWidth / img.width) * img.height);
    resolutions.thumbnail = await generateResizedImage(
      img, canvas, ctx, 
      thumbnailWidth, 
      thumbnailHeight, 
      0.6
    ) || originalImageUrl;

    return resolutions;
  } catch (error) {
    console.error('Error in image resizing process:', error);
    return {
      original: originalImageUrl,
      medium: originalImageUrl,
      small: originalImageUrl,
      thumbnail: originalImageUrl
    };
  }
}

/**
 * Helper to load an image and return a promise
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    
    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      reject(new Error('Image load timeout'));
    }, 10000);
    
    img.src = url;
  });
}

/**
 * Helper to generate a resized image from canvas
 */
function generateResizedImage(
  img: HTMLImageElement, 
  canvas: HTMLCanvasElement, 
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  quality: number
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    } catch (error) {
      console.error(`Error generating ${width}x${height} resolution:`, error);
      resolve(null);
    }
  });
}