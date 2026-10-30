# MSK Temporal Repair v1

This repository contains a custom, classical computer vision video repair pipeline. It does not use ProPainter's source or model weights, and no external removal service is called. It is not a trained AI model. The generic research idea of transferring visible information between video frames informed the design; our implementation uses feature tracking and robust geometric fitting rather than ProPainter's propagation networks and transformer.

## Pipeline

1. Decode frames with PyAV, retaining their presentation timestamps.
2. Interpolate user mask keyframes for position/size changes, or use a fixed box. Expand the user mask by an adjustable margin to include transparent outlines.
3. Buffer a bounded past/future window (approximately 256 MiB of full-resolution pixels).
4. Estimate scene boundaries from HSV histogram changes; do not use references across detected cuts.
5. Find clean features outside the expanded watermark. Track them forward and backward with pyramidal Lucas–Kanade. Reject tracks that enter the source watermark, leave the image, or fail the round trip.
6. Estimate a similarity transform with RANSAC. Reject poor consensus or extreme scale changes.
7. Warp candidate background samples into the selected region. Exclude each source frame’s own watermark pixels and out-of-frame pixels. Use an untouched boundary ring to reject poor alignment and compensate small exposure changes.
8. Recover masked pixels from the robust median of accepted observations, excluding high-disagreement pixels. Fill unobserved areas with OpenCV's Telea inpainting primitive.
9. Composite only inside the expanded mask; decoded pixels outside it are unchanged before encoding. Encode H.264 with original frame timestamps and restore original audio through AAC encoding.
10. Report actual recovered-pixel coverage and fallback frames. Coverage describes reference use, not accuracy or confidence calibration.

## Dependencies and attribution

Custom orchestration, mask handling, motion validation, source gating, fusion, compositing, buffering, reporting, and application integration are implemented here. OpenCV supplies established feature tracking, geometric fitting, warping and Telea inpainting algorithms. NumPy supplies numerical operations. PyAV and FFmpeg supply media codecs and muxing. These are third-party dependencies; the product is not entirely independent of third-party technology.

Research reference: Zhou et al., “ProPainter: Improving Propagation and Transformer for Video Inpainting”, ICCV 2023, https://openaccess.thecvf.com/content/ICCV2023/papers/Zhou_ProPainter_Improving_Propagation_and_Transformer_for_Video_Inpainting_ICCV_2023_paper.pdf . This is a conceptual reference, not an implementation of that model.

## Limits

Supports a fixed screen-space mask or up to 32 manually guided mask keyframes, interpolated in position and size. This is not automatic logo tracking. Large text can be enclosed in a rectangle; selections over half the frame are rejected because insufficient background remains. Affine camera motion is the strongest case. Deforming subjects, parallax, low texture, large opaque masks and background that never appears elsewhere may force spatial fallback or produce artifacts. Histogram cut detection and similarity transforms are heuristics, not universal scene understanding. Full-resolution processing is CPU-bound. Context is reduced automatically on large frames to keep memory bounded. Current export supports even-sized, upright, 8-bit SDR videos. No promise of perfect reconstruction or universal improvement is made.
