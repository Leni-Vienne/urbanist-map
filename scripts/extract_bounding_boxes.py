
# Extracts country bounding boxes from Natural Earth shapefile (110m admin 0 countries)
# https://www.naturalearthdata.com/downloads/110m-cultural-vectors/

# MUST READ : script needs all 4 files in the .zip to work, that is .shp, .shx, .dbf, .prj

import geopandas as gpd
import json

# Load shapefile (or GeoJSON)
world = gpd.read_file("./junk/bbox/ne_110m_admin_0_countries.shp")

# Manual fixes for countries with ISO_A3 = -99
iso_fixes = {
    "France": "FRA",
    "Norway": "NOR",
    "Northern Cyprus": "CYN",
    "Somaliland": "SOL",
    "Kosovo": "XKX"
}

bboxes = {}

for _, row in world.iterrows():
    geom = row.geometry
    if geom is None:
        continue

    iso = row["ISO_A3"]
    if iso == "-99" or not iso:
        iso = iso_fixes.get(row["ADMIN"], None)
    if not iso:
        continue

    # Handle MultiPolygon → keep the largest part
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)

    # Compute mainland bounding box
    minx, miny, maxx, maxy = geom.bounds
    bboxes[iso] = [minx, miny, maxx, maxy]


with open("./front/src/assets/country_bboxes.json", "w") as f:
    json.dump(bboxes, f, separators=(",", ":"), indent=2)