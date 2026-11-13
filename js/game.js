/* ============================================================
 * game.js — GameManager, visual mole pool, input, effects, VR stereo
 *
 * Unity concept mapping:
 *   Game           -> GameManager singleton (owns phase, score, timer)
 *   Spawner        -> MoleEnv internals (env.js), driven by fixed-step accumulator
 *   Mole.cs        -> VisualMole wrapper over the pooled prefab
 *   InputController-> pointer raycast + keyboard + gaze
 *   Effects        -> FX bursts, explosion, camera shake, AudioKit
 * ============================================================ */
(function (global) {
  'use strict';
  const K = global.WAM3D.const;
  const HOLE_XZ = K.HOLE_XZ;
  const { clamp, lerp } = { clamp: (v, a, b) => Math.min(b, Math.max(a, v)), lerp: (a, b, t) => a + (b - a) * t };
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeIn = t => t * t;

  /* ---------------- Storage (PlayerPrefs equivalent) ---------------- */
  const Store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('wam3d_' + key); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('wam3d_' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    }
  };

  /* ---------------- Audio ---------------- */
  const AudioKit = {
    ctx: null, enabled: Store.get('sound', true),
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (global.AudioContext || global.webkitAudioContext)(); } catch (e) { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    beep(freq, dur, type, gain, when) {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime + (when || 0);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    hit() { this.ensure(); const b = 620 + Math.random() * 260; this.beep(b, 0.1, 'square', 0.1); this.beep(b * 1.5, 0.08, 'triangle', 0.06); },
    bomb() { this.ensure(); this.beep(120, 0.4, 'sawtooth', 0.18); this.beep(60, 0.5, 'square', 0.14, 0.05); },
    whiff() { this.ensure(); this.beep(180, 0.06, 'triangle', 0.05); },
    start() { this.ensure(); this.beep(523, 0.09, 'triangle', 0.1); this.beep(784, 0.14, 'triangle', 0.1, 0.09); },
    gameover() { this.ensure(); this.beep(330, 0.22, 'sine', 0.12); this.beep(247, 0.3, 'sine', 0.12, 0.18); },
    tick() { this.ensure(); this.beep(880, 0.05, 'sine', 0.07); }
  };

  /* ---------------- Visual mole pool ----------------
   * 9 slots. Each slot owns a mole clone and a bomb clone; the env slot
   * decides which is shown. Position comes from env state + frame fraction. */
  const HIDDEN_Y = -1.0, UP_Y = 1.0;

  function buildVisualPool(S) {
    const tmpl = global.WAM3D.sceneKit.moleTemplate(S);
    S.visual = [];
    for (let i = 0; i < K.HOLES; i++) {
      const mole = tmpl.clone();
      const bomb = S.bombProto.clone();
      mole.visible = bomb.visible = false;
      mole.userData.isClone = bomb.userData.isClone = true;
      S.scene.add(mole, bomb);
      S.visual.push({ mole, bomb, envSlot: null });
    }
  }

  /** Visual y for an env slot, with `frac` (0..1) sub-step interpolation. */
  function slotY(slot, frac) {
    const t = slot.t + frac * (1 / 30);
    const rise = global.WAM3D.env ? global.WAM3D.env.cfg.rise : 0.28;
    if (slot.state === 'RISING') return lerp(HIDDEN_Y, UP_Y, easeOut(clamp(t / rise, 0, 1)));
    if (slot.state === 'UP') return UP_Y + Math.sin(t * 9) * 0.03;
    if (slot.state === 'FALLING') return lerp(UP_Y, HIDDEN_Y, easeIn(clamp(t / rise, 0, 1)));
    if (slot.state === 'HIT') return lerp(UP_Y, HIDDEN_Y, easeIn(clamp(t / 0.18, 0, 1)));
    return HIDDEN_Y;
  }

  function syncVisuals(S, env, frac) {
    const byHole = {};
    for (const m of env.moles) byHole[m.hole] = m;
    for (let i = 0; i < K.HOLES; i++) {
      const v = S.visual[i];
      const slot = byHole[i];
      v.envSlot = slot || null;
      const [x, z] = HOLE_XZ[i];
      if (!slot || slot.state === 'DONE') {
        if (v.mole.visible || v.bomb.visible) { v.mole.visible = v.bomb.visible = false; }
        continue;
      }
      const y = slotY(slot, frac);
      const mesh = slot.isBomb ? v.bomb : v.mole;
      const other = slot.isBomb ? v.mole : v.bomb;
      if (other.visible) other.visible = false;
      mesh.visible = true;
      mesh.position.set(x, y, z);
      mesh.rotation.y = Math.atan2(-x, -z) * 0.45;
      // dirt puff the moment a mole starts rising out of its hole
      if (slot.state === 'RISING' && slot.t < 0.05 && !v.dustDone) {
        v.dustDone = true;
        global.WAM3D.sceneKit.FX.dustPuff(S, new THREE.Vector3(x, 0.1, z));
      }
      if (slot.state !== 'RISING') v.dustDone = false;
      if (slot.state === 'HIT') {
        const k = clamp((slot.t + frac * (1 / 30)) / 0.18, 0, 1);
        mesh.scale.set(1 + k * 0.7, 1 + k * 0.3, 1 + k * 0.7);
      } else {
        mesh.scale.set(1, 1, 1);
      }
      // bomb spark pulse
      if (slot.isBomb) {
        const spark = mesh.getObjectByName('Spark');
        if (spark) spark.scale.setScalar(0.8 + Math.sin(performance.now() * 0.02) * 0.35);
      }
    }
  }

  /* ---------------- Explosion ---------------- */
  function explode(S, worldPos, game) {
    const kit = global.WAM3D.sceneKit;
    kit.FX.bombBurst(S, worldPos);
    // flash light
    const flash = new THREE.PointLight(0xffa726, 6, 18);
    flash.position.copy(worldPos).y += 1;
    S.scene.add(flash);
    let flashT = 0;
    game.temporary.push({ update(dt) { flashT += dt; flash.intensity = 6 * Math.max(0, 1 - flashT / 0.28); if (flashT > 0.28) { S.scene.remove(flash); return true; } return false; } });
    // shockwave ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffcc80).convertSRGBToLinear(), transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldPos.x, 0.08, worldPos.z);
    S.scene.add(ring);
    let ringT = 0;
    game.temporary.push({ update(dt) { ringT += dt; const k = ringT / 0.5; ring.scale.setScalar(1 + k * 9); ring.material.opacity = 0.9 * (1 - k); if (k >= 1) { S.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); return true; } return false; } });
    // debris cubes
    for (let i = 0; i < 8; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(0x37474f).convertSRGBToLinear(), roughness: 0.8 }));
      d.position.copy(worldPos);
      S.scene.add(d);
      kit.flingBody(S, d, new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 4, (Math.random() - 0.5) * 7));
    }
    // camera shake
    game.shake = 0.5;
    AudioKit.bomb();
  }

  /* ============================================================
   * Game — GameManager singleton
   * ============================================================ */
  class Game {
    constructor(S, env) {
      this.S = S;
      this.env = env;
      this.phase = 'MENU';            // MENU | PLAYING | PAUSED | GAMEOVER
      this.mode = 'classic';          // classic | vr | watch-q | watch-ppo | watch-im
      this.highScore = global.WAM3D.gameKit.Store.get('high', 0);
      this.fixedDt = 1 / 30;
      this.accumulator = 0;
      this.temporary = [];            // short-lived effects with update(dt)->done?
      this.shake = 0;
      this.paused = false;
      this.onGameOver = null;         // hook set by panels.js
      this.onHit = null;              // hook used by the imitation recorder
      this.recording = false;
      this.hammerTarget = new THREE.Vector3(0, 0, 6);
      this.hammerSwing = 0;           // 0..1 swing animation progress
      this.gaze = { slot: null, t: 0, HOLD: 0.5 };
      this.wasdHole = 4;              // keyboard pointer starts centre
      this.lastTickSecond = -1;
      this.lastMethod = 'Update()';
      global.WAM3D.gameKit.buildVisualPool(S);
    }

    /* ---------- round lifecycle ---------- */
    startRound(mode) {
      this.mode = mode || this.mode;
      this.lastMethod = 'StartRound()';
      this.env.reset();
      this.env.seed((Math.random() * 1e9) | 0);
      this.phase = 'PLAYING';
      this.accumulator = 0;
      this.shake = 0;
      this.temporary.length = 0;
      global.WAM3D.gameKit.AudioKit.start();
      UI.hudShow(true);
      UI.setScore(0); UI.setTime(this.env.cfg.roundTime); UI.setBest(this.highScore);
      UI.modeChip(this.modeLabel());
    }

    modeLabel() {
      return { classic: '🔨 Classic', vr: '🥽 Cardboard VR', 'watch-q': '🧠 Q-learning bot',
        'watch-ppo': '📈 PPO bot', 'watch-im': '👀 Imitation bot' }[this.mode] || this.mode;
    }

    endRound() {
      this.phase = 'GAMEOVER';
      this.lastMethod = 'EndGame()';
      const score = this.env.score;
      const isNew = score > this.highScore;
      if (isNew) { this.highScore = score; Store.set('high', score); }
      UI.setTime(0);
      UI.hudShow(false);
      UI.reticle(false);
      if (isNew) global.WAM3D.sceneKit.FX.confetti(this.S);
      global.WAM3D.gameKit.AudioKit.gameover();
      if (this.onGameOver) this.onGameOver(score, this.highScore, isNew);
    }

    toMenu() {
      this.phase = 'MENU';
      UI.hudShow(false); UI.reticle(false); UI.modeChip(null);
      this.env.reset();
    }

    pauseToggle() {
      if (this.phase === 'PLAYING') { this.phase = 'PAUSED'; UI.pause(true); }
      else if (this.phase === 'PAUSED') { this.phase = 'PLAYING'; UI.pause(false); }
    }

    /* ---------- scoring path shared by every input mode ---------- */
    playerHit(hole) {
      if (this.phase !== 'PLAYING') return false;
      const obsBefore = this.env.observation();   // pre-hit state for the imitation recorder
      this.lastMethod = 'Hit()';
      const res = this.env.hitHole(hole);
      const kit = global.WAM3D.sceneKit;
      const [x, z] = HOLE_XZ[hole];
      const pos = new THREE.Vector3(x, 0.75, z);
      if (res.hit) {
        kit.FX.hitBurst(this.S, pos);
        const v = this.S.visual[hole];
        const mesh = v.mole.visible ? v.mole : v.bomb;
        if (mesh && mesh.visible) {
          mesh.visible = false;
          const flung = mesh.clone();
          flung.position.copy(mesh.position);
          this.S.scene.add(flung);
          kit.flingBody(this.S, flung, new THREE.Vector3((Math.random() - 0.5) * 4, 5.5, (Math.random() - 0.5) * 4));
        }
        global.WAM3D.gameKit.AudioKit.hit();
        UI.popScore();
      } else if (res.bomb) {
        const v = this.S.visual[hole];
        if (v.bomb.visible) v.bomb.visible = false;
        explode(this.S, pos, this);
        UI.popScore(true);
      } else {
        global.WAM3D.gameKit.AudioKit.whiff();
      }
      UI.setScore(this.env.score);
      if (this.onHit) this.onHit(obsBefore, hole, res);
      return res.hit || res.bomb;
    }

    /* ---------- fixed-step env driver ----------
     * Human modes: env.step(WAIT) advances the world; clicks use hitHole().
     * Bot modes:   the agent supplies the action each step (agents.js). */
    update(dt) {
      if (this.phase !== 'PLAYING') {
        // keep effects and bodies alive on menu/gameover screens
        global.WAM3D.sceneKit.updateParticles(this.S, dt);
        global.WAM3D.sceneKit.updateBodies(this.S, dt);
        this.updateTemporary(dt);
        this.updateCameraRig(dt, true);
        return;
      }
      this.accumulator += Math.min(dt, 0.1);
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < 8) {
        this.accumulator -= this.fixedDt;
        steps++;
        const action = this.botAction ? this.botAction() : 9; // 9 = WAIT
        const r = this.env.step(action);
        if (r.info && (r.info.hit || r.info.bomb)) this.botEffect(r.info);
        if (r.done) { this.endRound(); return; }
      }
      const frac = this.accumulator / this.fixedDt;
      global.WAM3D.sceneKit.updateParticles(this.S, dt);
      global.WAM3D.sceneKit.updateBodies(this.S, dt);
      this.updateTemporary(dt);
      syncVisuals(this.S, this.env, frac);
      this.updateCameraRig(dt, false);
      this.updateGaze(dt);
      this.updateHammer(dt);
      // countdown tick sfx in the last 5 seconds
      const sec = Math.ceil(this.env.timeLeft);
      if (sec <= 5 && sec !== this.lastTickSecond) { this.lastTickSecond = sec; AudioKit.tick(); }
      UI.setTime(this.env.timeLeft);
      UI.setScore(this.env.score);
    }

    botEffect(info) {
      const hole = this.env.moles.length ? -1 : -1; // resolved below via last action
      if (this.lastBotAction === undefined) return;
      const h = this.lastBotAction;
      if (h >= 0 && h < 9) {
        const [x, z] = HOLE_XZ[h];
        const pos = new THREE.Vector3(x, 0.75, z);
        if (info.hit) { global.WAM3D.sceneKit.FX.hitBurst(this.S, pos); AudioKit.hit(); }
        else if (info.bomb) { explode(this.S, pos, this); }
      }
    }

    updateTemporary(dt) {
      for (let i = this.temporary.length - 1; i >= 0; i--) {
        if (this.temporary[i].update(dt)) this.temporary.splice(i, 1);
      }
    }

    /* ---------- camera rig: orbit + modes + shake ---------- */
    updateCameraRig(dt, idle) {
      const S = this.S, kit = global.WAM3D.sceneKit;
      const o = S.orbit;
      const k = 1 - Math.pow(0.001, dt);
      o.yaw = lerp(o.yaw, o.targetYaw, k);
      o.pitch = lerp(o.pitch, o.targetPitch, k);
      kit.applyOrbit(S, o.yaw, o.pitch);
      kit.placeFpv(S);
      // smooth shake decay
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 1.6);
        const s = this.shake * this.shake * 0.55;
        for (const key of ['angled', 'top', 'fpv']) {
          const c = S.cameras[key];
          c.position.x += (Math.random() - 0.5) * s;
          c.position.y += (Math.random() - 0.5) * s;
        }
      }
    }

    /* ---------- gaze ---------- */
    updateGaze(dt) {
      const gazeOn = this.mode === 'vr' || UI.gazeRequested;
      if (!gazeOn || this.phase !== 'PLAYING') { UI.reticle(false); this.gaze.slot = null; this.gaze.t = 0; return; }
      UI.reticle(true);
      const S = this.S;
      const cam = global.WAM3D.sceneKit.activeCamera(S);
      const rc = S.raycaster;
      rc.setFromCamera({ x: 0, y: 0 }, cam);
      const targets = this.env.activeHoles().map(m => (m.isBomb ? S.visual[m.hole].bomb : S.visual[m.hole].mole));
      let found = null, hole = -1;
      if (targets.length) {
        const hits = rc.intersectObjects(targets, true);
        if (hits.length) {
          let obj = hits[0].object;
          while (obj && !obj.userData.isClone) obj = obj.parent;
          if (obj) {
            for (let i = 0; i < K.HOLES; i++) {
              if (S.visual[i].mole === obj || S.visual[i].bomb === obj) { hole = i; found = obj; break; }
            }
          }
        }
      }
      if (hole !== this.gaze.hole) { this.gaze.hole = hole; this.gaze.t = 0; }
      else if (hole >= 0) {
        this.gaze.t += dt;
        if (this.gaze.t >= this.gaze.HOLD) {
          // bombs are never auto-whacked by gaze: staring at a bomb does nothing (design choice)
          const slot = this.env.moles.find(m => m.hole === hole);
          if (slot && !slot.isBomb) this.playerHit(hole);
          this.gaze.t = 0;
        }
      }
      UI.reticleProgress(hole >= 0 ? this.gaze.t / this.gaze.HOLD : 0);
    }

    /* ---------- hammer ---------- */
    updateHammer(dt) {
      const S = this.S;
      const show = this.mode === 'classic' && S.camOrder[S.camIndex] === 'fpv' ? false : this.mode === 'classic';
      S.hammer.visible = this.phase === 'PLAYING' && this.mode === 'classic';
      if (!S.hammer.visible) return;
      // WASD pointer hole
      const [hx, hz] = HOLE_XZ[this.wasdHole];
      const tx = this.hammerPointer ? this.hammerPointer.x : hx;
      const tz = this.hammerPointer ? this.hammerPointer.z : hz;
      this.hammerTarget.lerp(new THREE.Vector3(tx, 0, tz), 1 - Math.pow(0.0001, dt));
      if (this.hammerSwing > 0) {
        this.hammerSwing = Math.max(0, this.hammerSwing - dt * 5.5);
      }
      const swing = easeIn(this.hammerSwing);
      const g = S.hammer;
      g.position.set(this.hammerTarget.x, 0.2, this.hammerTarget.z + 0.9);
      g.rotation.x = -0.5 - swing * 1.6;   // rest tilt -> smashed down
      g.rotation.z = 0.15;
    }

    swingHammer(hole) {
      this.hammerSwing = 1;
      if (hole !== undefined && hole >= 0) this.playerHit(hole);
    }
  }

  /* ---------------- UI facade (HUD, reticle, chips) ---------------- */
  const UI = {
    $: id => document.getElementById(id),
    hudShow(v) { this.$('hud').classList.toggle('hidden', !v); },
    setScore(n) { const el = this.$('scoreVal'); if (el && el.textContent !== String(n)) el.textContent = n; },
    setTime(t) {
      const el = this.$('timeVal'); const s = Math.max(0, Math.ceil(t));
      if (el && el.textContent !== String(s)) el.textContent = s;
      el.classList.toggle('zero', s <= 5);
    },
    setBest(n) { this.$('bestVal').textContent = n; },
    popScore(bad) {
      const el = this.$('scoreVal');
      el.style.transition = 'none'; el.style.transform = 'scale(1.35)';
      el.style.color = bad ? '#f87171' : '#4ade80';
      requestAnimationFrame(() => { el.style.transition = 'transform 0.18s ease, color 0.4s ease'; el.style.transform = 'scale(1)'; el.style.color = ''; });
    },
    reticle(v) { this.$('reticle').classList.toggle('hidden', !v); },
    reticleProgress(k) { this.$('reticleFill').style.strokeDashoffset = String(213.6 * (1 - clamp(k, 0, 1))); },
    modeChip(text) {
      const el = this.$('modeChip');
      if (!text) { el.classList.add('hidden'); return; }
      el.textContent = text; el.classList.remove('hidden');
    },
    pause(v) { global.WAM3D.panels && global.WAM3D.panels.togglePause(v); },
    toast(msg, ms) {
      const el = this.$('toast');
      el.textContent = msg; el.classList.remove('hidden');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => el.classList.add('hidden'), ms || 2200);
    },
    gazeRequested: false
  };

  /* ============================================================
   * Input — pointer raycast, orbit drag, keyboard
   * ============================================================ */
  function setupInput(game) {
    const S = game.S;
    const canvas = S.renderer.domElement;
    const rc = new THREE.Raycaster();
    S.raycaster = S.raycaster || rc;
    const ndc = new THREE.Vector2();

    /* Orbit drag state. orbit.moved is reset when the gesture ENDS so the
     * next tap is never rejected by a leftover drag distance. */
    const drag = { id: null, lastX: 0, lastY: 0 };

    function holeFromPointer(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
      const cam = global.WAM3D.sceneKit.activeCamera(S);
      rc.setFromCamera(ndc, cam);
      // ray vs ground plane y=0 -> nearest hole
      const t = -rc.ray.origin.y / rc.ray.direction.y;
      if (t < 0) return -1;
      const p = rc.ray.origin.clone().addScaledVector(rc.ray.direction, t);
      let best = -1, bestD = 1.35;
      for (let i = 0; i < K.HOLES; i++) {
        const [hx, hz] = HOLE_XZ[i];
        const d = Math.hypot(p.x - hx, p.z - hz);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    canvas.addEventListener('pointerdown', e => {
      global.WAM3D.gameKit.AudioKit.ensure();
      drag.id = e.pointerId; drag.lastX = e.clientX; drag.lastY = e.clientY;
      S.orbit.moved = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      if (game.phase !== 'PLAYING') return;
      if (game.mode === 'vr') return;             // VR uses gaze + tap anywhere
      if (game.mode === 'classic' && S.camOrder[S.camIndex] === 'fpv') {
        const hole = holeFromPointer(e.clientX, e.clientY);
        game.swingHammer(hole);                   // first-person: click swings the hammer
        return;
      }
      const hole = holeFromPointer(e.clientX, e.clientY);
      if (hole >= 0) game.playerHit(hole);
    });

    canvas.addEventListener('pointermove', e => {
      if (drag.id === null || drag.id !== e.pointerId) {
        // hover: move the hammer pointer over the grid
        if (game.mode === 'classic' && game.phase === 'PLAYING') {
          const t = -rc.ray.origin.y / rc.ray.direction.y;
          const cam = global.WAM3D.sceneKit.activeCamera(S);
          const r = canvas.getBoundingClientRect();
          ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
          ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
          rc.setFromCamera(ndc, cam);
          const tt = -rc.ray.origin.y / rc.ray.direction.y;
          if (tt > 0) {
            const p = rc.ray.origin.clone().addScaledVector(rc.ray.direction, tt);
            game.hammerPointer = { x: clamp(p.x, -4.2, 4.2), z: clamp(p.z, -4.2, 4.2) };
          }
        }
        return;
      }
      const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      S.orbit.moved = (S.orbit.moved || 0) + Math.abs(dx) + Math.abs(dy);
      const o = S.orbit;
      o.targetYaw = global.WAM3D.gameKit.clamp(o.targetYaw - dx * 0.004, -o.MAX_YAW, o.MAX_YAW);
      o.targetPitch = global.WAM3D.gameKit.clamp(o.targetPitch + dy * 0.003, -o.MAX_PITCH, o.MAX_PITCH);
    });

    const endDrag = e => {
      if (drag.id === null || e.pointerId === drag.id) {
        drag.id = null;
        setTimeout(() => { S.orbit.moved = 0; }, 0);
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('blur', () => { drag.id = null; S.orbit.moved = 0; keys.clear(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    /* VR tap = trigger */
    canvas.addEventListener('click', () => {
      if (game.mode === 'vr' && game.phase === 'PLAYING') {
        // tap acts as the Cardboard trigger: whack whatever the gaze is on
        if (game.gaze.hole >= 0) game.playerHit(game.gaze.hole);
      }
    });

    /* ---------------- Keyboard) ---------------- */
    const keys = new Set();
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      keys.add(k);
      if (k === ' ') { e.preventDefault(); if (game.phase === 'PLAYING') game.swingHammer(game.wasdHole); }
      if (k === 'p') game.pauseToggle();
      if (k === 'r' && game.phase !== 'MENU') game.startRound();
      if (k === 'm') global.WAM3D.panels && global.WAM3D.panels.toMenu();
      if (k === 'c') {
        const name = global.WAM3D.sceneKit.cycleCamera(S);
        UI.toast('Camera: ' + ({ angled: 'Angled', top: 'Top-down', fpv: 'First person', vr: 'VR stereo' }[name]));
      }
      if (k === 'e') global.WAM3D.panels && global.WAM3D.panels.toggleEditor();
      if (k === 'enter' && game.phase === 'MENU') global.WAM3D.panels && global.WAM3D.panels.playClassic();
    });
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

    /* WASD / arrows move the keyboard pointer across the 3x3 grid) */
    function updateWasd(dt) {
      if (game.phase !== 'PLAYING') return;
      let dx = 0, dz = 0;
      if (keys.has('w') || keys.has('arrowup')) dz -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dz += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;
      if (!dx && !dz) return;
      const col = game.wasdHole % 3, row = Math.floor(game.wasdHole / 3);
      const nc = global.WAM3D.gameKit.clamp(col + dx, 0, 2);
      const nr = global.WAM3D.gameKit.clamp(row + dz, 0, 2);
      game.wasdHole = nr * 3 + nc;
      game.hammerPointer = null; // keyboard takes over from the mouse
    }
    game.updateWasd = updateWasd;
    return { holeFromPointer };
  }

  /* ============================================================
   * VR stereo rendering
   * Two scissored viewports, eye separation 0.064, deviceorientation head tracking.
   * ============================================================ */
  function setupVR(game) {
    const S = game.S;
    const vr = { active: false, yaw: 0, pitch: 0, roll: 0, hasGyro: false, eyeSep: 0.064 };

    window.addEventListener('deviceorientation', e => {
      if (e.alpha === null) return;
      vr.hasGyro = true;
      vr.yaw = (e.alpha || 0) * Math.PI / 180;
      vr.pitch = ((e.beta || 0) - 90) * Math.PI / 180;  // phone held portrait-up
      vr.roll = (e.gamma || 0) * Math.PI / 180;
    });

    function enter() {
      vr.active = true;
      S.camIndex = S.camOrder.indexOf('vr');
      const el = S.renderer.domElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
      if (!vr.hasGyro) UI.toast('No gyroscope — drag to look around');
    }
    function exit() {
      vr.active = false;
      S.camIndex = S.camOrder.indexOf('angled');   // leave the stereo view
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }

    /** Renders both eyes; called from boot's loop when camera == vr. */
    function render() {
      const size = { w: S.renderer.domElement.width / (S.renderer.getPixelRatio()), h: S.renderer.domElement.height / (S.renderer.getPixelRatio()) };
      const halfW = Math.floor(size.w / 2);
      const basePos = new THREE.Vector3(0, 3.2, 7.6);
      // head orientation (gyro on phone, orbit drag on desktop).
      // Negative Euler X pitches the view DOWN toward the board (the desktop
      // fallback tilts down ~0.25 rad so the 3x3 grid fills the lower half).
      const yaw = vr.hasGyro ? -vr.yaw : S.orbit.yaw * 1.6;
      const pitch = vr.hasGyro ? -vr.pitch : -(0.42 + S.orbit.pitch);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, vr.hasGyro ? -vr.roll : 0, 'YXZ'));
      S.renderer.setScissorTest(true);
      for (const [cam, xOff] of [[S.cameras.vrL, -vr.eyeSep], [S.cameras.vrR, vr.eyeSep]]) {
        cam.position.copy(basePos).add(new THREE.Vector3(xOff, 0, 0).applyQuaternion(q));
        cam.quaternion.copy(q);
        const side = xOff < 0 ? 0 : 1;
        S.renderer.setViewport(side * halfW, 0, halfW, size.h);
        S.renderer.setScissor(side * halfW, 0, halfW, size.h);
        S.renderer.render(S.scene, cam);
      }
      S.renderer.setScissorTest(false);
      S.renderer.setViewport(0, 0, size.w, size.h);
    }
    return { state: vr, enter, exit, render };
  }

  /* ---------------- Resize) ---------------- */
  function setupResize(game) {
    const S = game.S;
    const apply = () => {
      const w = window.innerWidth, h = window.innerHeight;
      for (const key in S.cameras) {
        S.cameras[key].aspect = w / h;
        S.cameras[key].updateProjectionMatrix();
      }
      S.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      S.renderer.setSize(w, h);
    };
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', () => setTimeout(apply, 150));
    apply();
  }

  global.WAM3D.gameKit = Object.assign(global.WAM3D.gameKit || {}, {
    Store, AudioKit, buildVisualPool, syncVisuals, slotY, explode, Game, UI,
    setupInput, setupVR, setupResize, HIDDEN_Y, UP_Y, easeOut, easeIn, clamp, lerp
  });
})(window);
