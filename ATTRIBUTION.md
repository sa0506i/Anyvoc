# Third-Party Data Attribution

Anyvoc's local CEFR classifier bundles derived data from the following
sources. These generated files live in `lib/data/` and are committed to
the repository so EAS Build never needs to download them.

## Word-frequency tables — `lib/data/freq_*.json`

**Source:** Leipzig Corpora Collection (Universität Leipzig)
**Citation:** Goldhahn, D., Eckart, T., & Quasthoff, U. (2012).
*Building Large Monolingual Dictionaries at the Leipzig Corpora Collection:
From 100 to 200 Languages.* In Proceedings of the 8th International
Conference on Language Resources and Evaluation (LREC 2012).
**URL:** https://wortschatz.uni-leipzig.de
**License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
**Build script:** `scripts/build-freq.ts`

The `news_{year}_{size}` corpora are used for all 12 supported languages.
The exact corpus tier chosen per language is recorded in each JSON file's
`__corpus` field and in the sibling `freq_{lang}.attribution.txt` file.

## Age-of-Acquisition norms (English) — `lib/data/aoa_en.json`

**Source:** Kuperman, V., Stadthagen-Gonzalez, H., & Brysbaert, M. (2012).
*Age-of-acquisition ratings for 30,000 English words.*
Behavior Research Methods, 44(4), 978–990.
**Build script:** `scripts/build-norms.ts --aoa=<path>`

Ratings file is not redistributed here. Download
`AoA_51715_words.zip` from Kuperman's CRR page (the current live copy
sits on the Wayback Machine:
`https://web.archive.org/web/2020/http://crr.ugent.be/papers/AoA_51715_words.zip`),
unzip to get `AoA_51715_words.xlsx`, then run
`npm run build:norms -- --aoa=path/to/AoA_51715_words.xlsx`. The script
reads column `AoA_Kup` (Mechanical Turk mean AoA). Without this file,
the runtime classifier uses a Zipf-based fallback for AoA.

## Age-of-Acquisition estimates (non-English) — `lib/data/aoa_<lang>.json`

For the 11 non-English supported languages we don't have a published
human-norm dataset analogous to Kuperman 2012. Instead these JSONs are
generated offline by `scripts/build-aoa-llm.ts`, which asks Claude
Haiku to assign each top-N frequent word a Kuperman-scale AoA value
(2–18). The runtime treats them identically to the English Kuperman
data and falls back to a Zipf-based estimate for words missing from
the LLM-generated map.
