# Clearframe

A video cleanup dashboard and working local FFmpeg processing service.

## Run

Requirements: Node.js 20+, `ffmpeg` and `ffprobe` available on PATH. FFmpeg must include the `delogo` filter and libx264 encoder.

```sh
npm start
```

Open http://localhost:4173. Upload a browser-playable MP4, draw a fixed rectangle over the watermark, then select Remove watermark. Review and download the MP4 result. Audio tracks are retained through AAC re-encoding. Upload limit: 500 MB. One export at a time.

## Current capabilities and limits

The engine uses FFmpeg's spatial `delogo` repair. It interpolates from the selected region's surroundings; it is not temporal AI inpainting. It can smear detailed backgrounds and cannot guarantee perfect removal. Selections apply to the entire clip. Moving watermark tracking, multiple masks, time ranges, HDR preservation, accounts, cloud GPU workers, and persistent job history are not implemented. Rotated inputs are rejected with instructions to normalize them first. Originals are not modified. Outputs remain in `.runtime/` until manually removed; project history lasts for the server/browser session. Uploaded temporary inputs are removed after processing.

The hosted static dashboard supports local video inspection and selection. Actual export runs in the local studio; the hosted dashboard shows this requirement explicitly. It does not send media to an external server. The local service listens on loopback only.

## Checks

```sh
npm run check
```

Data contract: POST `/api/jobs?box={x,y,w,h}&quality=high` accepts raw video bytes, with a video Content-Type and normalized rectangle coordinates. GET `/api/jobs/:id` returns actual status and encoding progress. GET `/outputs/:id.mp4` returns the finished MP4. GET `/api/health` reports engine availability.
