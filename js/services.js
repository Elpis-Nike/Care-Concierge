// Mock outside world the agent talks to: practices (one with its own AI receptionist),
// a transport service and the health/care insurer. No real systems are contacted.
(function () {
  var CC = window.CC;

  CC.practices = {
    gp: {
      id: 'gp', name: 'GP practice Dr. Yilmaz', label: 'GP', specialty: 'gp', doctors: ['Dr. Yilmaz'],
      area: 'Bielefeld-Schildesche', distanceKm: 1.2, ai: null, channel: '116117 booking interface'
    },
    cardio: {
      id: 'cardio', name: 'Herzzentrum Bielefeld-Mitte', label: 'Cardiologist', specialty: 'cardiology', doctors: ['Dr. Becker', 'Dr. Nowak'],
      area: 'Bielefeld-Mitte', distanceKm: 6.5, ai: 'Clara (the practice\'s AI receptionist)', channel: 'Practice phone line (AI receptionist)'
    },
    cardio2: {
      id: 'cardio2', name: 'Kardiologie am Siegfriedplatz', label: 'Cardiologist', specialty: 'cardiology', doctors: ['Dr. Hoffmann'],
      area: 'Bielefeld-Schildesche', distanceKm: 3.4, ai: null, channel: '116117 booking interface'
    },
    eye: {
      id: 'eye', name: 'Eye practice am Jahnplatz', label: 'Eye doctor', specialty: 'ophthalmology', doctors: ['Dr. Kaya'],
      area: 'Bielefeld-Mitte', distanceKm: 5.8, ai: null, channel: '116117 booking interface'
    },
    onco: {
      id: 'onco', name: 'Oncology day clinic, Klinikum Bielefeld', label: 'Oncology clinic', specialty: 'oncology',
      area: 'Bielefeld-Mitte', distanceKm: 7.1, ai: null, channel: 'Clinic scheduling', doctors: ['Dr. Lange']
    }
  };

  // Doctor directory lookups (in reality: the KV doctor search / 116117 directory, not "the internet").
  CC.directory = {
    bySpecialty: function (specialty) {
      return Object.keys(CC.practices).map(function (k) { return CC.practices[k]; })
        .filter(function (p) { return p.specialty === specialty; })
        .sort(function (a, b) { return a.distanceKm - b.distanceKm; });
    },
    // "Dr. Hoffmann" → { practice, doctor }
    findDoctor: function (text) {
      var t = text.toLowerCase();
      var hit = null;
      Object.keys(CC.practices).forEach(function (k) {
        (CC.practices[k].doctors || []).forEach(function (d) {
          var last = d.replace(/^dr\.?\s*/i, '').toLowerCase();
          if (!hit && new RegExp('\\b' + last + '\\b').test(t)) hit = { practice: CC.practices[k], doctor: d };
        });
      });
      return hit;
    }
  };

  CC.findPracticeBySpecialty = function (specialty) {
    var ids = Object.keys(CC.practices);
    for (var i = 0; i < ids.length; i++) {
      if (CC.practices[ids[i]].specialty === specialty) return CC.practices[ids[i]];
    }
    return CC.practices.gp;
  };

  var SLOT_TIMES = [[9, 0], [10, 30], [11, 45], [14, 0], [16, 30]];

  // Deterministic "busy" pattern so the demo always behaves the same way.
  function preBooked(practiceId, dayIndex, slotIndex) {
    if (practiceId === 'cardio' && dayIndex < 7) return true; // specialists are booked out for a week
    return ((dayIndex * 7 + slotIndex * 3 + practiceId.length) % 4) === 0;
  }

  function hasClash(world, time) {
    return world.appointments.some(function (a) {
      return a.status === 'booked' && Math.abs(a.time - time) < 3 * CC.HOUR;
    });
  }

  CC.services = {
    searchSlots: function (world, practiceId, opts) {
      opts = opts || {};
      var prefs = world.vollmacht.preferences;
      var from = opts.after || world.now;
      var results = [];
      for (var d = 1; d <= 35 && results.length < (opts.count || 3); d++) {
        var day = new Date(world.now);
        day.setDate(day.getDate() + d);
        var dow = day.getDay();
        if (dow === 0 || dow === 6) continue;
        for (var s = 0; s < SLOT_TIMES.length && results.length < (opts.count || 3); s++) {
          var h = SLOT_TIMES[s][0];
          if (h < prefs.earliestHour || h > prefs.latestHour) continue;
          var t = CC.at(world.now, d, h, SLOT_TIMES[s][1]);
          if (t <= from) continue;
          if (preBooked(practiceId, d, s)) continue;
          if (world.slotsTaken[practiceId + '|' + t]) continue;
          if (hasClash(world, t)) continue;
          results.push(t);
        }
      }
      return results;
    },

    // Books a slot. Returns the appointment and, for practices with an AI receptionist,
    // the agent-to-agent transcript (shows AI disclosure and data minimisation).
    bookAppointment: function (world, practiceId, time, details) {
      var practice = CC.practices[practiceId];
      var appt = {
        id: CC.uid('ap'), practiceId: practiceId, title: details.title || (practice.label + ' appointment'),
        time: time, status: 'booked', routine: !!details.routine, transportId: null,
        createdBy: details.createdBy || 'Concierge', referralNo: details.referralNo || null,
        reason: details.reason || null, doctor: details.doctor || null
      };
      world.appointments.push(appt);
      world.slotsTaken[practiceId + '|' + time] = appt.id;

      var transcript = null;
      if (practice.ai) {
        transcript = [
          ['Concierge', 'Hello, this is the Care Concierge, an AI assistant calling on behalf of Margaret Weber, with her written authorisation (digital Vollmacht ' + world.vollmacht.id + '). I would like to book a cardiology appointment.'],
          ['Clara (practice AI)', 'Hello. I am Clara, the practice\'s AI assistant. Please give me the patient\'s date of birth, insurer and referral.'],
          ['Concierge', 'Date of birth ' + world.senior.born + ', ' + world.senior.insurer + ', referral number ' + (details.referralNo || 'n/a') + ' from Dr. Yilmaz.'],
          ['Clara (practice AI)', 'Thank you. Can you also send her full medication list and previous diagnoses?'],
          ['Concierge', 'I can only share medical details with Mrs Weber\'s explicit approval. The referral states the reason for the visit. She can bring her medication plan to the appointment.'],
          ['Clara (practice AI)', 'Understood. I have booked ' + CC.fmt.spoken(time) + '. Please arrive 15 minutes early.'],
          ['Concierge', 'Confirmed. Please send the confirmation to Mrs Weber by letter or SMS as well. Goodbye.']
        ];
      }
      return { appointment: appt, transcript: transcript };
    },

    cancelAppointment: function (world, apptId) {
      var appt = world.appointments.filter(function (a) { return a.id === apptId; })[0];
      if (!appt || appt.status !== 'booked') return null;
      appt.status = 'cancelled';
      delete world.slotsTaken[appt.practiceId + '|' + appt.time];
      if (appt.transportId) CC.services.cancelTransport(world, appt.transportId);
      return appt;
    },

    restoreAppointment: function (world, apptId) {
      var appt = world.appointments.filter(function (a) { return a.id === apptId; })[0];
      if (!appt) return null;
      appt.status = 'booked';
      world.slotsTaken[appt.practiceId + '|' + appt.time] = appt.id;
      return appt;
    },

    // Transport: Margaret has care level 2 and no mobility marker, so statutory insurance
    // does not cover rides to routine outpatient visits (Krankentransport-Richtlinie) – it is a private ride.
    quoteTransport: function (world, appt) {
      var km = CC.practices[appt.practiceId].distanceKm;
      var price = Math.round((12 + 2.5 * km * 2) * 100) / 100;
      return {
        provider: 'CityCare Fahrdienst', vehicle: 'Car with space for a rollator, driver helps to the door',
        pickup: appt.time - 45 * CC.MIN, back: appt.time + 90 * CC.MIN, price: price,
        covered: false, coverageNote: 'Not covered by statutory insurance for a routine outpatient visit at care level 2 – private ride.'
      };
    },

    bookTransport: function (world, appt, quote) {
      var tr = {
        id: CC.uid('tr'), apptId: appt.id, provider: quote.provider, vehicle: quote.vehicle,
        pickup: quote.pickup, back: quote.back, price: quote.price, status: 'booked'
      };
      world.transports.push(tr);
      appt.transportId = tr.id;
      return tr;
    },

    cancelTransport: function (world, trId) {
      var tr = world.transports.filter(function (t) { return t.id === trId; })[0];
      if (!tr) return null;
      tr.status = 'cancelled';
      world.appointments.forEach(function (a) { if (a.transportId === trId) a.transportId = null; });
      return tr;
    }
  };

  // Proactive Document Assistant knowledge base (bonus question).
  // Simplified general rules for the demo; the final check always lies with the insurer or authority.
  CC.documentCatalog = function (world, treatment) {
    var docs = [];
    var serial = /chemo|radio|dialysis/.test(treatment);
    if (serial) {
      docs.push({
        key: 'transport', title: 'Transport prescription (Muster 4) + insurer approval',
        to: 'GP / Musterkasse', why: 'Regular trips for ' + treatment + ' can be covered by health insurance, but need a doctor\'s prescription and prior approval.',
        prefilled: ['Name, date of birth, insurance number', 'Destination: ' + CC.practices.onco.name, 'Treatment series: ' + treatment],
        missing: ['Doctor\'s signature on Muster 4']
      });
    }
    docs.push({
      key: 'copay', title: 'Co-payment exemption (Zuzahlungsbefreiung) for ' + new Date(world.now).getFullYear(),
      to: 'Musterkasse', why: 'Chronically ill patients pay at most 1 % of yearly gross income in co-payments; frequent treatment makes this worthwhile.',
      prefilled: ['Name, insurance number, address', 'Chronic illness: certificate requested from GP (Muster 55)'],
      missing: ['Pension statement for the income check', 'Receipts of co-payments so far']
    });
    docs.push({
      key: 'care', title: 'Request for a higher care level (Pflegegrad review)',
      to: 'Pflegekasse (Musterkasse)', why: 'During ' + treatment + ' the need for help may rise. The care insurer must decide within 25 working days.',
      prefilled: ['Current care level: ' + world.senior.careLevel, 'Contact person: ' + world.relative.name + ' (with Margaret\'s consent)'],
      missing: ['Margaret\'s own description of what has become harder (I can help her record it)']
    });
    if (/chemo|radio|cancer|onco/.test(treatment)) {
      docs.push({
        key: 'disability', title: 'Disability card application (Schwerbehindertenausweis)',
        to: 'Versorgungsamt Bielefeld', why: 'Cancer treatment often leads to a recognised degree of disability, which brings tax and mobility relief.',
        prefilled: ['Personal data', 'Treating clinic'],
        missing: ['Consent to release medical reports (red: health data)']
      });
    }
    return docs;
  };

  CC.services.submitDocuments = function (world, docIds) {
    world.documents.forEach(function (d) {
      if (docIds.indexOf(d.id) >= 0) { d.status = 'submitted'; d.submittedAt = world.now; }
    });
  };
})();
