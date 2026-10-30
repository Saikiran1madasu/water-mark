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

# Version 2 changes

Version 2 keeps the same custom, classical computer-vision approach and dependencies. It adds competing scene/local similarity/local affine fits; a boundary percentile penalty; bidirectionally checked DIS residual flow, with unreliable/hidden flow extended from clean surroundings; local uncertainty gating; reference-pixel consensus selection instead of RGB averaging; nearby and distant references on both sides; deterministic clean-patch exemplar synthesis for unseen texture; and motion-validated history blending for fallback stability. History and synthesized patches never count toward temporal recovery.

The residual-flow branch runs when affine alignment has measurable error and is accepted only when it improves the clean boundary match. It remains an inference from surrounding visible pixels, not a guarantee that motion inside the hidden area is correct. Detail mode enables dense refinement and exemplar synthesis; balanced mode uses fewer references and smooth fallback. Patch synthesis is bounded to 160 steps and missing regions up to 18,000 pixels; larger remaining areas use smooth fill. Fallback textures are estimates, not recovered originals.

The 3-second preview route trims and normalizes a temporary copy, translates mask keyframes into the preview time range, then runs the same engine. Full exports use the original input and timestamp path. Preview source preparation introduces an additional encode, so preview pixels are not bit-identical to a full export.

The hosted dashboard can contact the loopback engine directly through an exact-origin CORS bridge. Only the private dashboard origin and local studio origins are allowed; the server continues to bind to 127.0.0.1. A browser may require local-network permission or block loopback access; the full local studio remains available as a fallback. No cloud Python or GPU service is deployed.

## Visible-patch correction, revision 2.1

The concrete example failure was a source-selection problem: a model could score well on the visible boundary while revealing no clean pixels, residual flow could overfit codec noise, and independently chosen donor pixels could form an inconsistent interior. A local masked-correlation translation proposal now excludes both source and target watermark pixels. Model ranking includes observed-area coverage, residual flow is reserved for larger measured mismatch, and a coherent donor supplies each repair wherever possible. Only the expanded margin is feathered; the watermark core is fully replaced. No clean-reference asset is used by the repair pipeline.

## Repeating graphics and shaded backgrounds

A real 720p graphics clip exposed a different failure from the synthetic moving-texture test: the mark stayed over a nearly static grid, so frame propagation had no genuine clean view. Tiny exemplar patches broke cross shapes, and reusing an untrustworthy previous fill stretched them across frames.

`structure.py` now proposes a whole clean pattern tile at native resolution. Masked, shading-normalized correlation excludes the source and target holes, requires a completely clean donor for the selected area, checks pattern correlation, and validates the visible boundary after fitting a lighting plane. Smooth backgrounds use a validated thin-plate illumination surface and harmonic boundary correction; compact high-frequency structures prevent the smooth path from flattening clear grid detail. These are spatial estimates and are reported separately from observed temporal pixels. General repair remains the fallback if structure confidence fails. Previous-fill propagation now requires a verified local translation and a much stricter boundary match.

The real user's video and its diagnostic images stay local and are not part of hosted assets or the source repository. Tests use generated repeating patterns and illumination fields. There is no clean original behind the real watermark, so visual review and export-integrity checks do not establish exact reconstruction.

## Alignment and edge polish

Pattern donors now receive a bounded subpixel translation refinement only when it reduces measured clean-surround error. A low-frequency boundary correction matches tone without averaging away crosses. The prior frame's donor coordinates can be considered with a small preference when quality is otherwise similar; old synthesized pixels are never copied by this path, and a poor prior cannot suppress the strongest clean candidate. Scene changes reset the preference. High-quality exports now use CRF 14; balanced exports retain CRF 20.


## Conservative watermark footprints

After a pattern or lighting reconstruction passes its own validation, `footprint.py` tests light and dark opacity models against that plate. Connected evidence, an antialiasing safety band, selection-edge checks, competing-polarity rejection and agreement on retained pixels prevent an uncertain footprint from trimming the repair. A confident footprint replaces the mark fully and feathers only its outer safety band; other observed selection pixels are retained before export encoding. An uncertain shape uses the existing full-selection repair. This is limited achromatic overlay estimation against an estimated plate, not universal logo detection, trained matting or automatic tracking.

Reports separate preserved original selection pixels, observed temporal pixels, and synthesized pixels. Pattern/lighting coverage counts only pixels touched by that repair after footprint trimming. Fractions describe processing sources, not visual accuracy.


## Agreement between clean pattern donors

A good surrounding match does not prove that a donor's hidden interior is appropriate. The pattern path now retains its candidate whole tiles and compares their estimated interiors. Only candidates within 0.75 of the strongest boundary score can vote; heavily overlapping donor positions cannot supply multiple votes. At least three mutually compatible donors and a strict majority are required to override the boundary winner. The winning group supplies its strongest whole tile, with no RGB averaging. If evidence is split or inadequate, the existing boundary ranking remains in charge. Interior comparisons use at most 4096 deterministic samples per donor to bound memory. `patternConsensusFrames` records frames with this additional agreement evidence; it is not an accuracy score.
