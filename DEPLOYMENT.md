# Deployment Guide

## Prerequisites

Before building, ensure you have:
1. GitHub repository access to `CJ-aezakmi/UKULUT`
2. Tauri signing keys generated
3. GitHub Secrets configured

## Step 1: Generate Tauri Signing Keys

Run this command once to generate signing keys:

```bash
npm run tauri signer generate -- -w ~/.tauri/myapp.key
```

This creates:
- **Private key**: `~/.tauri/myapp.key` (keep secret!)
- **Public key**: printed to console

## Step 2: Configure GitHub Secrets

Go to repository Settings → Secrets and variables → Actions

Add these secrets:

### `TAURI_SIGNING_PRIVATE_KEY`
Content of `~/.tauri/myapp.key` file

### `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
Password you used when generating the key (if any)

## Step 3: Update tauri.conf.json

Replace the `pubkey` in `tauri.conf.json` with your generated public key:

```json
"plugins": {
  "updater": {
    "active": true,
    "pubkey": "YOUR_PUBLIC_KEY_HERE"
  }
}
```

## Step 4: Build Locally (Optional)

Test the build locally:

```bash
npm run tauri build
```

Output files will be in `src-tauri/target/release/bundle/`

## Step 5: Create GitHub Release

### Option A: Automatic (via tag)

```bash
git tag v2.0.0
git push origin v2.0.0
```

GitHub Actions will automatically build and create release.

### Option B: Manual (via workflow)

1. Go to Actions tab in GitHub
2. Select "Release Build" workflow
3. Click "Run workflow"
4. Choose branch and click "Run"

## Step 6: Verify Release

After workflow completes:

1. Check GitHub Releases page
2. Should see `v2.0.0` release with:
   - `Antic-Browser_2.0.0_x64_en-US.msi` (Windows installer)
   - `latest.json` (updater manifest)
   - `Antic-Browser_2.0.0_x64_en-US.msi.zip.sig` (signature)

## Step 7: Install and Test

Download the MSI installer and test:
1. Install the application
2. Launch it
3. The app should automatically check for updates on future releases

## Updating for Future Releases

1. Update version in:
   - `package.json` → `"version": "2.0.1"`
   - `src-tauri/Cargo.toml` → `version = "2.0.1"`
   - `src-tauri/tauri.conf.json` → `"version": "2.0.1"`

2. Commit changes

3. Create new tag:
   ```bash
   git tag v2.0.1
   git push origin v2.0.1
   ```

4. GitHub Actions builds and releases automatically

5. Users with v2.0.0 will get notification to update

## Troubleshooting

### Build fails on GitHub Actions

- Check workflow logs in Actions tab
- Ensure all secrets are configured
- Verify Rust and Node versions match

### Updates not detected

- Verify `latest.json` is in release assets
- Check CSP allows `https://github.com`
- Ensure pubkey matches private key used for signing

### MSI installer issues

- Requires Windows to build MSI
- Use `windows-latest` runner in GitHub Actions
- Check Wix Toolset is installed

## Security Notes

- **NEVER** commit private signing key
- Keep `TAURI_SIGNING_PRIVATE_KEY` secret
- Rotate keys if compromised
- Use strong password for key encryption
