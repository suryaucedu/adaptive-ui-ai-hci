/* =========================================================================
 * kmeans.js — online k-means clustering for behavioural persona detection
 * -------------------------------------------------------------------------
 * The telemetry layer emits a normalised feature vector describing the most
 * recent slice of interaction:
 *
 *   [0] interaction rate      clicks per minute, scaled to 0..1
 *   [1] navigation breadth    distinct panels visited / total panels
 *   [2] error rate            undo + misclick events / total actions
 *   [3] mean dwell            seconds on a panel, scaled to 0..1
 *   [4] shortcut usage        keyboard-shortcut actions / total actions
 *
 * Three centroids are seeded with hand-specified prototypes so the cluster
 * labels stay interpretable (a purely random seeding would produce clusters
 * that shift meaning between sessions, which is a known usability hazard for
 * adaptive systems — Jameson, 2008). Centroids then move toward observed
 * behaviour using an online (sequential) update rule, so the personas are
 * still learned from this specific user rather than hard-coded.
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  var PROTOTYPES = [
    {
      id: 'focused',
      label: 'Focused Specialist',
      // low breadth, low errors, long dwell, growing shortcut use
      centroid: [0.45, 0.20, 0.05, 0.75, 0.55],
      description: 'Works deeply in a small number of panels with few errors.'
    },
    {
      id: 'explorer',
      label: 'Broad Explorer',
      // high breadth, high click rate, short dwell
      centroid: [0.80, 0.85, 0.15, 0.25, 0.20],
      description: 'Moves quickly across many panels, sampling features.'
    },
    {
      id: 'struggling',
      label: 'Effortful Novice',
      // high error rate, low shortcut use, medium dwell
      centroid: [0.35, 0.45, 0.60, 0.55, 0.02],
      description: 'Frequent corrections and undos; relies on visible labels.'
    }
  ];

  function euclidean(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) {
      var d = a[i] - b[i];
      s += d * d;
    }
    return Math.sqrt(s);
  }

  /**
   * @constructor
   * @param {number} [learningRate] - how fast centroids drift toward new data
   */
  function OnlineKMeans(learningRate) {
    this.lr = typeof learningRate === 'number' ? learningRate : 0.08;
    this.clusters = PROTOTYPES.map(function (p) {
      return {
        id: p.id,
        label: p.label,
        description: p.description,
        centroid: p.centroid.slice(),
        count: 0
      };
    });
    this.history = [];
  }

  /**
   * Assign a feature vector to the nearest cluster without learning from it.
   * @returns {{id:string,label:string,distance:number,confidence:number}}
   */
  OnlineKMeans.prototype.predict = function (vector) {
    var distances = this.clusters.map(function (c) {
      return euclidean(vector, c.centroid);
    });
    var bestIdx = 0;
    for (var i = 1; i < distances.length; i++) {
      if (distances[i] < distances[bestIdx]) bestIdx = i;
    }
    // Convert distances to a softmax-style confidence so the explainability
    // panel can show "how sure" the system is about the persona.
    var inv = distances.map(function (d) { return 1 / (d + 1e-6); });
    var total = inv.reduce(function (a, b) { return a + b; }, 0);

    return {
      index: bestIdx,
      id: this.clusters[bestIdx].id,
      label: this.clusters[bestIdx].label,
      description: this.clusters[bestIdx].description,
      distance: distances[bestIdx],
      confidence: inv[bestIdx] / total,
      allDistances: distances
    };
  };

  /**
   * Assign the vector AND nudge the winning centroid toward it
   * (competitive learning / "winner-take-all" online k-means).
   */
  OnlineKMeans.prototype.learn = function (vector) {
    var result = this.predict(vector);
    var c = this.clusters[result.index];
    for (var i = 0; i < c.centroid.length; i++) {
      c.centroid[i] += this.lr * (vector[i] - c.centroid[i]);
    }
    c.count += 1;
    this.history.push({ vector: vector.slice(), cluster: c.id, t: Date.now() });
    if (this.history.length > 200) this.history.shift();
    return result;
  };

  OnlineKMeans.prototype.report = function () {
    return this.clusters.map(function (c) {
      return {
        id: c.id,
        label: c.label,
        count: c.count,
        centroid: c.centroid.map(function (v) { return Math.round(v * 100) / 100; })
      };
    });
  };

  OnlineKMeans.prototype.toJSON = function () {
    return { lr: this.lr, clusters: this.clusters };
  };
  OnlineKMeans.prototype.fromJSON = function (obj) {
    if (obj && obj.clusters) {
      this.clusters = obj.clusters;
      this.lr = obj.lr || this.lr;
    }
  };

  global.AdaptiveUI = global.AdaptiveUI || {};
  global.AdaptiveUI.OnlineKMeans = OnlineKMeans;
  global.AdaptiveUI.FEATURE_NAMES = [
    'interaction rate', 'navigation breadth', 'error rate',
    'mean dwell', 'shortcut usage'
  ];
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AdaptiveUI;
}
