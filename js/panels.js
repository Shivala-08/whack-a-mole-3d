/* ============================================================
 * panels.js — UI panels: menu routing, settings, editor, code lens,
 * AI panel, About VR, credits
 * Global namespace: WAM3D.panels
 * ============================================================ */
(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);
  const kit = () => global.WAM3D.gameKit;
  const sceneKit = () => global.WAM3D.sceneKit;
  const agents = () => global.WAM3D.agentsKit;

  const TIMELINE = [
    { yr: '1962', ttl: 'Sensorama', dsc: 'Morton Heilig\'s arcade cabinet: stereo picture, sound, smell and vibration — "experience theatre" before the term VR existed.' },
    { yr: '1968', ttl: 'Sword of Damocles', dsc: 'Ivan Sutherland\'s head-mounted display, hung from the ceiling. First see-through head tracking in graphics.' },
    { yr: '1985', ttl: 'VPL Research', dsc: 'Jaron Lanier coins "virtual reality" and ships the DataGlove and EyePhone — VR as a consumer product idea.' },
    { yr: '2012', ttl: 'Oculus Rift', dsc: 'Palmer Luckey\'s Kickstarter re-ignites VR; Facebook buys Oculus in 2014 for $2bn.' },
    { yr: '2014', ttl: 'Google Cardboard', dsc: 'A folded cardboard viewer and a phone: VR for the price of lunch. The inspiration for this project\'s VR mode.' },
    { yr: '2016', ttl: 'Room-scale VR', dsc: 'HTC Vive and Oculus Rift bring lighthouse tracking, hand controllers and rooms you can walk in.' },
    { yr: '2019', ttl: 'Standalone headsets', dsc: 'Oculus Quest: inside-out tracking, no PC, no wires. VR becomes portable.' },
    { yr: 'Today', ttl: 'Mobile + mixed VR', dsc: 'Phones do head-tracked stereo (this game!), and headsets blend passthrough video with holograms.' }
  ];
  const APPS = [
    { b: '🎮 Gaming', s: 'Beat Saber, Half-Life: Alyx — presence makes play physical.' },
    { b: '🎓 Education', s: 'Virtual labs and field trips where mistakes are free.' },
    { b: '🏥 Healthcare', s: 'Exposure therapy, pain distraction, surgical rehearsal.' },
    { b: '🏗 Training', s: 'Firefighting, flight and factory drills without the risk.' },
    { b: '🏛 Architecture', s: 'Walk through a building before it is built.' },
    { b: '✈ Tourism', s: 'Preview destinations and heritage sites in 360°.' }
  ];
  const LEARNED = [
    'Mapped Unity concepts (scene, prefabs, raycast, GameManager, PlayerPrefs) onto Three.js one to one.',
    'Reinforcement learning is a feedback loop: state, action, reward — and the reward design decides what "good" means.',
    'Tabular Q-learning is exact but explodes with state size; policy gradients scale but need a critic for credit.',
    'A value function (the critic in PPO/GAE) is what turns "the episode went well" into "THIS action was good".',
    'Imitation learning copies demonstrated behaviour — cheap to train, only as good as the demonstrator.',
    'Cardboard VR is just two slightly-offset cameras and a gyroscope — the magic is in the optics, not the code.',
    'Headless training loops (no rendering) are what make learning visible in a browser demo.'
  ];

  class Panels {
    constructor(game, trainer) {
      this.game = game;
      this.trainer = trainer;
      this.selected = null;
      this.gizmo = null;
      this.wireOn = false;
      this._bind();
      this._buildSettings();
      this._buildAbout();
      this._buildCredits();
      this._buildHPGrid();
      game.onGameOver = (score, best, isNew) => this.showGameOver(score, best, isNew);
    }

    /* ---------------- panel helpers ---------------- */
    show(id) { $(id).classList.add('show'); }
    hide(id) { $(id).classList.remove('show'); }
    hideAll() { for (const id of ['menu', 'gameover', 'settings', 'editor', 'aiPanel', 'aboutVr', 'credits', 'pause']) this.hide(id); }

    toMenu() {
      this.trainer.stop();
      this.trainer.stopWatch();
      if (this.vr && this.vr.state && this.vr.state.active) this.vr.exit();   // leave fullscreen + stereo
      this.game.toMenu();
      this.hideAll();
      this.show('menu');
    }
    showGame() {
      this.hideAll();
      kit().UI.hudShow(true);
    }
    togglePause(v) {
      if (v) this.show('pause'); else this.hide('pause');
    }

    /* ---------------- mode routing) ---------------- */
    playClassic() {
      this.hideAll();
      this.game.startRound('classic');
    }
    playVR() {
      this.hideAll();
      this.game.startRound('vr');
      this.vr.enter();
    }
    openAI(mode) {
      const kind = mode === 'qlearn' ? 'q' : mode === 'imitate' ? 'im' : mode;   // normalize data-mode -> trainer kind
      this.hideAll();
      this.show('aiPanel');
      this.trainer.kind = kind;
      for (const id of ['aiQBody', 'aiPpoBody', 'aiImitBody']) $(id).classList.add('hidden');
      const titles = {
        q: ['AI Learns — Q-Learning', 'The agent sees which holes hold moles or bombs (its state), picks one of 10 actions (hit hole 0–8, or wait) and learns from rewards: +1 hit a mole, −1 hit a bomb, −0.05 hit an empty hole, −0.001 per step. Tabular Q-learning updates Q(s,a) ← Q(s,a) + α(r + γ·maxQ(s′) − Q(s,a)) after every step.'],
        ppo: ['AI Learns — PPO', 'A small policy network maps the 11-value observation to action probabilities and is trained with a PPO-style clipped objective. A value head (the critic) supplies per-decision credit through GAE(λ) — without it, a hit\'s reward drowns across the hundreds of steps before it.'],
        im: ['AI Imitates You', 'Play a round with recording on: every click is logged as (observation → hole). Training fits a softmax classifier to your choices (behaviour cloning). The bot then replays your style — whacking the hole it predicts has a mole, waiting otherwise.']
      };
      const t = titles[kind];
      $('aiTitle').textContent = t[0];
      $('aiIntro').textContent = t[1];
      $('aiRecordBtn').classList.toggle('hidden', kind !== 'im');
      $(kind === 'q' ? 'aiQBody' : kind === 'ppo' ? 'aiPpoBody' : 'aiImitBody').classList.remove('hidden');
      $('aiHonesty').textContent = kind === 'im'
        ? 'Honesty note: behaviour cloning here is a softmax classifier trained in your browser — no cloud, no framework. It copies your clicks, including your mistakes.'
        : 'Honesty note: real Unity ML-Agents training runs in Python with PyTorch and cannot run in a web page. This is a compact educational re-implementation of the same ideas at small scale.';
      if (kind === 'im') this.refreshIm();
      this.trainer.updateUI(true);
    }

    /* ---------------- game over ---------------- */
    showGameOver(score, best, isNew) {
      $('finalScore').textContent = score;
      $('finalBest').textContent = best;
      $('newBest').classList.toggle('hidden', !isNew);
      $('overSub').textContent = this.game.mode === 'classic' ? 'Final score' : 'Bot score';
      this.show('gameover');
    }

    /* ---------------- settings: materials, lights, assets ---------------- */
    _buildSettings() {
      const S = this.game.S;
      const rows = [['ground', 'ground'], ['mole', 'mole'], ['hammer', 'hammer']];
      const saved = kit().Store.get('materials', { ground: 'grass', mole: 'brown', hammer: 'wood' });
      for (const [kind, key] of rows) {
        const chipsEl = document.querySelector(`[data-chips="${kind}"]`);
        const presets = kind === 'ground' ? ['grass', 'wood', 'metal', 'neon']
          : kind === 'mole' ? ['brown', 'pink', 'metal', 'neon'] : ['wood', 'metal', 'neon'];
        chipsEl.innerHTML = '';
        for (const p of presets) {
          const b = document.createElement('button');
          b.className = 'chip' + (saved[kind] === p ? ' on' : '');
          b.textContent = p;
          b.onclick = () => {
            this.applyMaterial(kind, p);
            kit().Store.set('materials', Object.assign(kit().Store.get('materials', {}), { [kind]: p }));
            chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
            b.classList.add('on');
          };
          chipsEl.appendChild(b);
        }
      }
      this.applyMaterial('ground', saved.ground);
      this.applyMaterial('mole', saved.mole);
      this.applyMaterial('hammer', saved.hammer);

      // lights)
      const ls = kit().Store.get('lights', {
        ambientOn: true, ambientInt: 0.55, dirOn: true, dirInt: 0.9,
        pointOn: false, pointInt: 1.5, spotOn: false, spotInt: 2, night: false
      });
      const ids = [['lightAmbient', 'ambientOn'], ['ambientInt', 'ambientInt'], ['lightDir', 'dirOn'], ['dirInt', 'dirInt'],
        ['lightPoint', 'pointOn'], ['pointInt', 'pointInt'], ['lightSpot', 'spotOn'], ['spotInt', 'spotInt']];
      const readLights = () => {
        const st = { night: false };
        for (const [id, key] of ids) {
          const el = $(id);
          st[key] = el.type === 'checkbox' ? el.checked : Number(el.value);
        }
        return st;
      };
      for (const [id] of ids) {
        const el = $(id);
        if (el.type === 'checkbox') el.checked = !!ls[ids.find(x => x[0] === id)[1]];
        else el.value = ls[ids.find(x => x[0] === id)[1]];
        el.addEventListener('input', () => {
          sceneKit().setLightState(this.game.S, readLights());
          kit().Store.set('lights', readLights());
        });
      }
      sceneKit().setLightState(S, ls);
      $('presetDay').onclick = () => {
        Object.assign({ ambientOn: true, ambientInt: 0.55, dirOn: true, dirInt: 0.9, pointOn: false, pointInt: 1.5, spotOn: false, spotInt: 2, night: false }, {});
        for (const [id, key] of ids) {
          const el = $(id);
          const day = { ambientOn: true, ambientInt: 0.55, dirOn: true, dirInt: 0.9, pointOn: false, pointInt: 1.5, spotOn: false, spotInt: 2 }[key];
          if (el.type === 'checkbox') el.checked = day; else el.value = day;
        }
        sceneKit().setLightState(S, readLights());
        kit().Store.set('lights', readLights());
      };
      $('presetNight').onclick = () => {
        for (const [id, key] of ids) {
          const el = $(id);
          const night = { ambientOn: true, ambientInt: 0.18, dirOn: true, dirInt: 0.35, pointOn: true, pointInt: 2.5, spotOn: true, spotInt: 2.5 }[key];
          if (el.type === 'checkbox') el.checked = night; else el.value = night;
        }
        sceneKit().setLightState(S, Object.assign(readLights(), { night: true }));
        kit().Store.set('lights', Object.assign(readLights(), { night: true }));
      };

      // assets
      $('reloadAssets').onclick = async () => {
        const ok = await sceneKit().loadGltfMole(this.game.S);
        kit().UI.toast(ok ? 'Loaded assets/mole.glb — Blender model in use' : 'No assets/mole.glb — using the primitive mole (fallback)');
        $('assetNote').textContent = ok
          ? 'Blender model assets/mole.glb is in use. Delete it to fall back to the primitive mole.'
          : 'Drop assets/mole.glb to use a Blender model. Without it the built-in primitive mole is used.';
      };
      $('wireBtn').onclick = () => this.toggleWireframe();
    }

    applyMaterial(kind, preset) {
      const S = this.game.S;
      const m = S.materials[kind];
      const p = sceneKit().makeMat(preset);
      m.color.copy(p.color);
      m.roughness = p.roughness;
      m.metalness = p.metalness;
      if (p.emissive) m.emissive.copy(p.emissive); else m.emissive.setHex(0x000000);
      m.needsUpdate = true;
    }

    toggleWireframe() {
      this.wireOn = !this.wireOn;
      this.game.S.scene.traverse(o => {
        if (o.isMesh && o.material && 'wireframe' in o.material) o.material.wireframe = this.wireOn;
      });
      kit().UI.toast(this.wireOn ? 'Wireframe on — primitive geometry exposed' : 'Wireframe off');
    }

    /* ---------------- About VR + Credits) ---------------- */
    _buildAbout() {
      $('timeline').innerHTML = TIMELINE.map(t =>
        `<li><span class="yr">${t.yr}</span><span><span class="ttl">${t.ttl}</span><div class="dsc">${t.dsc}</div></span></li>`).join('');
      $('appGrid').innerHTML = APPS.map(a => `<div class="appCard"><b>${a.b}</b><span>${a.s}</span></div>`).join('');
    }
    _buildCredits() {
      $('creditsBody').innerHTML =
        `<p><b>Whack-a-Mole 3D — Mobile VR + AI Edition</b><br/>Built with Three.js r128, plain JavaScript and the Web Audio API. No ML framework: the agents are hand-written.</p>
         <h4>What I learned</h4><ul>${LEARNED.map(l => `<li>${l}</li>`).join('')}</ul>
`;
    }

    /* ---------------- Editor View ---------------- */
    toggleEditor() {
      const open = $('editor').classList.contains('show');
      if (!open) {
        if (this.game.phase === 'PLAYING') this.game.pauseToggle();
        this.hideAll();
        this.show('editor');
        this.refreshHierarchy();
      } else {
        this.hide('editor');
        this.clearSelection();
      }
    }
    refreshHierarchy() {
      const scene = this.game.S.scene;
      const rows = [];
      scene.children.forEach(o => rows.push(this._row(o, 0)));
      $('hierarchy').innerHTML = rows.join('') || '<div class="empty">empty scene</div>';
      $('hierarchy').querySelectorAll('[data-uuid]').forEach(el => {
        el.onclick = () => this.select(el.dataset.uuid);
      });
    }
    _row(o, depth) {
      const kids = o.children.length;
      const label = o.name || o.type;
      const meta = kids ? ` · ${kids} child${kids > 1 ? 'ren' : ''}` : '';
      const sel = this.selected && this.selected.uuid === o.uuid ? ' sel' : '';
      let html = `<div class="hrow${sel}" data-uuid="${o.uuid}" style="padding-left:${6 + depth * 14}px"><span class="hname">${label}</span><span class="hmeta">${meta}</span></div>`;
      if (depth < 1) o.children.forEach(c => { html += this._row(c, depth + 1); });
      return html;
    }
    select(uuid) {
      const scene = this.game.S.scene;
      this.selected = null;
      scene.traverse(o => { if (o.uuid === uuid) this.selected = o; });
      if (!this.selected) return;
      this.refreshHierarchy();
      this.refreshInspector();
      if (!this.gizmo) {
        this.gizmo = new THREE.BoxHelper(this.selected, 0xffb300);
        this.game.S.scene.add(this.gizmo);
      } else {
        this.gizmo.setFromObject(this.selected);
        this.gizmo.visible = true;
      }
    }
    clearSelection() {
      this.selected = null;
      if (this.gizmo) this.gizmo.visible = false;
    }
    refreshInspector() {
      const o = this.selected;
      const insp = $('inspector');
      if (!o) { insp.innerHTML = '<div class="empty">select an object in the hierarchy</div>'; return; }
      const d = r => THREE.MathUtils.radToDeg(r).toFixed(1);
      const col = o.material && o.material.color ? '#' + o.material.color.getHexString() : null;
      const row = (label, key, val, step) =>
        `<label class="irow"><span>${label}</span><input type="number" step="${step}" data-prop="${key}" value="${val}"></label>`;
      let html = `<div class="iname">${o.name || o.type}</div>`;
      html += row('pos x', 'px', o.position.x.toFixed(2), 0.1) + row('pos y', 'py', o.position.y.toFixed(2), 0.1) + row('pos z', 'pz', o.position.z.toFixed(2), 0.1);
      html += row('rot x°', 'rx', d(o.rotation.x), 5) + row('rot y°', 'ry', d(o.rotation.y), 5) + row('rot z°', 'rz', d(o.rotation.z), 5);
      html += row('scale x', 'sx', o.scale.x.toFixed(2), 0.1) + row('scale y', 'sy', o.scale.y.toFixed(2), 0.1) + row('scale z', 'sz', o.scale.z.toFixed(2), 0.1);
      if (col) html += `<label class="irow"><span>color</span><input type="color" data-prop="col" value="${col}"></label>`;
      html += `<div class="inote">Edits are live in the scene graph). Reload resets them.</div>`;
      insp.innerHTML = html;
      insp.querySelectorAll('[data-prop]').forEach(el => {
        el.addEventListener('input', () => this.applyProp(el.dataset.prop, el.value));
      });
    }
    applyProp(prop, val) {
      const o = this.selected;
      if (!o) return;
      const v = Number(val);
      if (prop === 'col') { if (o.material && o.material.color) o.material.color.set(val); return; }
      const map = { px: ['position', 'x', 1], py: ['position', 'y', 1], pz: ['position', 'z', 1],
        rx: ['rotation', 'x', Math.PI / 180], ry: ['rotation', 'y', Math.PI / 180], rz: ['rotation', 'z', Math.PI / 180],
        sx: ['scale', 'x', 1], sy: ['scale', 'y', 1], sz: ['scale', 'z', 1] };
      const m = map[prop];
      if (!m) return;
      o[m[0]][m[1]] = v * m[2];
      if (this.gizmo) this.gizmo.setFromObject(o);
    }

    /* ---------------- Code Lens ---------------- */
    toggleCodeLens() {
      $('codelens').classList.toggle('show');
    }
    tickCodeLens() {
      if (!$('codelens').classList.contains('show')) return;
      const g = this.game, e = g.env;
      const vars = [
        ['score', g.env.score], ['timeLeft', e.timeLeft.toFixed(1) + 's'], ['highScore', kit().Store.get('highScore', 0)],
        ['phase', g.phase], ['mode', g.mode], ['molesUp', e.activeHoles().length],
        ['stay', e.stay ? e.stay.toFixed(2) + 's' : '—'], ['camera', g.S.camOrder[g.S.camIndex]]
      ];
      $('clVars').innerHTML = vars.map(v => `<div class="clv"><span>${v[0]}</span><b>${v[1]}</b></div>`).join('');
      $('clMethod').textContent = g.lastMethod || 'Update()';
    }

    /* ---------------- AI panel buttons ---------------- */
    _bindAI() {
      const t = this.trainer;
      $('aiRecordBtn').onclick = () => t.recordRound();
      $('aiTrainBtn').onclick = () => {
        if (t.kind === 'im') {
          if (t.im.samples.length < 20) { kit().UI.toast('Record at least ~20 hits first: press Record and play a round.'); return; }
          t.trainImitation();
        } else {
          t.train(t.kind);
        }
      };
      $('aiWatchBtn').onclick = () => {
        if (t.kind === 'im' && !t.im.trained) { kit().UI.toast('Train the imitation bot first.'); return; }
        t.stop();
        t.watch(t.kind);
      };
      $('aiStopBtn').onclick = () => { t.stop(); t.stopWatch(); };
      $('aiResetBtn').onclick = () => { t.reset(t.kind); };
      $('aiSpeed').oninput = () => {
        t.speed = Number($('aiSpeed').value);
        $('aiSpeedVal').textContent = t.speed + '×';
      };
      $('aiSpeed').oninput();
      $('aiBackBtn').onclick = () => this.toMenu();
    }
    _buildHPGrid() {
      const ppo = this.trainer.ppo;
      const defs = [['lr', 1e-4, 0.02, 0.0005], ['batchSize', 16, 512, 16], ['bufferSize', 256, 8192, 256],
        ['epochs', 1, 10, 1], ['clip', 0.05, 0.5, 0.05], ['beta', 0, 0.05, 0.001],
        ['lambda', 0.8, 0.99, 0.01], ['gamma', 0.9, 0.999, 0.001], ['hidden', 16, 128, 16]];
      $('hpGrid').innerHTML = defs.map(d =>
        `<label class="irow"><span>${d[0]}</span><input type="number" data-hp="${d[0]}" value="${ppo.cfg[d[0]]}" min="${d[1]}" max="${d[2]}" step="${d[3]}"></label>`).join('');
      $('hpGrid').querySelectorAll('[data-hp]').forEach(el => {
        el.addEventListener('change', () => {
          const v = Number(el.value);
          if (!isFinite(v) || v <= 0) { el.value = ppo.cfg[el.dataset.hp]; return; }
          ppo.cfg[el.dataset.hp] = v;
          if (el.dataset.hp === 'hidden') this.trainer.reset('ppo');
          kit().UI.toast(`PPO ${el.dataset.hp} = ${v}`);
        });
      });
    }
    refreshIm() {
      const t = this.trainer;
      $('imSamples').textContent = t.im.samples.length;
      $('imYourScore').textContent = t.im.lastScore === null ? '—' : t.im.lastScore;
      $('imBotScore').textContent = t.im.trained ? t.imScore().toFixed(0) : '—';
    }

    /* ---------------- VR) ---------------- */
    get vr() { return kit().VR; }

    /* ---------------- per-frame tick ---------------- */
    tick() {
      this.tickCodeLens();
      if ($('editor').classList.contains('show') && this.gizmo && this.gizmo.visible) {
        this.gizmo.update();
      }
    }

    /* ---------------- event binding ---------------- */
    _bind() {
      document.querySelectorAll('[data-mode]').forEach(b => {
        b.onclick = () => {
          const m = b.dataset.mode;
          if (m === 'classic') this.playClassic();
          else if (m === 'vr') this.playVR();
          else if (m === 'about') { this.hideAll(); this.show('aboutVr'); }
          else this.openAI(m);
        };
      });
      document.querySelectorAll('[data-open]').forEach(b => {
        b.onclick = () => {
          const t = b.dataset.open;
          if (t === 'settings') { this.hideAll(); this.show('settings'); }
          else if (t === 'editor') this.toggleEditor();
          else if (t === 'credits') { this.hideAll(); this.show('credits'); }
        };
      });
      document.querySelectorAll('[data-close]').forEach(b => {
        b.onclick = () => {
          const t = b.dataset.close;
          this.hide(t);
          if (t === 'editor') this.clearSelection();
          // closing a side panel with no round active returns to the menu
          if (this.game.phase === 'MENU') this.show('menu');
        };
      });
      document.querySelectorAll('[data-back]').forEach(b => {
        b.onclick = () => { this.clearSelection(); this.toMenu(); };
      });
      $('againBtn').onclick = () => {
        this.hideAll();
        if (this.game.mode === 'vr') { this.game.startRound('vr'); this.vr.enter(); }
        else this.game.startRound(this.game.mode || 'classic');
      };
      $('overMenuBtn').onclick = () => this.toMenu();
      $('resumeBtn').onclick = () => { this.hide('pause'); this.game.pauseToggle(); };
      $('pauseMenuBtn').onclick = () => this.toMenu();
      this._bindAI();
      window.addEventListener('keydown', ev => {
        if (ev.key === 'e' || ev.key === 'E') this.toggleEditor();
        if (ev.key === 'l' || ev.key === 'L') this.toggleCodeLens();
        if (ev.key === 'Escape') {
          if ($('codelens').classList.contains('show')) this.toggleCodeLens();
          else this.toMenu();
        }
      });
    }
  }

  global.WAM3D = global.WAM3D || {};
  global.WAM3D.panelsKit = { Panels, TIMELINE, APPS, LEARNED };
})(window);
