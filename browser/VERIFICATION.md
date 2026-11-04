# Browser edition verification

Repository integration: the browser source is included in `browser/`, and the root Pages workflow publishes `browser/dist`. The dated sections below record local development before this integration. Their private video, screenshot and report paths refer to local evidence that is not committed or deployed.

Verified locally on 2 November 2026. The static app was opened in the in-app browser at localhost:4174. Processing occurred in a browser module worker using WebCodecs; the Python reference engine was not called by the app.

- 11 JavaScript tests passed, including preservation of faint pattern detail, recovery from a clean moving background, outside-selection pixel preservation, conservative footprint behavior, keyframe interpolation and bounded original-only history.
- Static checks verify that the active application contains no server job/status requests and the production HTML has no backend-configuration script.
- Browser integration: a generated 96-frame variable-timestamp MP4 with one audio track exported with all frames, unchanged dimensions, one audio track and zero measured normalized video timestamp error.
- Browser preview: a source-offset trim with mask keyframes exported 70 frames, one audio track and a 3.0107-second container duration (including audio padding).
- The user's diagnostic video exported entirely in the browser: 1280×720, 144 frames, one audio stream and 6.016 seconds. Independent PyAV checks confirmed exact normalized frame timestamps, strictly increasing timestamps, frame count, dimensions, audio-stream count and duration.
- Every diagnostic repaired-area crop was visually reviewed. The visible star is removed in the reviewed render; some reconstructed detail and lighting in the transition remain estimates. There is no clean original behind the real mark, so file-integrity checks and visual inspection do not establish exact recovery.
- The UI cancel action stopped an active diagnostic export, restored editing controls and reported that the original video was unchanged.
- Preview, full export and download links were exercised in the browser. The active editor was visually inspected. The original Python project remained clean and unchanged.

Private diagnostic videos, images and reports are stored only under ignored `.runtime` or local Downloads. They are not included in the deployable `dist` folder.

Current browser limits and differences from the Python engine are documented in README.md. No claim of universal browser or codec support is made. A GitHub Pages workflow is included, but this separate edition has not replaced the original repository or hosted website.


## Visible-patch correction and playable example

14 JavaScript tests now pass, including isolated edge-noise rejection in the watermark footprint and curved-lighting prediction. The repeated browser pipeline checks still pass: 96-frame variable-timestamp input with audio, a trimmed preview and the real 144-frame diagnostic clip. Preserved original selection coverage on the real clip increased from 6.6% to 58.8%. This describes processing sources, not reconstruction accuracy.

Both previous and updated generated examples were exported by the actual browser worker. On their known-clean reference, selected-region MAE changed from 1.0095 to 0.7903; transition MAE changed from 1.3908 to 0.8079. These measurements apply only to this generated example. The real clip has no clean hidden-region reference.

Original, previous and updated real-clip crops were visually reviewed, especially frames 132–143. The rectangular lighting seam is reduced, while inferred detail can still differ from the hidden source. User footage and diagnostic comparisons remain under ignored `.runtime`; only generated examples enter `dist`.


## Playback and temporal stability update

19 JavaScript tests pass. New checks verify stable matte geometry, rejection of newly uncovered watermark evidence, invalidation when a mark disappears or the selection jumps, current-frame lighting rather than copied painted pixels, and fractional pattern alignment.

The comparison player now uses one packed media file and one video clock with three canvas views. Browser inspection confirmed identical frame-time stamps across all panels during playback. Independent periodic seeks have been removed, and automatic looping has been removed so the example does not snap back from its last frame to its first frame. Pausing, seeking and changing versions remain explicit user actions.

The full browser pipeline still passes the 96-frame timestamp/audio regression and trimmed-preview checks. The real diagnostic render has 144 frames, 1280×720 resolution, one audio stream and 6.016-second duration. Independent timestamp checks passed with zero normalized timestamp error. On this render, matte geometry was held on 108 frames and subpixel donor alignment was used on 105 frames. These counts describe algorithm behavior, not guaranteed visual accuracy.

On the generated known-clean example, temporal residual MAE changed from 0.226997 to 0.223545 (1.5% lower). Selected-region MAE was essentially unchanged (0.790251 to 0.791313). This is a small, fixture-specific temporal improvement; it is not evidence that all reconstruction flicker is eliminated. The separately corrected comparison-player stutter is a playback issue.

## Translucent detail recovery — 4 November 2026

24 JavaScript tests pass. A new calibrated inverse-compositing path uses current source pixels to recover changing detail visible through a fixed white or black translucent mark. It freezes calibration after 12 frames so later background changes are not gradually absorbed into the estimated watermark. It rejects opaque interiors, weak calibration, changed selections and inconsistent current observations. The inversion strength ramps smoothly, avoiding a hard per-frame on/off threshold. Exposure correction follows the supported logo outline, and equally good distant pattern donors retain their previous alignment.

The known-clean synthetic changing-detail test (`scripts/evaluate-transparency.mjs`) measures hidden-region MAE of 3.0 for the previous engine and 0.6667 for this version. This is a specific controlled test, not a real-video accuracy claim. The separate opaque patterned/lighting browser fixture retains identical selected-region MAE (0.791313) and temporal residual MAE (0.223545), rather than trading opaque-mark quality for the new feature.

The final browser integration passes the 96-frame variable-timestamp/audio fixture (zero normalized timestamp error), trimmed preview (70 frames, audio retained, 3.0107 seconds) and diagnostic clip (144 frames, 1280×720, audio retained, 6.016 seconds). The diagnostic run used 111 held-mask frames, 107 fractional donor frames and 90,452 inverse-recovered pixel samples across the clip. These counts do not measure accuracy. The full final diagnostic video was played through in the browser, finishing normally at 6.016 seconds. The private output is `.runtime/Diagnostic-browser-advanced.mp4`; reports are `.runtime/advanced-verification.json` and `.runtime/advanced-integrity.json`.

The real source has no unmarked reference. Visual review and passing integrity checks cannot establish zero reconstruction artifacts or exact hidden content. The separate browser folder remains local and has not replaced the original GitHub repository.

## Prepared first-frame recovery — 4 November 2026

28 JavaScript tests pass. A bounded pre-export pass analyzes up to 12 source samples within the first two seconds of the selected output range. The transparency model is retained, while all donor history, alignment hints, matte geometry and output counters are reset. Tests verify improved first-frame reconstruction, correct source timestamps for offset selections, short-clip behavior, frame/iterator cleanup on failure, and exclusion of future frames from past-only donors. Per-pixel calibration now requires at least eight valid observations; isolated high-contrast observations cannot satisfy the confidence check by weight alone.

On a controlled changing-detail fixture, first-12-frame MAE changes from 3.0 without preparation to 0.6667 with preparation. This measures a generated translucent-mark test, not the unknown hidden pixels in the user's video. The existing opaque patterned-lighting browser example retains identical region MAE (0.791313) and temporal residual MAE (0.223545).

The browser verification passes full output (96 frames, audio, zero normalized timestamp error), offset preview (70 frames, audio, 3.0107 seconds) and the real diagnostic clip (144 frames, 1280×720, audio, 6.016 seconds). Both full output and preview report 12 prepared frames without adding them to the encoded frame count. Independent timing verification passes. The main editor also completed a 72-frame preview and a full 144-frame export. Canceling during the analysis phase restored editor controls and reported cancellation without modifying the source file.

Private result and evidence: `.runtime/Diagnostic-browser-prepared.mp4`, `preparation-verification.json`, `preparation-integrity.json`, `preparation-review.png`, `prepared-export.png`, `preparation-metrics.json` and `preparation-regression.json`. All are excluded from public hosting.

## Repair transition and all three playback cases — 4 November 2026

35 tests pass. The current logo edge signature is checked at reduced noise resolution, with calibrated coverage, amplitude and structural-agreement gates. If this confirms only geometry, a padded outline is filled from current clean contour pixels. Inversion is disabled on these frames; it is not valid to treat an edge match as proof of opacity accuracy. A controlled moving-shadow test verifies preservation of clean pixels around the logo, actual removal of its bright center, and rejection of opacity inversion under geometry-only confidence. Separate tests reject disappeared or shifted logos and unrelated strong background edges.

The actual browser diagnostic export uses eight edge-confirmed outlines and eleven contour-fill frames. Preserved source coverage inside the selection changes from 61.9% to 65.9%; this is a processing-coverage measure, not an accuracy score. Review of transition frames 130–142 shows reduced rectangular patching without the noisy mark-shaped edge of an intermediate experiment. That experiment was replaced before delivery. Reconstructed hidden shadows remain estimates. The opaque patterned/lighting fixture retains region MAE 0.791313 and temporal residual MAE 0.223545.

Whole-video integrity passes: 144 frames, 1280×720, one audio stream, 6.016 seconds, strictly increasing timestamps and zero normalized timestamp error. The browser presentation audit records 144 playing-state frame callbacks, zero repeated or backward callbacks, zero seeks, zero waiting events, zero dropped frames and zero corrupted frames. Paused preload callbacks are excluded from playing-state callback counts. These observations apply to this local test, not every device or browser.

The example comparison uses the native presented-video-frame clock, confirmed as `video-frame` in the browser. All three canvas panels have identical presented media times during playback. Tests cover cancellation, stale callback rejection and a 24fps animation fallback. Source/result/example playback is exclusive; native browser checks confirm that starting the result pauses both other players. The original frame timestamp/audio and trimmed-preview integration tests also pass.

Final private evidence: `.runtime/Diagnostic-browser-glitch-fixed.mp4`, `glitch-verification.json`, `glitch-integrity.json`, `glitch-regression.json`, `glitch-review.png`, `player-audit.json`, `canvas-playback-audit.json` and `exclusive-playback-audit.json`. The independent original server repository and hosted GitHub site have not been replaced.
