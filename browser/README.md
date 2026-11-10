# MSK Browser Video Removal

Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE and THIRD_PARTY_NOTICES.md.

This is a local working copy of the browser edition in `Saikiran1madasu/water-mark` (`browser/`). The original Python/server edition remains at the repository root. Version 0.6.3 is a local candidate with an original learned RGB contour model and motion repair; browser WebCodecs integration is still unverified and this version has not replaced the published build.

## Own reconstruction — current default

Open `http://localhost:4174/?mode=restore`, or use **Own reconstruction · experimental** in Output settings. Version 0.6.3 combines the original motion repair with an original learned RGB contour model. Video processing stays in the browser; no processing backend, video upload or external inpainting model is required.

The 68,507-parameter, 284,647-byte model is trained entirely within this project. Its first checkpoint starts from random initialization; the selected checkpoint continues training from that original checkpoint. It uses no external pretrained weights or external teacher outputs. Standard PyTorch/ONNX tools are used offline for development, and ONNX Runtime Web runs inference in the browser.

For each eligible frame, the model processes the original source and a simulated overlay on the same current-frame repair. Subtracting the second prediction cancels the model's fixed outline bias. Only the uncertain contour may change: inverted core pixels, alpha, pixels outside the support, and verified original-frame motion contributions are preserved. Unsupported selections retain standard repair. One calibrated round is used; repeating it worsened most individual frames in a controlled test.

On the related 240-frame known-clean photographic test, the exact integrated pipeline reduces masked mean error from 1.642261 to 1.209770 and temporal residual error from 1.207866 to 0.897690, improving 226 of 240 frames. This is a one-video synthetic-overlay experiment, **not** proof of exact hidden-pixel recovery in the actual marked video. A full native original-video render processes all 240 frames, but visible reconstruction traces remain; completely invisible removal is not achieved. Browser WebCodecs export/playback is still unverified. The public GitHub deployment has not been updated.

Since version 0.6.1, the engine also corrects a calibration bias: when a fading edge lowers the core estimate, a sufficiently stable deeper interior may provide the plateau instead. Small, downward and excessive shifts are rejected, and repeatable opacity gradients retain the existing estimate. This does not make the uncertain contour exact.

## 0.6.3 verified fine motion matching

Motion/reconstruction mode now refines translations to quarter-pixel positions using bilinear samples. Forward/reverse checks, original-source watermark exclusion, visible-context agreement and the validated integer alternative remain. New fractional donor samples must improve current-frame compositing evidence by at least 20% and 0.5 RGB units. A newly valid fractional whole-context match cannot suppress the existing local searches when its integer alternative was invalid.

The supplied full original uses 966 original-reference pixel contributions in 40 frames, versus 873 in 31 frames previously. This is a small matching upgrade, not resolution of the faint patch. Related raw-control masked error changes from 1.210231 to 1.209770 and temporal residual from 0.898181 to 0.897690. The compressed-control changes are near zero and slightly worse (3.110784 to 3.110804 masked error). No broad quality or invisible-removal guarantee is established. The original learned graph is unchanged; no processing backend or new browser dependency is introduced.

## 0.6.2 confidence handling and repeated-export test

A rejected frame-level inversion no longer switches motion/reconstruction mode to filling the entire selection rectangle. Strong evidence that the calibrated mark is absent preserves original pixels. Otherwise, estimated filling stays inside the established fixed-mark support and uses outside source pixels as anchors. The report identifies these cases. On a related H.264-compressed 240-frame control this reduces masked error by about 6% and temporal residual by about 5.8%; it does not resolve the original clip's faint patch. All frames in that original already qualify for inversion, so its retained 0.6.2 export was identical to 0.6.1.

Three new original-model training candidates were tested on the entire original video and rejected as default replacements after raw/compressed comparisons. The retained checkpoint is still v3. Reprocessing the exported result also worsens detail; it is not automatic cleanup. See VERIFICATION.md and training/RESEARCH.md for the full results and limitations.

## Original browser motion engine

**Original motion repair · experimental** is also available separately. Select it in Output settings, or use `http://localhost:4174/?mode=motion`.

This is independently written JavaScript. It compares unmodified neighboring decoded frames, estimates masked motion in both directions, checks local visible-background agreement and source-watermark exclusion, then reuses supported clean original samples inside the repair. Ambiguous matches retain the existing reconstruction. Original history remains bounded, and it is cleared at detected scene changes. No processing backend, external video upload, Python runtime, third-party inpainting weights, or GPU service is needed by this mode. Mediabunny remains a third-party media library; its license is retained.

The architectural idea of using temporal information is a research reference, not a claim that we invented motion matching. No ProPainter, ROSE or other restricted inpainting implementation was copied into this module. This is a small classical motion engine, not an independently trained video diffusion/transformer model.

On the restored 240-frame original, it adds only 806 original-reference pixel contributions across 31 frames. A related 240-frame controlled synthetic-overlay sequence improves masked mean error from 1.646683 to 1.642876 and temporal residual error from 1.211583 to 1.208330. These are small gains; **the visible patch remains unresolved**. Native JavaScript testing and bundling pass; actual browser WebCodecs export/playback of this version remains unverified. No GitHub push/deployment is performed.

## Original supporting model

Choose **Own learned repair · experimental**, or open `http://localhost:4174/?mode=own`. The architecture and weights are original project work, trained from random initialization. No MI-GAN weights, outputs or teacher were used. MI-GAN has been removed from the app and packaged site; it remains only an ignored private benchmark reference. Standard inference/media libraries retain their third-party licenses.

The 6,818-parameter, 40,185-byte model refines an existing translucent-white watermark opacity estimate. It does not generate a replacement image. Our own directional boundary repair handles uncertain edge pixels. Proposals must pass a visible-background color-line check before being applied; otherwise the existing original engine handles the frame. In the supplied 240-frame clip, every learned proposal failed this check, so the final guarded output uses the retained original reconstruction. The new learned model is not a demonstrated improvement for that clip.

Training code lives in `training/`; it uses unmarked crops from the supplied video and synthetic overlays. Frames 83–127 are withheld from training. This is a one-video research dataset, not a broadly validated removal model. See `training/RESEARCH.md` for architecture, provenance, rejected trials and comparison limitations.

The original model runs on-device through ONNX Runtime Web 1.31.1, using single-threaded WASM and relative same-origin assets. The small model still needs approximately 14 MB of inference runtime on first use. Video frames are not uploaded. The model checksum is verified before inference. This hidden legacy experiment is not the default. It does not promise invisible removal or superior general quality to MI-GAN.

Local native evaluation: `node scripts/render-own-evaluation.mjs SOURCE.mp4 OUTPUT.mp4`. It uses our production JavaScript adapter and model with FFmpeg supplying test-only media I/O. The browser uses WebCodecs; no processing backend is introduced. Browser playback/export remains unverified.

## Use it locally

```sh
npm install
npm start
```

Open http://localhost:4174/. On this Mac you can also double-click `Open Browser Studio.command` and open that address. The local server only serves website files; it does not receive or process videos. Do not double-click `index.html`: browser modules and workers need HTTPS or localhost.

Choose a video, draw around the watermark, and try a 3-second preview. The browser creates a new MP4 using H.264 when available, or WebM using VP9. You can cancel processing. Downloads stay available for the current page session, subject to a four-export / 256 MB history limit. Save them before closing the page or making many exports.

## Host on GitHub Pages alone

1. The repository root workflow `.github/workflows/pages.yml` builds from `browser/` and publishes only `browser/dist`.
2. Set Settings → Pages → Source to GitHub Actions.
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

The JavaScript engine is a separate implementation, **not feature or quality parity with the Python engine**. Own learned mode includes an original opacity-matte refiner, but does not include dense optical flow, future-frame recovery or automatic watermark tracking. Large opaque logos, busy subjects and content that is never visible can still leave artifacts. Review the actual result; missing pixels cannot be guaranteed to match the hidden original.

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

## Detail recovery in 0.2

For a fixed semi-transparent white watermark, Detail mode can study up to 24 distinct frames distributed across the source, including for an offset preview. It fits robust RGB background color lines using only visible pixels outside the selection. At least four reliable frames and varied background colors are required. Per-pixel opacity is combined with weighted medians, consistency checks and connected support. Opaque marks, weak color separation, changing selection geometry and absent or displaced marks do not qualify for this path. Moving-keyframe mode and Fast mode retain the existing engine.

The qualified core is recovered from current source pixels by inverse compositing. An uncertain edge band is repaired separately; its directional weights are derived from current clean pixels and recovered core pixels. This preserves straight background structures better than isotropic averaging, while leaving the rest of the selection untouched before encoding. The opacity estimate and band fill are still estimates, not access to an unmarked original. No reference frame or logo asset is supplied to the engine.

The color-line assumption is described in [Levin, Lischinski and Weiss, A Closed-Form Solution to Natural Image Matting](https://people.csail.mit.edu/alevin/papers/Matting-Levin-Lischinski-Weiss-PAMI.pdf). This implementation is our own multi-frame ROI calibration and directional boundary treatment; it is not a copied implementation of that paper or a pretrained model.

Upfront sparse decoding adds preparation time. Reports distinguish opacity-recovered core pixels from estimated band pixels and preserved source pixels. Versioned download names help distinguish new exports from earlier ones.

`scripts/render-local-evaluation.mjs` is a development-only CFR evaluation driver: FFmpeg handles media I/O, while the production JavaScript engine performs reconstruction. It is not used by the website and does not establish browser integration success. Native output timing/audio and actual-frame comparisons are recorded separately from WebCodecs verification.

For a manual browser check, run the optional test server with `BROWSER_TEST=1` and the explicitly supplied local `BROWSER_TEST_VIDEO`. Its test button saves the completed report and export under ignored `.runtime/browser-v02-*` paths on this computer. Save routes exist only in that development mode, reject unrelated browser origins, and are absent from the normal studio and GitHub Pages. Review saves are capped at 64 MB; normal production export limits remain as documented above.

### Local follow-up 0.2.1

Adds a bounded clean-background padding retry for tight selections, denoising of flat matte interiors and conservative scene-aware opacity adjustment. The result report states when opacity calibration failed and estimated filling was used. Refresh the page to load 0.2.1 before reprocessing. This remains a local candidate; browser integration and perfect restoration are not claimed.

### Local follow-up 0.2.2

Adds conservative smooth-tone matching for faint residual shapes after opacity recovery. It fits only visible background pixels, limits color changes and preserves image texture; unsupported areas keep their previous repair. Tone corrections are reported as estimated background, not exact recovery. Local checks and full-file evaluation pass; the actual browser export remains unverified and perfect restoration is not claimed.

### Local follow-up 0.2.3

Cross-scene checks prevent nonrepeating background texture from being baked into a nearly uniform watermark opacity map. A narrower estimated boundary preserves more recovered source detail, and a bounded curvature correction improves its continuity. There are 53 passing checks and a new full local evaluation. Difficult transition traces remain unresolved; the browser-only perfect-removal goal is not reported as achieved. GitHub Pages has not been updated with this candidate.

### Local follow-up 0.2.4: Seamless mode

Choose **Seamless · soft backgrounds**, or open `http://localhost:4174/?mode=seamless`, to target faint repaired-area tone in low-detail scenes. Coherent edges are protected and the correction is stabilized across frames. Choose **Detail** when preserving fine texture matters most. Seamless estimates missing appearance; it is not an exact-restoration guarantee. All processing remains in browser JavaScript and the product still supports static GitHub Pages hosting.

59 checks and a complete local evaluation pass. The actual browser export remains unverified. The published site has not been updated with this local candidate.
