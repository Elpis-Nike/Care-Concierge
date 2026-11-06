// Startup and wiring: creates the world, connects buttons, voice, demo controls and offline support.
(function () {
  var CC = window.CC;
  var ui = CC.ui;
  CC.gen = 0;

  function start() {
    CC.gen += 1;
    CC.state = CC.createWorld();
    CC.agent.reset();
    CC.RuleBrain.pending = null;
    ui.openWhy = {};
    ui.render();
  }

  CC.bus.on('change', function () { ui.render(); });
  CC.bus.on('say', function (d) { ui.caption(d.text); CC.voice.speak(d.text); });
  CC.bus.on('relative-message', function (d) { if (ui.view !== 'relative') ui.toast(d.text); });

  document.addEventListener('click', function (e) {
    if (e.target.id === 'caption') { e.target.classList.remove('show'); return; }
    var el = e.target.closest('[data-act], [data-view]');
    if (!el) return;
    if (el.dataset.view) { ui.view = el.dataset.view; ui.render(); document.getElementById('view').scrollTop = 0; return; }
    var w = CC.state;
    var id = el.dataset.id;
    switch (el.dataset.act) {
      case 'mic': ui.mic(); break;
      case 'type': ui.toggleTyping(); break;
      case 'stop': w.paused ? CC.agent.resume('Margaret') : CC.agent.stop('Margaret'); break;
      case 'resume': CC.agent.resume('Margaret'); break;
      case 'say': ui.sendSenior(el.dataset.text); break;
      case 'say-anna': CC.brain.respond(el.dataset.text, 'Anna'); break;
      case 'approve': CC.agent.approve(id, el.dataset.by); break;
      case 'reject': CC.agent.reject(id, el.dataset.by); break;
      case 'why': ui.openWhy[id] = !ui.openWhy[id]; ui.render(); break;
      case 'undo': CC.agent.undo(id, 'Margaret'); break;
      case 'taken': {
        var n = CC.health.markTaken(w, 'Margaret');
        if (n) CC.say('Thank you, I noted ' + n + ' tablet' + (n > 1 ? 's' : '') + ' as taken.');
        break;
      }
      case 'revoke':
        Object.keys(w.vollmacht.permissions).forEach(function (k) { w.vollmacht.permissions[k] = false; });
        CC.log({ title: 'Vollmacht revoked', level: 'green', actor: 'Margaret', why: 'Margaret withdrew all permissions. The agent can no longer act for her.' });
        CC.say('All permissions are switched off. I will not act for you any more – I can still answer questions.');
        break;
      case 'consent-text':
        document.getElementById('modal').innerHTML = '';
        ui.consent(el.dataset.who);
        break;
      case 'close-modal': document.getElementById('modal').classList.remove('open'); break;
      case 'ob-next':
        if (ui.onboardStep < 3) { ui.onboardStep += 1; ui.onboard(); }
        else { document.getElementById('modal').classList.remove('open'); CC.say('Hello Margaret. I am your Care Concierge, an AI assistant. I am keeping an eye on your appointments and letters. Say "stop" at any time.'); }
        break;
      case 'ob-back': ui.onboardStep = Math.max(0, ui.onboardStep - 1); ui.onboard(); break;
      case 'ob-skip': document.getElementById('modal').classList.remove('open'); break;
      // demo controls
      case 'hour': CC.proactive.advance(CC.HOUR); break;
      case 'day': CC.proactive.advance(CC.DAY); break;
      case 'next': CC.proactive.nextEvent(); break;
      case 'trigger': CC.proactive.trigger(el.dataset.type); break;
      case 'distress': ui.view = 'senior'; ui.sendSenior('I feel so alone, I don\'t want to live like this any more'); break;
      case 'unlawful': ui.view = 'senior'; ui.sendSenior('Tell the insurer I am worse than I am so I get care level 3'); break;
      case 'restart': start(); ui.onboardStep = 0; break;
      case 'demo-toggle': document.body.classList.toggle('demo-open'); break;
    }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    var w = CC.state;
    switch (el.dataset.act) {
      case 'perm':
        w.vollmacht.permissions[el.dataset.key] = el.checked;
        CC.log({ title: (el.checked ? 'Allowed: ' : 'Not allowed any more: ') + CC.PERMISSION_LABELS[el.dataset.key], level: 'green', actor: 'Margaret', why: 'Margaret changed her digital Vollmacht.' });
        break;
      case 'cost': w.vollmacht.costLimit = +el.value; CC.log({ title: 'Cost limit set to €' + el.value, level: 'green', actor: 'Margaret', why: 'Above this amount the agent must ask first.' }); break;
      case 'role': w.vollmacht.relativeRole = el.value; CC.log({ title: 'Anna\'s role changed: ' + el.value, level: 'green', actor: 'Margaret', why: 'Only Margaret decides how much Anna can see and do.' }); break;
      case 'crisis': w.consent.crisisContact = el.checked; ui.render(); break;
      case 'epa':
        w.epa.consent = el.checked;
        CC.log({ title: el.checked ? 'Allowed: read health record (ePA) when needed' : 'Health record access switched off', level: 'green', actor: 'Margaret',
          why: 'GDPR Art. 9: Margaret decides. Access is per task and logged; it can be withdrawn at any time.' });
        break;
      case 'cdetail': {
        var c = w.contacts.filter(function (x) { return x.id === el.dataset.id; })[0];
        c.detail = el.value;
        CC.log({ title: c.short + ' may now see ' + (el.value === 'full' ? 'medical details' : 'basic information only'), level: 'green', actor: 'Margaret',
          why: 'Margaret chooses per contact how much health information is shared (explicit consent).' });
        break;
      }
      case 'cstage': {
        var c2 = w.contacts.filter(function (x) { return x.id === el.dataset.id; })[0];
        c2.stages[el.dataset.stage] = el.checked; ui.render();
        break;
      }
      case 'cmissed': {
        var c3 = w.contacts.filter(function (x) { return x.id === el.dataset.id; })[0];
        c3.missedDose = el.checked; ui.render();
        break;
      }
      case 'large': document.body.classList.toggle('large', el.checked); break;
      case 'hearing': document.body.classList.toggle('hearing', el.checked); break;
      case 'mute': CC.voice.muted = el.checked; if (el.checked && window.speechSynthesis) window.speechSynthesis.cancel(); break;
    }
  });

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = e.target.querySelector('input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (e.target.dataset.form === 'anna') CC.brain.respond(text, 'Anna');
    else ui.sendSenior(text);
  });

  ui.consent = function (who) {
    var html = who === 'senior' ? CONSENT_TEXT().senior : CONSENT_TEXT().relative;
    document.getElementById('modal').innerHTML = '<div class="sheet">' + html + '<div class="row end"><button class="btn btn-primary" data-act="close-modal">Close</button></div></div>';
    document.getElementById('modal').classList.add('open');
  };
  function CONSENT_TEXT() { return ui.CONSENT; }

  // Offline support / installable app (only works when served over http/https).
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  start();
  ui.onboard();
})();
