/* ============================================================
 * Headless test suite for Whack-a-Mole 3D — Mobile VR + AI Edition
 * Full end-to-end verification: gameplay, settings, editor, code lens, AI
 * training/watch modes, VR, persistence. Headless-feasible parts only.
 * Uses installed Chrome.
 * Run: node test.cjs
 * ============================================================ */
const { chromium } = require('playwright');
const path = require('path');

const url = 'file://' + path.resolve(__dirname, 'index.html');
let failures = 0, passes = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  -> ' + extra : ''}`);
  cond ? passes++ : failures++;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(url);
  await page.evaluate(() => localStorage.clear());   // tests start from a clean save
  await page.reload();
  await page.waitForTimeout(1200);

  /* ---------- start screen  */
  check('menu visible', await page.locator('#menu.show').isVisible());
  check('three.js loaded', await page.evaluate(() => !!window.THREE));
  check('all modules booted', await page.evaluate(() =>
    !!(window.WAM3D.game && window.WAM3D.panels && window.WAM3D.trainer && window.WAM3D.env)));
  check('no console errors at boot', errors.length === 0, errors.join(' | '));

  /* ---------- classic round starts  */
  await page.click('[data-mode="classic"]');
  await page.waitForTimeout(500);
  const t2a = await page.evaluate(() => ({ phase: WAM3D.game.phase, time: WAM3D.env.timeLeft, hud: !document.getElementById('hud').classList.contains('hidden') }));
  await page.waitForTimeout(1200);
  const t2b = await page.evaluate(() => WAM3D.env.timeLeft);
  check('phase PLAYING + HUD shown', t2a.phase === 'PLAYING' && t2a.hud, JSON.stringify(t2a));
  check('timer counts down from 30', t2a.time > 28.5 && t2b < t2a.time - 0.8, `${t2a.time.toFixed(1)} -> ${t2b.toFixed(1)}`);

  /* ---------- clicking a mole scores (real pointer path)  */
  let t3ok = false, t3info = 'no UP mole found';
  for (let attempt = 0; attempt < 6 && !t3ok; attempt++) {
    const ct = await page.evaluate(() => {
      const env = WAM3D.env, S = WAM3D.S, cam = WAM3D.sceneKit.activeCamera(S);
      const up = env.moles.find(m => m.state === 'UP' && !m.isBomb);
      if (!up) return null;
      const v = S.visual[up.hole];
      const p = new THREE.Vector3(WAM3D.const.HOLE_XZ[up.hole][0], 0, WAM3D.const.HOLE_XZ[up.hole][1]).project(cam);
      return { hole: up.hole, x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
    });
    if (!ct) { await page.waitForTimeout(400); continue; }
    const before = await page.evaluate(() => WAM3D.env.score);
    await page.mouse.click(ct.x, ct.y);
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({ score: WAM3D.env.score, hud: document.getElementById('scoreVal').textContent }));
    if (after.score === before + 1 && after.hud === String(after.score)) t3ok = true;
    else t3info = JSON.stringify({ hole: ct.hole, before, after: after.score });
  }
  check('clicking a visible mole scores +1 via pointer', t3ok, t3info);

  /* ---------- clicking empty ground does nothing  */
  const s4 = await page.evaluate(() => WAM3D.env.score);
  await page.mouse.click(40, 760);           // far corner, no hole there
  await page.waitForTimeout(250);
  check('clicking empty ground adds nothing', (await page.evaluate(() => WAM3D.env.score)) === s4);

  /* ---------- double hit counts once (env guard)  */
  let r11 = null;
  for (let i = 0; i < 10 && !r11; i++) {
    r11 = await page.evaluate(() => {
      const env = WAM3D.env;
      const up = env.observation().holes.findIndex(h => h === 1);
      if (up < 0) return null;
      const a = env.hitHole(up);
      const b = env.hitHole(up);
      return { first: a.hit, second: b.hit || b.bomb };
    });
    if (!r11) await page.waitForTimeout(400);
  }
  check('second hit on the same mole is ignored', r11 ? (r11.first === true && r11.second === false) : false, JSON.stringify(r11));

  /* ---------- bomb hit deducts and floors at 0  */
  const t14 = await page.evaluate(() => {
    const env = WAM3D.env, game = WAM3D.game;
    env.score = 3;
    // force a bomb into hole 0
    const EnvMole = env.moles.length ? env.moles[0].constructor : null;
    env.moles.length = 0;
    const b = new EnvMole(); b.hole = 0; b.isBomb = true; b.state = 'UP'; b.t = 0; b.stay = 5;
    env.moles.push(b);
    const obs = env.observation();
    const before = env.score;
    const bombs0 = env.bombsHit;
    game.playerHit(0);
    return { before, after: env.score, bomb: env.bombsHit === bombs0 + 1, obsVal: obs.holes[0] };
  });
  check('bomb hit deducts a point', t14.bomb === true && t14.after === t14.before - 1, JSON.stringify(t14));
  const t14b = await page.evaluate(() => {
    const env = WAM3D.env;
    env.score = 0;
    env.moles[0].state = 'UP';
    WAM3D.game.playerHit(0);
    return env.score;
  });
  check('score floors at 0', t14b === 0, String(t14b));

  /* ---------- round ends, game over panel ---------- */
  await page.evaluate(() => { WAM3D.env.timeLeft = 0.05; });
  await page.waitForTimeout(600);
  const t6 = await page.evaluate(() => ({
    phase: WAM3D.game.phase, panel: document.getElementById('gameover').classList.contains('show'),
    final: document.getElementById('finalScore').textContent, score: WAM3D.env.score }));
  check('game over panel with correct score', t6.phase === 'GAMEOVER' && t6.panel && t6.final === String(t6.score), JSON.stringify(t6));

  /* ---------- high score persists after refresh  */
  await page.evaluate(() => { WAM3D.env.score = 12; WAM3D.game.endRound(); });
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => localStorage.getItem('wam3d_high'));
  check('high score saved to localStorage', stored === '12', String(stored));
  await page.reload(); await page.waitForTimeout(1200);
  check('high score persists after refresh', (await page.evaluate(() => localStorage.getItem('wam3d_high'))) === '12');

  /* ---------- restart resets without reload  */
  await page.click('[data-mode="classic"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => { WAM3D.env.score = 7; });
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  const t8 = await page.evaluate(() => ({ phase: WAM3D.game.phase, score: WAM3D.env.score, time: WAM3D.env.timeLeft }));
  check('restart resets score/timer without reload', t8.phase === 'PLAYING' && t8.score === 0 && t8.time > 28, JSON.stringify(t8));

  /* ---------- resize  */
  await page.setViewportSize({ width: 900, height: 650 });
  await page.waitForTimeout(400);
  const t9 = await page.evaluate(() => {
    const c = WAM3D.S.renderer.domElement;
    return { w: c.clientWidth, h: c.clientHeight, iw: innerWidth, ih: innerHeight };
  });
  check('canvas follows window size', t9.w === t9.iw && t9.h === t9.ih, JSON.stringify(t9));
  await page.setViewportSize({ width: 1280, height: 800 });

  /* ---------- camera cycle  */
  const cams = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('c');
    await page.waitForTimeout(150);
    cams.push(await page.evaluate(() => WAM3D.S.camOrder[WAM3D.S.camIndex]));
  }
  check('C cycles through all four views',
    new Set(cams).size === 4 && ['angled', 'top', 'fpv', 'vr'].every(k => cams.includes(k)), cams.join(' -> '));
  await page.keyboard.press('c'); await page.waitForTimeout(150);   // back to angled

  await page.keyboard.press('m'); await page.waitForTimeout(300);

  /* ---------- settings persist  */
  await page.click('[data-open="settings"]');
  await page.waitForTimeout(300);
  await page.click('[data-chips="ground"] .chip:nth-child(3)');     // metal ground
  await page.click('#presetNight');
  await page.waitForTimeout(300);
  const t13a = await page.evaluate(() => ({
    mat: localStorage.getItem('wam3d_materials'),
    amb: document.getElementById('ambientInt').value }));
  await page.reload(); await page.waitForTimeout(1200);
  const t13b = await page.evaluate(() => ({
    mat: localStorage.getItem('wam3d_materials'),
    amb: document.getElementById('ambientInt').value,
    color: WAM3D.S.materials.ground.color.getHexString() }));
  check('material choice survives refresh', t13a.mat === t13b.mat && t13b.mat && JSON.parse(t13b.mat).ground === 'metal', `${t13a.mat} -> ${t13b.mat}`);
  check('light levels survive refresh', t13a.amb === t13b.amb, `${t13a.amb} -> ${t13b.amb}`);

  /* ---------- About VR panel  */
  await page.click('[data-mode="about"]');
  await page.waitForTimeout(300);
  const t20 = await page.evaluate(() => ({
    tl: document.querySelectorAll('#timeline li').length,
    apps: document.querySelectorAll('#appGrid .appCard').length }));
  check('About VR shows timeline and application cards', t20.tl >= 6 && t20.apps >= 5, JSON.stringify(t20));
  await page.click('[data-close="aboutVr"]');
  await page.waitForTimeout(200);

  /* ---------- Editor View ---------- */
  await page.click('[data-open="editor"]');
  await page.waitForTimeout(400);
  const ed = await page.evaluate(() => ({
    rows: document.querySelectorAll('#hierarchy .hrow').length }));
  await page.evaluate(() => document.querySelector('#hierarchy .hrow').click());
  await page.waitForTimeout(200);
  const insp = await page.evaluate(() => {
    const inp = document.querySelector('#inspector input[data-prop="py"]');
    const o = WAM3D.panels.selected;
    const y0 = o.position.y;
    inp.value = String(y0 + 0.5);
    inp.dispatchEvent(new Event('input'));
    return { inputs: document.querySelectorAll('#inspector input').length, moved: o.position.y > y0 + 0.4 };
  });
  check('Editor: hierarchy lists scene graph', ed.rows > 10, String(ed.rows) + ' rows');
  check('Editor: inspector edits live', insp.inputs >= 9 && insp.moved, JSON.stringify(insp));
  await page.click('[data-close="editor"]');
  await page.waitForTimeout(200);

  /* ---------- Code Lens ---------- */
  await page.click('[data-mode="classic"]');
  await page.waitForTimeout(300);
  await page.keyboard.press('l');
  await page.waitForTimeout(400);
  const cl = await page.evaluate(() => ({
    shown: document.getElementById('codelens').classList.contains('show'),
    vars: document.querySelectorAll('#clVars .clv').length,
    method: document.getElementById('clMethod').textContent }));
  check('Code Lens: live variables and method', cl.shown && cl.vars >= 6 && !!cl.method, JSON.stringify(cl));
  await page.keyboard.press('m'); await page.waitForTimeout(300);

  /* ---------- Q-learning trains, reward rises  */
  await page.click('[data-mode="qlearn"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => { WAM3D.trainer.speed = 100; document.getElementById('aiSpeed').value = '100'; document.getElementById('aiSpeedVal').textContent = '100×'; });
  await page.click('#aiTrainBtn');
  await page.waitForTimeout(2000);
  const q1 = await page.evaluate(() => ({ ep: WAM3D.trainer.q.episodes, rew: WAM3D.trainer.q.avgReward(20) }));
  await page.waitForTimeout(8000);
  const q2 = await page.evaluate(() => ({
    ep: WAM3D.trainer.q.episodes, rew: WAM3D.trainer.q.avgReward(20),
    eps: document.getElementById('qEpsilon').textContent,
    heatCells: document.querySelectorAll('#heatGrid .heatCell').length }));
  check('Q-learning trains (episodes grow)', q2.ep > q1.ep && q2.ep > 300, `${q1.ep} -> ${q2.ep}`);
  check('average reward reaches competent level', q2.rew > 10, `${q1.rew.toFixed(1)} -> ${q2.rew.toFixed(1)} (random is -16)`);
  check('heat map fills in', q2.heatCells > 0, String(q2.heatCells));
  await page.click('#aiStopBtn');
  await page.waitForTimeout(300);
  await page.click('#aiWatchBtn');
  await page.waitForTimeout(1500);
  const wq = await page.evaluate(() => ({ mode: WAM3D.game.mode, phase: WAM3D.game.phase }));
  check('watch mode plays the trained bot', wq.mode === 'watch-q' && wq.phase === 'PLAYING', JSON.stringify(wq));
  await page.screenshot({ path: 'screenshot-ai-q.png' });
  await page.keyboard.press('m'); await page.waitForTimeout(300);

  /* ---------- PPO hyperparameter change alters behaviour  */
  await page.click('[data-mode="ppo"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => { WAM3D.trainer.speed = 100; document.getElementById('aiSpeed').value = '100'; document.getElementById('aiSpeedVal').textContent = '100×'; });
  await page.click('#aiTrainBtn');
  await page.waitForTimeout(3000);
  const p1 = await page.evaluate(() => ({ it: WAM3D.trainer.ppo.iterations, rew: WAM3D.trainer.ppo.avgReward(10), lr: WAM3D.trainer.ppo.cfg.lr }));
  await page.click('#aiStopBtn');
  await page.waitForTimeout(200);
  // change a hyperparameter through the UI
  await page.evaluate(() => {
    const inp = document.querySelector('#hpGrid input[data-hp="lr"]');
    inp.value = '0.01';
    inp.dispatchEvent(new Event('change'));
  });
  await page.click('#aiTrainBtn');
  await page.waitForTimeout(2000);
  const p2 = await page.evaluate(() => ({ it: WAM3D.trainer.ppo.iterations, lr: WAM3D.trainer.ppo.cfg.lr }));
  check('PPO trains (iterations grow)', p2.it > p1.it, `${p1.it} -> ${p2.it}`);
  check('hyperparameter change takes effect', p2.lr === 0.01 && p1.lr !== 0.01, `${p1.lr} -> ${p2.lr}`);
  await page.click('#aiStopBtn'); await page.waitForTimeout(200);
  await page.keyboard.press('m'); await page.waitForTimeout(300);

  /* ---------- imitation learns from demonstrations  */
  await page.click('[data-mode="imitate"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const t = WAM3D.trainer, env = t.env;
    env.reset();
    for (let i = 0; i < 3000 && t.im.samples.length < 300; i++) {
      const obs = env.observation();
      const up = obs.holes.map((h, j) => h === 1 ? j : -1).filter(j => j >= 0);
      if (up.length) t.im.record(obs, up[0]);
      env.step(9);
      if (env.done) env.reset();
    }
  });
  await page.click('#aiTrainBtn');
  await page.waitForTimeout(2500);
  const t17 = await page.evaluate(() => ({
    n: WAM3D.trainer.im.samples.length, acc: WAM3D.trainer.im.acc, trained: WAM3D.trainer.im.trained }));
  check('imitation trains on demonstrations', t17.trained && t17.acc > 0.9, JSON.stringify(t17));
  // bot plays a full headless round through the env
  const t17b = await page.evaluate(() => {
    const t = WAM3D.trainer, env = t.env;
    env.reset();
    let g = 0;
    while (!env.done && g++ < 2000) env.step(t.im.act(env));
    return env.score;
  });
  check('imitation bot scores well above random', t17b >= 8, 'bot score ' + t17b);
  await page.keyboard.press('m'); await page.waitForTimeout(300);

  /* ---------- VR mode + gaze  */
  await page.click('[data-mode="vr"]');
  await page.waitForTimeout(600);
  const t18 = await page.evaluate(() => ({
    mode: WAM3D.game.mode, cam: WAM3D.S.camOrder[WAM3D.S.camIndex], active: WAM3D.gameKit.VR.state.active }));
  check('VR mode enters stereo camera', t18.mode === 'vr' && t18.cam === 'vr' && t18.active, JSON.stringify(t18));
  const gaze = await page.evaluate(() => {
    const game = WAM3D.game, env = game.env;
    // force a mole up in hole 4 and gaze at it
    env.moles.length = 0;
    const m = new (env.moles.length ? env.moles[0].constructor : Object)();
    return null; // placeholder replaced below
  });
  // gaze test at API level: hold the reticle on a mole slot
  let g2 = null;
  for (let i = 0; i < 10 && !g2; i++) {
    g2 = await page.evaluate(() => {
      const game = WAM3D.game, env = game.env;
      const obs = env.observation();
      const up = obs.holes.findIndex(h => h === 1);
      if (up < 0) return null;
      const before = env.score;
      game.playerHit(up);            // the same hit path the 0.5s gaze hold triggers
      return { before, after: env.score };
    });
    if (!g2) await page.waitForTimeout(400);
  }
  check('gaze path scores via shared hit path', g2 ? g2.after === g2.before + 1 : false, JSON.stringify(g2));
  await page.keyboard.press('m'); await page.waitForTimeout(400);
  const t18b = await page.evaluate(() => ({ fs: !!document.fullscreenElement, cam: WAM3D.S.camOrder[WAM3D.S.camIndex] }));
  check('leaving VR exits fullscreen and restores camera', !t18b.fs && t18b.cam === 'angled', JSON.stringify(t18b));

  /* ---------- glTF fallback  */
  const t19 = await page.evaluate(() => ({
    proto: !!WAM3D.S.moleProto, note: document.getElementById('assetNote').textContent.slice(0, 20) }));
  check('primitive mole fallback works with no .glb', t19.proto, JSON.stringify(t19));

  /* ---------- persistence of trained Q ---------- */
  const qpersist = await page.evaluate(() => {
    const raw = localStorage.getItem('wam3d_qtable');
    return raw ? JSON.parse(raw).episodes : 0;
  });
  check('Persistence: Q-table autosaved', qpersist > 0, qpersist + ' episodes stored');

  /* ---------- mobile viewport tap  */
  await page.setViewportSize({ width: 390, height: 730 });
  await page.waitForTimeout(400);
  const t10 = await page.evaluate(() => {
    const c = WAM3D.S.renderer.domElement;
    return { w: c.clientWidth, ih: innerWidth, scrollable: document.documentElement.scrollWidth > innerWidth + 2 };
  });
  check('phone viewport fits, no horizontal scroll', t10.w <= t10.ih + 2 && !t10.scrollable, JSON.stringify(t10));
  await page.setViewportSize({ width: 1280, height: 800 });

  /* ---------- final: no errors + screenshots ---------- */
  check('No console/page errors during the whole run', errors.length === 0, errors.slice(0, 4).join(' | '));

  await page.keyboard.press('m'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshot-menu.png' });
  await page.click('[data-mode="classic"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshot-gameplay.png' });
  await page.keyboard.press('m'); await page.waitForTimeout(300);
  await page.click('[data-mode="vr"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'screenshot-vr.png' });
  await page.keyboard.press('m'); await page.waitForTimeout(300);

  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
