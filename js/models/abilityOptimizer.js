/* =========================================================================
 * abilityOptimizer.js — decision-theoretic ability-based presentation tuning
 * -------------------------------------------------------------------------
 * Inspired by the Supple system (Gajos, Weld & Wobbrock, 2010), which framed
 * interface generation as an optimisation problem over a cost function
 * estimating the expected effort a *specific* user will spend on an
 * interface. This module implements a small, tractable version of the same
 * idea: rather than searching a 10^17-element design space, it searches a
 * discrete grid of (fontScale, targetScale, spacing) presentation states and
 * picks the one minimising an expected-effort cost.
 *
 * The cost model uses a Fitts's Law term (Fitts, 1954; MacKenzie, 1992):
 *
 *     MT = a + b * log2(D / W + 1)
 *
 * where W is effective target width (grows with targetScale) and D is the
 * mean pointer travel distance measured from live telemetry. A screen-real-
 * estate penalty prevents the optimiser from simply making everything huge,
 * and a hysteresis band prevents the layout from oscillating — unstable
 * layouts are one of the classic usability costs of adaptive UIs
 * (Jameson, 2008).
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  var FITTS_A = 0.20;   // intercept, seconds
  var FITTS_B = 0.15;   // slope, seconds per bit

  var FONT_SCALES   = [0.95, 1.00, 1.10, 1.25, 1.40];
  var TARGET_SCALES = [0.95, 1.00, 1.15, 1.35, 1.60];
  var SPACINGS      = ['compact', 'comfortable', 'spacious'];
  var SPACING_COST  = { compact: 0.00, comfortable: 0.05, spacious: 0.12 };

  function AbilityOptimizer() {
    this.state = { fontScale: 1.0, targetScale: 1.0, spacing: 'comfortable' };
    this.lastCost = null;
    this.hysteresis = 0.06; // require a 6% predicted improvement to re-layout
    this.changeLog = [];
  }

  /**
   * Predicted movement time for one acquisition, in seconds.
   * @param {number} distance - mean pointer travel distance, px
   * @param {number} baseWidth - nominal target width, px
   * @param {number} targetScale
   */
  function fittsMT(distance, baseWidth, targetScale) {
    var w = Math.max(8, baseWidth * targetScale);
    return FITTS_A + FITTS_B * Math.log2(distance / w + 1);
  }

  /**
   * Expected-effort cost of a candidate presentation state.
   *
   * @param {Object} cand   - {fontScale, targetScale, spacing}
   * @param {Object} ability - measured user characteristics:
   *        missRate        0..1  fraction of clicks that missed their target
   *        meanDistance    px    mean pointer travel between targets
   *        baseTargetWidth px    nominal control width
   *        readSlowdown    0..1  proxy for visual difficulty (long dwell on
   *                              text-heavy panels with little scrolling)
   *        density         0..1  how much content the user wants on screen
   */
  AbilityOptimizer.prototype.cost = function (cand, ability) {
    // 1. Pointing cost, amplified by observed miss rate (each miss costs a
    //    re-acquisition, so effective time multiplies by 1/(1-p_miss)).
    var mt = fittsMT(ability.meanDistance, ability.baseTargetWidth, cand.targetScale);
    // Larger targets reduce misses; model residual miss probability as
    // decaying with target scale.
    var residualMiss = Math.min(0.9, ability.missRate / Math.pow(cand.targetScale, 1.8));
    var pointingCost = mt / (1 - residualMiss);

    // 2. Reading cost: readSlowdown is the evidence that text is hard to
    //    parse at the current size. Larger fonts reduce it, with diminishing
    //    returns. BASE_LEGIBILITY is the irreducible cost of reading *any*
    //    text: without it the optimiser will happily shrink type below the
    //    default whenever it can buy back a little screen real estate, even
    //    for a user who is visibly struggling. Shrinking should require
    //    positive evidence of fluency, not merely an absence of evidence of
    //    difficulty.
    var BASE_LEGIBILITY = 0.35;
    var readingCost =
      (ability.readSlowdown + BASE_LEGIBILITY) / Math.pow(cand.fontScale, 1.5);

    // 3. Real-estate penalty: bigger type and looser spacing push content
    //    off-screen, which costs scrolling. Weighted by how much density the
    //    user's behaviour says they want.
    var realEstate =
      (cand.fontScale - 1) * 0.45 +
      (cand.targetScale - 1) * 0.30 +
      SPACING_COST[cand.spacing];
    var realEstateCost = Math.max(0, realEstate) * (0.4 + ability.density);

    return pointingCost + readingCost + realEstateCost;
  };

  /**
   * Search the presentation grid and adopt the best state if the improvement
   * clears the hysteresis threshold.
   * @returns {{changed:boolean, state:Object, cost:number, reason:string}}
   */
  AbilityOptimizer.prototype.optimize = function (ability) {
    var best = null;
    var bestCost = Infinity;

    for (var i = 0; i < FONT_SCALES.length; i++) {
      for (var j = 0; j < TARGET_SCALES.length; j++) {
        for (var k = 0; k < SPACINGS.length; k++) {
          var cand = {
            fontScale: FONT_SCALES[i],
            targetScale: TARGET_SCALES[j],
            spacing: SPACINGS[k]
          };
          var c = this.cost(cand, ability);
          if (c < bestCost) { bestCost = c; best = cand; }
        }
      }
    }

    var currentCost = this.cost(this.state, ability);
    var improvement = (currentCost - bestCost) / (currentCost || 1);
    var same =
      best.fontScale === this.state.fontScale &&
      best.targetScale === this.state.targetScale &&
      best.spacing === this.state.spacing;

    if (same || improvement < this.hysteresis) {
      return {
        changed: false,
        state: this.state,
        cost: currentCost,
        reason: same
          ? 'Current presentation is already optimal.'
          : 'Predicted gain (' + (improvement * 100).toFixed(1) +
            '%) below the ' + (this.hysteresis * 100) + '% stability threshold.'
      };
    }

    var previous = this.state;
    this.state = best;
    this.lastCost = bestCost;
    var reason =
      'Expected interaction cost drops ' + (improvement * 100).toFixed(1) +
      '% (' + currentCost.toFixed(3) + 's → ' + bestCost.toFixed(3) + 's) ' +
      'given a measured miss rate of ' + (ability.missRate * 100).toFixed(0) + '%.';

    this.changeLog.push({ t: Date.now(), from: previous, to: best, reason: reason });
    if (this.changeLog.length > 50) this.changeLog.shift();

    return { changed: true, state: best, cost: bestCost, reason: reason };
  };

  AbilityOptimizer.prototype.toJSON = function () {
    return { state: this.state, changeLog: this.changeLog };
  };
  AbilityOptimizer.prototype.fromJSON = function (o) {
    if (o && o.state) this.state = o.state;
    if (o && o.changeLog) this.changeLog = o.changeLog;
  };

  global.AdaptiveUI = global.AdaptiveUI || {};
  global.AdaptiveUI.AbilityOptimizer = AbilityOptimizer;
  global.AdaptiveUI._fittsMT = fittsMT;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AdaptiveUI;
}
