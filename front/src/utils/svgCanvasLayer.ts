const SVG_NS = "http://www.w3.org/2000/svg";

// Transparent full-size SVG sized to its container, for drawing editor chrome in screen space.
// z-index 1 puts it above the map canvas and below markers; pointer events pass straight through.
export function createSvgCanvasLayer(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.style.position = "absolute";
  svg.style.top = "0";
  svg.style.left = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "1";
  return svg;
}

export function createSvgPath(): SVGPathElement {
  return document.createElementNS(SVG_NS, "path");
}
