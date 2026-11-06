// Core helpers shared by all modules: namespace, event bus, ids, time formatting.
(function () {
  var CC = (window.CC = window.CC || {});

  CC.config = {
    stepDelay: 900, // ms between agent steps, so viewers can follow the agent at work
    lang: 'en-GB',
    speechRate: 0.92
  };

  CC.MIN = 60 * 1000;
  CC.HOUR = 60 * CC.MIN;
  CC.DAY = 24 * CC.HOUR;

  // Tiny publish/subscribe bus: logic modules emit, the UI listens.
  var handlers = {};
  CC.bus = {
    on: function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
    emit: function (evt, data) {
      (handlers[evt] || []).forEach(function (fn) { fn(data); });
      (handlers['*'] || []).forEach(function (fn) { fn(evt, data); });
    },
    reset: function () { handlers = {}; }
  };

  var counter = 0;
  CC.uid = function (prefix) { counter += 1; return (prefix || 'id') + '-' + counter; };

  // Timestamp for a day offset and clock time relative to a base timestamp.
  CC.at = function (base, dayOffset, hour, minute) {
    var d = new Date(base);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute || 0, 0, 0);
    return d.getTime();
  };

  CC.fmt = {
    time: function (t) {
      return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    },
    day: function (t) {
      return new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    },
    short: function (t) {
      return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
        ', ' + CC.fmt.time(t);
    },
    spoken: function (t) {
      return new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) +
        ' at ' + CC.fmt.time(t);
    },
    euro: function (n) { return '€' + n.toFixed(2); }
  };

  CC.wait = function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };
})();
