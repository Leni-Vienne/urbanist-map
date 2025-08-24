// AI : SVG-based markers using the custom marker.svg design
import L from 'leaflet';
import type { MarkerColor } from '@types';

// AI : SVG marker configuration
const markerSize = 25;

// AI : Single base color per marker - everything else is generated
const markerColors: Record<MarkerColor, string> = {
  blue: '#1E90FF',
  green: '#32CD32',
  orange: '#FF8C00',
  red: '#DC143C',
  gold: '#FFD700',
  yellow: '#FFFF00',
  purple: '#9932CC',
  grey: '#A0A0A0',
  black: '#2F2F2F'
};

// AI : Simple functions to generate variants from base color
function lightenColor(color: string, amount: number): string {
  const hex = color.slice(1);
  const num = parseInt(hex, 16);
  let r = (num >> 16) + amount;
  let g = (num >> 8 & 0x00FF) + amount;
  let b = (num & 0x0000FF) + amount;
  r = r > 255 ? 255 : r < 0 ? 0 : r;
  g = g > 255 ? 255 : g < 0 ? 0 : g;
  b = b > 255 ? 255 : b < 0 ? 0 : b;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function darkenColor(color: string, amount: number): string {
  return lightenColor(color, -amount);
}

// AI : Simple marker creation - one base color, generate everything else
function createMarkerSVG(color: MarkerColor): string {
  const baseColor = markerColors[color];
  const lightColor = lightenColor(baseColor, 40);
  const darkColor = darkenColor(baseColor, 40);
  const width = markerSize;
  const height = Math.round(markerSize * 1.6);
  
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 50 82" role="img" aria-label="Map pin">
      <defs>
        <!-- Simple gradient for marker body -->
        <linearGradient id="g-${color}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${lightColor}"/>
          <stop offset="55%" stop-color="${baseColor}"/>
          <stop offset="100%" stop-color="${darkColor}"/>
        </linearGradient>
        
        <!-- Shadow gradient -->
        <linearGradient id="shadow-grad-${color}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="black" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <!-- Cast shadow (skewed ellipse to the right) -->
      <ellipse cx="38" cy="80" rx="18" ry="6"
               fill="url(#shadow-grad-${color})" transform="rotate(-8 38 80)"/>

      <!-- Pin body with darker contrasting edge -->
      <path d="M25 1
               C38.807 1 50 12.193 50 26
               C50 45 25 81 25 81
               S0 45 0 26
               C0 12.193 11.193 1 25 1Z"
            fill="url(#g-${color})" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" />

      <!-- Inner white circle -->
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>
    </svg>
  `;
}

// AI : Create SVG icon for Leaflet
function createSVGIcon(color: MarkerColor): L.DivIcon {
  const svgString = createMarkerSVG(color);
  
  return L.divIcon({
    html: svgString,
    className: 'custom-svg-marker',
    iconSize: [markerSize, markerSize + 10],
    iconAnchor: [markerSize/2, markerSize + 5],
    popupAnchor: [0, -(markerSize + 5)],
  });
}

// AI : Create button-sized marker SVG using base color
export function createButtonSVG(color: MarkerColor): string {
  const baseColor = markerColors[color];
  const size = 16;
  
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 50 82" role="img" aria-label="Map pin">
      <!-- Pin body -->
      <path d="M25 1
               C38.807 1 50 12.193 50 26
               C50 45 25 81 25 81
               S0 45 0 26
               C0 12.193 11.193 1 25 1Z"
            fill="${baseColor}" stroke="rgba(0,0,0,0.3)" stroke-width="1" />

      <!-- Inner white circle -->
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>
    </svg>
  `;
}

// AI : Export individual colored icon functions for backward compatibility
export const blueIcon = () => createSVGIcon('blue');
export const goldIcon = () => createSVGIcon('gold');
export const redIcon = () => createSVGIcon('red');
export const greenIcon = () => createSVGIcon('green');
export const orangeIcon = () => createSVGIcon('orange');
export const yellowIcon = () => createSVGIcon('yellow');
export const purpleIcon = () => createSVGIcon('purple');
export const greyIcon = () => createSVGIcon('grey');
export const blackIcon = () => createSVGIcon('black');

// AI : Helper function to create instances of color icons
export function createColorIcon(color: MarkerColor): L.DivIcon {
  return createSVGIcon(color);
}