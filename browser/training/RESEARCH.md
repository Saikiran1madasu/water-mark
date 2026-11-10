# Original reconstruction-model experiment

The requested target is a custom engine with better removal quality than MI-GAN. This experiment establishes original architecture, training, weights, browser-compatible inference and a comparison harness. It does **not** establish generally superior quality or invisible removal.

## What was studied

[MI-GAN, ICCV 2023](https://openaccess.thecvf.com/content/ICCV2023/html/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.html) uses an encoder/decoder, depthwise-separable operations and a painting branch, with adversarial training and knowledge distillation. Its target is plausible image completion. Single-image completion alone does not establish temporal video consistency or exact recovery of partly visible source detail. The paper and official project were consulted as references; their implementation and pretrained parameters were not used to initialize our model.

## Independent implementation

`own_matte_model.py` implements a 6,818-parameter local residual network. Seven input channels carry RGB, an initial opacity map, support and coordinates. Visible context means add three feature channels. Five small depthwise/pointwise residual blocks use dilation 1, 2, 4, 8 and 16. Two bounded heads estimate refined white-overlay opacity and a small dark fringe. RGB recovery uses inverse compositing. These are standard mathematical/building blocks; this is an original implementation, not a claim of inventing convolution or inverse compositing.

The first ONNX graph is 40,185 bytes. Training starts from random initialization, without a pretrained generator, discriminator, MI-GAN teacher or model-generated labels. Only standard libraries are third-party. Original code and weights fall under this project's original-materials license.

## Data and reproducibility

Run `python training/prepare_dataset.py SOURCE.mp4` locally, then `python training/train_own_matte.py --steps 800 --batch 8`. The supplied 1280x720 video is required to reproduce this specific dataset; it is not published. The script excludes the rightmost watermark region and creates 384 training and 96 validation patches. Source frames 83–127 are excluded from training. Synthetic translucent white stars and small dark fringes provide exact training targets. Seed: 20261105. Validation uses 96 newly synthesized examples on the held-out crops. One-video training is a substantial generalization limitation.

The first run took 800 steps on this Mac's MPS device. Initial-matte reconstruction MAE on its synthetic validation examples is 3.507531 RGB levels, versus 2.549200 after refinement. This is an internal synthetic test, not actual hidden-pixel accuracy.

A second independent run uses 3,000 steps with `--name own-matte-v2 --coarse-jitter`. Its training task includes shifted, blurred and noisy initial mattes. It scores 6.019336 before refinement and 3.106579 afterward on that harder synthetic validation task. These figures are not directly comparable with run one's easier validation. The second run is not selected for the app because the shared pipeline comparison is worse.

Checkpoint 1 SHA-256: `7d03f891d9a8fe0d62670943ea469ac41afb53986a2207b7f66cca4cc2530618`.
Checkpoint 2 SHA-256: `154cafa2e6388611d591badd4cbe543a2bac2408f412109e3f65845acc9ebf6d`.

## Comparison and rejected use

Twenty-four independent synthetic translucent-overlay examples use the same corrupted photographic crop and calibrated support for all pipelines; clean images are used only for scoring. This source is related to training footage, so the comparison is not an independent-dataset result. MI-GAN fills the support; our pipelines have built-in opacity calibration and exploit remaining visible detail. This comparison does not cover general opaque inpainting.

| Pipeline | Mean masked MAE | Median per-example MAE |
|---|---:|---:|
| Existing original custom repair | 1.828191 | 1.515774 |
| First original learned prototype, unguarded | 3.791831 | 3.774878 |
| MI-GAN supporting pipeline | 4.620399 | 2.457434 |

The first learned prototype beats MI-GAN on only 8 of 24 examples despite its lower average error. It is worse than our existing custom engine. The second prototype has mean MAE 4.026212. These results do not justify claiming superior overall quality. The first direct-inversion full video also leaves a star outline. That use is rejected; our existing directional contour reconstruction remains necessary.

The legacy matte experiment therefore verifies a candidate against the visible source background's color line and requires a material improvement before applying it. Otherwise it returns the frame to the original repair pipeline. All 24 comparison proposals and all 240 proposals on the actual supplied video are rejected under this conservative check. The retained output is not a learned-model improvement. The patch remains unresolved. This legacy model remains an explicit experiment. The later 0.6.0 RGB model is a separate architecture and current default.

MI-GAN weights and its runtime entry point were removed from the app. An ignored private licensed reference is retained only to reproduce comparison scores. No MI-GAN assets are included in the current website bundle.


## Original RGB contour restorer (0.6.0)

`own_rgb_refiner.py` independently implements a small encoder/decoder with depthwise residual blocks, downsampling, nearest-neighbor upsampling and skip connections. Inputs are original RGB, the current repair's RGB, a calibrated opacity estimate and support. A zero-initialized output head predicts a bounded 16-RGB-level residual. There are 68,507 parameters. Standard neural-network components and mathematical ideas are not claimed as new inventions.

All training material remains private in `.runtime/rgb-refiner/`. The 384 unmarked 128px training crops and 96 validation crops come from x<1024 of the user-supplied video, with frames 83–127 held out. Two generated overlay variants produce 768 training and 192 validation pairs. Targets are known unmarked source pixels; our original classical repair supplies an input, not an external teacher target. One-video related-source validation does not establish generalization.

The first RGB run trains from random initialization for 1,800 steps. It improves generated-example validation from MAE 2.537045 to 1.489275 but worsens the sequence test from 1.642876 to 1.766028 and reintroduces a star outline in actual footage. That direct use is rejected. A second identity-training run selects its initial zero-correction checkpoint, providing no improvement; it is rejected. The third run fine-tunes our original first checkpoint for 1,200 steps, using soft/hard antialiased overlays, 20% already-correct examples, partial-correction examples and a smooth loss. Its selected checkpoint is at step 900. Generated-example MAE improves from 2.362697 to 1.475004, with 0.279925 RGB MAE on already-correct inputs. Direct application still worsens the sequence metric (1.745027), so that use is rejected as well.

The selected use is paired self-calibration. For source O, first-pass repair B, calibrated global alpha a and the model N, compute N(O,B,a) and N((1-a)B+a,B,a). Add their bounded difference to B. The simulated overlay is an internal inference input and is never painted into the export. Paired inference cancels the model's response to its own reference repair, reducing fixed outline bias. Final changes are restricted to the uncertain contour, since measured core error did not improve. The inverted core and original-frame motion contributions remain unchanged. This is original project code, with no MI-GAN/ProPainter/ROSE/LaMa weights or inference code in this path.

The exact integrated 240-frame controlled sequence improves masked MAE from 1.642873850 to 1.210230612, selected-area MAE from 0.472167257 to 0.347375322 and temporal residual MAE from 1.208329572 to 0.898181066; 226 frames improve, 14 do not. All original-reference motion contributions are preserved. A second calibrated iteration improves the mean slightly but worsens 147 of 240 individual frames relative to the first round, so it is not enabled. An experimental gradient/offset core bridge qualifies no effective changes and is not shipped.

The promoted original RGB checkpoint is 284,647 bytes, SHA-256 `4c405764bb5a78a38a4608de2e1b76d260bad39ff3d5fa8fc56f11d279c7a68b`. It is a continuation of our own random-initialized RGB checkpoint, not externally pretrained. It runs via the existing single-threaded ONNX Runtime Web WASM library. The native full-resolution source render uses it on all 240 frames. Residual artifacts remain in actual footage; the user's complete invisible-removal requirement is not achieved. Browser WebCodecs integration remains unverified.

### 0.6.1 interior calibration follow-up

A fading edge can bias the median used to regularize a small flat core. The bounded interior estimator in `src/overlay.js` uses an eroded stable plateau only for qualified upward differences; it leaves correlated opacity gradients, tiny changes and uncertain interiors alone. This changes the actual source's fitted plateau from 0.290221244 to 0.298537880, without assuming that the unknown true opacity is 0.3. Unqualified substitution marginally worsens the synthetic sequence and is rejected. Qualified substitution retains byte-identical control output and the metrics above. All 240 source frames are rendered and visually reviewed again; faint patches and contour distortion remain. A subsequent geometric contour pass also worsens control metrics and is not enabled. See `VERIFICATION.md` for the full evaluation and rejection record.

### 0.6.2 full-video follow-up: rejected retraining and repeated export

Three additional original checkpoints were trained and evaluated rather than promoted from training scores alone. `training/generate_codec_pairs.mjs` encodes our synthetic observed patches as H.264 YUV420p at CRF 18/24/30, decodes them, and recomputes our own classical reconstruction inputs. Original clean targets remain unchanged. Original and encoded variants give 1,536 training and 384 validation pairs; the existing held-out frame interval remains separate. FFmpeg and Python are development-only dependencies. No third-party engine, weights or teacher outputs are introduced.

- v4: 1,200-step original-v3 continuation on the codec mixture, ordinary residual loss. SHA `b026259f4b5ff9938b6f9550e3f3a516e01193ecc7bdf893432070e7f619212c`. Generated-example MAE 2.356430; full raw control MAE 1.311182 / temporal residual 1.004612, versus retained v3 1.210231 / 0.898181. Encoded-control results also regress. Rejected.
- v5: same mixture and initialization, 1,200 steps with the new `--paired-training` objective matching deployed factual/counterfactual inference. Selected step 900. SHA `792b41867f01427511671bec16f5f03e476631dd5f50ec8ad54a5a2a25790d7f`. Raw control MAE 1.304198 / temporal 1.004652. With identical bounded fallback, encoded control MAE 3.124353 / temporal 2.414752, versus v3 3.110784 / 2.403945. Rejected.
- v6: paired objective on the original raw pairs, isolating the training-objective change from codec augmentation; 1,200 steps, selected step 1,200. SHA `c8f5fd6f583548f9952efdd3d6c5b2b78f097b3f446d9cf92005b900ad6581c1`. Raw control MAE 1.211293 / temporal 0.927011. Encoded control slightly improves mean MAE to 3.090506 but temporal residual is 2.405123 and the actual video still has a trace. Rejected as the default replacement. Pixel-output ensembles offer negligible joint improvements at low weights and require extra inference; they are not enabled.

Each candidate rendered all 240 original full-resolution frames using production JavaScript and its own verified graph, without changing the shipped model. Candidate exports retain source timing and audio. No candidate establishes invisible removal.

A further classical contour-confidence trial transfers a few stable edge pixels from filling to direct inversion (four observations, MAD below 0.008, alpha above 0.1 and spatial support). It improves control mean MAE from 1.210231 to 1.184752 and temporal residual from 0.898181 to 0.847289, but worsens 118 individual frames and leaves visible contour artifacts on the original. It is not promoted based on its average score.

The retained model stays v3. The promoted 0.6.2 change is bounded handling of rejected frame-level calibration, documented in VERIFICATION.md. Processing an already exported result a second time is separately rejected: the related encoded control's masked MAE increases from 1.948037 to 10.765840, and real background details visibly blur in the actual full-video test. The complete invisible-removal requirement remains unresolved.

### 0.6.3 profile fitting and verified fractional matching

No new checkpoint is promoted. An original low-dimensional star-profile prototype fits center, extent, curvature, white opacity, antialias falloff and an optional dark fringe from projected observations across accepted calibration frames. Unlike the prior independent-pixel two-layer experiment, this constrains the whole spatial profile. A cross-term shape family and a deeper-interior-opacity constraint are also tested. Private development uses SciPy 1.18.1 only; SciPy/Python/profile-fit parameters are not added to the browser application.

Direct profile inversion substantially improves the related synthetic control (masked MAE 1.210231 to 0.541574 and temporal residual 0.898181 to 0.281132), but leaves a visible star outline in the actual source. A narrow contour repair improves that control to 0.741287 / 0.613803 versus the retained model, while an opacity-constrained and curvature-adjusted variant scores 0.754909 / 0.593413. A wider contour worsens it to 1.269004 / 1.099885. Actual calibration offers very little independent leverage for dark-fringe estimation (projection coefficient range approximately 0.007–0.0305), and that parameter is unidentifiable. Despite their promising synthetic scores, these profiles are not promoted because actual-video contours remain visible. No original watermark PNG or unmarked preview is assumed.

A bounded look-ahead bank of 24 original sampled frames is also tested without reconstructed donors. Integer matching adds 16 source contributions in one actual frame, but slightly worsens the control. Quarter-pixel bank matching adds 136 contributions in nine actual frames and also slightly worsens the control; it is not enabled. An extra fine-only stage after the learned cleanup changes only five actual pixels in two frames, an insufficient improvement for the added work, and is not integrated.

The retained change is more conservative fractional matching within the existing original-history engine. It retains independently validated integer alternatives and local queries, rejects interpolation taps near original hidden support, and requires materially better compositing agreement for fractional samples. It introduces no new model or dependency. Its raw-control changes are small: final MAE 1.210231 to 1.209770 and temporal residual 0.898181 to 0.897690. The compressed-control changes are near zero and slightly worse (MAE 3.110784 to 3.110804; temporal 2.403945 to 2.403995). This is not a breakthrough or evidence of invisible removal. The actual supplied source still has faint patches. See VERIFICATION.md for the full render and review record.

### Later codec-matte research — rejected as a product replacement

The next cycle tests projected-background correction, local palette-line observations, independent boundary-gradient opacity estimates and a shared luma/chroma matte fitted without clean training labels. The codec-matte trial uses offline PyTorch only; it is not installed as a processing backend or represented as browser-ready. Source and control studies, pose variants and rendered comparisons are private under `.runtime/chroma-background/`, `.runtime/palette-calibration/` and `.runtime/codec-matte/`.

On a freshly encoded matched control, the retained engine scores masked MAE 3.045956 and temporal residual 2.323289. The final trial scores 2.935638 / 2.090323, but 126 of 240 individual frames worsen, and actual original-video traces remain. This candidate is not promoted. The source-derived opacity estimates (original 0.299039, control 0.297512) are observations rather than assumed true opacities. The public v3 neural checkpoint and browser 0.6.3 runtime remain unchanged. VERIFICATION.md records these experiments, their limitations and the actual full-video test artifacts.


### Source-tangent and log-complement trials — not promoted

Original browser-compatible source-gradient modules (`src/tangent-normals.js`, `src/tangent-repair.js`) and an opt-in native evaluation path are retained for research. The browser worker does not enable them. An integrated raw related control improves masked MAE 1.209770 to 1.164016 and temporal residual 0.897690 to 0.862937. The encoded control improves mean error only slightly (3.045956 to 3.040298), worsens in 161 frames, and increases temporal residual (2.323289 to 2.328544). This regression prevents promotion. Earlier unprotected prototypes are not the integrated results. A separate log-complement matte fit also leaves a thin actual-video star contour and worsens encoded temporal residual.

The actual source tangent candidate was rendered and reviewed across all 240 frames; faint patches remain. No invisible-removal or generalization claim is made. No new weights, third-party removal engine or processing backend were added. The current browser algorithm and model remain 0.6.3 / own-rgb-v3. See VERIFICATION.md for test, media-integrity and artifact details.


### Context-only supporting engine and motion-graph study — not promoted

An original 670843-parameter context-only encoder/decoder was trained from scratch for 900 steps, then fine-tuned from our own checkpoint for 1200 steps on primarily contour-shaped holes. No external removal weights or teacher were used. The private one-video unmarked dataset and withheld frame interval are unchanged. It produces a 2.7 MB ONNX graph that passes graph, identity, known-pixel preservation and local WASM parity checks. This is an additional original supporting model, not a qualified replacement for the current engine.

Every original frame and encoded-control frame was evaluated. Complete-hole reconstruction worsens masked error to 12.120818. The best unguarded annular boundary-corrected version scores 3.547040 / 2.554900 versus the retained 3.045956 / 2.323289. A known-ring confidence gate yields only near-zero control gains and 573 changed real-source pixels. Actual visible patches remain, so no new graph is promoted or bundled. The full actual 240-frame output and comparison are retained under `.runtime/self-validation/`.

Shadow-hole directional fitting, nonlinear chromaticity estimation, and a coupled original-source motion/transmission graph were also tested. The graph improves held-out correspondence residuals but leaves visible contours. These are private experiments, with no new browser dependency or backend. See VERIFICATION.md for provenance, scores, integrity checks and explicit limitations.


### Calibrated residual-support continuation — rejected

A new original residual context model is trained from scratch for 1200 steps, followed by an explicit constant-field counterfactual graph (600 steps from our own checkpoint) and known-mean diffusion initialization (400 further steps, selected step 300). The final graph is 670843 parameters / 2711096 bytes, hash 8aad6a96d952c8efd3bf345d9281e0dbc9230e619bf8ce4e02e27b98f2e19d63. No external weights or teacher are used. Flat-field, identity, range, ONNX and local WASM parity checks pass. The private one-video dataset and withheld interval remain unchanged.

Despite better training-validation error, full integrated 240-frame controls worsen: raw 1.744701 / 1.205790 versus retained 1.209770 / 0.897690; encoded 3.359256 / 2.473075 versus 3.045956 / 2.323289. Actual source patches remain after full native WASM rendering and all-frame review. This supporting engine is not bundled or promoted. Source code and private checkpoints are retained for research; VERIFICATION.md records provenance and artifacts.

Bezier profile fitting, normalized observations, separate luma/chroma inversion, a qualified opacity-uncertainty guard, and preserving all inverted core detail were also tested. None meets invisible-removal quality; the core-preservation variant can worsen patches. Production remains 0.6.3.
