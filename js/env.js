/* ============================================================
 * env.js — MoleEnv
 * The shared environment contract. Mirrors the
 * Unity ML-Agents Agent API: reset() / step(action) -> {observation, reward, done}.
 *
 * Used by: the human game, the Q-learning agent, the PPO agent and
 * the imitation bot. Nothing in here touches Three.js, so training can
 * run headless at thousands of steps per frame.
 * ============================================================ */
(function (global) {
  'use strict';

  const HOLES = 9;
  const ACTIONS = 10; // 0..8 = hit that hole, 9 = wait
  const WAIT = 9;

  // Reward table from C4.
  const REWARD = {
    mole: 1.0,
    bomb: -1.0,
    empty: -0.05,
    step: -0.001
  };

  /**
   * A single mole slot. This is the simulation's own mole — the visual
   * Mole objects in game.js read from these slots so what you see is what
   * the agents see.
   */
  class EnvMole {
    constructor() {
      this.hole = -1;
      this.isBomb = false;
      this.state = 'DONE'; // DONE | RISING | UP | FALLING | HIT
      this.t = 0;
      this.stay = 1;
      this.hittable = false;
    }
    get alive() { return this.state !== 'DONE'; }
  }

  class MoleEnv {
    constructor(cfg) {
      this.cfg = Object.assign({
        roundTime: 30,
        rise: 0.28,
        stayStart: 1.5,
        stayMin: 0.55,
        gapStart: 1.15,
        gapMin: 0.42,
        bombChance: 0.18,   // bomb mole chance
        maxActiveEarly: 1,
        maxActiveLate: 2,
        twoMoleAt: 0.6      // progress fraction when 2 moles may be up
      }, cfg || {});

      this.time = 0;
      this.timeLeft = this.cfg.roundTime;
      this.spawnTimer = 0;
      this.moles = [];      // active EnvMole slots
      this.pool = [];       // reusable slots
      this.rngSeed = 12345;
      this.score = 0;
      this.hits = 0;
      this.misses = 0;
      this.bombsHit = 0;
      this.done = false;
      for (let i = 0; i < 4; i++) this.pool.push(new EnvMole());
    }

    /* --- deterministic PRNG so training runs are reproducible-ish --- */
    rand() {
      // xorshift32
      let x = this.rngSeed | 0;
      x ^= x << 13; x |= 0;
      x ^= x >>> 17;
      x ^= x << 5; x |= 0;
      this.rngSeed = x;
      return ((x >>> 0) % 100000) / 100000;
    }
    seed(s) { this.rngSeed = (s | 0) || 12345; }

    reset() {
      this.time = 0;
      this.timeLeft = this.cfg.roundTime;
      this.spawnTimer = 0.4;
      this.moles.length = 0;
      this.score = 0;
      this.hits = 0;
      this.misses = 0;
      this.bombsHit = 0;
      this.done = false;
      return this.observation();
    }

    get progress() { return Math.min(1, Math.max(0, 1 - this.timeLeft / this.cfg.roundTime)); }
    lerp(a, b, t) { return a + (b - a) * t; }

    /**
     * Observation vector): 9 hole values + 2 globals = 11 values.
     * Hole value: 0 empty, 1 mole, -1 bomb. A hole whose mole is already
     * retreating counts as empty (it can no longer be hit).
     */
    observation() {
      const obs = new Array(HOLES + 2).fill(0);
      for (const m of this.moles) {
        if (m.state === 'RISING' || m.state === 'UP') {
          obs[m.hole] = m.isBomb ? -1 : 1;
        }
      }
      obs[HOLES] = this.timeLeft / this.cfg.roundTime;          // normalized time left
      let maxStay = 0;
      for (const m of this.moles) {
        if (m.state === 'UP') maxStay = Math.max(maxStay, m.stay - m.t);
      }
      obs[HOLES + 1] = Math.min(1, maxStay);                     // longest remaining stay
      return { holes: obs.slice(0, HOLES), timeLeft: obs[HOLES], stay: obs[HOLES + 1] };
    }

    /** Compact state key for the tabular Q-table ( "built from the 9 hole values"). */
    stateKey(obs) {
      return obs ? obs.holes.join('') : this.observation().holes.join('');
    }

    /** Discrete action mask: you can always wait; hitting a hole is always "legal"
     *  (and costs -0.05 if empty), which keeps the action space stable for learning. */
    actionMask() {
      const mask = new Array(ACTIONS).fill(1);
      return mask;
    }

    step(action) {
      if (this.done) {
        return { observation: this.observation(), reward: 0, done: true, info: { terminal: true } };
      }
      let reward = REWARD.step;
      const info = { hit: false, bomb: false, miss: false, score: this.score };

      // ---- apply the action to the CURRENT world state ----
      if (action !== WAIT && action >= 0 && action < HOLES) {
        const target = this.moles.find(m =>
          m.hole === action && (m.state === 'RISING' || m.state === 'UP'));
        if (target && !target.isBomb) {
          target.state = 'HIT'; target.t = 0;
          reward += REWARD.mole;
          this.score += 1; this.hits += 1;
          info.hit = true;
        } else if (target && target.isBomb) {
          target.state = 'HIT'; target.t = 0;
          reward += REWARD.bomb;
          this.score = Math.max(0, this.score - 1);
          this.bombsHit += 1;
          info.bomb = true;
        } else {
          reward += REWARD.empty;
          this.misses += 1;
          info.miss = true;
        }
      }

      // ---- advance one simulated tick ----
      const dt = 1 / 30; // fixed step: keeps training deterministic & fast
      this.time += dt;
      this.timeLeft = Math.max(0, this.timeLeft - dt);

      for (let i = this.moles.length - 1; i >= 0; i--) {
        const m = this.moles[i];
        m.t += dt;
        if (m.state === 'RISING') {
          if (m.t >= this.cfg.rise) { m.state = 'UP'; m.t = 0; }
        } else if (m.state === 'UP') {
          if (m.t >= m.stay) { m.state = 'FALLING'; m.t = 0; }
        } else if (m.state === 'FALLING' || m.state === 'HIT') {
          const dur = m.state === 'HIT' ? 0.18 : this.cfg.rise;
          if (m.t >= dur) {
            m.state = 'DONE';
            this.moles.splice(i, 1);
            this.pool.push(m);
          }
        }
      }

      // ---- spawning ----
      this.spawnTimer -= dt;
      const progress = this.progress;
      const stay = this.lerp(this.cfg.stayStart, this.cfg.stayMin, progress);
      const gap = this.lerp(this.cfg.gapStart, this.cfg.gapMin, progress);
      const maxActive = progress > this.cfg.twoMoleAt ? this.cfg.maxActiveLate : this.cfg.maxActiveEarly;

      if (this.spawnTimer <= 0 && this.moles.length < maxActive && this.timeLeft > 0) {
        this.spawnTimer = gap * (0.8 + this.rand() * 0.4);
        const busy = this.moles.map(m => m.hole);
        const free = [];
        for (let h = 0; h < HOLES; h++) if (busy.indexOf(h) === -1) free.push(h);
        if (free.length) {
          const hole = free[Math.floor(this.rand() * free.length) % free.length];
          const slot = this.pool.pop() || new EnvMole();
          slot.hole = hole;
          slot.isBomb = this.rand() < this.cfg.bombChance;
          slot.state = 'RISING';
          slot.t = 0;
          slot.stay = stay;
          this.moles.push(slot);
        }
      }

      if (this.timeLeft <= 0) {
        this.done = true;
        // Terminal moles are cleared so the next reset starts clean.
        for (const m of this.moles) m.state = 'DONE';
        this.moles.length = 0;
      }

      return {
        observation: this.observation(),
        reward: reward,
        done: this.done,
        info: info
      };
    }

    /** Externally-triggered hit (used by the human input path so it shares one code path). */
    hitHole(hole) {
      if (this.done) return { hit: false, bomb: false, miss: false, score: this.score };
      const before = this.score;
      const target = this.moles.find(m =>
        m.hole === hole && (m.state === 'RISING' || m.state === 'UP'));
      if (target && !target.isBomb) {
        target.state = 'HIT'; target.t = 0;
        this.score += 1; this.hits += 1;
        return { hit: true, bomb: false, miss: false, score: this.score, mole: target };
      }
      if (target && target.isBomb) {
        target.state = 'HIT'; target.t = 0;
        this.score = Math.max(0, this.score - 1);
        this.bombsHit += 1;
        return { hit: false, bomb: true, miss: false, score: this.score, mole: target };
      }
      this.misses += 1;
      return { hit: false, bomb: false, miss: true, score: before };
    }

    /** Holes that currently hold a hittable mole (for rendering + gaze). */
    activeHoles() {
      return this.moles.filter(m => m.state === 'RISING' || m.state === 'UP');
    }
  }

  global.MoleEnv = MoleEnv;
  global.ENV_CONST = { HOLES, ACTIONS, WAIT, REWARD };
})(window);
