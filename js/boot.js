/* ============================================================
 * boot.js — wire everything together and run the main loop
 * Creates scene, env, Game, Trainer, Panels; rAF loop renders
 * normal or VR stereo depending on the active camera).
 * ============================================================ */
(function (global) {
  'use strict';
  const W = global.WAM3D = global.WAM3D || {};

  function boot() {
    const S = W.sceneKit.create();
    W.env = new global.MoleEnv();          // game.js slotY() fallback reads W.env
    const game = new W.gameKit.Game(S, W.env);
    const trainer = new W.agentsKit.Trainer(game);
    // First run with no saved progress: seed from the shipped pre-trained
    // models (assets/trained.js) so the AI modes are demo-ready out of the box.
    if (!trainer.qLoaded && !trainer.ppoLoaded && !trainer.imLoaded && global.WAM_TRAINED) {
      const t = global.WAM_TRAINED, Store = W.gameKit.Store;
      if (t.qtable) Store.set('qtable', t.qtable);
      if (t.pponet) Store.set('pponet', t.pponet);
      if (t.imit) Store.set('imit', t.imit);
      trainer.q.load(); trainer.ppo.load(); trainer.im.load();
    }
    const panels = new W.panelsKit.Panels(game, trainer);
    W.panels = panels;
    W.game = game;
    W.trainer = trainer;
    W.S = S;

    const vr = W.gameKit.setupVR(game);
    W.gameKit.VR = vr;                   // panels.playVR uses gameKit.VR
    W.gameKit.setupInput(game);
    W.gameKit.setupResize(game);

    // try the Blender mole once: a missing file must fall back cleanly
    W.sceneKit.loadGltfMole(S).then(ok => {
      if (ok) W.gameKit.UI.toast('Loaded assets/mole.glb');
      else {
        const note = document.getElementById('assetNote');
        if (note) note.textContent = 'Drop assets/mole.glb to use a Blender model. Without it the built-in primitive mole is used.';
      }
    });

    const clock = { last: performance.now() };
    function frame(now) {
      const dt = Math.min((now - clock.last) / 1000, 0.1);
      clock.last = now;
      game.update(dt);
      trainer.tick();
      panels.tick();
      render();
      requestAnimationFrame(frame);
    }
    function render() {
      const camKey = S.camOrder[S.camIndex];
      if (camKey === 'vr') {
        vr.render();                       // stereo scissored render)
      } else {
        S.renderer.render(S.scene, W.sceneKit.activeCamera(S));
      }
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
