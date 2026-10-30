# MSK Temporal Repair v1 — validation

Measured on generated, known-ground-truth footage. These results show behavior on controlled cases, not universal real-world quality.

| Case | Result |
|---|---|
| Encoded panning textured background, fixed white overlay, 28 frames | Masked-region mean absolute pixel error: MSK 10.14 versus previous FFmpeg delogo 19.95 on the 0–255 channel scale; approximately 49.2% lower error |
| Same encoded export | 72.3% of selected pixels used recovered reference-frame observations |
| Uncompressed translating texture | 100% reference recovery, masked-region mean absolute error 0.00 on this exact integer-translation case |
| Moving opaque overlay over a static textured background, supplied per-frame masks | 100% reference recovery, masked-region mean absolute error 0.00 |
| Permanently hidden area on a flat background | Explicit spatial fallback, 0% reference recovery |
| Scene cut | References from other detected scene IDs rejected |
| Export integrity | Frame count, dimensions, audio stream presence and original variable presentation timestamps verified |
| Browser workflow | Upload, rectangle selection, two editable mask keyframes, real processing, completed output and download link verified |

The moving-overlay benchmark assumes correct masks. The application supplies these through manually edited, linearly interpolated keyframes; automatic logo detection/tracking is not implemented. Zero-error uncompressed cases use exact synthetic geometry and are not representative of general video. Real footage with nonrigid motion, parallax, compression and permanently occluded content may fall back or produce artifacts.

Run `npm test` from the project directory to reproduce the automated checks. The old delogo filter appears only as a comparison baseline in the test, never in the application processing path.

## Version 2 development measurements

Controlled tests added for weaknesses that the original translation example did not cover:

| Case | Measured result |
|---|---|
| Independently moving foreground layer, static camera, opaque logo | v1 masked MAE 16.52 with 0% reference recovery; v2 masked MAE 1.01 with 100% reference recovery for the selected uncompressed frame |
| Smooth nonlinear warp, alignment evaluated outside hidden pixels | Initial alignment MAE 18.65; dense-refined alignment MAE 1.47 |
| Permanently hidden repeating stripe texture | Smooth fill MAE 52.72; clean-patch synthesis MAE 1.91 |
| Original encoded panning export | v2 MAE 7.98, old delogo MAE 19.95; v2 reference recovery 94.9% |

These are synthetic fixtures with known ground truth. They do not establish quality on the user's failing clip, which was not attached when these measurements were made. Dense-flow alignment is measured on visible pixels, not proof that hidden motion is correct. Exemplar reconstruction is synthesized texture; it is never reported as reference recovery. The full test suite also covers fallback stability, preview trim/keyframe translation, audio and frame timing, and exact-origin browser access.

## Exact visible-patch regression (revision 2.1)

The loaded `MSK-local-motion-example.mp4` preview showed an incorrect green shape at frame 36 and an incorrect yellow shape at the end, despite high reference coverage. This was reproduced against its clean reference, not inferred from a coverage percentage.

For the same encoded preview preparation and expanded repair region across all 72 frames:

| Measurement, channel MAE on 0–255 scale | Previous preview | Corrected preview |
|---|---:|---:|
| Mean across frames | 5.32 | 3.08 |
| Worst frame | 14.93 | 3.61 |
| Moving green shape, frame 36 | 14.46 | 2.19 |
| Last frame | 14.93 | 3.35 |

`tests/test_example_regression.py` now checks every frame, with explicit limits on the moving shape and clip ending. A good average is insufficient for this regression. The clean reference is evaluation-only; it is never passed into the engine. Remaining error includes alignment and video encoding differences. This validates the included example, not all possible footage.
