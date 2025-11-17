/**
 * AI : Simple date formatting utility for consistent dd/mm/yyyy display across the app
 * No localization needed - uses plain numeric format
 */

/**
 * AI : Format a date as dd/mm/yyyy
 * @param date - Date object, string, or null/undefined
 * @returns Formatted date string or empty string if invalid
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return ''

  const d = typeof date === 'string' ? new Date(date) : date
  if (!(d instanceof Date) || isNaN(d.getTime())) return ''

  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()

  return `${day}/${month}/${year}`
}

/**
 * AI : Format a date with time as dd/mm/yyyy HH:mm
 * @param date - Date object, string, or null/undefined
 * @returns Formatted datetime string or empty string if invalid
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return ''

  const d = typeof date === 'string' ? new Date(date) : date
  if (!(d instanceof Date) || isNaN(d.getTime())) return ''

  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')

  return `${day}/${month}/${year} ${hours}:${minutes}`
}

/**
 * AI : Format a date as relative time (e.g., "5 minutes ago", "2 hours ago")
 * @param date - The date to format (Date object or ISO string)
 * @returns A human-readable relative time string
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) {
    return 'Unknown'
  }

  const now = new Date()
  const targetDate = typeof date === 'string' ? new Date(date) : date

  if (isNaN(targetDate.getTime())) {
    return 'Unknown'
  }

  const diffMs = now.getTime() - targetDate.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  if (diffSeconds < 60) {
    return 'just now'
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  } else if (diffWeeks < 4) {
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`
  } else if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
  } else {
    return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`
  }
}
