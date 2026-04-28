# Photo Drive Uploader

Single-page React app for collecting photos and sending them into a shared Google
Drive folder. The frontend stays static and GitHub-friendly, while the actual upload
is handled by a configurable endpoint so Drive credentials do not live in the browser.

## Features

- Upload into a configured Google Drive folder
- Drag and drop or browse for multiple images
- Preview selected photos before upload
- Show upload status, retry failures, and open uploaded files in Drive
- Sample Google Apps Script endpoint included in `apps-script/Code.gs`

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env.local
   ```

3. Put your deployed Google Apps Script web app URL and target Drive folder into `.env.local`:

   ```bash
   VITE_UPLOAD_ENDPOINT=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   VITE_DRIVE_FOLDER_NAME=Shared Google Drive folder
   VITE_DRIVE_FOLDER_LINK=https://drive.google.com/drive/folders/YOUR_FOLDER_ID
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

## Build

```bash
npm run build
npm run preview
```

The Vite config uses `base: './'`, which helps when the site is hosted from a repo
subpath such as GitHub Pages.

## GitHub Pages deploy

This repo includes `.github/workflows/deploy.yml` so pushes to `main` can build and
publish the app to GitHub Pages.

Before the workflow can publish a working site:

1. In GitHub, open your repository settings and enable GitHub Pages with source set to
   `GitHub Actions`.
2. In repository `Settings > Secrets and variables > Actions > Variables`, create:
   - `VITE_UPLOAD_ENDPOINT`
   - `VITE_DRIVE_FOLDER_NAME`
   - `VITE_DRIVE_FOLDER_LINK`
3. Push to `main` or run the workflow manually from the Actions tab.

Important: every `VITE_*` value is bundled into the frontend and is visible in the
deployed site. Treat them as public configuration, not server-side secrets.

## Google Drive setup

1. Create a new Google Apps Script project.
2. Copy the contents of `apps-script/Code.gs` into that project.
3. Deploy it as a web app:
   - Execute as: `Me`
   - Who has access: `Anyone with the link`
4. Copy the deployment URL and set it as `VITE_UPLOAD_ENDPOINT`.
5. Set `VITE_DRIVE_FOLDER_LINK` to the shared Google Drive folder URL.
6. Make sure the Google account that owns the Apps Script has access to the target
   Google Drive folder.
7. Start uploading photos from the app.

## How uploads work

- The React app extracts the Google Drive folder ID from `VITE_DRIVE_FOLDER_LINK`.
- Each selected image is converted to base64 in the browser.
- The app posts the image to the configured web app endpoint.
- The Google Apps Script creates the file in the target Drive folder and returns the
  new file URL.

## Important notes

- This implementation currently targets Google Drive. If your folder link is from
  OneDrive, Dropbox, SharePoint, or another storage provider, the upload endpoint and
  helper logic need to change.
- Google Apps Script is a simple way to avoid exposing secrets in the frontend, but it
  is not ideal for very large uploads. For higher volume or larger file sizes, use a
  dedicated backend.
