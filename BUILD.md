# Build Instructions

This extension uses minimal build steps and includes one third-party minified library for security.

## Dependencies

The extension includes DOMPurify for secure HTML sanitization to prevent XSS vulnerabilities when displaying translated content with links.

## Reproduction Steps

To reproduce the exact extension package from source:

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Copy DOMPurify library**:

   ```bash
   cp node_modules/dompurify/dist/purify.min.js shared/
   ```

3. **Verify setup**:

   ```bash
   npm run lint
   npm test
   ```

## Package Contents

The extension package includes:

- `package.json` - Lists DOMPurify as a dependency and development tools
- All source code files (background/, content/, popup/, settings/, shared/)
- Build documentation (this file)
- Test files and configuration

## Third-Party Code

- **File**: `shared/purify.min.js`
- **Source**: DOMPurify v3.2.6 from npm package
- **Original location**: `node_modules/dompurify/dist/purify.min.js`
- **Purpose**: Sanitize HTML content to prevent XSS attacks
- **License**: Apache 2.0 / Mozilla Public License 2.0
- **Homepage**: <https://github.com/cure53/DOMPurify>

## Source Code

All other files are original source code written for this extension. No build tools, bundlers, or code transformations are used beyond copying the DOMPurify library.

The extension can be loaded directly in developer mode without any build process.
