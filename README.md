# Care Concierge – showcase app (DFC #7 prototype)

A proactive, voice-first AI agent for seniors that **acts** within a **digital Vollmacht**. It:
- books appointments, including with a doctor the senior chooses
- arranges rides
- prepares paperwork
- reminds the senior of tablets, procedures and appointments
- keeps chosen contacts informed

Every action passes a rule engine (the traffic light) before it runs. All data is fictional.

## Try it on the PC
- Double-click `index.html`. It opens in Chrome or Edge.
- The **demo controls** panel on the right lets you move time forward and trigger events.
- When opened as a local file, the microphone and installing as an app don't work. Use the typing button ⌨ or the phrase buttons instead. Voice works once the app is online (see below).

## Demo story (about 4 minutes)
1. **⏭ Next event:** a referral arrives. The agent books a cardiologist and a car on its own (🟡), and Anna's phone is notified.
2. **Log → Why?** Shows the reason, the rule check, and the AI-to-AI call. The agent says it is an AI and shares only basic admin data.
3. **💊 Tablets due now:** the agent reminds Margaret. Say or tap **"taken"**.
4. **⏰ Missed dose:** Anna is informed, Peter is not, because that is what Margaret chose.
5. Say **"Can I take two tablets?"** The agent refuses to change a dose and offers to send the question to the doctor.
6. **📅 Live through next appointment:** contacts get messages before, during and after. Open **Health** to see the new report in the ePA.
7. Say **"Which cardiologists are there?"**, then **"Book Dr. Hoffmann"** (free choice of doctor).
8. **Health tab:**
   - Switch off ePA access, then say **"What did the doctor write?"**. The request is blocked.
   - Change what Peter may learn.
9. **💊 Treatment plan letter:** the Document Assistant drafts forms and waits for a 🔴 OK.

## How it is built
| File | Role |
|---|---|
| `js/world.js` | Simulated world: Margaret, contacts, Vollmacht, medication plan, ePA, appointments, timeline |
| `js/services.js` | Mock practices, doctor directory, transport, insurer, document catalogue |
| `js/policy.js` | **Rule engine**: traffic light, cost limit, Vollmacht permissions, ePA consent. It has **no "change dose" action** |
| `js/agent.js` | Runs multi-step plans, approvals, undo, audit log |
| `js/health.js` | Medication reminders and dose log, repeat prescriptions, ePA reading, contact notifications |
| `js/brain.js` | **Swappable agent brain**: rule-based now, so an LLM can plug in later |
| `js/proactive.js` | Proactive engine: letters, rides, tablets, procedures, appointment reminders, before/during/after messages |
| `js/voice.js`, `js/ui.js`, `js/app.js` | Speech in and out, screens, wiring |

**Tested:** 60 automated checks of the agent logic pass, including that the agent never changes a dose and never reads the ePA without consent.

---

## Run it on your Samsung S24 Ultra

The app needs an **https** web address on the phone, because the microphone and "install as app" only work on secure pages. GitHub Pages provides one for free. Setup takes about 10 minutes, once.

### 1. Put the app online (on the PC)
1. Go to **https://github.com** and create a free account. Confirm your email.
2. Click **+** (top right) → **New repository**.
   - Name: `care-concierge`
   - Visibility: **Public** (free GitHub Pages needs a public repository; the app contains only fictional data)
   - Click **Create repository**.
3. On the new page, click **"uploading an existing file"**.
4. Open the folder `output\dfc-2027\app` in Windows Explorer. Select **everything inside it**: `index.html`, `manifest.webmanifest`, `sw.js`, `README.md`, and the folders `css`, `js` and `icons`. Drag it all into the browser window.
   - Drag the **contents** of the folder, not the `app` folder itself. `index.html` must sit at the top level.
5. Click **Commit changes**.
6. Go to **Settings → Pages** (left menu). Under **Branch**, choose `main` and `/ (root)`, then click **Save**.
7. Wait 1–2 minutes and reload the page. Your address appears at the top, for example **`https://YOUR-USERNAME.github.io/care-concierge/`**.

### 2. Open and install it on the phone
1. On the S24 Ultra, open **Chrome**. Samsung Internet also works, but Chrome is best for voice.
2. Type the address from step 7.
3. The app opens. Tap **Next** through the welcome screens.
4. Tap **"Tap and speak"**. When Chrome asks for the microphone, tap **Allow**.
5. Install it on the home screen: tap **⋮** (top right) → **Add to home screen** → **Install**.
6. The **Care Concierge** icon is now on your home screen. It opens full screen, like a real app. Once opened, it also works **offline**, which is useful at the pitch.

### 3. Tips for the demo on the phone
- **Demo controls:** the dark **"Demo controls"** button (top right) opens the panel with the time and event buttons.
- **Voice:** speak English, in short sentences, for example "What is coming up?", "taken", "Book Dr. Hoffmann". If voice fails, use the ⌨ button.
- **Sound:** turn the phone's media volume up so the spoken replies are heard. If the room is loud, switch on **Settings → Hearing support** for large captions.
- **Fresh start:** use **↺ Restart demo** at the bottom of the demo panel.

### 4. Updating the app later
1. On GitHub, open the repository → **Add file → Upload files**.
2. Drag in the changed files and click **Commit changes**.
3. Wait a minute. On the phone, open the app twice: the first time it loads the new version in the background, and the second time shows it. The version number in `sw.js` (`care-concierge-v2`) tells the phone that something changed.

### If something doesn't work
| Problem | Fix |
|---|---|
| Page shows "404" | Wait 2 minutes after enabling Pages. Check that `index.html` is at the top level of the repository, not inside an `app` folder |
| Microphone does nothing | Chrome → ⋮ → Settings → Site settings → Microphone → allow your github.io address. Make sure the address starts with **https** |
| No "Install" option | Open the page once fully and wait a few seconds; then ⋮ → Add to home screen |
| No spoken replies | Turn up media volume; check that **Settings → Silent mode** is off |
