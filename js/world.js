// The simulated world: people, the digital Vollmacht, appointments and the event timeline.
// Everything here is mock data – no real health data is used.
(function () {
  var CC = window.CC;

  CC.createWorld = function () {
    var start = new Date(2026, 10, 16, 8, 0, 0).getTime(); // Monday 16 Nov 2026, 08:00
    var at = function (d, h, m) { return CC.at(start, d, h, m); };

    return {
      start: start,
      now: start,
      paused: false,
      busy: false,
      status: { mode: 'idle', text: 'I am keeping an eye on your appointments and letters.' },

      senior: {
        name: 'Margaret Weber',
        short: 'Margaret',
        age: 79,
        born: '12.03.1947',
        city: 'Bielefeld',
        insurer: 'Musterkasse (statutory health insurance)',
        insuranceNo: 'M123456789',
        careLevel: 2, // Pflegegrad
        conditions: ['Mild heart failure', 'Type 2 diabetes'],
        mobility: 'Walks with a rollator, has no car',
        hasCar: false
      },

      relative: {
        name: 'Anna Weber',
        short: 'Anna',
        relation: 'daughter',
        city: 'Hamburg'
      },

      consent: {
        senior: true,
        seniorAt: at(-14, 11, 0),
        relative: true,
        relativeAt: at(-14, 18, 30),
        crisisContact: true
      },

      // The digital Vollmacht: what Margaret has authorised the agent to do on her behalf.
      vollmacht: {
        id: 'VM-2026-0417',
        grantedBy: 'Margaret Weber',
        grantedAt: at(-14, 11, 0),
        validUntil: at(180, 23, 59),
        costLimit: 60, // euros per action without explicit approval
        relativeRole: 'approve', // 'inform' | 'approve' | 'none'
        permissions: {
          remind: true,
          inform: true,
          book_appointment: true,
          reschedule_appointment: true,
          cancel_appointment: true,
          book_transport: true,
          share_admin_data: true,
          share_health_data: true,
          draft_document: true,
          submit_application: true,
          notify_relative: true,
          medication: true,
          request_prescription: true,
          read_health_record: true,
          message_practice: true
        },
        preferences: { earliestHour: 9, latestHour: 15 }
      },

      // Margaret's usual practices (used for "my usual cardiologist").
      usual: { gp: 'gp', cardiology: 'cardio', ophthalmology: 'eye' },

      appointments: [
        {
          id: 'ap-1', practiceId: 'gp', title: 'Routine check-up', time: at(3, 10, 30),
          status: 'booked', routine: true, transportId: null, createdBy: 'Margaret',
          reason: 'Quarterly check-up (blood pressure, diabetes)'
        },
        {
          id: 'ap-2', practiceId: 'gp', kind: 'procedure', title: 'Fasting blood test', time: at(4, 8, 30),
          status: 'booked', routine: true, transportId: null, createdBy: 'Dr. Yilmaz',
          reason: 'HbA1c and kidney values (diabetes control)',
          prep: 'Nothing to eat after midnight – water is fine. Bring your Metformin and take it after the blood test, as Dr. Yilmaz wrote.'
        }
      ],

      // Medication plan exactly as prescribed (structured like the federal medication plan / ePA medication list).
      // The agent reminds and records – it never changes a dose.
      medPlan: [
        { id: 'm1', drug: 'Ramipril', strength: '5 mg', dose: '1 tablet', times: [8], purpose: 'blood pressure / heart',
          prescribedBy: 'Dr. Yilmaz (GP)', source: 'Federal medication plan (BMP), issued 02.11.2026', stock: 5, rxRequested: false },
        { id: 'm2', drug: 'Metformin', strength: '500 mg', dose: '1 tablet with a meal', times: [8, 19], purpose: 'diabetes',
          prescribedBy: 'Dr. Yilmaz (GP)', source: 'Federal medication plan (BMP), issued 02.11.2026', stock: 40, rxRequested: false },
        { id: 'm3', drug: 'Bisoprolol', strength: '2.5 mg', dose: '1 tablet', times: [8], purpose: 'heart rate',
          prescribedBy: 'Dr. Becker (cardiologist)', source: 'ePA medication list (e-prescription of 20.10.2026)', stock: 38, rxRequested: false }
      ],
      doses: [],
      rxRequests: [],

      // Electronic patient record (ePA) – read only with Margaret's consent, per task, with an access log.
      epa: {
        consent: true,
        docs: [
          { id: 'e1', date: at(-5, 11, 0), from: 'Dr. Yilmaz (GP)', type: 'Doctor\'s letter', title: 'Quarterly check-up',
            summary: 'Blood pressure slightly high (145/90). Ramipril continued. Fasting blood test planned.' },
          { id: 'e2', date: at(-30, 9, 0), from: 'Laboratory Bielefeld', type: 'Lab result', title: 'HbA1c',
            summary: 'HbA1c 7.1 % – stable. Next check in three months.' }
        ],
        accessLog: []
      },

      // Emergency and notification contacts – Margaret chooses what each person may learn.
      contacts: [
        { id: 'anna', name: 'Anna Weber', short: 'Anna', relation: 'Daughter', phone: '+49 40 555 0101',
          detail: 'full', stages: { before: true, during: true, after: true }, missedDose: true, emergency: true },
        { id: 'peter', name: 'Peter Schulz', short: 'Peter', relation: 'Neighbour', phone: '+49 521 555 0177',
          detail: 'basic', stages: { before: false, during: true, after: true }, missedDose: false, emergency: true }
      ],
      slotsTaken: {},
      transports: [],
      inbox: [],
      documents: [],
      approvals: [],
      messages: [], // messages to Anna (relative app)
      chat: [], // conversation with Margaret
      log: [], // audit log
      plans: {},
      fired: {},

      // Things that will happen in the simulated world, whether or not anyone asks.
      timeline: [
        {
          time: at(1, 9, 0), type: 'referral_received', fired: false,
          data: {
            from: 'Dr. Yilmaz (GP)', practiceId: 'cardio', specialty: 'cardiology',
            reason: 'Shortness of breath on exertion – cardiology check-up within 4 weeks',
            referralNo: 'UEW-88213'
          }
        }
      ]
    };
  };
})();
