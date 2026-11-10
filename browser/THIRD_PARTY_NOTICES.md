# Third-party notices

Copyright (c) 2026 Saikiran1madasu. All rights reserved for original project materials.

This browser edition uses Mediabunny 1.65.0 for media demuxing, decoding/encoding orchestration and muxing. Its MIT license is retained in `dist/MEDIABUNNY-LICENSE.txt` after building and in the installed package. The custom watermark reconstruction code is in `src/repair.js`.

The optional AI reconstruction mode uses ONNX Runtime Web 1.31.1 (Microsoft, MIT). Its license and upstream third-party notices are retained in `third_party/onnxruntime/` and copied into the built site as `ONNX-RUNTIME-LICENSE.txt` and `ONNX-RUNTIME-THIRD-PARTY-NOTICES.txt`. These files come from the official `microsoft/onnxruntime` v1.31.1 tag.

The former MI-GAN runtime and pretrained model were removed from the packaged site in 0.4.0. An ignored private licensed copy is retained only for reference comparisons. The active experimental model architecture in `training/own_matte_model.py` and its weights at `public/models/own-matte-v1.onnx` are original project materials, trained from random initialization with no third-party pretrained weights or teacher outputs. The inference adapter is `src/own-matte.js`. ONNX Runtime, Mediabunny, esbuild and other standard dependencies retain their separate licenses. Training uses PyTorch, ONNX, NumPy and PyAV as development tools; these are not packaged as browser runtimes.

The original RGB architecture is in `training/own_rgb_refiner.py`, with its project-trained checkpoint at `public/models/own-rgb-v3.onnx`. It is initialized from our own original RGB v1 checkpoint, which starts from random weights; no external model weights or external teacher outputs are used. Its adapters and paired self-calibration are in `src/rgb-refiner.js`. The proprietary project license covers these original materials; standard mathematical/architectural ideas are not claimed as inventions.

The development build uses esbuild. The dashboard requests fonts from Google Fonts and retains the user-supplied MSK Converter logo. GitHub workflows use actions provided by their authors. These components retain their own copyrights and licenses.

The archived reference server code uses NumPy, OpenCV, PyAV, FFmpeg, Node.js, Python, gosu and system packages. Those components are not shipped as browser runtime code; their own licenses still apply if that separate reference project is packaged or distributed.

The repository's proprietary LICENSE applies to original project materials and does not replace upstream licenses or claim third-party ownership.
