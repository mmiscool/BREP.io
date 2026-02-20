# GitHub Repo Storage

This app can store models and settings directly in a GitHub repository using a personal access token (PAT). When enabled, GitHub becomes the storage backend instead of the browser’s local IndexedDB/VFS storage.

## Live Demos
- Examples hub: [https://BREP.io/apiExamples/index.html](https://BREP.io/apiExamples/index.html)
- Embeded CAD: [https://BREP.io/apiExamples/Embeded_CAD.html](https://BREP.io/apiExamples/Embeded_CAD.html)

## How It Works
- You provide a GitHub token and select a repo in the **Display Settings** panel.
- When both are set, the app switches to GitHub storage for models and settings.
- Storage lives inside a folder named `brep-storage` at the repo root.

## Setup
1. Create a fine‑grained token at `https://github.com/settings/personal-access-tokens`.
1. Grant access to the target repository.
1. Enable **Contents: Read and Write** permissions.
1. In the app, open **Display Settings → Storage (GitHub)**.
1. Paste the token, click **Load Repos**, then select a repository.

## Repository Layout
- `brep-storage/__BREP_DATA__/` contains saved models.
- `brep-storage/settings/` contains app settings (e.g. Display Settings).

Each saved model is stored as:
- `name.3mf` (real 3MF file containing geometry + embedded history metadata)
- `name.meta.json` (small metadata sidecar: saved timestamp and optional thumbnail)

## Behavior Notes
- Saving a model writes a 3MF file into the repo and updates its `.meta.json`.
- Loading a model reads the 3MF file directly from GitHub.
- If the token or repo is cleared, the app switches back to local storage.

## Security Notes
- The token is stored in `sessionStorage` (tab‑scoped). Closing the tab clears it.
- Avoid using a token with broader permissions than necessary.

## Troubleshooting
- If saves fail, verify the token has **Contents: Read and Write** on the selected repo.
- If the repo default branch is not `main`, leave branch blank so GitHub uses the default.
