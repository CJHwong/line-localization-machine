# Changelog

Each entry is split into the two strings needed at submission time:
**Release Notes** (store detail page) and **Notes to Reviewer** (AMO source review).

## 2.2.2 (2026-05-08)

### Release Notes

- Fix: "View Translation Cache" in the popup showed a "File not found" page on packaged builds. The history viewer files were missing from the published zip.

### Notes to Reviewer

No build step. The extension ships as plain JavaScript with no transpilation, bundling, or minification. The submitted zip is byte-equivalent to the output of the project's packaging script.

Reproduce from a clean checkout:

    git clone https://github.com/CJHwong/line-localization-machine.git
    cd line-localization-machine
    git checkout 6b133f0
    npm install        # installs ESLint, Prettier, Jest, Playwright, web-ext only; no runtime dependencies
    npm run pack       # writes dist/line-localization-machine-firefox.zip

The Firefox zip differs from the Chrome zip by one line: the `"service_worker"` key is removed from `manifest.json` (Firefox MV3 uses `background.scripts`).

Vendored third-party code, unmodified and unminified:

    vendor/readability-0.6.0/   Mozilla Readability, Apache 2.0
    vendor/jsonriver-1.1.1/     progressive JSON parser by Google, BSD-3-Clause

This release is a packaging fix only. `scripts/package-chrome.sh` and `scripts/package-firefox.sh` now include the `history/` folder, which had been missing from the `cp` allowlist since the cache history viewer was added.
