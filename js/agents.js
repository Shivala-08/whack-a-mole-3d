/* ============================================================
 * agents.js — Week 3 + Week 4 AI (plain JavaScript, no ML library)
 *
 *   QAgent      tabular Q-learning
 *   PPOAgent    compact policy-gradient net
 *   Imitation   behaviour cloning recorder
 *   Trainer     shared loop: speed slider, watch mode, persistence
 *
 * All agents speak the MoleEnv contract (env.js): reset() / step(action)
 * -> {observation, reward, done}. Honesty note (Part C): these are
 * small educational re-implementations, not Unity ML-Agents/PyTorch.
 * ============================================================ */
(function (global) {
  'use strict';
  const EC = global.ENV_CONST || {};   // env.js is the source of truth for the action space
  const HOLES = EC.HOLES || 9;
  const ACTIONS = EC.ACTIONS || 10;
  const WAIT = EC.WAIT !== undefined ? EC.WAIT : 9;
  const Store = () => global.WAM3D.gameKit.Store;

  /* ---------------- small utils ---------------- */
  function argmax(arr) {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
    return best;
  }
  function softmax(logits) {
    const m = Math.max.apply(null, logits);
    const e = logits.map(v => Math.exp(v - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map(v => v / s);
  }
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  /* ---------------- canvas line chart (reused by all three) ---------------- */
  function drawChart(canvas, series, opts) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const o = opts || {};
    const pad = 6;
    if (!series.length || series.every(v => v === null || isNaN(v))) {
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(o.emptyText || 'no data yet — press Train', W / 2, H / 2);
      return;
    }
    const vals = series.filter(v => v !== null && !isNaN(v));
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < 1e-6) { max += 0.5; min -= 0.5; }
    const pad2 = (max - min) * 0.08; min -= pad2; max += pad2;
    const X = i => pad + (W - 2 * pad) * (i / Math.max(1, series.length - 1));
    const Y = v => H - pad - (H - 2 * pad) * ((v - min) / (max - min));
    // zero line if in range
    if (min < 0 && max > 0) {
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(W - pad, Y(0)); ctx.stroke();
      ctx.setLineDash([]);
    }
    // the line
    ctx.strokeStyle = o.color || '#ffb300';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v === null || isNaN(v)) { started = false; continue; }
      if (!started) { ctx.moveTo(X(i), Y(v)); started = true; }
      else ctx.lineTo(X(i), Y(v));
    }
    ctx.stroke();
    // fill under
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = o.color || '#ffb300';
    ctx.lineTo(X(series.length - 1), H - pad); ctx.lineTo(X(0), H - pad); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // min/max labels
    ctx.fillStyle = 'rgba(148,163,184,0.8)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(max.toFixed(1), pad + 2, 12);
    ctx.fillText(min.toFixed(1), pad + 2, H - 4);
  }

  /* ---------------- heat map grid (Q-table + policy) ---------------- */
  function colorScale(v, min, max) {
    // red (min) -> grey (0) -> green (max)
    const t = max > min ? (v - min) / (max - min) : 0.5;
    if (v >= 0) {
      const k = max > 0 ? v / max : 0;
      return `rgba(74,222,128,${0.12 + 0.75 * k})`;
    }
    const k = min < 0 ? v / min : 0;
    return `rgba(248,113,113,${0.12 + 0.75 * k})`;
  }

  function renderHeat(gridEl, values, emptyEl, format) {
    if (!gridEl) return;
    if (emptyEl) emptyEl.style.display = values ? 'none' : 'flex';
    if (!values) { gridEl.innerHTML = ''; return; }
    const nums = values.filter(v => typeof v === 'number');
    const min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
    let html = '';
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const bg = (typeof v === 'number') ? colorScale(v, min, max) : 'rgba(255,255,255,0.06)';
      const txt = format ? format(v) : (typeof v === 'number' ? v.toFixed(2) : '—');
      html += `<div class="heatCell" style="background:${bg}">${txt}</div>`;
    }
    gridEl.innerHTML = html;
  }

  /* ============================================================
   * QAgent — tabular Q-learning)
   * Q(s,a) += alpha * (r + gamma * maxQ(s') - Q(s,a))
   * ============================================================ */
  class QAgent {
    constructor(cfg) {
      this.cfg = Object.assign({ alpha: 0.1, gamma: 0.95, epsStart: 1.0, epsEnd: 0.05, epsDecay: 0.995 }, cfg || {});
      this.Q = new Map();               // stateKey -> Float64Array(ACTIONS)
      this.episodes = 0;
      this.epsilon = this.cfg.epsStart;
      this.epReward = 0;
      this.recent = [];                 // last N episode rewards for the chart + average
      this.lastAction = WAIT;
      this.lastState = null;
    }
    qRow(key) {
      let row = this.Q.get(key);
      if (!row) { row = new Float64Array(ACTIONS); this.Q.set(key, row); }
      return row;
    }
    /** epsilon-greedy action for observation `obs` */
    act(obs, greedy) {
      const key = obs.holes.join('');
      if (!greedy && Math.random() < this.epsilon) {
        this.lastAction = Math.floor(Math.random() * ACTIONS);
        return this.lastAction;
      }
      const row = this.qRow(key);
      // tie-break randomly among equal maxima so the agent is not biased to hole 0
      const best = argmax(row);
      const ties = [];
      for (let a = 0; a < ACTIONS; a++) if (row[a] === row[best]) ties.push(a);
      this.lastAction = ties[Math.floor(Math.random() * ties.length)];
      return this.lastAction;
    }
    /** one learning step from the Trainer */
    learn(env) {
      const obs = env.observation();
      const s = obs.holes.join('');
      const a = this.act(obs, false);
      const r = env.step(a);
      const s2 = r.observation.holes.join('');
      const row = this.qRow(s);
      const target = r.done ? r.reward : r.reward + this.cfg.gamma * Math.max.apply(null, this.qRow(s2));
      row[a] += this.cfg.alpha * (target - row[a]);
      this.epReward += r.reward;
      if (r.done) {
        this.episodes++;
        this.recent.push(this.epReward);
        if (this.recent.length > 200) this.recent.shift();
        this.epReward = 0;
        this.epsilon = Math.max(this.cfg.epsEnd, this.epsilon * this.cfg.epsDecay);
        env.reset();
      }
      return r;
    }
    avgReward(n) {
      const tail = this.recent.slice(-(n || 50));
      return tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
    }
    /** Q values of the 9 hole actions for the current state (for the heat map) */
    holeQ(env) {
      const key = env.observation().holes.join('');
      const row = this.Q.get(key);
      if (!row) return null;
      return Array.from(row.slice(0, HOLES));
    }
    chartSeries() { return this.recent.slice(); }
    reset() {
      this.Q.clear(); this.episodes = 0; this.epsilon = this.cfg.epsStart;
      this.recent.length = 0; this.epReward = 0;
    }
    save() {
      // cap stored states so localStorage stays small
      const entries = [];
      for (const [k, v] of this.Q) entries.push([k, Array.from(v)]);
      Store().set('qtable', { entries: entries.slice(-4000), eps: this.epsilon, episodes: this.episodes, recent: this.recent.slice(-200) });
    }
    load() {
      const d = Store().get('qtable', null);
      if (!d || !d.entries) return false;
      this.Q = new Map(d.entries.map(([k, v]) => [k, Float64Array.from(v)]));
      this.epsilon = d.eps; this.episodes = d.episodes || 0; this.recent = d.recent || [];
      return true;
    }
  }

  /* ============================================================
   * PPOAgent — compact PPO
   * Policy network 11 -> hidden(reLU) -> 10 logits -> softmax.
   * Clipped surrogate objective + entropy bonus, hand-derived gradients.
   * Advantages use GAE(λ) from a value head (the critic): per-decision credit
   * is impossible with reward-to-go alone in 900-step episodes.
   * ============================================================ */
  class PolicyNet {
    constructor(nIn, nHidden, nOut) {
      this.nIn = nIn; this.nH = nHidden; this.nOut = nOut;
      this.W1 = new Float64Array(nIn * nHidden);
      this.b1 = new Float64Array(nHidden);
      this.W2 = new Float64Array(nHidden * nOut);
      this.b2 = new Float64Array(nOut);
      this.Wv = new Float64Array(nHidden);   // value head (critic)
      this.bv = 0;
      this.init();
    }
    init() {
      const s1 = Math.sqrt(2 / this.nIn), s2 = Math.sqrt(2 / this.nH);
      for (let i = 0; i < this.W1.length; i++) this.W1[i] = (Math.random() * 2 - 1) * s1;
      for (let i = 0; i < this.W2.length; i++) this.W2[i] = (Math.random() * 2 - 1) * s2;
      for (let i = 0; i < this.Wv.length; i++) this.Wv[i] = (Math.random() * 2 - 1) * 0.1;
    }
    forward(x) {
      const h = new Float64Array(this.nH);
      for (let j = 0; j < this.nH; j++) {
        let s = this.b1[j];
        const off = j * this.nIn;
        for (let i = 0; i < this.nIn; i++) s += this.W1[off + i] * x[i];
        h[j] = s > 0 ? s : 0;                      // reLU
      }
      const logits = new Float64Array(this.nOut);
      for (let o = 0; o < this.nOut; o++) {
        let s = this.b2[o];
        const off = o * this.nH;
        for (let j = 0; j < this.nH; j++) s += this.W2[off + j] * h[j];
        logits[o] = s;
      }
      let v = this.bv;                              // value estimate V(s)
      for (let j = 0; j < this.nH; j++) v += this.Wv[j] * h[j];
      return { h, logits, v };
    }
  }

  class PPOAgent {
    constructor(cfg) {
      this.cfg = Object.assign({
        lr: 3e-4, batchSize: 64, bufferSize: 2048, epochs: 3,
        clip: 0.2, beta: 5e-3, lambda: 0.95, gamma: 0.99, hidden: 64
      }, cfg || {});
      this.net = new PolicyNet(HOLES + 2, this.cfg.hidden, ACTIONS);
      this.buffer = [];            // {x, h, probs, action, reward, done, logp}
      this.iterations = 0;
      this.epReward = 0;
      this.recent = [];            // avg reward per iteration
      this.entropy = 0;
      this.baseline = 0;           // EMA of returns
      this.lastAction = WAIT;
    }
    obsToX(obs) {
      const x = new Float64Array(HOLES + 2);
      for (let i = 0; i < HOLES; i++) x[i] = obs.holes[i];
      x[HOLES] = obs.timeLeft; x[HOLES + 1] = obs.stay;
      return x;
    }
    act(obs, greedy) {
      const x = this.obsToX(obs);
      const { logits } = this.net.forward(x);
      const probs = softmax(Array.from(logits));
      let a;
      if (greedy) a = argmax(probs);
      else {
        let r = Math.random(), acc = 0;
        a = ACTIONS - 1;
        for (let i = 0; i < ACTIONS; i++) { acc += probs[i]; if (r < acc) { a = i; break; } }
      }
      this.lastAction = a;
      const fwd = this.net.forward(x);
      const probs2 = softmax(Array.from(fwd.logits));
      this._last = { x, probs: probs2, a, logp: Math.log(Math.max(probs2[a], 1e-10)), v: fwd.v };
      return a;
    }
    /** collect one env step into the buffer */
    observe(env, r) {
      if (this._last) {
        this.buffer.push({
          x: this._last.x, probs: this._last.probs, a: this._last.a,
          logp: this._last.logp, v: this._last.v,
          xNext: this.obsToX(r.observation),
          reward: r.reward, done: r.done
        });
        this._last = null;
      }
      this.epReward += r.reward;
      if (r.done) {
        env.reset();
      }
    }
    /** PPO update: GAE(λ) advantages from the value critic + clipped surrogate.
     *  Per-decision credit needs the critic — reward-to-go alone drowns a hit's
     *  +1 across ~100 preceding arbitrary actions in 900-step episodes. */
    update() {
      const c = this.cfg;
      if (this.buffer.length < c.batchSize) return;
      const n = this.buffer.length;
      const last = this.buffer[n - 1];
      const vNext = last.done ? 0 : this.net.forward(last.xNext).v;
      const advs = new Array(n), returns = new Array(n);
      let gae = 0, retTail = vNext;
      for (let i = n - 1; i >= 0; i--) {
        const s = this.buffer[i];
        const nextVal = s.done ? 0 : (i === n - 1 ? vNext : this.buffer[i + 1].v);
        const delta = s.reward + c.gamma * nextVal - s.v;
        gae = delta + c.gamma * c.lambda * (s.done ? 0 : gae);
        advs[i] = gae;
        retTail = s.reward + (s.done ? 0 : c.gamma * retTail);
        returns[i] = retTail;
      }
      for (let i = 0; i < n; i++) this.buffer[i].ret = returns[i];
      for (let i = 0; i < n; i++) this.baseline = 0.995 * this.baseline + 0.005 * returns[i];
      // advantage normalization
      let am = 0;
      for (const a of advs) am += a;
      am /= n;
      let av = 0;
      for (const a of advs) av += (a - am) * (a - am);
      av = Math.sqrt(av / n) + 1e-8;
      for (let i = 0; i < n; i++) this.buffer[i].adv = (advs[i] - am) / av;
      let entropySum = 0, entropyN = 0;
      for (let epoch = 0; epoch < c.epochs; epoch++) {
        for (let start = 0; start < this.buffer.length; start += c.batchSize) {
          const end = Math.min(start + c.batchSize, this.buffer.length);
          this._gradBatch(start, end, returns);
        }
      }
      for (const s of this.buffer) {
        entropySum -= s.probs.reduce((acc, p) => acc + (p > 1e-10 ? p * Math.log(p) : 0), 0);
        entropyN++;
      }
      this.entropy = entropyN ? entropySum / entropyN : 0;
      this.iterations++;
      this.recent.push(this.epReward);
      if (this.recent.length > 200) this.recent.shift();
      this.epReward = 0;
      this.buffer.length = 0;      // on-policy: discard after update
    }
    /** one minibatch of clipped-surrogate + value-loss gradient ascent */
    _gradBatch(start, end, returns) {
      const c = this.cfg, net = this.net;
      const gW1 = new Float64Array(net.W1.length), gb1 = new Float64Array(net.b1.length);
      const gW2 = new Float64Array(net.W2.length), gb2 = new Float64Array(net.b2.length);
      const gWv = new Float64Array(net.Wv.length);
      let gbv = 0, n = 0;
      for (let idx = start; idx < end; idx++) {
        const s = this.buffer[idx];
        const { h, logits, v } = net.forward(s.x);
        const probs = softmax(Array.from(logits));
        const ratio = Math.exp(Math.log(Math.max(probs[s.a], 1e-10)) - s.logp);
        const adv = s.adv !== undefined ? s.adv : 0;
        // clipped surrogate gradient wrt logits: 0 when the clip absorbs the update
        let coef = adv * ratio;
        if ((adv > 0 && ratio > 1 + c.clip) || (adv < 0 && ratio < 1 - c.clip)) coef = 0;
        // entropy bonus gradient: dH/dlogit_j = p_j * (-H - log p_j)
        const H = -probs.reduce((acc, p) => acc + (p > 1e-10 ? p * Math.log(p) : 0), 0);
        // dLogits are per-sample gradients; the mean is taken once via lr/n below.
        const dLogits = new Float64Array(ACTIONS);
        for (let j = 0; j < ACTIONS; j++) {
          const onehot = j === s.a ? 1 : 0;
          dLogits[j] = coef * (onehot - probs[j]) + c.beta * probs[j] * (-H - Math.log(Math.max(probs[j], 1e-10)));
        }
        // value head gradient (MSE toward reward-to-go), 0.5 coefficient like ML-Agents
        const dv = s.ret !== undefined ? (0.5 * 2 * (s.ret - v) / (end - start)) : 0;
        // backprop: logits -> W2,b2 -> hidden (reLU gate) -> W1,b1; value -> Wv,bv
        const dh = new Float64Array(net.nH);
        for (let o = 0; o < net.nOut; o++) {
          const d = dLogits[o];
          gb2[o] += d;
          const off = o * net.nH;
          for (let j = 0; j < net.nH; j++) {
            gW2[off + j] += d * h[j];
            dh[j] += d * net.W2[off + j];
          }
        }
        gbv += dv;
        for (let j = 0; j < net.nH; j++) {
          gWv[j] += dv * h[j];
          dh[j] += dv * net.Wv[j];
        }
        for (let j = 0; j < net.nH; j++) {
          if (h[j] <= 0) continue;                    // reLU gate
          gb1[j] += dh[j];
          const off = j * net.nIn;
          for (let i = 0; i < net.nIn; i++) gW1[off + i] += dh[j] * s.x[i];
        }
        n++;
      }
      if (!n) return;
      const lr = c.lr / n;
      for (let i = 0; i < net.W1.length; i++) net.W1[i] += lr * gW1[i];
      for (let i = 0; i < net.b1.length; i++) net.b1[i] += lr * gb1[i];
      for (let i = 0; i < net.W2.length; i++) net.W2[i] += lr * gW2[i];
      for (let i = 0; i < net.b2.length; i++) net.b2[i] += lr * gb2[i];
      for (let i = 0; i < net.Wv.length; i++) net.Wv[i] += lr * gWv[i];
      net.bv += lr * gbv;
    }
    avgReward(n) {
      const tail = this.recent.slice(-(n || 20));
      return tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
    }
    /** policy probabilities for the current state (for the policy grid) */
    policyProbs(env) {
      const { logits } = this.net.forward(this.obsToX(env.observation()));
      return softmax(Array.from(logits)).slice(0, HOLES);
    }
    chartSeries() { return this.recent.slice(); }
    save() {
      const n = this.net;
      Store().set('pponet', {
        W1: Array.from(n.W1), b1: Array.from(n.b1), W2: Array.from(n.W2),
        b2: Array.from(n.b2), Wv: Array.from(n.Wv), bv: n.bv,
        iterations: this.iterations, recent: this.recent.slice(-200),
        cfg: this.cfg
      });
    }
    load() {
      const d = Store().get('pponet', null);
      if (!d || !d.W1) return false;
      if (d.cfg) Object.assign(this.cfg, d.cfg);
      this.net = new PolicyNet(HOLES + 2, this.cfg.hidden, ACTIONS);
      this.net.W1.set(d.W1); this.net.b1.set(d.b1);
      this.net.W2.set(d.W2); this.net.b2.set(d.b2);
      this.net.Wv.set(d.Wv); this.net.bv = d.bv;
      this.iterations = d.iterations || 0;
      this.recent = d.recent || [];
      return true;
    }
    reset() {
      this.net = new PolicyNet(HOLES + 2, this.cfg.hidden, ACTIONS);
      this.buffer.length = 0; this.iterations = 0; this.recent.length = 0;
      this.epReward = 0; this.entropy = 0; this.baseline = 0;
    }
  }

  /* ============================================================
   * ImitationAgent — behaviour cloning
   * Records (observation -> clicked hole) while the human plays, then fits
   * a softmax classifier by gradient descent on cross-entropy loss.
   * ============================================================ */
  class ImitationAgent {
    constructor() {
      this.samples = [];          // {x: Float64Array(11), y: holeIndex}
      this.W = null; this.b = null;
      this.trained = false;
      this.lossCurve = [];
      this.acc = null; this.loss = null;
    }
    record(obs, action) {
      const x = new Float64Array(HOLES + 2);
      for (let i = 0; i < HOLES; i++) x[i] = obs.holes[i];
      x[HOLES] = obs.timeLeft; x[HOLES + 1] = obs.stay;
      this.samples.push({ x, y: action });
      if (this.samples.length > 5000) this.samples.shift();
    }
    clear() { this.samples.length = 0; this.lossCurve.length = 0; this.trained = false; this.acc = this.loss = null; }
    get count() { return this.samples.length; }
    /** full-batch gradient descent, returns per-epoch loss (downsampled for the chart) */
    train(epochs, lr) {
      if (this.samples.length < 10) return [];
      const E = epochs || 200, LR = lr || 0.5;
      const nIn = HOLES + 2, nOut = HOLES;   // predicts one of the 9 holes
      if (!this.W) {
        this.W = new Float64Array(nIn * nOut);
        this.b = new Float64Array(nOut);
        for (let i = 0; i < this.W.length; i++) this.W[i] = (Math.random() * 2 - 1) * 0.1;
      }
      const N = this.samples.length;
      const losses = [];
      for (let ep = 0; ep < E; ep++) {
        const gW = new Float64Array(this.W.length), gb = new Float64Array(nOut);
        let loss = 0;
        for (const s of this.samples) {
          const logits = new Float64Array(nOut);
          for (let o = 0; o < nOut; o++) {
            let z = this.b[o];
            const off = o * nIn;
            for (let i = 0; i < nIn; i++) z += this.W[off + i] * s.x[i];
            logits[o] = z;
          }
          const p = softmax(Array.from(logits));
          loss += -Math.log(Math.max(p[s.y], 1e-10));
          for (let o = 0; o < nOut; o++) {
            const d = (p[o] - (o === s.y ? 1 : 0)) / N;
            gb[o] += d;
            const off = o * nIn;
            for (let i = 0; i < nIn; i++) gW[off + i] += d * s.x[i];
          }
        }
        for (let i = 0; i < this.W.length; i++) this.W[i] -= LR * gW[i];
        for (let i = 0; i < nOut; i++) this.b[i] -= LR * gb[i];
        losses.push(loss / N);
      }
      // downsample the curve to <=120 points for the chart
      const step = Math.max(1, Math.floor(losses.length / 120));
      this.lossCurve = losses.filter((_, i) => i % step === 0);
      this.loss = this.lossCurve[this.lossCurve.length - 1];
      this.acc = this.accuracy();
      this.trained = true;
      return this.lossCurve;
    }
    accuracy() {
      if (!this.W || !this.samples.length) return 0;
      let ok = 0;
      for (const s of this.samples) if (this.predict(s.x) === s.y) ok++;
      return ok / this.samples.length;
    }
    predict(x) {
      const nIn = HOLES + 2, nOut = HOLES;
      const logits = new Float64Array(nOut);
      for (let o = 0; o < nOut; o++) {
        let z = this.b[o]; const off = o * nIn;
        for (let i = 0; i < nIn; i++) z += this.W[off + i] * x[i];
        logits[o] = z;
      }
      return argmax(Array.from(logits));
    }
    /** bot action: whack the predicted hole only when a mole is visible there
     *  (masking uses the observation only, so it is fair), otherwise wait. */
    act(env) {
      const obs = env.observation();
      if (!this.trained) return WAIT;
      const x = new Float64Array(HOLES + 2);
      for (let i = 0; i < HOLES; i++) x[i] = obs.holes[i];
      x[HOLES] = obs.timeLeft; x[HOLES + 1] = obs.stay;
      const hole = this.predict(x);
      return obs.holes[hole] === 1 ? hole : WAIT;
    }
    save() {
      if (!this.W) return;
      Store().set('imit', {
        samples: this.samples.map(s => ({ x: Array.from(s.x), y: s.y })).slice(-3000),
        curve: this.lossCurve.slice(-120),
        W: Array.from(this.W), b: Array.from(this.b),
        acc: this.acc, loss: this.loss, trained: this.trained
      });
    }
    load() {
      const d = Store().get('imit', null);
      if (!d || !d.samples) return false;
      this.samples = d.samples.map(s => ({ x: Float64Array.from(s.x), y: s.y }));
      this.lossCurve = d.curve || [];
      if (d.W) {          // restore the trained classifier, not just the data
        this.W = Float64Array.from(d.W);
        this.b = Float64Array.from(d.b);
        this.acc = d.acc; this.loss = d.loss; this.trained = !!d.trained;
      }
      return this.samples.length > 0;
    }
  }

  /* ============================================================
   * Trainer — shared orchestration for all three agents
   * Owns: speed slider, train/stop/reset/watch, DOM updates, persistence.
   * ============================================================ */
  class Trainer {
    constructor(game) {
      this.game = game;
      this.env = game.env;
      this.kind = null;            // 'q' | 'ppo' | 'im'
      this.q = new QAgent();
      this.ppo = new PPOAgent();
      this.im = new ImitationAgent();
      this.running = false;
      this.speed = 20;
      this._frame = 0;
      this._saveT = 0;
      this.imRecording = false;
      this.loadPersisted();
    }
    loadPersisted() {
      this.qLoaded = this.q.load();
      this.imLoaded = this.im.load();
      this.ppoLoaded = this.ppo.load();
    }
    setSpeed(v) { this.speed = v; }

    train(kind) {
      this.kind = kind;
      this.running = true;
      if (kind === 'im') this.trainImitation();
    }
    /** start a recorded demonstration round): the player's hits are the dataset */
    recordRound() {
      const game = this.game;
      this.imRecording = true;
      this.im.lastScore = null;
      game.onHit = (obs, hole, res) => {
        if (!this.imRecording || !res.hit) return;   // only successful whacks are demonstrations
        this.im.record(obs, hole);
      };
      if (!this._overWrapped) {
        this._overWrapped = true;
        const prev = game.onGameOver;
        game.onGameOver = (score, best, isNew) => {
          if (this.imRecording) {
            this.imRecording = false;
            this.im.lastScore = score;
            this.im.save();
            global.WAM3D.panels && global.WAM3D.panels.refreshIm();
            global.WAM3D.gameKit.UI.toast(`Recorded — ${this.im.samples.length} demonstrations saved`);
          }
          if (prev) prev(score, best, isNew);
        };
      }
      game.startRound('imitate');
      global.WAM3D.panels.showGame();
    }
    stop() {
      this.running = false;
      if (this.kind === 'q') this.q.save();     // persist progress when training stops
      if (this.kind === 'ppo') this.ppo.save();
    }
    reset() {
      if (this.kind === 'q') { this.q.reset(); Store().set('qtable', null); }
      if (this.kind === 'ppo') { this.ppo.reset(); Store().set('pponet', null); }
      if (this.kind === 'im') { this.im.clear(); Store().set('imit', null); }
      this.updateUI(true);
    }

    /** watch the trained bot play in the live scene */
    watch(kind) {
      this.kind = kind;
      const game = this.game;
      game.mode = kind === 'q' ? 'watch-q' : kind === 'ppo' ? 'watch-ppo' : 'watch-im';
      game.startRound(game.mode);
      // drop any stale sample left over from a previous watch/train session
      this.q._last = null; this.ppo._last = null;
      game.botAction = () => {
        const obs = this.env.observation();
        let a;
        if (kind === 'q') a = this.q.act(obs, true);
        else if (kind === 'ppo') a = this.ppo.act(obs, true);
        else a = this.im.act(this.env);
        game.lastBotAction = a;
        return a;
      };
      global.WAM3D.panels.showGame();
    }
    stopWatch() {
      this.game.botAction = null;
      this.game.lastBotAction = undefined;
    }
    /** the imitation bot's score over one headless env round (for the panel) */
    imScore() {
      const env = this.env;
      env.reset();
      let g = 0;
      while (!env.done && g++ < 2000) env.step(this.im.act(env));
      return env.score;
    }

    /** called every animation frame from boot.js */
    tick() {
      if (!this.running || this.kind === 'im') return;
      this.game.lastMethod = this.kind === 'q' ? 'Learn()' : 'UpdateModel()';
      const stepsPerFrame = Math.max(1, Math.round(this.speed * 8));
      const agent = this.kind === 'q' ? this.q : this.ppo;
      for (let i = 0; i < stepsPerFrame; i++) {
        if (this.kind === 'q') {
          this.q.learn(this.env);
        } else {
          const a = this.ppo.act(this.env.observation(), false);
          const r = this.env.step(a);
          this.ppo.observe(this.env, r);
          if (this.ppo.buffer.length >= this.ppo.cfg.bufferSize) this.ppo.update();
        }
      }
      if (++this._frame % 8 === 0) this.updateUI();
      // autosave the trained model about once a second of wall time
      if (++this._saveT >= 60) {
        this._saveT = 0;
        if (this.kind === 'q') this.q.save();
        if (this.kind === 'ppo') this.ppo.save();
      }
    }

    /** imitation training is one blocking pass (dataset is small) */
    trainImitation() {
      const curve = this.im.train(200, 0.5);
      this.im.save();
      this.updateUI(true);
      return curve.length > 0;
    }

    /* ---------- DOM updates ---------- */
    updateUI(full) {
      const $ = id => document.getElementById(id);
      if (this.kind === 'q') {
        $('qEpisodes').textContent = this.q.episodes;
        $('qEpsilon').textContent = this.q.epsilon.toFixed(2);
        $('qReward').textContent = this.q.avgReward(50).toFixed(2);
        renderHeat($('heatGrid'), this.q.holeQ(this.env), $('heatEmpty'), v => v.toFixed(2));
        drawChart($('qChart'), this.q.chartSeries(), { color: '#4ade80', emptyText: 'train to fill the curve' });
        const bs = $('qBotScore'); if (bs) bs.textContent = this.env.score;
      } else if (this.kind === 'ppo') {
        $('ppoIters').textContent = this.ppo.iterations;
        $('ppoReward').textContent = this.ppo.avgReward(20).toFixed(2);
        $('ppoEntropy').textContent = this.ppo.entropy.toFixed(3);
        renderHeat($('policyGrid'), this.ppo.policyProbs(this.env), null, v => (v * 100 >= 0.05 ? (v * 100).toFixed(1) : '<0.1') + '%');
        drawChart($('ppoChart'), this.ppo.chartSeries(), { color: '#60a5fa', emptyText: 'collecting rollouts…' });
      } else if (this.kind === 'im') {
        $('imSamples').textContent = this.im.count;
        $('imAcc').textContent = this.im.acc === null ? '—' : (this.im.acc * 100).toFixed(1) + '%';
        $('imLoss').textContent = this.im.loss === null ? '—' : this.im.loss.toFixed(3);
        drawChart($('imChart'), this.im.lossCurve, { color: '#f472b6', emptyText: 'record a round, then train' });
      }
    }
  }

  global.WAM3D = global.WAM3D || {};
  global.WAM3D.agentsKit = Object.assign(global.WAM3D.agentsKit || {}, {
    argmax, softmax, dot, drawChart, renderHeat, colorScale,
    QAgent, PPOAgent, PolicyNet, ImitationAgent, Trainer
  });
})(window);
