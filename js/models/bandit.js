/* =========================================================================
 * bandit.js — Thompson Sampling multi-armed bandit
 * -------------------------------------------------------------------------
 * Selects which shortcut to surface in the "Suggested for you" slot.
 * Each candidate shortcut is an "arm". The reward signal is binary:
 *   1 = the user clicked the suggestion that was shown
 *   0 = the suggestion was shown and ignored (dismissed or superseded)
 *
 * Thompson Sampling maintains a Beta(alpha, beta) posterior over each arm's
 * click-through probability, samples one value per arm, and plays the arm
 * with the highest sample. This balances exploration (trying shortcuts the
 * system knows little about) against exploitation (re-showing shortcuts the
 * user has responded to before). See Russo et al. (2018).
 *
 * Author: Surya Yellutla
 * Course: Human-Computer Interaction — AI-Based Adaptive HCI Project
 * ========================================================================= */

(function (global) {
  'use strict';

  /**
   * Draw a sample from a Gamma(shape, 1) distribution using the
   * Marsaglia & Tsang (2000) method. Used as a building block for Beta.
   */
  function sampleGamma(shape) {
    if (shape < 1) {
      // Boost low shapes: Gamma(a) = Gamma(a+1) * U^(1/a)
      return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    var d = shape - 1 / 3;
    var c = 1 / Math.sqrt(9 * d);
    while (true) {
      var x, v;
      do {
        x = gaussian();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      var u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Standard normal sample via the Box-Muller transform. */
  function gaussian() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Draw from Beta(a, b) as the ratio of two Gamma draws. */
  function sampleBeta(a, b) {
    var x = sampleGamma(a);
    var y = sampleGamma(b);
    return x / (x + y);
  }

  /**
   * @constructor
   * @param {string[]} armIds - identifiers for each candidate suggestion
   */
  function ThompsonBandit(armIds) {
    this.arms = {};
    var self = this;
    armIds.forEach(function (id) {
      // Beta(1,1) is a uniform prior: before any evidence, every shortcut is
      // considered equally likely to be useful.
      self.arms[id] = { alpha: 1, beta: 1, pulls: 0, rewards: 0 };
    });
  }

  /** Register a new arm at runtime (e.g. a feature unlocked mid-session). */
  ThompsonBandit.prototype.addArm = function (id) {
    if (!this.arms[id]) {
      this.arms[id] = { alpha: 1, beta: 1, pulls: 0, rewards: 0 };
    }
  };

  /**
   * Choose the next arm to display.
   * @param {string[]} [restrictTo] - optional subset of eligible arm ids
   * @returns {string} the chosen arm id
   */
  ThompsonBandit.prototype.select = function (restrictTo) {
    var ids = restrictTo && restrictTo.length
      ? restrictTo.filter(function (i) { return this.arms[i]; }, this)
      : Object.keys(this.arms);
    if (!ids.length) return null;

    var best = null;
    var bestDraw = -Infinity;
    for (var i = 0; i < ids.length; i++) {
      var a = this.arms[ids[i]];
      var draw = sampleBeta(a.alpha, a.beta);
      if (draw > bestDraw) {
        bestDraw = draw;
        best = ids[i];
      }
    }
    return best;
  };

  /**
   * Record the outcome of showing an arm.
   * @param {string} id
   * @param {number} reward - 1 for a click, 0 for an ignore
   */
  ThompsonBandit.prototype.update = function (id, reward) {
    var arm = this.arms[id];
    if (!arm) return;
    arm.pulls += 1;
    if (reward > 0) {
      arm.alpha += reward;
      arm.rewards += 1;
    } else {
      arm.beta += 1;
    }
  };

  /** Posterior mean click-through estimate for an arm. */
  ThompsonBandit.prototype.estimate = function (id) {
    var a = this.arms[id];
    if (!a) return 0;
    return a.alpha / (a.alpha + a.beta);
  };

  /** Snapshot of all arms, sorted by posterior mean — used by the XAI panel. */
  ThompsonBandit.prototype.report = function () {
    var self = this;
    return Object.keys(this.arms)
      .map(function (id) {
        return {
          id: id,
          mean: self.estimate(id),
          pulls: self.arms[id].pulls,
          rewards: self.arms[id].rewards
        };
      })
      .sort(function (x, y) { return y.mean - x.mean; });
  };

  ThompsonBandit.prototype.toJSON = function () { return this.arms; };
  ThompsonBandit.prototype.fromJSON = function (obj) {
    if (obj && typeof obj === 'object') this.arms = obj;
  };

  global.AdaptiveUI = global.AdaptiveUI || {};
  global.AdaptiveUI.ThompsonBandit = ThompsonBandit;
  global.AdaptiveUI._sampleBeta = sampleBeta; // exposed for unit tests
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AdaptiveUI;
}
