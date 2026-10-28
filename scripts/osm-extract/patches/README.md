# pyosmium tag-copy patch

`pyosmium-taglist-to-dict.patch` adds `TagList.to_dict()` to pyosmium. The
extractors use it when available instead of `{tag.k: tag.v for tag in tags}`,
which removed about 68 s from the full-size areal extractor and 31 s from
linear in the October 2026 benchmark. Stock pyosmium 4.3.2 does not provide
the method.

Apply and install the patch against the pyosmium source revision recorded in the
benchmark (`b54c5fa64118366b6901a21142737b9f965e2818`, version 4.3.2):

```sh
git clone https://github.com/osmcode/pyosmium
cd pyosmium
git checkout b54c5fa64118366b6901a21142737b9f965e2818
git apply /path/to/scripts/osm-extract/patches/pyosmium-taglist-to-dict.patch
pip install .
```

A normal build needs libosmium headers, protozero, zlib, bzip2, expat and LZ4
development headers. The patch also adds tests to `test/test_taglist.py`; run
`pytest test` from the pyosmium checkout after installation.

The patch is optional: both extractors fall back to
`{tag.k: tag.v for tag in tags}` when `to_dict()` is unavailable.
`update_daily.sh` also works with stock pyosmium.

The full experiment and measurements are in
`../../../../osmium-performance-review/tag-copy-20261027/README.md`.
