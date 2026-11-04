# MSK Browser Video Removal

Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE and THIRD_PARTY_NOTICES.md.

This is the browser edition of Saikiran1madasu/water-mark. Its source lives in `browser/`; the original Python/server edition is preserved at the repository root. The browser edition does not execute or publish that server code.

## Use it locally

```sh
npm install
npm start
```

Open http://localhost:4174/. On this Mac you can also double-click `Open Browser Studio.command` and open that address. The local server only serves website files; it does not receive or process videos. Do not double-click `index.html`: browser modules and workers need HTTPS or localhost.

Choose a video, draw around the watermark, and try a 3-second preview. The browser creates a new MP4 using H.264 when available, or WebM using VP9. You can cancel processing. Downloads stay available for the current page session, subject to a four-export / 256 MB history limit. Save them before closing the page or making many exports.

## Host on GitHub Pages alone

1. This repository's `.github/workflows/pages.yml` builds from `browser/` and publishes only `browser/dist`.
2. Set Settings → Pages → Source to GitHub Actions if it is not already selected.
3. Push to `main` or run the included browser Pages workflow.

The workflow installs locked dependencies, checks and tests the engine, builds `dist`, and publishes those static files. No Render account, Python server, secret, `MSK_API_URL`, cross-origin isolation header, or SharedArrayBuffer is required. Assets and worker paths are relative to the page and support repository-path hosting.

You can also run `npm run build` and host the contents of `dist` on any HTTPS static host.

## What runs in the browser

- A dedicated module worker reads the selected File directly, so the editor can stay responsive.
- Mediabunny handles media containers, browser WebCodecs decoding/encoding, audio conversion or direct copying, and timestamp handling. It is a third-party media library, not a removal engine.
- Our JavaScript repair algorithm searches for a coherent clean pattern, validates a local lighting fit, or finds clean pixels in earlier unmodified frames. Missing content uses a boundary-constrained smooth estimate.
- Pattern matching compares gradients and full surrounding color; robust motion fitting rejects a limited set of codec/occlusion outliers. Previous repaired pixels are never counted as real source pixels.
- Conservative light/dark footprint estimation can retain original selection pixels. Reports separate preserved, observed temporal and estimated content.
- Moving masks use manually placed keyframes. Preview trims use the source time for the mask, while the exported timeline starts at zero.
- Codec support, track loss and excessive output size cause a clear failure rather than a silent or audio-less export. Unsupported browsers cannot start processing.

## Limits

Start with a recent Chrome or Edge browser on a desktop. This edition requires WebCodecs and OffscreenCanvas in a secure context. Decoder/encoder support varies by browser, operating system and input codec. A browser capability check is not a promise that every input can be decoded.

Current limits are 200 MB input, 1080p, 3 minutes for full exports, and a selected area no larger than a quarter of the frame or 90,000 pixels. Use even video dimensions and SDR footage; HDR preservation is not provided. Audio tracks must be preservable in the chosen output format, or export stops. Output is buffered in memory with a 256 MB cap. Device resources can impose lower limits. History is bounded to approximately 64 MiB and at most 12 frames. Full pixel buffers and the encoded output need additional memory.

The JavaScript engine is a separate, smaller implementation, **not feature or quality parity with the Python engine**. It does not include the original dense optical flow, learned generative inpainting, future-frame recovery, or automatic watermark tracking. Large opaque logos, busy subjects and content that is never visible can still leave artifacts. Review the actual result; missing pixels cannot be guaranteed to match the hidden original.

## Verify the build

```sh
npm run check
npm test
npm run build
```

Pure JavaScript tests cover pattern and lighting repair, light/dark footprints, unchanged pixels outside the selection, safe mask rejection, keyframe interpolation, bounded original-only history and coverage accounting.

`tests/runner.html` and its entry script are an optional local browser integration harness. They are excluded from the production build. The harness checks a variable-timestamp video with audio, a trimmed preview with moving-mask keys and the user's diagnostic clip. Private diagnostic media is never copied into the website. The optional test-only video path is supplied when starting the local test server. See `VERIFICATION.md` for the measured run.


## Review the example in motion

Click **Watch original vs repaired** in the upload panel. The synchronized comparison starts with a watermark close-up and shows the original, an actual browser-engine export and the clean reference. Switch between the previous and updated browser repairs, scrub the lighting transition or show the full frame. **Try the pattern + lighting example** loads that same marked source and its selection into the editor so you can rerun it yourself.

The generated comparison files are safe to publish; they contain no user footage. Their measured clean-reference errors and the repair source checksum are recorded in `public/examples/pattern-lighting.json`. The clean original is never passed to the repair worker.

The latest repair uses connected, strongly supported logo components to avoid replacing a whole rectangle because of isolated codec noise, and a validated thin-plate lighting surface with a boundary correction for curved illumination. Exact hidden content remains an estimate.

The browser engine also calibrates fixed white or black translucent overlays from a short sequence of checked frames. Where a substantial part of the logo supports that estimate, it can recover detail from the current source pixels through inverse compositing. It rejects opaque areas, inconsistent observations, changed selections and weak calibration; codec noise does not trigger full inverse correction. Calibration is never trained on its own recovered pixels. A clean reference is not required or supplied.

Before writing an export, a bounded analysis pass checks up to 12 source frames within the first two seconds of the chosen output range. This prepares translucent recovery for the first output frame and offset previews. Each calibrated pixel needs at least eight valid observations as well as the existing variance and contrast checks. Analysis frames are released immediately; future donor history, hints and masks are cleared before encoding, and output frame statistics exclude analysis frames. Very short or uncertain clips use the normal reconstruction path. Analysis can be canceled in the editor.

Clean pixels around the actual logo outline can correct the plate's local exposure, with a bounded smooth adjustment that retains donor texture. The adjustment is skipped when the exposure difference is insignificant. Equally good repeated-pattern donors retain their current alignment, avoiding unnecessary jumps between distant tiles.

During changing light, a validated current-frame edge signature can retain a calibrated outline when the absolute color fit fails. This confirms geometry only: opacity inversion is disabled for these uncertain frames. A padded contour is filled using the current clean pixels around it, instead of repainting the whole selection or carrying pixels from an older frame. Disappeared or displaced marks and unrelated background edges must fail the signature checks. Hidden content inside this contour is still an estimate.

## Playback stability

The comparison uses presented-frame callbacks where the browser supports them, with an animation-clock fallback. Source, result and example playback are coordinated so only one plays at a time; replacing the input also stops hidden result/example playback. These controls reduce decoder contention and canvas timing jitter independently of reconstruction quality.

The example comparison now uses one packed video and one playback clock, rendered into three canvases. Panels cannot seek or drift independently. The comparison pauses while a video export runs to reduce competition for browser video resources.

Repair alignment can refine a pattern donor to quarter-pixel positions and retain an equally good prior alignment. A watermark matte can remain fixed across small detection fluctuations only while current visible pixels and current watermark evidence validate it. No previous painted background is copied. New mark evidence, changed selection geometry or a detected scene change invalidates the held state. These checks reduce avoidable changes; they cannot guarantee artifact-free reconstruction of hidden content.

The packed comparison videos are presentation assets made by `node scripts/build-comparison.mjs` after the individual browser exports exist. FFmpeg is used only for this development-time presentation packaging. It is not called by the deployed app or used as the removal engine.
