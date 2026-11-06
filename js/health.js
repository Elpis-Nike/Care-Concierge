// Health functions: medication reminders and dose log (strictly as prescribed), repeat prescriptions,
// health record (ePA) reading with consent, and notifications to chosen contacts (before / during / after).
// The agent never changes a dose, never diagnoses and never triages.
(function () {
  var CC = window.CC;

  function med(w, id) { return w.medPlan.filter(function (m) { return m.id === id; })[0]; }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function hourOf(t) { return new Date(t).getHours(); }

  CC.health = {
    med: med,

    // Doses still open (due or already reminded once).
    openDoses: function (w) { return w.doses.filter(function (d) { return d.status === 'due' || d.status === 'reminded'; }); },

    describe: function (w, doses) {
      return doses.map(function (d) { var m = med(w, d.medId); return m.drug + ' ' + m.strength + ' (' + m.dose + ')'; }).join(', ');
    },

    // Creates today's doses for the medications scheduled at this hour (once per day and hour).
    createDoses: function (w, t, hour) {
      var h = hour === undefined ? hourOf(t) : hour;
      var key = 'dose:' + dayKey(t) + '|' + h;
      if (w.fired[key]) return [];
      w.fired[key] = true;
      return w.medPlan.filter(function (m) { return m.times.indexOf(h) >= 0; }).map(function (m) {
        var d = { id: CC.uid('dose'), medId: m.id, time: CC.at(t, 0, h, 0), status: 'due', reminders: 0 };
        w.doses.push(d);
        return d;
      });
    },

    // Margaret confirms: every open dose is recorded as taken (stock goes down).
    markTaken: function (w, by) {
      var open = CC.health.openDoses(w);
      if (!open.length) return 0;
      var decision = CC.policy.evaluate(w, 'log_dose', {});
      if (!decision.allowed) { CC.say('I cannot record that right now: ' + decision.reason); return 0; }
      open.forEach(function (d) {
        d.status = 'taken'; d.at = w.now;
        var m = med(w, d.medId); m.stock = Math.max(0, m.stock - 1);
      });
      CC.log({ title: 'Recorded: medication taken', level: 'green', actor: by || 'Margaret',
        summary: CC.health.describe(w, open), why: 'Dose log – exactly as prescribed in the medication plan.' });
      CC.bus.emit('change');
      return open.length;
    },

    readEpa: function (w, purpose) {
      var decision = CC.policy.evaluate(w, 'read_health_record', {});
      if (!decision.allowed) {
        CC.log({ title: 'Blocked: read health record', level: 'green', blocked: true, why: decision.reason });
        CC.say('I am not allowed to open your health record. You can allow it under Health, and switch it off again at any time.');
        return null;
      }
      var doc = w.epa.docs.slice().sort(function (a, b) { return b.date - a.date; })[0];
      w.epa.accessLog.unshift({ time: w.now, doc: doc.title, purpose: purpose });
      CC.log({ title: 'Read health record (ePA): ' + doc.title, level: 'green', summary: 'Only this document, for: ' + purpose,
        why: 'Margaret asked. Access only with her consent, per task, logged – no copy of her medical history is kept.' });
      CC.say('The latest entry is a ' + doc.type.toLowerCase() + ' from ' + doc.from + ' (' + CC.fmt.day(doc.date) + '): ' + doc.summary +
        ' If you have questions about it, I can send them to the practice.');
      return doc;
    }
  };

  // ---------- tools (each call has already passed the policy engine) ----------
  CC.tools.notify_contacts = function (w, a) {
    var sent = [];
    w.contacts.forEach(function (c) {
      if (a.to && c.id !== a.to) return;
      var wants = a.to ? true : a.emergency ? c.emergency : (a.stage === 'missed' ? c.missedDose : c.stages[a.stage]);
      if (!wants) return;
      if (c.id === 'anna' && (!w.consent.relative || w.vollmacht.relativeRole === 'none')) return;
      var withDetail = c.detail === 'full' && a.detail;
      var text = a.basic + (withDetail ? ' ' + a.detail : '');
      w.messages.unshift({ id: CC.uid('msg'), time: w.now, text: text, level: a.level || 'green', to: c.id, stage: a.stage });
      if (c.id === 'anna') CC.bus.emit('relative-message', { text: text });
      sent.push(c.short + (withDetail ? ' (with medical details – allowed by Margaret)' : ' (basic info only)'));
    });
    CC.bus.emit('change');
    return { data: sent, summary: sent.length ? 'Notified ' + sent.join(', ') + '.' : 'No contact asked for this update.' };
  };

  CC.tools.request_prescription = function (w, a) {
    var m = med(w, a.medId);
    m.rxRequested = true;
    var req = { id: CC.uid('rx'), medId: m.id, time: w.now, to: m.prescribedBy, status: 'requested' };
    w.rxRequests.push(req);
    return {
      data: req,
      summary: 'Asked ' + m.prescribedBy + ' for a repeat e-prescription of ' + m.drug + ' ' + m.strength + ' (' + m.stock +
        ' tablets left), via the practice\'s secure messaging. The e-prescription can be collected at the pharmacy with the health card.'
    };
  };

  CC.tools.message_practice = function (w, a) {
    return { data: true, summary: 'Sent Margaret\'s question to ' + a.to + ': "' + a.text + '". A doctor will answer – the agent gives no medical advice.' };
  };

  // ---------- plan templates ----------
  CC.plans.medReminder = function (w, doses, second) {
    var list = CC.health.describe(w, doses);
    var hour = CC.fmt.time(doses[0].time);
    return {
      id: CC.uid('plan'), title: 'Medication reminder ' + hour,
      steps: [{ action: 'med_reminder', tool: 'say_reminder', label: second ? 'Second medication reminder' : 'Medication reminder',
        why: 'Medication plan from ' + w.medPlan[0].prescribedBy + ': doses at ' + hour + '. The agent reminds – it never changes a dose.',
        args: { text: (second ? 'Margaret, I have not heard yet – did you take your ' + hour + ' tablets? ' : 'It is ' + hour + ' – time for your tablets: ') +
          list + '. Say "taken" when you are done.' } }]
    };
  };

  CC.plans.missedDose = function (w, doses) {
    return {
      id: CC.uid('plan'), title: 'Missed medication',
      steps: [{ action: 'notify_contact', tool: 'notify_contacts', label: 'Tell the contacts who asked about missed doses',
        why: 'Two reminders without confirmation. Margaret chose who is told about missed doses.',
        args: { stage: 'missed', level: 'yellow', basic: 'Margaret has not confirmed her ' + CC.fmt.time(doses[0].time) + ' medication.',
          detail: '(' + CC.health.describe(w, doses) + ') A short call may help.' } }],
      onDone: function () { CC.say('I have noted the ' + CC.fmt.time(doses[0].time) + ' tablets as not confirmed. If you take them now, just say "taken". Do not take a double dose later – if unsure, ask your doctor or pharmacist.'); }
    };
  };

  CC.plans.repeatPrescription = function (w, m, why) {
    return {
      id: CC.uid('plan'), title: 'Repeat prescription for ' + m.drug,
      steps: [
        { action: 'request_prescription', tool: 'request_prescription', label: 'Ask for a repeat prescription of ' + m.drug, why: why,
          approvalText: function () { return 'Ask ' + m.prescribedBy + ' for a repeat prescription of ' + m.drug + ' ' + m.strength + '.'; },
          args: { medId: m.id } },
        { action: 'notify_relative', tool: 'notify_relative', label: 'Update Anna', why: 'New request sent (yellow).',
          args: { level: 'yellow', text: 'Repeat prescription for Margaret\'s ' + m.drug + ' requested from ' + m.prescribedBy + ' (' + m.stock + ' tablets left).' } }
      ],
      onDone: function () { CC.say('You have ' + m.stock + ' ' + m.drug + ' tablets left, so I asked ' + m.prescribedBy + ' for a new prescription. You can collect it at the pharmacy with your health card.'); }
    };
  };

  CC.plans.notifyStage = function (w, appt, stage) {
    var p = CC.practices[appt.practiceId];
    var what = appt.title + ' at ' + p.name;
    var basic = {
      before: 'Tomorrow at ' + CC.fmt.time(appt.time) + ': Margaret has her ' + what + '.',
      during: 'Margaret is now at ' + p.name + ' for her ' + appt.title.toLowerCase() + '.',
      after: 'Margaret\'s ' + appt.title.toLowerCase() + ' at ' + p.name + ' is finished.'
    }[stage];
    var detail = {
      before: appt.reason ? 'Reason: ' + appt.reason + '.' + (appt.prep ? ' Preparation: ' + appt.prep : '') : '',
      during: appt.reason ? '(' + appt.reason + ')' : '',
      after: 'The practice\'s report is now in her health record (ePA); Margaret can read it to you if she likes.'
    }[stage];
    return {
      id: CC.uid('plan'), title: 'Notify contacts (' + stage + ')',
      steps: [{ action: 'notify_contact', tool: 'notify_contacts', label: 'Notify contacts – ' + stage + ' the appointment',
        why: 'Margaret chose which contacts hear about appointments before, during and after – and how much detail each may see.',
        args: { stage: stage, basic: basic, detail: detail, level: 'green' } }]
    };
  };
})();
