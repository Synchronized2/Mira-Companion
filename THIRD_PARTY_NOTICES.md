# Third-party sources and licenses

## AIRI

- Repository: https://github.com/moeru-ai/airi
- Inspected commit: `0fd71bc1abed585955c1df18a40b95ef3b5276bf`
- Upstream version: `0.12.0-beta.5`
- License: MIT, Copyright (c) 2024-PRESENT Neko Ayaka. Full text: `licenses/AIRI-MIT.txt`.
- `src/vendor/airi-lipsync.ts` is an unmodified copy of `packages/model-driver-lipsync/src/live2d/index.ts` at this commit.
- `src/vendor/lipsync-profile.json` is an unmodified copy of `packages/model-driver-lipsync/src/shared/wlipsync/profile.json`.
- AIRI's `apps/stage-web/vite.config.ts` supplies the Hiyori asset URL below. This app does not redistribute the full AIRI application or claim AIRI authorship.

## Hiyori / Momose Hiyori PRO

- Download: https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip
- Original provider: Live2D Inc.
- Illustration: Kani Biimu. Model: Live2D.
- Original license/readme retained at `public/assets/hiyori/hiyori_pro_zh/ReadMe.txt`.
- Terms: https://www.live2d.com/zh-CHS/download/sample-data/
- The bundled readme permits qualifying individuals and small businesses to use the material commercially subject to the stated agreements. Medium/large companies are limited to non-public internal evaluation under those sample terms. This is NOT an MIT-licensed model and is NOT offered here as unrestricted commercial artwork.
- Model binary, textures, motions, physics and pose data are retained unchanged. App code applies runtime parameter values only.

## Live2D Cubism Core

- Official archive: https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.3.zip
- Core file: `public/vendor/live2dcubismcore.min.js`, copied unchanged from the official archive.
- Same SDK archive selected by AIRI's `@proj-airi/unplugin-live2d-sdk@0.1.7`.
- License: Live2D Proprietary Software License, not MIT. See `licenses/LIVE2D-CORE.md` and its linked agreement.
- Additional SDK publication/business license conditions may apply to distributed products. The current project is a local evaluation prototype.

## Runtime libraries

Dependencies and exact resolved versions are recorded in `package-lock.json`.

- pixi.js and pixi-live2d-display: MIT.
- wLipSync: MIT. https://github.com/mrxz/wlipsync
- React, Vite, Express, dotenv, TypeScript: MIT.
- Lucide: ISC.
- Playwright: Apache-2.0, development/test tooling only.
- edge-tts 7.2.8: LGPL-3.0, installed unmodified as a Python dependency. https://github.com/rany2/edge-tts . It accesses Microsoft's online speech service; the Python package license does not grant separate service rights.

## User-supplied Live2D collection

- Imported from the user's local `D:\github\live2d`, corresponding to <https://github.com/imuncle/live2d>.
- 250 selectable model/outfit manifests, with referenced model binaries, textures, motions, expressions and physics, are under `public/assets/characters/`. One identical Pio configuration in the same folder was skipped. St. Louis (Tipsy Snow) is excluded from the selectable catalog because all drawables remain transparent in the current runtime; its supplied assets are retained. Names follow the supplied collection; generated previews are renderings of these same assets.
- The collection's original README is preserved in `licenses/live2d-collection-README.md`. It states that copyrights remain with the original companies/individuals and limits usage to learning and non-profit projects, prohibiting commercial exploitation. Public availability does not imply unrestricted redistribution or commercial rights.
- `public/vendor/live2d-legacy.js` is copied unchanged from the collection's `js/live2d.js` to supply the Cubism 2 runtime globals. Mira does not invoke its original widget loader. The Live2D runtime is subject to its own proprietary terms, not the application's MIT dependency licenses.
- Imported manifests normalize incorrect root-relative paths, omit missing optional resources and strip bundled sound references. Original files in the user's collection remain unchanged.
- Existing Hiyori and AIRI attributions above continue to apply separately.

## Earlier unselected material

An early Ready Player Me model was downloaded for evaluation from `wass08/r3f-virtual-girlfriend-frontend` commit `c862eebbdbc269d3f6552b49b41065812010f316`. It is not part of the app runtime or production assets. Any retained local copy is under the ignored `artifacts/unselected/` directory. Its redistribution rights have not been established.

## Audited duplicate collection

- Repository: https://github.com/summerscar/live2dDemo
- Inspected commit: `3bacc398746caff119793730d090fe399a3f4250`.
- The repository contains no explicit license file.
- Its 21 unique Live2D model binaries were compared by SHA-256 with Mira's existing collection and all were already present. Of 47 unique model/texture configurations, 41 matched existing resources exactly; the remaining six were alternate packages of the same named characters and identical model binaries.
- No runtime model, texture, motion, code or screenshot was copied from this repository. The audit result is recorded in `shared/live2d-demo-import-report.json`.

## Audited game-extracted collection

- Repository: https://github.com/Eikanya/Live2d-model
- Inspected commit: `94ae3e5628226726af96c6b4bf0e1ce5c728e28e`.
- The repository has no LICENSE, COPYING or NOTICE file. Its README describes the models as generally extracted from games, warns that configurations may be incorrect, asks readers to pay attention to licenses and says not to use the material commercially.
- The inspected tree contains 103,442 files, 4,928 model-binary paths and 3,577 potential model manifests across 23 top-level asset categories. These include resources extracted from multiple commercial games.
- Public access to a repository does not grant permission to redistribute its contents. No model or other runtime resource was copied into Mira. The metadata-only audit is recorded in `shared/eikanya-live2d-model-audit.json`.
