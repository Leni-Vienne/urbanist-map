## Adding a New Tile Layer

### Requirements

- The URL to the tile layer service
- Relevant configuration: `maxNativeZoom`, attribution
- Verify the ESRI tile layer does not already cover the area at sufficient resolution
- Country border GeoJSON, simplified for web use

### Getting the Country Border

1. Download the country's administrative boundary from [GADM](https://gadm.org/download_world.html)
2. Simplify it at [mapshaper.org](https://mapshaper.org/) and verify the result near city boundaries
3. Target a file size of a few tens of kilobytes
4. For countries with a single long shared border, use mapshaper's rectangle selection tool, then **Clip**, and redraw the border polygon manually
