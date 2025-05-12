import type { ImageResolutions } from '@types';

/**
 * AI: Get appropriate image URL based on display size
 */
export function getImageUrlForCoverage(imageResolutions: ImageResolutions | undefined, bounds: L.LatLngBounds, map: L.Map | null): string {
  if (!imageResolutions || !map || !bounds?.isValid?.()) return imageResolutions?.original || '';
  
  const original = imageResolutions.original || '';
  
  // Use original if no other resolutions available
  if (!imageResolutions.medium && !imageResolutions.small && !imageResolutions.thumbnail) {
    return original;
  }

  try {
    // Calculate image display size in pixels
    const ne = map.latLngToContainerPoint(bounds.getNorthEast());
    const sw = map.latLngToContainerPoint(bounds.getSouthWest());
    const displayWidth = Math.abs(ne.x - sw.x);
    console.log('Display width:', displayWidth, 'original width:', imageResolutions.originalWidth, 'ratio:', displayWidth / (imageResolutions.originalWidth || 1));
    // Use stored original dimensions
    if (imageResolutions.originalWidth) {
      const ratio = displayWidth / imageResolutions.originalWidth;
      
      // Select resolution based on % of original size needed
      // 0.3 is a good ratio !
      if (ratio > 0.3) return original;
      if (ratio > 0.1) return imageResolutions.medium || original;
      if (ratio > 0.05) return imageResolutions.small || imageResolutions.medium || original;
      return imageResolutions.thumbnail || imageResolutions.small || imageResolutions.medium || original;
    }
  } catch (error) {
    console.error('Error getting image resolution:', error);
    return original;
  }
}

/**
 * Generate lower resolution versions of an image
 */
export async function generateImageResolutions(originalImageUrl: string): Promise<ImageResolutions> {
  // AI : Initialize with original URL
  const resolutions: ImageResolutions = { original: originalImageUrl };

  try {
    const img = await loadImage(originalImageUrl);
    
    // AI : Store original dimensions
    resolutions.originalWidth = img.width;
    resolutions.originalHeight = img.height;
    
    // AI : Skip resizing for small images
    if (img.width < 500 && img.height < 500) {
      return {
        original: originalImageUrl,
        medium: originalImageUrl,
        small: originalImageUrl,
        thumbnail: originalImageUrl,
        originalWidth: img.width,
        originalHeight: img.height
      };
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolutions;

    // AI : Generate medium resolution (50% of original)
    const mediumWidth = Math.floor(img.width * 0.5);
    const mediumHeight = Math.floor(img.height * 0.5);
    resolutions.medium = await generateResizedImage(
      img, canvas, ctx, 
      mediumWidth,
      mediumHeight, 
      0.8
    ) || originalImageUrl;

    // AI : Generate small resolution (25% of original)
    const smallWidth = Math.floor(img.width * 0.25);
    const smallHeight = Math.floor(img.height * 0.25);
    resolutions.small = await generateResizedImage(
      img, canvas, ctx, 
      smallWidth,
      smallHeight, 
      0.7
    ) || originalImageUrl;

    // AI : Generate thumbnail (10% of original or 100px width, whichever is smaller)
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
 * AI : Helper to load an image and return a promise
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    
    // AI : Add timeout to prevent hanging
    setTimeout(() => {
      reject(new Error('Image load timeout'));
    }, 10000);
    
    img.src = url;
  });
}

/**
 * AI : Helper to generate a resized image from canvas
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