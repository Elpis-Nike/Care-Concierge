// Voice in/out using the browser's built-in speech services (Chrome on Android supports both).
// Falls back to typing when speech recognition is unavailable.
(function () {
  var CC = window.CC;
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

  CC.voice = {
    canListen: !!Rec,
    canSpeak: 'speechSynthesis' in window,
    muted: false,
    listening: false,

    listen: function (onText, onState) {
      if (!Rec) { onState && onState('unsupported'); return; }
      var r = new Rec();
      r.lang = CC.config.lang;
      r.interimResults = true;
      r.maxAlternatives = 1;
      var finalText = '';
      CC.voice.listening = true;
      onState && onState('listening');
      r.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        onState && onState('hearing', finalText || interim);
      };
      r.onerror = function (e) { CC.voice.listening = false; onState && onState('error', e.error); };
      r.onend = function () {
        CC.voice.listening = false;
        onState && onState('idle');
        if (finalText.trim()) onText(finalText.trim());
      };
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      r.start();
      CC.voice._rec = r;
    },

    stopListening: function () { if (CC.voice._rec) CC.voice._rec.stop(); },

    speak: function (text) {
      if (!CC.voice.canSpeak || CC.voice.muted) return;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = CC.config.lang;
      u.rate = CC.config.speechRate;
      var voices = window.speechSynthesis.getVoices();
      var v = voices.filter(function (x) { return x.lang === CC.config.lang; })[0] ||
              voices.filter(function (x) { return x.lang && x.lang.indexOf('en') === 0; })[0];
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    }
  };
})();
