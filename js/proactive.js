// Proactive engine: watches the simulated world as time passes and lets the agent act
// without being asked (letters arriving, rides missing, reminders due, practice cancellations).
(function () {
  var CC = window.CC;

  function hourCheck(w) {
    var plans = [];

    // 1. Scheduled world events (e.g. a referral letter arrives).
    w.timeline.forEach(function (evt) {
      if (!evt.fired && evt.time <= w.now) {
        evt.fired = true;
        var p = CC.brain.planForEvent(evt, w);
        if (p) plans.push(p);
      }
    });

    var hour = new Date(w.now).getHours();
    w.appointments.forEach(function (a) {
      if (a.status !== 'booked' || a.time <= w.now) return;
      var until = a.time - w.now;

      // 2. Appointment tomorrow, far away, no ride → arrange one (checked from 17:00 the day before).
      var practice = CC.practices[a.practiceId];
      if (until <= 24 * CC.HOUR && hour >= 17 && !a.transportId && practice.distanceKm >= 2 && !w.senior.hasCar && !w.fired['tr:' + a.id]) {
        w.fired['tr:' + a.id] = true;
        CC.log({ title: 'Noticed: no ride for tomorrow', summary: a.title + ' at ' + practice.name + ', ' + CC.fmt.short(a.time), level: 'green',
          why: 'Proactive check every evening: appointments tomorrow need a way to get there.' });
        plans.push(CC.brain.planForEvent({ type: 'needs_transport', appt: a }, w));
      }

      // 3. Evening reminder the day before (18:00).
      if (until <= 24 * CC.HOUR && hour >= 18 && !w.fired['rem:' + a.id]) {
        w.fired['rem:' + a.id] = true;
        var tr = w.transports.filter(function (t) { return t.id === a.transportId && t.status === 'booked'; })[0];
        plans.push({
          id: CC.uid('plan'), title: 'Reminder for ' + a.title,
          steps: [{ action: 'remind', tool: 'say_reminder', label: 'Evening reminder', why: 'Reminder the evening before, as Margaret asked.',
            args: { text: 'Good evening Margaret. Tomorrow at ' + CC.fmt.time(a.time) + ' you have your ' + a.title.toLowerCase() + ' at ' + practice.name + '.' +
              (tr ? ' The car comes at ' + CC.fmt.time(tr.pickup) + '.' : '') + ' Please take your insurance card' + (a.referralNo ? ' and the referral' : '') + '.' +
              (a.prep ? ' Important for the ' + a.title.toLowerCase() + ': ' + a.prep : '') } }]
        });
        plans.push(CC.plans.notifyStage(w, a, 'before'));
      }

      // 4. Morning reminder on the day itself (07:00).
      if (hour >= 7 && new Date(a.time).toDateString() === new Date(w.now).toDateString() && !w.fired['morn:' + a.id]) {
        w.fired['morn:' + a.id] = true;
        var tr2 = w.transports.filter(function (t) { return t.id === a.transportId && t.status === 'booked'; })[0];
        plans.push({
          id: CC.uid('plan'), title: 'Morning reminder for ' + a.title,
          steps: [{ action: 'remind', tool: 'say_reminder', label: 'Morning reminder', why: 'Reminder on the day of the appointment.',
            args: { text: 'Good morning Margaret. Today at ' + CC.fmt.time(a.time) + ': ' + a.title.toLowerCase() + ' at ' + practice.name + '.' +
              (tr2 ? ' The car comes at ' + CC.fmt.time(tr2.pickup) + '.' : '') + (a.prep ? ' Remember: ' + a.prep : '') } }]
        });
      }
    });

    // 5. During / after an appointment → tell the chosen contacts; after → the practice report arrives in the ePA.
    w.appointments.forEach(function (a) {
      if (a.status !== 'booked') return;
      if (w.now >= a.time && w.now < a.time + CC.HOUR && !w.fired['during:' + a.id]) {
        w.fired['during:' + a.id] = true;
        plans.push(CC.plans.notifyStage(w, a, 'during'));
      }
      if (w.now >= a.time + 90 * CC.MIN && !w.fired['after:' + a.id]) {
        w.fired['after:' + a.id] = true;
        w.fired['during:' + a.id] = true;
        a.done = true;
        w.epa.docs.push({ id: CC.uid('e'), date: w.now, from: CC.practices[a.practiceId].name, type: 'Practice report',
          title: a.title, summary: a.title + ' done. ' + (a.kind === 'procedure' ? 'Results will follow in a few days.' : 'Findings discussed with Margaret; next steps in the doctor\'s letter.') });
        plans.push(CC.plans.notifyStage(w, a, 'after'));
      }
    });

    // 6. Medication: reminders at the prescribed times, second reminder after 1 h, "missed" after 2 h.
    var newDoses = CC.health.createDoses(w, w.now);
    if (newDoses.length) plans.push(CC.plans.medReminder(w, newDoses, false));
    var second = [], missed = [];
    CC.health.openDoses(w).forEach(function (d) {
      var elapsed = w.now - d.time;
      if (d.status === 'reminded' && elapsed >= 2 * CC.HOUR) { d.status = 'missed'; missed.push(d); }
      else if (d.status === 'due' && elapsed >= CC.HOUR) { d.status = 'reminded'; second.push(d); }
    });
    if (second.length) plans.push(CC.plans.medReminder(w, second, true));
    if (missed.length) {
      CC.log({ title: 'Medication not confirmed', summary: CC.health.describe(w, missed), level: 'green',
        why: 'Two reminders without a confirmation – recorded as not confirmed (never as taken).' });
      plans.push(CC.plans.missedDose(w, missed));
    }

    // 7. Repeat prescription when 5 or fewer tablets are left (checked at 10:00).
    if (hour === 10) {
      w.medPlan.forEach(function (m) {
        if (m.stock <= 5 && !m.rxRequested) plans.push(CC.plans.repeatPrescription(w, m, 'Only ' + m.stock + ' tablets left – a new prescription takes a few days.'));
      });
    }

    plans.forEach(function (p) { CC.agent.enqueue(p); });
    return plans.length;
  }

  CC.proactive = {
    // Fast-forward the simulated clock hour by hour so events fire in the right order.
    advance: function (ms) {
      var w = CC.state;
      var steps = Math.max(1, Math.round(ms / CC.HOUR));
      for (var i = 0; i < steps; i++) {
        w.now += CC.HOUR;
        hourCheck(w);
      }
      CC.bus.emit('change');
    },

    // Jump to the next thing that will happen.
    nextEvent: function () {
      var w = CC.state;
      var upcoming = w.timeline.filter(function (e) { return !e.fired; }).map(function (e) { return e.time; })
        .concat(w.appointments.filter(function (a) { return a.status === 'booked' && a.time > w.now; }).map(function (a) {
          var eve = new Date(a.time); eve.setDate(eve.getDate() - 1); eve.setHours(18, 0, 0, 0); return eve.getTime();
        }))
        .filter(function (t) { return t > w.now; })
        .sort(function (a, b) { return a - b; });
      var target = upcoming[0] || (w.now + CC.DAY);
      CC.proactive.advance(target - w.now);
    },

    check: function () { return hourCheck(CC.state); },

    // Demo triggers so the jury can see each behaviour on demand.
    trigger: function (type) {
      var w = CC.state;
      if (type === 'referral') {
        var evt = w.timeline.filter(function (e) { return e.type === 'referral_received' && !e.fired; })[0];
        if (!evt) { CC.say('The referral letter has already arrived.'); return; }
        evt.time = w.now;
        hourCheck(w);
      } else if (type === 'practice_cancelled') {
        var appt = w.appointments.filter(function (a) { return a.status === 'booked' && a.time > w.now; }).sort(function (a, b) { return a.time - b.time; })[0];
        if (!appt) { CC.say('There is no upcoming appointment that could be cancelled.'); return; }
        CC.agent.enqueue(CC.brain.planForEvent({ type: 'practice_cancelled', appt: appt }, w));
      } else if (type === 'treatment_start') {
        var start = CC.at(w.now, 14, 9, 0);
        CC.agent.enqueue(CC.brain.planForEvent({
          type: 'treatment_start', treatment: 'chemotherapy',
          text: 'Chemotherapy starts on ' + CC.fmt.day(start) + ': 6 sessions, every 3 weeks, at the oncology day clinic.'
        }, w));
      } else if (type === 'dose') {
        // Demo: the morning tablets are due right now (if tablets are already open, just remind again – never duplicate).
        var already = CC.health.openDoses(w);
        if (already.length) { CC.agent.enqueue(CC.plans.medReminder(w, already, true)); CC.bus.emit('change'); return; }
        var doses = w.medPlan.filter(function (m) { return m.times.indexOf(8) >= 0; }).map(function (m) {
          var d = { id: CC.uid('dose'), medId: m.id, time: w.now, status: 'due', reminders: 0 };
          w.doses.push(d);
          return d;
        });
        CC.agent.enqueue(CC.plans.medReminder(w, doses, false));
      } else if (type === 'missed') {
        // Demo: open doses (or a fresh set) go unconfirmed for two hours.
        if (!CC.health.openDoses(w).length) CC.proactive.trigger('dose');
        CC.health.openDoses(w).forEach(function (d) { d.time = w.now - 2 * CC.HOUR; d.status = 'reminded'; });
        hourCheck(w);
      } else if (type === 'procedure') {
        // Demo: jump to the evening before the next procedure (reminder with preparation + "before" notice).
        var pr = w.appointments.filter(function (a) { return a.kind === 'procedure' && a.status === 'booked' && a.time > w.now; })[0];
        if (!pr) { CC.say('No procedure is planned.'); return; }
        var eve = new Date(pr.time); eve.setDate(eve.getDate() - 1); eve.setHours(18, 0, 0, 0);
        if (eve.getTime() > w.now) CC.proactive.advance(eve.getTime() - w.now);
      } else if (type === 'apptday') {
        // Demo: live through the next appointment (morning reminder → during → after, with contact notifications).
        var nx = w.appointments.filter(function (a) { return a.status === 'booked' && !a.done && a.time > w.now; })
          .sort(function (a, b) { return a.time - b.time; })[0];
        if (!nx) { CC.say('No upcoming appointment.'); return; }
        CC.proactive.advance(nx.time + 2 * CC.HOUR - w.now);
      }
      CC.bus.emit('change');
    }
  };
})();
