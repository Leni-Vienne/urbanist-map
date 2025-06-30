/*
BSD 2-Clause License

Copyright (c) 2010-2019, Vladimir Agafonkin
Copyright (c) 2010-2011, CloudMade
Copyright (c) 2013-2020, Thomas Pointhuber
Copyright (c) 2024, Vincent Wong
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
import L from 'leaflet';

const iconSize = [25, 41] as [number, number];
const iconAnchor = [12, 41] as [number, number];
const popupAnchor = [1, -34] as [number, number];
const tooltipAnchor = [16, -28] as [number, number];
const shadowSize = [41, 41] as [number, number];

// AI : Use absolute import paths for Vite
const getIconUrl = (color: string) => new URL(`../../assets/markers/marker-icon-${color}.png`, import.meta.url).href;
const getIconRetinaUrl = (color: string) => new URL(`../../assets/markers/marker-icon-2x-${color}.png`, import.meta.url).href;
const getShadowUrl = () => new URL('../../assets/markers/marker-shadow.png', import.meta.url).href;

export const blueIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('blue'),
		iconRetinaUrl: getIconRetinaUrl('blue'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

export const goldIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('gold'),
		iconRetinaUrl: getIconRetinaUrl('gold'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

export const redIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('red'),
		iconRetinaUrl: getIconRetinaUrl('red'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

export const greenIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('green'),
		iconRetinaUrl: getIconRetinaUrl('green'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

export const orangeIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('orange'),
		iconRetinaUrl: getIconRetinaUrl('orange'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

export const yellowIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('yellow'),
		iconRetinaUrl: getIconRetinaUrl('yellow'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

export const violetIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('violet'),
		iconRetinaUrl: getIconRetinaUrl('violet'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

export const greyIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('grey'),
		iconRetinaUrl: getIconRetinaUrl('grey'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

export const blackIcon = L.Icon.extend({
	options: {
		iconUrl: getIconUrl('black'),
		iconRetinaUrl: getIconRetinaUrl('black'),
		shadowUrl: getShadowUrl(),
		iconSize: iconSize,
		iconAnchor: iconAnchor,
		popupAnchor: popupAnchor,
		tooltipAnchor: tooltipAnchor,
		shadowSize: shadowSize
	}
});

// AI : Helper function to create instances of color icons
export function createColorIcon(color: 'blue' | 'gold' | 'red' | 'green' | 'orange' | 'yellow' | 'violet' | 'grey' | 'black'): L.Icon {
	const iconMap = {
		blue: blueIcon,
		gold: goldIcon,
		red: redIcon,
		green: greenIcon,
		orange: orangeIcon,
		yellow: yellowIcon,
		violet: violetIcon,
		grey: greyIcon,
		black: blackIcon
	};
	
	return new iconMap[color]();
}