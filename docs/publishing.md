# Extension Publishing Guide

This guide provides step-by-step instructions for publishing the Line Localization Machine extension to both Chrome Web Store and Firefox Add-ons marketplace.

## Prerequisites

Before publishing, ensure you have:

- [ ] Thoroughly tested the extension in both browsers
- [ ] Verified all functionality works as expected
- [ ] Removed any test API keys or development code
- [ ] Set `DEBUG = false` in `shared/debug.js`
- [ ] Run linting and formatting: `npm run lint:fix && npm run format`
- [ ] Updated version in `package.json` and `manifest.json`
- [ ] Prepared marketing materials (screenshots, descriptions)

## Chrome Web Store Publication

### Step 1: Developer Account Setup

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with your Google account
3. Pay the one-time $5 developer registration fee
4. Complete the developer verification process

### Step 2: Prepare Chrome Package

1. **Ensure Chrome compatibility**:

   The current `manifest.json` uses Manifest V3 and is Chrome-compatible by default.

2. **Create distribution package**:

   ```bash
   # Create a clean directory for packaging
   mkdir chrome-package

   # Copy required files (exclude development files)
   cp -r assets/ background/ content/ popup/ settings/ shared/ chrome-package/
   cp manifest.json chrome-package/

   # Create zip file
   cd chrome-package
   zip -r ../line-localization-machine-chrome.zip *
   cd ..
   rm -rf chrome-package
   ```

### Step 3: Chrome Web Store Submission

1. **Upload Extension**:
   - Click "New Item" in the developer dashboard
   - Upload `line-localization-machine-chrome.zip`
   - Wait for the upload to process

2. **Fill Store Listing**:
   - **Name**: "Line Localization Machine"
   - **Summary**: "AI-powered line-by-line webpage translation with stunning animations"
   - **Description**: Detailed description of features and functionality
   - **Category**: "Productivity"
   - **Language**: Select primary language

3. **Upload Assets**:
   - **Icon**: Use `assets/icon-128.png` (128x128px)
   - **Screenshots**: Take 5-10 screenshots showing the extension in action
   - **Promotional images**: Optional but recommended

4. **Privacy & Permissions**:
   - **Privacy Policy**: Create and link to privacy policy (required)
   - **Permissions**: Justify each permission used in the manifest
   - **Host Permissions**: Explain why access to all websites is needed

5. **Submit for Review**:
   - Review all information
   - Click "Submit for Review"
   - Review typically takes 1-3 business days

## Firefox Add-ons (AMO) Publication

### Step 1: Developer Account Setup

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Create a Firefox account or sign in
3. Complete developer profile (free registration)

### Step 2: Prepare Firefox Package

1. **Convert to Firefox-compatible manifest**:

   Firefox requires Manifest V2. Create a Firefox-specific manifest:

   ```bash
   # Create Firefox manifest (convert from V3 to V2)
   # Note: You'll need to manually convert manifest.json to V2 format
   # Key changes needed:
   # - Change "manifest_version": 3 to 2
   # - Replace "action" with "browser_action"
   # - Convert "service_worker" to "scripts" in background
   # - Update permissions format
   ```

2. **Create distribution package**:

   ```bash
   # Create a clean directory for packaging
   mkdir firefox-package

   # Copy required files
   cp -r assets/ background/ content/ popup/ settings/ shared/ firefox-package/

   # Copy Firefox-compatible manifest
   # (You'll need to create manifest-firefox.json first)
   cp manifest-firefox.json firefox-package/manifest.json

   # Create zip file
   cd firefox-package
   zip -r ../line-localization-machine-firefox.zip *
   cd ..
   rm -rf firefox-package
   ```

### Step 3: Firefox Add-ons Submission

1. **Submit Add-on**:
   - Click "Submit a New Add-on"
   - Choose "On this site" (for AMO distribution)
   - Upload `line-localization-machine-firefox.zip`

2. **Add-on Details**:
   - **Name**: "Line Localization Machine"
   - **Summary**: "AI-powered line-by-line webpage translation with stunning animations" (under 250 chars)
   - **Description**: Detailed functionality description
   - **Categories**: Select relevant categories

3. **Additional Information**:
   - **Homepage**: <https://github.com/CJHwong/line-localization-machine>
   - **Support Email**: Contact email for user support
   - **License**: MIT License (as specified in package.json)

4. **Review Process**:
   - Firefox reviews source code manually
   - Process typically takes 1-7 business days
   - Reviewers may request changes

## Post-Publication Steps

### Chrome Web Store

1. **Monitor Reviews**: Respond to user reviews and feedback
2. **Analytics**: Use Chrome Web Store analytics to track usage
3. **Updates**: Use the dashboard to publish updates

### Firefox Add-ons

1. **Monitor Statistics**: Check download and usage statistics
2. **User Feedback**: Respond to user reviews and support requests
3. **Updates**: Upload new versions through the developer hub

## Update Process

### For Both Stores

1. **Increment Version**: Update version in `package.json` and `manifest.json`
2. **Pre-publication Checklist**:
   - Set `DEBUG = false` in `shared/debug.js`
   - Run `npm run lint:fix && npm run format`
   - Test in both browsers
   - Create Firefox-compatible manifest if needed
3. **Create Packages**: Follow the same packaging steps above
4. **Submit Updates**: Upload new versions to respective stores

### Version Management

```bash
# Update version in all files simultaneously
# package.json and manifest.json
# Example: "version": "1.0.1"

# Use npm version to update package.json automatically
npm version patch  # for bug fixes
npm version minor  # for new features
npm version major  # for breaking changes

# Then manually sync the version to manifest.json
# For Firefox, also update manifest-firefox.json if using separate file
```

## Marketing Assets

### Required Assets

- **Icon**: 128x128px PNG (already have in `assets/icon-128.png`)
- **Screenshots**: 1280x800px showing key features
- **Description**: "AI-powered line-by-line webpage translation with stunning animations" (compelling copy highlighting benefits)
- **Privacy Policy**: Required for Chrome, recommended for Firefox

### Optional Assets

- **Promotional tile**: 440x280px for Chrome Web Store
- **Video**: Demo video showing extension in action
- **Website**: Landing page for the extension

## Common Rejection Reasons

### Chrome Web Store

- Insufficient privacy policy
- Excessive permissions without justification
- Poor quality screenshots or descriptions
- Functionality not working as described

### Firefox Add-ons

- Code quality issues
- Security vulnerabilities
- Missing or incomplete manifest permissions
- Non-compliance with add-on policies

## Support and Maintenance

### User Support

- Monitor reviews and ratings
- Provide timely responses to user issues
- Maintain documentation and FAQ

### Technical Maintenance

- Regular testing with browser updates
- Security updates for dependencies
- Performance optimizations
- Bug fixes and feature improvements

## Resources

- [Chrome Web Store Developer Documentation](https://developer.chrome.com/webstore)
- [Firefox Add-on Developer Guide](https://extensionworkshop.com/)
- [Web Extensions API Documentation](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions)
