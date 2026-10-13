# The place list

`places.tsv.gz` is the list of towns and cities the server answers
`/api/v1/geo/places` from: a place's name, country, region, position and number
of people, with its name in each language Adminium ships where one is known.
It is read from this file on the server; nothing is asked of another site.

| | |
|---|---|
| Source | [GeoNames](https://www.geonames.org/), `https://download.geonames.org/export/dump/`: `cities1000.zip`, `alternateNamesV2.zip`, `admin1CodesASCII.txt`, `countryInfo.txt` |
| Fetched | 2026-10-13 |
| Places | 171,226 (every place with 1,000 people or more) |
| Countries | 252 |
| Size | 4.48 MB gzipped, 12.3 MB as text |
| Names by language | en 4,964 · ar 21,001 · cs 1,330 · da 482 · de 5,202 · fr 4,032 · zh-CN 31,356 · zh-TW 1,528 |

## Credit

This list is made from data by [GeoNames](https://www.geonames.org/), which is
licensed under the [Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/).
It was reshaped for Adminium: only the columns named above are kept, and only
the names in the languages Adminium ships.

## Making it again

```sh
node scripts/geo/build-places.mjs <a scratch directory>
```

The script's first lines describe the file's format. It is run by hand, never
by CI or a release: this file is committed.
