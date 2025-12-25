// AI : Format source URL for display by extracting domain and adding type label
export function formatSourceUrl(url: string): string {
  if (!url) return "";
  try {
    const urlObj = new URL(url);
    const isPdf = urlObj.pathname.toLowerCase().endsWith(".pdf");
    return `${urlObj.hostname} (${isPdf ? "pdf" : "website"})`;
  } catch {
    const truncated = url.length > 30 ? `${url.substring(0, 30)}...` : url;
    const isPdf = url.toLowerCase().endsWith(".pdf");
    return `${truncated} (${isPdf ? "pdf" : "website"})`;
  }
}
