## What's needed

- the URL to the tilelayer service
- all the relevant stuff like maxNativeZoom and attribution
- having check that the ESRI tile layer doesn't already supply it
- the country borders, that should be simplified.

To get the country borders json, go to https://gadm.org/download_world.html then use mapshaper.org to simplify it. check what the borders look like near cities. Aim for a file that is a few 10s of kb at best. If the country has only a single border with another country, you can extract that border on mapshaper.org by using the rectangle tool then "clip" then drawing the polygon yourself.
