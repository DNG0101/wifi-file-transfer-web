# GitHub Pages deployment

This folder is already built as a static site. Do not run Vite or npm on GitHub Pages.

## Recommended deployment

1. Extract this ZIP.
2. Push the extracted **contents** directly to the root of your GitHub repository.
3. Open **Settings → Pages** in GitHub.
4. Under **Build and deployment**, select **GitHub Actions** as the source.
5. Push to `main` or `master`, or run the included **Deploy GitHub Pages** workflow manually.

The package is repository-name independent. It supports URLs such as:

`https://USERNAME.github.io/REPOSITORY/`

Internal routes such as `/send`, `/receive`, `/history`, `/settings`, and `/help` are configured to remain inside the repository subpath. `404.html` provides a GitHub Pages SPA fallback for refresh/direct navigation.

## Important runtime note

The application uses browser WebRTC for peer-to-peer transfers. GitHub Pages only hosts the frontend. Both devices must be able to establish the WebRTC connection and complete the app's manual signaling flow. Browser/network restrictions can still affect peer connectivity and very large transfers.
