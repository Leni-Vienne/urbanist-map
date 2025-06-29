import type { ImageResolutions } from '@types';

/**
 * AI: Get appropriate image URL based on displayed image size (pixels) versus the original size.
 */
export function getImageUrlForCoverage(imageResolutions: ImageResolutions | undefined, bounds: L.LatLngBounds, map: L.Map | null): string {
  if (!imageResolutions || !map || !bounds?.isValid?.()) return imageResolutions?.original || '';
  
  const original = imageResolutions.original || '';
  
  // Use original if no other resolutions available
  if (!imageResolutions.medium && !imageResolutions.small) {
    return original;
  }

  try {
    const ne = map.latLngToContainerPoint(bounds.getNorthEast());
    const sw = map.latLngToContainerPoint(bounds.getSouthWest());
    const displayedWidth = Math.abs(ne.x - sw.x);

    if (imageResolutions.originalWidth) {
      const ratio = displayedWidth / imageResolutions.originalWidth;

      if (ratio > 0.375) return original;
      if (ratio > 0.175) return imageResolutions.medium || original;
      return imageResolutions.small || imageResolutions.medium || original;
    }
  } catch (error) {
    console.error('Error getting image resolution:', error);
    return original;
  }
  
  return original;
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
        originalWidth: img.width,
        originalHeight: img.height
      };
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolutions;    // AI : Generate medium resolution (50% of original)
    const mediumWidth = Math.floor(img.width * 0.5);
    const mediumHeight = Math.floor(img.height * 0.5);
    resolutions.medium = await generateResizedImage(
      img, canvas, ctx, 
      mediumWidth,
      mediumHeight
    ) || originalImageUrl;    // AI : Generate small resolution (25% of original)
    const smallWidth = Math.floor(img.width * 0.25);
    const smallHeight = Math.floor(img.height * 0.25);
    resolutions.small = await generateResizedImage(
      img, canvas, ctx, 
      smallWidth,
      smallHeight
    ) || originalImageUrl;

    return resolutions;
  } catch (error) {
    console.error('Error in image resizing process:', error);
    return {
      original: originalImageUrl,
      medium: originalImageUrl,
      small: originalImageUrl
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
  height: number
): Promise<string | null> {  return new Promise((resolve) => {
    try {
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/webp'));
    } catch (error) {
      console.error(`Error generating ${width}x${height} resolution:`, error);
      resolve(null);
    }
  });
}