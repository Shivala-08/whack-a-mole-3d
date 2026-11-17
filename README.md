# Whack-a-Mole 3D — Mobile VR + AI Edition

[![Live demo](https://img.shields.io/badge/live%20demo-play%20now-ffb300?style=flat-square)](https://whack-a-mole-eight-iota.vercel.app) [![Built with Three.js](https://img.shields.io/badge/three.js-r128-black?style=flat-square)](https://threejs.org) [![No build step](https://img.shields.io/badge/build-none%20required-4ade80?style=flat-square)](index.html) [![Tests](https://img.shields.io/badge/tests-38%20passing-4ade80?style=flat-square)](test.cjs)

**▶ Play it now: https://whack-a-mole-eight-iota.vercel.app**

A 30-second browser arcade game built with **HTML + JavaScript + Three.js**, extended into a six-mode showcase for mobile VR and hand-written machine learning: a Cardboard-style stereo mode, a tabular Q-learning agent, a compact PPO agent with a value critic, and an imitation-learning bot that copies your play. No ML framework — every agent is plain JavaScript.

> **Keywords:** 3D whack-a-mole browser game · Three.js game · WebGL arcade game · Cardboard VR / mobile VR game in JavaScript · tabular Q-learning demo · PPO reinforcement learning from scratch · behaviour cloning / imitation learning · no build step, plays in any modern browser.

![gameplay](screenshot-gameplay.png)

## Run it

Play the hosted build at **https://whack-a-mole-eight-iota.vercel.app**, or double-click `index.html` locally — there is no build step and no install.

- Three.js r128 and GLTFLoader load from the cdnjs CDN, so the first load needs an internet connection.
- **Optional Blender model:** drop a `mole.glb` into `assets/` and it is loaded automatically (scale-normalised). Without it the game falls back to the built-in primitive mole — no error, by design.
- **Optional test run:** `node test.cjs` drives the whole game in headless Chrome (38 end-to-end checks).
- **Pre-trained bots included:** `assets/trained.js` ships Q-learning (~2000 episodes), PPO (~2100 iterations) and imitation models exported from a training session. On first run (empty `localStorage`) the AI modes are demo-ready immediately — press **Watch bot** and they score 23–31 out of the box. Deleting it (or pressing Reset) starts every agent from scratch.
- **Retrain it yourself:** `node trainall.cjs` trains all three agents to completion in the real UI and re-exports `assets/trained.js`.

## Why Three.js and not Unity

One-sentence answer: **the deliverable is a link, not a build — and the machine learning has to run inside the same page as the game.** Everything else is detail that supports that sentence.

### The reasons, ordered by how well they survive questioning

1. **Zero-install delivery.** The submission is a URL. A reviewer clicks it and is playing in ~1 s on a laptop, a phone or a Chromebook. A Unity WebGL build is 15–40 MB, needs a server with the right compression headers, and still asks the reviewer to trust a download. A Unity build for the desktop or a store listing is worse — install, OS-specific build, permissions.
2. **Mobile VR without an APK, an XR plugin or a headset SDK.** Cardboard VR here is two scissored viewports plus `deviceorientation` (`js/game.js:616`). The phone *is* the headset: no Cardboard SDK, no Android build, no Play Store, no permission prompts. The whole payload is ~444 KB (`index.html` + `css/` + `js/` + the pre-trained `assets/trained.js`, before the optional screenshots), and Three.js streams from a CDN.
3. **The AI had to be visible, not imported.** Unity ML-Agents trains *outside* the game: a Python/PyTorch trainer talks to the editor or a build over gRPC. A WebGL build cannot host that trainer, so on a web submission the agents would be frozen weights and a video of training. Here `MoleEnv`, a Q-table, a 11→64→10 policy net with a value critic and the PPO/GAE update are ~300 lines of plain JavaScript running in the page — the examiner can press **Train** and watch the reward curve climb live. That is the single strongest reason, and it is architectural, not aesthetic.
4. **Iteration speed and inspectable source.** Change → save → refresh, versus a 1–3 minute IL2CPP/WebGL build-and-upload loop. Just as importantly, every change is a readable text diff. A `.unity` scene, a `.prefab` and a `.meta` GUID are opaque in review; `js/env.js` is the environment contract in 251 lines anyone can read.
5. **Deploy and verification.** `git push` → Vercel CDN, ready in ~11 s, stable URL. The same repo runs **38 headless Playwright checks** (`node test.cjs`) against the real game — boot with zero console errors, reward curve rising, VR enter/exit, settings persistence. That harness is trivial for a web page and awkward for a WebGL build.
6. **No licence, activation, editor-version lock, or seat.** Nothing to expire before the demo, nothing to install on the marker's machine — and the reviewer can *read the whole submission* (2,850 lines) without opening an editor.

### What Unity would genuinely have been better at — say this before you are asked

- **Production RL.** ML-Agents gives you PPO/SAC/GAIL, curriculum, environment parameter randomisation and TensorBoard for free. This project reimplements a compact PPO as an *educational* artifact, and the AI panel says so.
- **Asset pipeline and authoring.** Blender → FBX/GLB import with materials, prefabs, timelines, animator controllers, Lightmapping. Here the mole is procedural geometry and the "prefabs" are `clone()` calls.
- **Real XR.** Unity + OpenXR gives 6-DoF positional tracking, controllers and hand tracking. This build is 3-DoF (rotation only) Cardboard-style stereo. WebXR (`renderer.xr.enabled`, `navigator.xr.requestSession('immersive-vr')`) is the upgrade path, and it is one commit, not a rewrite.
- **Physics, post-processing stacks, profiler, and the editor itself.** No rigid bodies here — bomb debris is hand-integrated in `explode()`.

**Phrase it as an engineering trade, not an avoidance:** "The brief's *concepts* are scene graph, prefabs, a game manager, an agent environment contract and score persistence. I implemented all of them with 1:1 counterparts so the design transfers: `MoleEnv` = the Agent's `CollectObservations/OnActionReceived`, `scene.js` = prefabs + materials + lights, `game.js` = `GameManager` + input, `localStorage` = `PlayerPrefs`, `agents.js` = the ML-Agents training loop. I chose a runtime where the reviewer can open the result in one click and watch the training happen, instead of shipping a build they have to install."

## 10-minute walkthrough

Two timed halves. Each beat has what to **say** and what to **do on screen** — click while talking, never narrate a menu.

### Part 1 — The application (0:00 → 5:00)

| Clock | Beat |
| --- | --- |
| 0:00–0:40 | Hook + what it is |
| 0:40–1:30 | The problem it solves |
| 1:30–2:30 | Classic mode (play it) |
| 2:30–3:20 | Cardboard VR mode |
| 3:20–4:20 | The three AI modes |
| 4:20–5:00 | Craft, audience, scope |

**0:00–0:40 — Hook.** Open the live URL on the projector, menu already showing. *"This is a 30-second whack-a-mole game in 3D, and it runs in this tab on any phone or laptop. Two things make it more than an arcade game: it has a Cardboard VR mode with no headset, no app — and it has three reinforcement-learning agents that train live in the page while you watch."* One line on the build: *"No engine, no build step: six JavaScript modules and Three.js."*

**0:40–1:30 — The problem.** *"VR demos have a hardware tax. A headset, an SDK, a store install, a build per platform — and the audience for a student project usually has none of that. So the design question I set myself was: how do you hand someone VR in one click, using only what is already in their pocket? The answer here is stereo rendering plus the phone's gyroscope in the browser, and a web link as the deliverable. The second question was the same shape: how do you show reinforcement learning to someone who does not have Python installed? Same answer — run the learning inside the page."*

**1:30–2:30 — Classic mode.** Click **Classic**, play 10–15 s while talking. *"One round is 30 seconds, a 3×3 field, one point per mole, minus one for a bomb — 18% of spawns. It is not flat: stay time falls from 1.5 s to 0.55 s and the spawn gap from 1.15 s to 0.42 s across the round, and after 60% of the clock a second mole can be up at once. So the difficulty ramp is what the AI actually has to solve."* Mention feedback: hammer swing, particles, camera shake, best score in `localStorage`. *Don't read the rules — show them.*

**2:30–3:20 — Cardboard VR.** Enter VR mode. *"Same scene, two eyes: two scissored viewports and two cameras offset by 0.064 — that is 64 mm, a real interpupillary distance. Head tracking is the gyro on a phone; on a laptop you drag. Because there is no laser pointer in Cardboard, the interaction is gaze: hold the centre reticle on a mole for half a second and it whacks. And one deliberate design decision — staring at a bomb never triggers, because a dwell timer that punishes you for looking around is a usability bug, not a difficulty curve."*

**3:20–4:20 — The three AI modes.** *"All three bots play exactly the same environment as me — the same spawns, the same reward table. Q-learning keeps a table over the nine holes and you can watch the heat map fill in as epsilon decays. PPO learns a small policy network and you can change its learning rate mid-training and see the curve bend. Imitation records my own successful whacks, fits a classifier on them, and then copies my style — including my mistakes."* Press **Watch bot** and let a trained bot score for ~10 s. *"These ship pre-trained, so a fresh browser is demo-ready; press Reset and they start from zero."*

**4:20–5:00 — Craft, audience, scope.** Quick breadcrumb of the extras — Editor View (live scene graph + inspector), Code Lens (`L`) showing live game variables, Materials & Lights with a Day/Night preset, an About VR timeline. Then the audience in one sentence: *"It is built for a classroom or a portfolio review — a VR demo and an RL demo that anyone can open, on the device they already own, without installing anything."* Close with scope honesty: *"Deliberately limited: 3-DoF rotation-only VR, no positional tracking, no physics engine."* Say that before anyone asks; it buys credibility for everything else.

### Part 2 — The code (5:00 → 10:00)

| Clock | Beat | File to open |
| --- | --- | --- |
| 5:00–5:40 | Architecture and data flow | `README` architecture block |
| 5:40–6:40 | The environment contract | `js/env.js:13–30`, `:104`, `:132`, `:223` |
| 6:40–7:20 | Frame loop + fixed step + view sync | `js/boot.js:47`, `js/game.js:279–289` |
| 7:20–8:10 | VR stereo + gaze input | `js/game.js:577–626`, `:345–376` |
| 8:10–9:20 | The three learning algorithms | `js/agents.js:119`, `:209`, `:304`, `:469` |
| 9:20–10:00 | Verification and honest limits | `test.cjs` output |

**5:00–5:40 — Architecture.** *"Six files, no bundler, load order in `index.html`. The rule I kept throughout is one direction of data flow: `env.js` is the simulation and owns all game state; `game.js` renders it and handles input; `agents.js` learns from it; `panels.js` displays it; `boot.js` wires them and runs the loop. Nothing above the env line invents state — the visual moles are pooled meshes that mirror the env's slots, so what you see is literally what the bots see."* That sentence is the whole review: *single source of truth*.

**5:40–6:40 — The contract (`env.js`).** This is the most impressive 60 seconds; be precise.
- `:13` — 9 holes, 10 actions (0–8 = hit that hole, 9 = wait).
- `:18` — reward table: `+1` mole, `−1` bomb, `−0.05` empty hole, `−0.001` per step — the negative step term is what stops the agent from idling forever.
- `:104` — observation is 11 floats: 9 hole values (`0` empty, `1` mole, `−1` bomb), plus normalised time left and the longest remaining stay. A retreating mole reports `0`, because it can no longer be hit — the observation never lies to the agent.
- `:132` — `step()` applies the action, then advances one fixed `1/30 s` tick, then spawns; `:223` — `hitHole()` is the same logic exposed for human taps, so the player and the agents share one scoring path. My clicks and the bot's actions cannot drift apart.
- Determinism: xorshift32 PRNG instead of `Math.random`, so a training run is reproducible.

**6:40–7:20 — The loop.** *"`boot.js` has one rAF loop: update the game, tick the trainer, tick the UI, render. The game itself runs on a fixed 1/30 step with an accumulator, and it caps catch-up at 8 steps so a background tab cannot spiral. The leftover fraction is passed to `syncVisuals` as `frac`, so the mole's height is interpolated between simulation ticks — that is why the animation is smooth at 60 Hz or 120 Hz while the simulation stays deterministic."*

**7:20–8:10 — VR.** *"`setupVR` is about 50 lines: two cameras, an offset of ±0.064; render with the scissor test on, viewport and scissor per eye, then restore. Head orientation comes from one `deviceorientation` listener — alpha/beta/gamma mapped to yaw/pitch/roll; on desktop the orbit drag fills the same fields, so the render path is identical. Gaze is a raycast from the centre of the active camera; whichever hole it hits accumulates `dt` in a timer, and at 0.5 s it calls the same `playerHit` path as a mouse click — bombs excluded by design."*

**8:10–9:20 — The learning.** Structure it as three levels of the same idea:
- **Q-learning** (`:119`): a `Map` from a 9-character hole-state string to a 10-element `Float64Array`; `Q(s,a) += α(r + γ·maxQ(s′) − Q(s,a))`, ε-greedy with decay. Cheap enough to train hundreds of episodes per second.
- **The net** (`:209`): `PolicyNet` is 11 → 64 (ReLU) → 10 logits → softmax, plus a scalar value head on the same hidden layer — all in `Float64Array`, forward and the hand-derived gradients written out.
- **PPO** (`:247`/`:304`): fill a buffer of steps, then (1) walk it backwards computing GAE(λ) advantages from TD residuals `δ = r + γV(s′) − V(s)`; (2) normalise advantages; (3) for each epoch × minibatch, climb the *clipped* surrogate `min(ρÂ, clip(ρ,1±ε)Â)` minus the value loss plus an entropy bonus; (4) discard the buffer because PPO is on-policy. **Say why the critic exists:** an episode is ~900 steps and one hit's reward is spread across ~100 steps before it, so reward-to-go alone cannot assign credit — the value head is what makes the advantages meaningful. That is the honest engineering story of the project.
- **Imitation** (`:451`): log `(observation → hole)` on every *successful* human whack, fit a softmax classifier by full-batch gradient descent, then `act()` on the argmax. 100% train accuracy — because it is copying a small dataset of your own choices.
- **Trainer** (`:566`): one `tick()` per frame multiplies training by the speed slider (up to 100×), autosaves every N seconds into `localStorage`, and `assets/trained.js` is just that blob re-exported — which is why the bots are strong on a cold browser.

**9:20–10:00 — Verification and limits.** Run (or show a captured) `node test.cjs`: *"38 end-to-end checks in headless Chrome — boot with zero console errors, a click scores, a bomb deducts and the score floors at zero, settings survive a reload, Q-learning reward goes from −8 to +17 in about 8 s of wall clock, PPO iterations advance, imitation trains and its bot scores 28, VR enters and exits stereo cleanly, and the glTF path falls back without throwing."* Close on limits: *"Tabular Q only scales to a 9-hole state; PPO is one hidden layer; VR is rotation-only; there is no physics engine."* Then the one line that ties the whole choice together: *"Those limits are the same limits I would have hit in Unity — the difference is that here you can inspect 2,850 lines of source, press Train, and watch it learn."*

### Questions you will get

| Question | Answer |
| --- | --- |
| "Why not Unity?" | The link-versus-build argument above, then: same concepts, 1:1 mapping, and the browser is the only runtime where the reviewer can watch RL train without installing Python. |
| "Is this real reinforcement learning?" | Yes: a defined env, reward function, policy, advantage estimation and gradient updates — scoped small, and the AI panel states the scope. It is not a wrapper around a library. |
| "How can it be VR without a VR SDK?" | It is Cardboard-style: stereo views + gyro, 3-DoF only. Upgrading to real WebXR is `renderer.xr` + a session request, not a rewrite. |
| "Could it be cheated?" | The bots call the same `env.step()` the player's world runs on; nothing reads pixels or DOM. |
| "What is next?" | WebXR immersive session, a second hidden layer + PPO on continuous actions, a leaderboard backend, and a proper `mole.glb` asset. |

## The look

The scene is dressed like a diorama rather than a tech demo: filmic ACES tone mapping with sRGB output, a gradient sky dome, a hemisphere-light fill, procedural grass texture, deep hole pits with dirt-rim rims and clods, a wooden fence, background trees that catch long shadows, grass tufts, rocks, flowers and drifting clouds. The mole is a proper character (belly, snout, ears, whiskers, paws), the bomb is a glossy cartoon bomb with a curved fuse, and hit effects use faceted sparkle particles plus a dirt puff when a mole bursts out. A soft vignette and glassy panels frame it all.

One implementation note: with sRGB output, every authored colour is converted to linear space (`col()` helper in `scene.js`) — otherwise the whole scene renders washed-out pastel.

## The six modes

| Mode | What it is |
| --- | --- |
| 🔨 **Classic** | The arcade game: 30 s, 3×3 grid, bombs, difficulty ramp, hammer physics, particles. |
| 🥽 **Cardboard VR** | Stereo side-by-side render with an eye separation of 0.064, gyroscope head tracking on phones (drag to look on desktop), gaze to whack (hold 0.5 s — bombs are never auto-whacked). |
| 🧠 **Q-Learning** | Tabular Q-learning over the exact game state. Watch the Q-table heat map fill in, epsilon decay, and the reward curve climb; then watch the trained bot play the live scene. |
| 📈 **PPO** | A policy network (11 → 64 → 10) trained with a clipped surrogate objective and a value-head critic through GAE(λ). Editable hyperparameters (lr, batch, clip, β, λ, γ, …) update training live. |
| 🎓 **Imitation** | Record your own play, train a softmax behaviour-cloning model on your clicks, then watch the bot imitate you. |
| ℹ️ **About VR** | A VR history timeline (Sensorama 1962 → today) and application cards. |

Plus **Editor View** (live scene-graph hierarchy + inspector with position/rotation/scale/colour edits), **Code Lens** (live game variables + running method, key `L`), and **Materials & Lights** settings (four material presets per surface, per-light toggles and intensities, Day/Night presets, wireframe view — all persisted in `localStorage`).

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Whack a mole | Click it | Tap it |
| Look around | Drag, or Arrow keys | Drag |
| Move the keyboard pointer | `WASD` / Arrows | — |
| Swing | `Space` | Tap |
| Cycle camera (angled / top / first-person / VR) | `C` | Camera button |
| Pause / restart / menu | `P` / `R` / `M` | Buttons |
| Editor View / Code Lens | `E` / `L` | Menu buttons |
| Gaze whack (VR mode) | Hold the centre reticle on a mole 0.5 s | Same |

## Rules

1. A round lasts 30 seconds; each mole is worth 1 point.
2. Bomb moles (18% chance) deduct a point, floor the score at 0, and explode with debris and camera shake.
3. Difficulty ramps: moles stay up for less time and spawn closer together; after 60% of the round two can be up at once.

## How the AI works (and what it honestly is)

All three agents play the **same environment** as you — a fixed-step (1/30 s) `MoleEnv` with a 10-action space (9 holes + wait) and an 11-value observation (9 hole states + time left + longest remaining stay). Rewards: +1 mole, −1 bomb, −0.05 empty hole, −0.001 per step.

- **Q-learning** keeps a table keyed by the hole-state string and updates `Q(s,a) += α(r + γ·maxQ(s′) − Q(s,a))` every step, with ε-greedy exploration and decay. It reaches near-oracle play (~30 points) within a few hundred episodes — training runs live in the browser at up to 100× speed.
- **PPO** trains a small policy network with hand-derived gradients. The honest engineering note: reward-to-go alone cannot assign credit in 900-step episodes (a hit's reward drowns across the ~100 steps before it), so the agent carries a value-head critic and uses GAE(λ) advantages — after which it converges to near-oracle play in ~2000 iterations. This mirrors why real PPO needs a critic; it is still a compact educational re-implementation, not Unity ML-Agents (which runs Python/PyTorch and cannot run in a web page).
- **Imitation** logs every successful whack you make as an `(observation → hole)` sample and fits a softmax classifier by full-batch gradient descent. It copies your style — including your mistakes.

The AI panel carries an explicit **honesty note** about this scope.

## Architecture

```
index.html          six-mode shell, panels, script loading order
css/style.css       all panel/HUD styling
js/env.js           MoleEnv — single source of truth for state, rewards, spawning
js/scene.js         Three.js scene, cameras, materials, lights, particles, glTF loader
js/game.js          GameManager, visual pool, input, hammer, effects, VR stereo render
js/agents.js        QAgent, PPOAgent (+ value critic), ImitationAgent, Trainer
js/panels.js        menu routing, settings, editor, code lens, AI panel, About VR
js/boot.js          wiring + main loop (normal vs stereo render dispatch)
test.cjs            38-check Playwright suite
```

**Unity mapping** (how the concepts translate): `MoleEnv` ≈ the game-state manager, `scene.js` ≈ scene/prefabs/materials, `game.js` ≈ `GameManager` + input + `PlayerPrefs` (localStorage), `agents.js` ≈ ML-Agents training loop, `panels.js` ≈ UI canvases, `boot.js` ≈ the bootstrap scene.

## Verified behaviour

`node test.cjs` — 38 checks, all passing in headless Chrome: boot with no errors, round start/timer, pointer hit scoring, empty-click no-op, double-hit guard, bomb deduction + score floor, game-over panel, high-score persistence, restart, resize, camera cycle, settings persistence, About VR content, editor hierarchy + live inspector edits, code lens, Q-learning training (reward −8 → +17 in 8 s), watch mode, PPO training + live hyperparameter changes, imitation training (100% accuracy) and bot play, VR stereo enter/exit, glTF fallback, Q-table autosave, phone viewport.

Screenshots: `screenshot-menu.png`, `screenshot-gameplay.png`, `screenshot-ai-q.png`, `screenshot-vr.png`, `screenshot-gameover.png`.
