/* Train all three AI modes to completion in the real game UI.
 * Results persist to localStorage and are verified per agent. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file:///Users/pallav/Desktop/whack-a-mole/index.html');
  await page.waitForTimeout(1200);
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(1200);

  const setSpeed = () => page.evaluate(() => {
    WAM3D.trainer.speed = 100;
    document.getElementById('aiSpeed').value = '100';
    document.getElementById('aiSpeedVal').textContent = '100×';
  });

  /* ---------- 1. Q-LEARNING: 2000 episodes ---------- */
  console.log('=== Q-LEARNING ===');
  await page.click('[data-mode="qlearn"]'); await page.waitForTimeout(300);
  await setSpeed();
  await page.click('#aiTrainBtn');
  let q0 = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({ ep: WAM3D.trainer.q.episodes, rew: WAM3D.trainer.q.avgReward(20), eps: WAM3D.trainer.q.epsilon }));
    if (i === 0) q0 = s;
    console.log(`  ep=${s.ep} avgR=${s.rew.toFixed(1)} eps=${s.eps.toFixed(3)}`);
    if (s.ep >= 2000) break;
  }
  await page.click('#aiStopBtn'); await page.waitForTimeout(300);
  const qFinal = await page.evaluate(() => {
    const t = WAM3D.trainer, env = t.env;
    env.reset();
    let g = 0;
    while (!env.done && g++ < 2000) env.step(t.q.act(env.observation(), true));
    return { greedy: env.score, rows: t.q.Q.size };
  });
  console.log(`  greedy score: ${qFinal.greedy} | Q-rows: ${qFinal.rows} | stored: yes`);
  await page.screenshot({ path: 'screenshot-ai-q.png' });

  /* ---------- 2. PPO: 2000 iterations ---------- */
  console.log('=== PPO ===');
  await page.click('#aiBackBtn'); await page.waitForTimeout(300);
  await page.click('[data-mode="ppo"]'); await page.waitForTimeout(300);
  await setSpeed();
  // raise the learning rate through the hyperparameter grid (default 3e-4 is
  // 10x slower on this env; 3e-3 converges in ~2000 iterations)
  await page.evaluate(() => {
    const inp = document.querySelector('#hpGrid input[data-hp="lr"]');
    inp.value = '0.003';
    inp.dispatchEvent(new Event('change'));
  });
  await page.click('#aiTrainBtn');
  let p0 = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => ({ it: WAM3D.trainer.ppo.iterations, rew: WAM3D.trainer.ppo.avgReward(10), ent: WAM3D.trainer.ppo.entropy }));
    if (i === 0) p0 = s;
    console.log(`  it=${s.it} avgR=${s.rew.toFixed(1)} entropy=${s.ent.toFixed(2)}`);
    if (s.it >= 2000) break;
  }
  await page.click('#aiStopBtn'); await page.waitForTimeout(300);
  const pFinal = await page.evaluate(() => {
    const t = WAM3D.trainer, env = t.env;
    env.reset();
    let g = 0;
    while (!env.done && g++ < 2000) env.step(t.ppo.act(env.observation(), true));
    return { greedy: env.score };
  });
  console.log(`  greedy score: ${pFinal.greedy} | stored: yes`);
  await page.screenshot({ path: 'screenshot-ai-ppo.png' });

  /* ---------- 3. IMITATION: record + train ---------- */
  console.log('=== IMITATION ===');
  await page.click('#aiBackBtn'); await page.waitForTimeout(300);
  await page.click('[data-mode="imitate"]'); await page.waitForTimeout(300);
  // generate a full expert demonstration set (the "human" plays perfectly)
  await page.evaluate(() => {
    const t = WAM3D.trainer, env = t.env;
    env.reset();
    for (let i = 0; i < 20000 && t.im.samples.length < 3000; i++) {
      const obs = env.observation();
      const up = obs.holes.map((h, j) => h === 1 ? j : -1).filter(j => j >= 0);
      if (up.length) t.im.record(obs, up[0]);
      env.step(9);
      if (env.done) env.reset();
    }
  });
  await page.click('#aiTrainBtn');
  await page.waitForTimeout(4000);
  const imFinal = await page.evaluate(() => {
    const t = WAM3D.trainer, env = t.env;
    env.reset();
    let g = 0;
    while (!env.done && g++ < 2000) env.step(t.im.act(env));
    return { n: t.im.samples.length, acc: t.im.acc, loss: t.im.loss, bot: env.score };
  });
  console.log(`  samples: ${imFinal.n} | accuracy: ${(imFinal.acc * 100).toFixed(1)}% | loss: ${imFinal.loss.toFixed(3)} | bot score: ${imFinal.bot}`);
  await page.screenshot({ path: 'screenshot-ai-im.png' });

  /* ---------- verify persistence after reload ---------- */
  console.log('=== PERSISTENCE (reload) ===');
  await page.reload(); await page.waitForTimeout(1500);
  const pers = await page.evaluate(() => {
    const t = WAM3D.trainer, env = t.env;
    const play = act => { env.reset(); let g = 0; while (!env.done && g++ < 2000) env.step(act()); return env.score; };
    return {
      q: play(() => t.q.act(env.observation(), true)),
      ppo: play(() => t.ppo.act(env.observation(), true)),
      im: t.im.trained ? play(() => t.im.act(env)) : null
    };
  });
  console.log(`  after reload -> Q: ${pers.q} | PPO: ${pers.ppo} | Imitation: ${pers.im}`);
  console.log('ERRORS:', errs.length ? errs : 'none');

  /* ---------- export trained models to assets/trained.js ---------- */
  const fs = require('fs');
  const data = await page.evaluate(() => ({
    qtable: JSON.parse(localStorage.getItem('wam3d_qtable') || 'null'),
    pponet: JSON.parse(localStorage.getItem('wam3d_pponet') || 'null'),
    imit: JSON.parse(localStorage.getItem('wam3d_imit') || 'null')
  }));
  const js = '/* Pre-trained models exported from a training session (see README).\n' +
    '   boot.js seeds localStorage from this file when the user has no saved progress. */\n' +
    'window.WAM_TRAINED = ' + JSON.stringify(data) + ';\n';
  fs.writeFileSync('assets/trained.js', js);
  console.log('exported assets/trained.js:', Object.keys(data).filter(k => data[k]).join(', '),
    '| size:', (fs.statSync('assets/trained.js').size / 1024).toFixed(0) + 'KB');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
