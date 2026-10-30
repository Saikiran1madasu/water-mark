# Host the website from GitHub

The source repository can live on GitHub. GitHub Pages serves the dashboard; a separate HTTPS container server runs Node, Python and FFmpeg. Visitors then upload and download in their browser without running anything on their computer.

GitHub Pages cannot run this Python engine. GitHub Actions builds and publishes the dashboard; it is not used to process visitors' videos. The cloud engine can also serve the dashboard itself, if you prefer one URL and no separate Pages deployment.

## Files already prepared

- `.github/workflows/container.yml`: builds the Docker image on GitHub and smoke-tests engine readiness and the dashboard with a mounted volume.
- `.github/workflows/pages.yml`: builds and deploys `dist` to GitHub Pages on pushes to `main`.
- `scripts/build-pages.mjs`: writes the public API URL into the published `config.js`. It requires a public HTTPS origin and rejects credentials or a URL path. No API secrets belong in this public configuration.
- `Dockerfile`: packages Node, FFmpeg, Python and the current custom engine.
- `render.yaml`: example single-instance Render service with a persistent disk, readiness checks, processing limits and export expiry.
- `deployment.mjs`: configured origins and storage, job metadata recovery, interrupted-job reporting and expired-file cleanup.

## Deploy the engine

1. Push this `clearframe` directory as the GitHub repository root. The workflow paths assume that layout. Do not push the enclosing Downloads, `.runtime`, `.venv`, private videos or diagnostic images.
2. In Render, create a Blueprint from the repository using `render.yaml`. The template selects a **paid** service and disk; review the provider's current price before creating resources. CPU video processing needs more memory and time than static website hosting.
3. For `ALLOWED_ORIGINS`, enter your exact Pages origin, such as `https://YOUR-USERNAME.github.io`. Do not include the repository path. Add any custom dashboard origin separated by commas. The server also accepts its own Render origin through `RENDER_EXTERNAL_URL` automatically.
4. Deploy. Open `https://YOUR-ENGINE.onrender.com/api/ready`; it must return HTTP 200 and `{"available":true}`. An unavailable dependency returns 503 so the deployment does not look ready prematurely.
5. You can already use the dashboard at the engine's root URL. This same-origin option needs no GitHub Pages configuration.

## Deploy the GitHub Pages dashboard

1. In the GitHub repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. Open **Settings → Secrets and variables → Actions → Variables**. Add the repository variable `MSK_API_URL` with `https://YOUR-ENGINE.onrender.com` (no path). This is a public endpoint, not a secret.
3. Push to `main` or run **Deploy dashboard to GitHub Pages** manually under Actions.
4. Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`. Assets use relative paths so project Pages work below the repository path.
5. Upload a short test video, draw the watermark selection, run a preview, then a full export. Confirm playback and download from the separate engine. The hosted dashboard does not contact localhost.

## Server configuration

| Variable | Purpose | Render template |
|---|---|---|
| `HOST` | Listening address; use `0.0.0.0` for containers | `0.0.0.0` |
| `PORT` | HTTP port supplied to the app | `10000` |
| `MSK_PYTHON` | Python executable with installed engine packages | `/opt/venv/bin/python` in the image |
| `MSK_DATA_DIR` | Writable data directory; mount persistent storage here | `/app/storage` |
| `PUBLIC_URL` | Optional exact external engine origin on other providers | Render supplies `RENDER_EXTERNAL_URL` |
| `ALLOWED_ORIGINS` | Comma-separated exact dashboard origins | Set during setup |
| `MAX_UPLOAD_MB` | Server upload size limit | `500` |
| `MAX_DURATION_SECONDS` | Longest input clip | `600` |
| `MAX_VIDEO_PIXELS` | Maximum width × height | `2073600` (1080p) |
| `JOB_TIMEOUT_SECONDS` | Timeout for an engine or media-processing subprocess | `1200` |
| `OUTPUT_RETENTION_HOURS` | Completed and failed job retention | `24` |

Completed exports and status metadata survive server restarts when the data directory is persistent. Interrupted uploads or repairs are marked failed on restart and must be submitted again. Inputs and repair intermediates are removed when a job finishes; exports and metadata expire together. Cleanup runs once a minute. Without a disk, a container restart can lose every export.

## Current deployment scope

This is a single-instance service with one active upload/repair at a time. Other submissions receive a busy message; there is no distributed job queue or horizontal scaling. Do not run several app processes against the same disk. Large uploads and processing times must fit the hosting provider's proxy and resource limits as well as the settings above.

There are no user accounts, payment quotas or authenticated private download links. Job URLs contain random IDs, but anyone holding an output URL can access that export until it expires. Add account authentication and a shared queue before using this as a private or high-volume customer service.

## Checks

Run `npm run check` and `npm run test:hosting` for deployment configuration, restart recovery, expiry, Pages builds, cross-origin requests and range downloads. Run `npm test` in the local Python environment for engine and full video-pipeline tests.

A Docker runtime is required to validate the container itself:

```sh
docker build -t msk-video .
docker run --rm -p 10000:10000 -v msk-video-data:/app/storage msk-video
```

No cloud resources or GitHub repository have been created by these source changes. The container build and a live cross-domain browser upload must be verified on the deployment platform; local routing tests do not replace those checks.

References: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Render Docker services](https://render.com/docs/docker), [persistent disks](https://render.com/docs/disks).
