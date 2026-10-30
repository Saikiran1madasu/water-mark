# MSK Watermark Remover

Custom temporal video repair engine with the MSK dashboard. No cloned removal repository, model weights, remote inference service or FFmpeg delogo in the application pipeline. Third-party numerical, computer vision and media libraries are still required; see engine/DESIGN.md.

## Setup and run

Requirements: Node.js 20+, Python 3.12+, FFmpeg and ffprobe on PATH.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm start
```

Open http://localhost:4173. Upload a browser-playable MP4, draw a box over a logo or text region, choose motion context and edge margin, and select Remove watermark. Inspect the repaired result and actual temporal coverage report before downloading. For a moving or animated watermark, choose mask keyframes, scrub to new times and redraw the box at each position or size change. Masks interpolate along straight paths between positions. This is manual guidance, not automatic object tracking. A larger context can recover more revealed background but takes longer. Context is automatically reduced for large frames to bound memory.

The hosted dashboard supports video selection; actual repair is available in the local studio. It cannot execute the Python engine on static hosting. The engine listens on loopback only and does not send videos to an external service.

## What changed

The original spatial delogo filter is replaced by our feature tracking, bidirectional motion validation, robust affine alignment, boundary checks, exposure correction, source masking and temporal median fusion pipeline. It uses OpenCV's Telea inpainting only for pixels that cannot be recovered from nearby frames. PyAV encodes original presentation timestamps, including variable frame intervals; FFmpeg restores audio through AAC re-encoding. The original uploaded file is never overwritten.

## Limits

This is a classical computer vision engine, not a trained generative AI model. Exact reconstruction of permanently hidden details is impossible. Complex deforming motion, parallax, low texture and large masks can still produce artifacts or require spatial fallback. Temporal coverage is source utilization, not a quality guarantee. Current support: fixed rectangular masks or up to 32 interpolated position/size keyframes across the full clip, upright even-sized 8-bit SDR video, one job at a time, uploads up to 500 MB. Multiple simultaneous regions, automatic tracking, calibrated confidence and cloud processing are not implemented.

Intermediate video and uploaded inputs are deleted after processing. Completed exports remain in `.runtime/` until manually removed. Job and export history are session-local. Output pixels outside the expanded mask are unchanged before lossy final encoding. HDR and rotated inputs are explicitly rejected rather than silently degraded.

## Validation

```sh
npm run check
.venv/bin/python -m unittest discover -s tests -v
```

Tests measure recovery against known clean moving footage, compare with the previous delogo implementation, verify untouched regions before encoding, scene isolation, static fallback, input rejection, variable timestamps, output frame count, dimensions and audio presence.

## API

POST `/api/jobs?box={x,y,w,h}&quality=high&radius=12&margin=3&keyframes=[]` accepts raw video bytes with a video Content-Type and normalized rectangle coordinates. Radius 2–24; margin 0–12. GET `/api/jobs/:id` returns real stage, progress, coverage and final statistics. GET `/outputs/:id.mp4` returns the finished video. GET `/api/health` reports engine availability.
