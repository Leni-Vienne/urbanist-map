// AI : Handle image load error by hiding the image element
export function handleImageError(event: Event): void {
  const img = event.target as HTMLImageElement;
  img.style.display = "none";
}
