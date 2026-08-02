/* =========================================================================
 * naivebayes.js — multinomial Naive Bayes next-action predictor
 * -------------------------------------------------------------------------
 * Predicts which workspace panel the user will open next, conditioned on a
 * small set of discrete contextual features:
 *
 *   timeBucket   : 'morning' | 'afternoon' | 'evening' | 'night'
 *   lastAction   : id of the previously opened panel
 *   persona      : cluster id from kmeans.js
 *   sessionPhase : 'start' | 'mid' | 'late'
 *
 * The prediction drives navigation-menu reordering: the most probable
 * destinations float to the top of the sidebar. Laplace (add-one) smoothing
 * keeps unseen feature/class pairs from zeroing out the whole product, and
 * log-space accumulation avoids floating-point underflow.
 *
 * Naive Bayes is deliberately chosen over a heavier model: it trains
 * incrementally from a handful of observations, which matches the cold-start
 * reality of a single-user adaptive interface.
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  function NaiveBayes(classes) {
    this.classes = classes.slice();
    this.classCounts = {};
    this.featureCounts = {};   // feature -> value -> class -> count
    this.featureValues = {};   // feature -> Set-like map of observed values
    this.total = 0;

    var self = this;
    this.classes.forEach(function (c) { self.classCounts[c] = 0; });
  }

  NaiveBayes.prototype.addClass = function (c) {
    if (this.classes.indexOf(c) === -1) {
      this.classes.push(c);
      this.classCounts[c] = 0;
    }
  };

  /**
   * Train on one observation.
   * @param {Object} features - flat map of featureName -> discrete value
   * @param {string} label    - the observed class (panel actually opened)
   */
  NaiveBayes.prototype.train = function (features, label) {
    this.addClass(label);
    this.classCounts[label] += 1;
    this.total += 1;

    for (var f in features) {
      if (!Object.prototype.hasOwnProperty.call(features, f)) continue;
      var v = String(features[f]);
      if (!this.featureCounts[f]) this.featureCounts[f] = {};
      if (!this.featureValues[f]) this.featureValues[f] = {};
      this.featureValues[f][v] = true;
      if (!this.featureCounts[f][v]) this.featureCounts[f][v] = {};
      var bucket = this.featureCounts[f][v];
      bucket[label] = (bucket[label] || 0) + 1;
    }
  };

  /**
   * Score every class for a given context.
   * @returns {Array<{label:string, logProb:number, prob:number}>} sorted desc
   */
  NaiveBayes.prototype.predict = function (features) {
    var self = this;
    var scores = this.classes.map(function (c) {
      // Laplace-smoothed prior
      var logp = Math.log(
        (self.classCounts[c] + 1) / (self.total + self.classes.length)
      );

      for (var f in features) {
        if (!Object.prototype.hasOwnProperty.call(features, f)) continue;
        var v = String(features[f]);
        // Vocabulary size includes a reserved slot for values never yet
        // observed. Without it, a single unseen value (e.g. a persona the
        // predictor has not encountered) contributes log(1/(n+1)) to every
        // class *except* the well-evidenced ones, which cancels the prior
        // and flattens the posterior to uniform. Reserving the extra slot
        // keeps an unseen value merely uninformative rather than
        // actively destructive.
        var vocab = (self.featureValues[f]
          ? Object.keys(self.featureValues[f]).length
          : 0) + 1;
        var countFVC =
          (self.featureCounts[f] &&
            self.featureCounts[f][v] &&
            self.featureCounts[f][v][c]) || 0;
        var countC = self.classCounts[c] || 0;
        logp += Math.log((countFVC + 1) / (countC + vocab));
      }
      return { label: c, logProb: logp };
    });

    // Normalise out of log space with the log-sum-exp trick.
    var max = scores.reduce(function (m, s) {
      return s.logProb > m ? s.logProb : m;
    }, -Infinity);
    var sumExp = scores.reduce(function (a, s) {
      return a + Math.exp(s.logProb - max);
    }, 0);
    scores.forEach(function (s) {
      s.prob = Math.exp(s.logProb - max) / sumExp;
    });

    return scores.sort(function (a, b) { return b.prob - a.prob; });
  };

  /** Convenience: ranked list of class labels, most likely first. */
  NaiveBayes.prototype.rank = function (features) {
    return this.predict(features).map(function (s) { return s.label; });
  };

  /** How much evidence has been seen — used to gate premature adaptation. */
  NaiveBayes.prototype.observations = function () { return this.total; };

  NaiveBayes.prototype.toJSON = function () {
    return {
      classes: this.classes,
      classCounts: this.classCounts,
      featureCounts: this.featureCounts,
      featureValues: this.featureValues,
      total: this.total
    };
  };
  NaiveBayes.prototype.fromJSON = function (o) {
    if (!o) return;
    this.classes = o.classes || this.classes;
    this.classCounts = o.classCounts || this.classCounts;
    this.featureCounts = o.featureCounts || {};
    this.featureValues = o.featureValues || {};
    this.total = o.total || 0;
  };

  global.AdaptiveUI = global.AdaptiveUI || {};
  global.AdaptiveUI.NaiveBayes = NaiveBayes;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AdaptiveUI;
}
