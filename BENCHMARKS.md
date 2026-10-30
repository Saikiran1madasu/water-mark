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
