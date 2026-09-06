# Changelog

Each entry is split into the two strings needed at submission time:
**Release Notes** (store detail page) and **Notes to Reviewer** (AMO source review).

## 2.2.5 (2026-09-06)

### Release Notes

- Fixed translation toggles that broke buttons and other page controls.
- Keep original content when translation segments do not match, instead of removing page elements.
- Added a button to collapse and expand the Show Originals panel.

### Notes to Reviewer

The extension ships as plain JavaScript with no transpilation, bundling, minification, or code generation.
The packaging scripts copy source files into each archive.
The Firefox package removes the `background.service_worker` entry and retains `background.scripts`.

Reproduce from a clean checkout:

    git clone https://github.com/CJHwong/line-localization-machine.git
    cd line-localization-machine
    git checkout v2.2.5
    npm install
    npm test
    npm run publish:prep

Upload packages:

- `dist/line-localization-machine-chrome.zip`
- `dist/line-localization-machine-firefox.zip`

Vendored third-party code:

- `vendor/readability-0.6.0/`: Mozilla Readability, Apache 2.0.
- `vendor/jsonriver-1.1.1/`: progressive JSON parser by Google, BSD-3-Clause.

Both libraries remain unmodified and unminified.
This release preserves page controls during text restoration and adds a collapsible translation panel.

## 2.2.4 (2026-08-16)

### Release Notes

- Fixed translation coverage on pages where the article is split across multiple containers: the TL;DR, intro, and hero subtitle sections are now translated.
- Fixed layout breakage on some pages after translation (e.g. blog.google), where article paragraphs collapsed into a narrow column.
- Tip callouts and other blockquote content are now translated.

### Notes to Reviewer

No build step. The extension ships as plain JavaScript with no transpilation, bundling, or minification. The submitted zips are byte-equivalent to the output of the project's packaging scripts.

Reproduce from a clean checkout:

    git clone https://github.com/CJHwong/line-localization-machine.git
    cd line-localization-machine
    git checkout v2.2.4
    npm install        # installs ESLint, Prettier, Jest, Playwright, web-ext only; no runtime dependencies
    npm run lint
    npm run format:check
    npm test
    npm run pack       # writes dist/line-localization-machine-chrome.zip and dist/line-localization-machine-firefox.zip

The Firefox zip differs from the Chrome zip by one manifest entry: the `"service_worker"` key is removed from `manifest.json` (Firefox MV3 uses `background.scripts`).

Vendored third-party code, unmodified and unminified:

    vendor/readability-0.6.0/   Mozilla Readability, Apache 2.0
    vendor/jsonriver-1.1.1/     progressive JSON parser by Google, BSD-3-Clause

This release improves article extraction coverage (multi-container layouts, blockquotes) and fixes a layout regression on pages that style custom elements as grid or flex containers.

## 2.2.3 (2026-08-07)

### Release Notes

- Added provider-specific API key storage so switching providers keeps each key isolated.
- Updated the built-in OpenAI, Google, and Ollama model lists and defaults.
- Fixed translation on pages where Readability extracts only a small part of the visible content.

### Notes to Reviewer

No build step. The extension ships as plain JavaScript with no transpilation, bundling, or minification. The submitted zips are byte-equivalent to the output of the project's packaging scripts.

Reproduce from a clean checkout:

    git clone https://github.com/CJHwong/line-localization-machine.git
    cd line-localization-machine
    git checkout v2.2.3
    npm install        # installs ESLint, Prettier, Jest, Playwright, web-ext only; no runtime dependencies
    npm run lint
    npm run format:check
    npm test
    npm run pack       # writes dist/line-localization-machine-chrome.zip and dist/line-localization-machine-firefox.zip

The Firefox zip differs from the Chrome zip by one manifest entry: the `"service_worker"` key is removed from `manifest.json` (Firefox MV3 uses `background.scripts`).

Vendored third-party code, unmodified and unminified:

    vendor/readability-0.6.0/   Mozilla Readability, Apache 2.0
    vendor/jsonriver-1.1.1/     progressive JSON parser by Google, BSD-3-Clause

This release updates provider configuration and improves extraction fallback for pages where Readability returns incomplete content.

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
