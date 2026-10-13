<!-- produced from apps/docs/src/content/docs/guides/apps/maps.md § An area; do not edit -->

# Maps, places and routes: An area

A column that holds an area is a `json` column with the `area` rule. It keeps a GeoJSON
`Polygon` or `MultiPolygon`: a delivery zone, a sales territory. Rings are closed, there are at
most 2,000 points, and positions are written east first (`[lng, lat]`), as GeoJSON does.

```json
{ "ref": "zone", "type": "json", "nullable": true, "rules": { "area": true } }
```
