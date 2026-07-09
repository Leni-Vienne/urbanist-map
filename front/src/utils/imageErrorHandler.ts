// Handle image load error by hiding the image element
export function handleImageError(event: Event): void {
  // eslint-disable-next-line no-unsafe-type-assertion
  const img = event.target as HTMLImageElement;
  img.style.display = "none";
}
