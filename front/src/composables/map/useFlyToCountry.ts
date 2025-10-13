import { map } from '@composables/core/useMap'
import countryBboxes from '@assets/country_bboxes.json'

/**
 * AI : Fly to a country using its bounding box or fallback to coordinates with zoom
 * @param countryCode - ISO country code
 * @param fallbackLat - Fallback latitude if bbox not found
 * @param fallbackLng - Fallback longitude if bbox not found
 * @param fallbackZoom - Fallback zoom level (default: 6)
 * @param duration - Animation duration in seconds (default: 1.5)
 */
export function flyToCountry(
  countryCode: string,
  fallbackLat?: number,
  fallbackLng?: number,
  fallbackZoom = 6,
  duration = 1.5
) {
  if (!map.value) return

  const bbox = countryBboxes[countryCode as keyof typeof countryBboxes]

  if (bbox) {
    // AI : bbox format is [minLng, minLat, maxLng, maxLat]
    map.value.flyToBounds(
      [
        [bbox[1], bbox[0]], // AI : southwest corner [lat, lng]
        [bbox[3], bbox[2]]  // AI : northeast corner [lat, lng]
      ],
      {
        duration,
        padding: [-30, -30]
      }
    )
  } else if (fallbackLat !== undefined && fallbackLng !== undefined) {
    // AI : Fallback to flyTo if no bbox found
    map.value.flyTo([fallbackLat, fallbackLng], fallbackZoom, {
      duration
    })
  }
}
