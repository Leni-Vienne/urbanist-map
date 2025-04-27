import type { ImageResolutions } from '../types';

// Define screen coverage thresholds for different resolutions (in percentage)
export const COVERAGE_THRESHOLDS = {
  HIGH: 15,       // Original resolution when overlay covers 15% or more of the screen
  MEDIUM: 5,      // Medium resolution when overlay covers between 5-15% of the screen
  LOW: 0.5,       // Small resolution when overlay covers between 0.5-5% of the screen
  // Below 0.5% coverage, use thumbnail
};

/**
 * Get appropriate image URL based on how much screen the overlay covers
 */
export function getImageUrlForCoverage(imageResolutions: ImageResolutions | undefined, coveragePercent: number): string {
  console.log('Coverage Percent:', coveragePercent);
  if (!imageResolutions) {
    console.warn('No imageResolutions provided');
    return '';
  }

  // If only original is available, use it regardless of coverage
  if (!imageResolutions.medium && !imageResolutions.small && !imageResolutions.thumbnail) {
    console.log('Only original resolution available, using it');
    return imageResolutions.original;
  }

  let selectedUrl = '';
  if (coveragePercent >= COVERAGE_THRESHOLDS.HIGH) {
    selectedUrl = imageResolutions.original;
    console.log('Using ORIGINAL resolution - coverage above', COVERAGE_THRESHOLDS.HIGH);
  } else if (coveragePercent >= COVERAGE_THRESHOLDS.MEDIUM) {
    selectedUrl = imageResolutions.medium || imageResolutions.original;
    console.log('Using MEDIUM resolution - coverage above', COVERAGE_THRESHOLDS.MEDIUM);
  } else if (coveragePercent >= COVERAGE_THRESHOLDS.LOW) {
    selectedUrl = imageResolutions.small || imageResolutions.medium || imageResolutions.original;
    console.log('Using SMALL resolution - coverage above', COVERAGE_THRESHOLDS.LOW);
  } else {
    selectedUrl = imageResolutions.thumbnail || imageResolutions.small || imageResolutions.medium || imageResolutions.original;
    console.log('Using THUMBNAIL resolution - coverage below', COVERAGE_THRESHOLDS.LOW);
  } /*{
    console.log('too low, not loading anythign')
  }*/

  // Vérifier que l'URL n'est pas vide
  if (!selectedUrl) {
    console.warn('Selected URL is empty, falling back to original');
    return imageResolutions.original;
  }

  return selectedUrl;
}

/**
 * Generate lower resolution versions of an image
 */
export async function generateImageResolutions(originalImageUrl: string): Promise<ImageResolutions> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Toujours stocker l'original
      const resolutions: ImageResolutions = {
        original: originalImageUrl,
      };

      // Éviter de générer des résolutions si l'image est déjà petite
      if (img.width < 500 && img.height < 500) {
        console.log('Image already small, skipping resizing', img.width, img.height);
        // Utiliser l'image originale pour toutes les résolutions
        resolutions.medium = originalImageUrl;
        resolutions.small = originalImageUrl;
        resolutions.thumbnail = originalImageUrl;
        resolve(resolutions);
        return;
      }

      try {
        // Create canvas for resizing
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('Could not get canvas context');
          resolve(resolutions);
          return;
        }

        // Medium resolution (50% of original)
        const mediumWidth = Math.floor(img.width * 0.5);
        const mediumHeight = Math.floor(img.height * 0.5);
        canvas.width = mediumWidth;
        canvas.height = mediumHeight;
        ctx.drawImage(img, 0, 0, mediumWidth, mediumHeight);
        try {
          resolutions.medium = canvas.toDataURL('image/jpeg', 0.8);
          console.log('Generated medium resolution', mediumWidth, mediumHeight);
        } catch (error) {
          console.error('Error generating medium resolution', error);
          resolutions.medium = originalImageUrl;
        }

        // Small resolution (25% of original)
        const smallWidth = Math.floor(img.width * 0.25);
        const smallHeight = Math.floor(img.height * 0.25);
        canvas.width = smallWidth;
        canvas.height = smallHeight;
        ctx.drawImage(img, 0, 0, smallWidth, smallHeight);
        try {
          resolutions.small = canvas.toDataURL('image/jpeg', 0.7);
          console.log('Generated small resolution', smallWidth, smallHeight);
        } catch (error) {
          console.error('Error generating small resolution', error);
          resolutions.small = originalImageUrl;
        }

        // Thumbnail (10% of original or 100px width, whichever is smaller)
        const thumbnailWidth = Math.min(Math.floor(img.width * 0.1), 100);
        const thumbnailHeight = Math.floor((thumbnailWidth / img.width) * img.height);
        canvas.width = thumbnailWidth;
        canvas.height = thumbnailHeight;
        ctx.drawImage(img, 0, 0, thumbnailWidth, thumbnailHeight);
        try {
          resolutions.thumbnail = canvas.toDataURL('image/jpeg', 0.6);
          console.log('Generated thumbnail resolution', thumbnailWidth, thumbnailHeight);
        } catch (error) {
          console.error('Error generating thumbnail resolution', error);
          resolutions.thumbnail = originalImageUrl;
        }

        resolve(resolutions);
      } catch (error) {
        console.error('Error in image resizing process', error);
        // En cas d'erreur, utiliser l'image originale pour toutes les résolutions
        resolutions.medium = originalImageUrl;
        resolutions.small = originalImageUrl;
        resolutions.thumbnail = originalImageUrl;
        resolve(resolutions);
      }
    };

    img.onerror = () => {
      console.error('Error loading original image for resizing');
      // If there's an error, just return the original
      resolve({ original: originalImageUrl });
    };

    // Ajouter un timeout pour éviter que l'image reste bloquée en chargement
    setTimeout(() => {
      if (!img.complete) {
        console.error('Image load timeout');
        resolve({ original: originalImageUrl });
      }
    }, 10000); // 10 secondes timeout

    img.crossOrigin = 'anonymous'; // Nécessaire pour certaines images externes
    img.src = originalImageUrl;
  });
}