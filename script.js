/*  Secret Santa - frontend only
    - Stato: LocalStorage
    - Moduli logici: partecipanti, estrazione, invio
    - EmailJS opzionale, fallback mailto
*/

const LS_KEY = "ss_v1_state";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  participants: [],     // {id, name, email, notes}
  exclusions: [],       // {fromId, toId}
  draw: null,           // { [giverId]: receiverId }
  settings: {
    emailTemplate: "Ciao {{nome}}, il tuo Secret Santa è {{assegnato}}. Buone feste!",
    emailSubject: "🎅 Il tuo Secret Santa!",
    lockAfterDraw: false,
    demoMode: false,
    themeXmas: false,
    seedMode: "secure",
  }
};

function uid() {
  // id unico "abbastanza" per un tool da festa
  return "p_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    Object.assign(state, parsed);

    // hardening: campi mancanti
    state.participants ||= [];
    state.exclusions ||= [];
    state.settings ||= {};
    state.settings.emailTemplate ||= "Ciao {{nome}}, il tuo Secret Santa è {{assegnato}}. Buone feste!";
    state.settings.emailSubject ||= "🎅 Il tuo Secret Santa!";
    state.settings.seedMode ||= "secure";
  } catch {
    // se è corrotto: reset
    localStorage.removeItem(LS_KEY);
  }
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function setStep(n) {
  // step buttons
  $$("#stepBtn1, #stepBtn2, #stepBtn3").forEach(btn => btn.classList.remove("step--active"));
  $(`#stepBtn${n}`).classList.add("step--active");

  // sections
  $("#step1").classList.toggle("hidden", n !== 1);
  $("#step2").classList.toggle("hidden", n !== 2);
  $("#step3").classList.toggle("hidden", n !== 3);

  // safety: non entrare in step successivi se manca draw ecc
  if (n === 2) renderDrawTable();
  if (n === 3) renderSendStatus();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateParticipantsBasic() {
  if (state.participants.length < 3) return "Servono almeno 3 partecipanti.";
  // email uniche (molto consigliato)
  const emails = state.participants.map(p => normalizeEmail(p.email));
  const set = new Set(emails);
  if (set.size !== emails.length) return "Ogni email deve essere unica (ci sono duplicati).";
  return null;
}

function isLocked() {
  return !!(state.draw && state.settings.lockAfterDraw);
}

function renderParticipants() {
  const tbody = $("#participantsTbody");
  tbody.innerHTML = "";

  $("#countPill").textContent = `${state.participants.length} partecipanti`;

  for (const p of state.participants) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <div><strong>${escapeHtml(p.name)}</strong></div>
        <div class="muted"><span class="tag">${escapeHtml(p.id)}</span></div>
      </td>
      <td>${escapeHtml(p.email)}</td>
      <td>${escapeHtml(p.notes || "")}</td>
      <td>
        <div class="actions">
          <button class="btn btn-ghost" data-edit="${p.id}">Modifica</button>
          <button class="btn btn-ghost" data-del="${p.id}">Rimuovi</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  }

  // bind actions
  tbody.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (isLocked()) return toast("Partecipanti bloccati dopo estrazione.");
      const id = btn.getAttribute("data-del");
      removeParticipant(id);
    });
  });

  tbody.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (isLocked()) return toast("Partecipanti bloccati dopo estrazione.");
      const id = btn.getAttribute("data-edit");
      startEditParticipant(id);
    });
  });

  renderExclusionsUI();
  saveState();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

let editingId = null;
function startEditParticipant(id) {
  const p = state.participants.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  $("#pName").value = p.name;
  $("#pEmail").value = p.email;
  $("#pNotes").value = p.notes || "";
  $("#btnAdd").textContent = "Salva";
  toast("Modifica attiva. Salva quando hai finito.");
}

function clearForm() {
  editingId = null;
  $("#pName").value = "";
  $("#pEmail").value = "";
  $("#pNotes").value = "";
  $("#btnAdd").textContent = "Aggiungi";
}

function addOrUpdateParticipant() {
  const name = $("#pName").value.trim();
  const email = normalizeEmail($("#pEmail").value);
  const notes = $("#pNotes").value.trim();

  if (!name) return toast("Nome obbligatorio.");
  if (!email || !email.includes("@")) return toast("Email non valida.");

  // email unica (ignora se sto editando lo stesso)
  const exists = state.participants.some(p => normalizeEmail(p.email) === email && p.id !== editingId);
  if (exists) return toast("Questa email è già presente.");

  if (editingId) {
    const p = state.participants.find(x => x.id === editingId);
    if (!p) return;
    p.name = name;
    p.email = email;
    p.notes = notes;
    toast("Partecipante aggiornato.");
  } else {
    state.participants.push({ id: uid(), name, email, notes });
    toast("Partecipante aggiunto.");
  }

  // Cambiare partecipanti invalida estrazione (se presente)
  if (state.draw) {
    state.draw = null;
    toast("Estrrazione cancellata: lista partecipanti modificata.");
  }

  clearForm();
  renderParticipants();
}

function removeParticipant(id) {
  state.participants = state.participants.filter(p => p.id !== id);
  // rimuovi esclusioni collegate
  state.exclusions = state.exclusions.filter(e => e.fromId !== id && e.toId !== id);
  // invalida draw
  state.draw = null;
  renderParticipants();
  toast("Rimosso.");
}

function renderExclusionsUI() {
  const fromSel = $("#exFrom");
  const toSel = $("#exTo");
  const list = $("#exclusionsList");

  // populate selects
  fromSel.innerHTML = "";
  toSel.innerHTML = "";
  for (const p of state.participants) {
    const opt1 = document.createElement("option");
    opt1.value = p.id;
    opt1.textContent = p.name;
    fromSel.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = p.id;
    opt2.textContent = p.name;
    toSel.appendChild(opt2);
  }

  // list exclusions
  list.innerHTML = "";
  for (const ex of state.exclusions) {
    const a = state.participants.find(p => p.id === ex.fromId);
    const b = state.participants.find(p => p.id === ex.toId);
    if (!a || !b) continue;

    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(a.name)}</strong> ≠ <strong>${escapeHtml(b.name)}</strong>
        <div><small class="muted">Evita: ${escapeHtml(a.name)} → ${escapeHtml(b.name)}</small></div>
      </div>
      <button class="btn btn-ghost" data-rmex="${a.id}|${b.id}">Rimuovi</button>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll("[data-rmex]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (isLocked()) return toast("Esclusioni bloccate dopo estrazione.");
      const [fromId, toId] = btn.getAttribute("data-rmex").split("|");
      state.exclusions = state.exclusions.filter(e => !(e.fromId === fromId && e.toId === toId));
      if (state.draw) state.draw = null;
      renderExclusionsUI();
      saveState();
    });
  });

  saveState();
}

function addExclusion() {
  const fromId = $("#exFrom").value;
  const toId = $("#exTo").value;
  if (!fromId || !toId) return toast("Seleziona entrambi.");
  if (fromId === toId) return toast("A ≠ A non ha senso.");
  const exists = state.exclusions.some(e => e.fromId === fromId && e.toId === toId);
  if (exists) return toast("Esclusione già presente.");

  state.exclusions.push({ fromId, toId });
  if (state.draw) state.draw = null;
  renderExclusionsUI();
  toast("Esclusione aggiunta.");
}

function clearExclusions() {
  if (isLocked()) return toast("Esclusioni bloccate dopo estrazione.");
  state.exclusions = [];
  if (state.draw) state.draw = null;
  renderExclusionsUI();
  toast("Esclusioni svuotate.");
}

// ----- ESTRAZIONE -----

function secureRandInt(maxExclusive) {
  // crypto.getRandomValues se disponibile
  if (state.settings.seedMode === "secure" && window.crypto && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % maxExclusive;
  }
  // fallback
  return Math.floor(Math.random() * maxExclusive);
}

function shuffle(arr) {
  // Fisher-Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function violatesExclusion(giverId, receiverId) {
  return state.exclusions.some(e => e.fromId === giverId && e.toId === receiverId);
}

function validateAssignment(assignments) {
  // assignments: Map giverId -> receiverId
  // 1) no self
  for (const [g, r] of assignments.entries()) {
    if (g === r) return "Vincolo violato: qualcuno è assegnato a se stesso.";
    if (violatesExclusion(g, r)) return "Vincolo violato: un'accoppiata è esclusa.";
  }
  // 2) receiver unique (per costruzione, ma controlliamo)
  const receivers = new Set(assignments.values());
  if (receivers.size !== state.participants.length) return "Vincolo violato: un assegnato è ripetuto.";
  return null;
}

/*
  Algoritmo:
  - proviamo a costruire una permutazione dei receiver tale che:
    - receiver[i] != giver[i]
    - (giver[i], receiver[i]) non in exclusions
  - con retry limitato + fallback con backtracking semplice
*/
function drawSecretSanta() {
  const err = validateParticipantsBasic();
  if (err) return { ok: false, error: err };

  const givers = state.participants.map(p => p.id);
  const receivers = state.participants.map(p => p.id);

  // tentativi rapidi con shuffle
  const MAX_TRIES = 4000;
  for (let t = 0; t < MAX_TRIES; t++) {
    const candidate = shuffle([...receivers]);
    const map = new Map();
    for (let i = 0; i < givers.length; i++) map.set(givers[i], candidate[i]);
    const v = validateAssignment(map);
    if (!v) return { ok: true, map };
  }

  // fallback: backtracking (più lento, ma su liste piccole va benissimo)
  const map = new Map();
  const used = new Set();

  const giverIds = [...givers];

  function backtrack(idx) {
    if (idx === giverIds.length) return true;
    const giver = giverIds[idx];

    // possibili receiver non usati
    let options = receivers.filter(r =>
      !used.has(r) &&
      r !== giver &&
      !violatesExclusion(giver, r)
    );
    // randomizza opzioni per non essere sempre uguale
    options = shuffle(options);

    for (const r of options) {
      map.set(giver, r);
      used.add(r);
      if (backtrack(idx + 1)) return true;
      used.delete(r);
      map.delete(giver);
    }
    return false;
  }

  const ok = backtrack(0);
  if (!ok) {
    return { ok: false, error: "Impossibile trovare un'estrazione con questi vincoli. Rimuovi qualche esclusione." };
  }
  return { ok: true, map };
}

function persistDraw(map) {
  const obj = {};
  for (const [g, r] of map.entries()) obj[g] = r;
  state.draw = obj;
  saveState();
}

function renderDrawTable() {
  const tbody = $("#drawTbody");
  tbody.innerHTML = "";

  const warn = $("#drawWarnings");
  warn.classList.remove("show");
  warn.textContent = "";

  if (!state.draw) {
    // mostra un placeholder gentile
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">Nessuna estrazione ancora. Premi “Estrai”.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const giver of state.participants) {
    const receiverId = state.draw[giver.id];
    const receiver = state.participants.find(p => p.id === receiverId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(giver.name)}</strong><div class="muted">${escapeHtml(giver.email)}</div></td>
      <td><strong>${escapeHtml(receiver?.name || "???")}</strong></td>
      <td>${escapeHtml(giver.notes || "")}</td>
    `;
    tbody.appendChild(tr);
  }

  // warning se partecipanti cambiati dopo draw (edge)
  const ids = new Set(state.participants.map(p => p.id));
  for (const g in state.draw) {
    if (!ids.has(g) || !ids.has(state.draw[g])) {
      warn.textContent = "Attenzione: l'estrazione non è coerente con la lista attuale (probabile modifica partecipanti). Rifai l’estrazione.";
      warn.classList.add("show");
      break;
    }
  }
}

function clearDraw() {
  state.draw = null;
  saveState();
  renderDrawTable();
  renderSendStatus();
  toast("Estrazione cancellata.");
}

// ----- INVIO -----

function fillTemplate(tpl, vars) {
  return tpl
    .replaceAll("{{nome}}", vars.nome)
    .replaceAll("{{assegnato}}", vars.assegnato);
}

function getAssignedName(giverId) {
  if (!state.draw) return null;
  const receiverId = state.draw[giverId];
  const receiver = state.participants.find(p => p.id === receiverId);
  return receiver?.name || null;
}

function renderSendStatus() {
  const list = $("#sendStatusList");
  list.innerHTML = "";

  if (!state.draw) {
    list.innerHTML = `<li><div><strong>Niente da inviare</strong><div><small>Prima fai l’estrazione.</small></div></div></li>`;
    return;
  }

  for (const giver of state.participants) {
    const assignedName = getAssignedName(giver.id);
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(giver.name)}</strong> <small class="muted">(${escapeHtml(giver.email)})</small>
        <div><small class="muted">Riceverà: ${escapeHtml(assignedName || "???")}</small></div>
      </div>
      <span class="tag">Pronto</span>
    `;
    list.appendChild(li);
  }
}

async function sendAll() {
  const method = $("#sendMethod").value;
  const confirm = $("#confirmBeforeSend").checked;

  if (!state.draw) return toast("Prima devi estrarre.");
  if (state.settings.demoMode) return toast("Modalità demo attiva: non invio nulla.");

  if (confirm) {
    const ok = await confirmModal(`Stai per inviare ${state.participants.length} email. Procedere?`);
    if (!ok) return;
  }

  const subject = $("#emailSubject").value.trim() || state.settings.emailSubject;
  const tpl = ($("#customEmailText").value.trim() || state.settings.emailTemplate);

  if (method === "mailto") {
    // Aprirà una mail per volta (dipende dal browser/client). È il meglio che mailto può fare.
    for (const giver of state.participants) {
      const assignedName = getAssignedName(giver.id);
      if (!assignedName) continue;
      const body = fillTemplate(tpl, { nome: giver.name, assegnato: assignedName });
      const url = buildMailto(giver.email, subject, body);
      window.open(url, "_blank", "noopener,noreferrer");
    }
    toast("Aperte email via mailto (controlla il tuo client).");
    return;
  }

  // EmailJS
  const emailjsOk = initEmailJSIfConfigured();
  if (!emailjsOk) {
    toast("EmailJS non configurato. Usa mailto o configura EmailJS (vedi istruzioni sotto).");
    return;
  }

  // Invio sequenziale per evitare rate-limit inutili
  const list = $("#sendStatusList");
  const items = [...list.querySelectorAll("li")];

  for (let i = 0; i < state.participants.length; i++) {
    const giver = state.participants[i];
    const assignedName = getAssignedName(giver.id);
    const body = fillTemplate(tpl, { nome: giver.name, assegnato: assignedName });

    // update UI
    if (items[i]) items[i].querySelector(".tag").textContent = "Invio...";

    try {
      await sendEmailJS({
        to_email: giver.email,
        to_name: giver.name,
        assigned_name: assignedName,
        subject,
        message: body
      });
      if (items[i]) items[i].querySelector(".tag").textContent = "Inviata";
    } catch (e) {
      if (items[i]) items[i].querySelector(".tag").textContent = "Errore";
      console.error(e);
    }
  }

  toast("Invio completato (controlla eventuali errori).");
}

function buildMailto(to, subject, body) {
  const s = encodeURIComponent(subject);
  const b = encodeURIComponent(body);
  return `mailto:${encodeURIComponent(to)}?subject=${s}&body=${b}`;
}

/* EmailJS config:
   Metti i valori qui sotto una volta creati su EmailJS.
   Nota: client-side = esponi public key e service/template id. Quindi:
   - non è "sicuro" per segreti veri
   - è ok per un Secret Santa, non per gestire un hedge fund
*/
const EMAILJS_CONFIG = {
  publicKey: "",   // es: "pUBliC_xxx"
  serviceId: "",   // es: "service_abcd"
  templateId: ""   // es: "template_xyz"
};

function initEmailJSIfConfigured() {
  if (!window.emailjs) return false;
  const { publicKey, serviceId, templateId } = EMAILJS_CONFIG;
  if (!publicKey || !serviceId || !templateId) return false;
  emailjs.init({ publicKey });
  return true;
}

function sendEmailJS(params) {
  const { serviceId, templateId } = EMAILJS_CONFIG;
  // params deve matchare i campi del template EmailJS
  return emailjs.send(serviceId, templateId, params);
}

// ----- UI / NAV / MODAL / TEMA -----

function confirmModal(text) {
  return new Promise(resolve => {
    const modal = $("#modal");
    $("#modalText").textContent = text;

    function cleanup(val) {
      modal.classList.add("hidden");
      $("#modalOk").removeEventListener("click", ok);
      $("#modalCancel").removeEventListener("click", cancel);
      modal.querySelector(".modal__backdrop").removeEventListener("click", backdrop);
      resolve(val);
    }
    function ok(){ cleanup(true); }
    function cancel(){ cleanup(false); }
    function backdrop(e){ if (e.target.dataset.close) cleanup(false); }

    modal.classList.remove("hidden");
    $("#modalOk").addEventListener("click", ok);
    $("#modalCancel").addEventListener("click", cancel);
    modal.querySelector(".modal__backdrop").addEventListener("click", backdrop);
  });
}

function applyTheme() {
  document.body.classList.toggle("xmas", !!state.settings.themeXmas);
  $("#snow").classList.toggle("hidden", !state.settings.themeXmas);
  if (state.settings.themeXmas) startSnow();
  else stopSnow();
}

let snowAnim = null;
function startSnow() {
  const canvas = $("#snow");
  const ctx = canvas.getContext("2d");
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;

  const flakes = Array.from({ length: 120 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 1 + Math.random() * 2.4,
    s: 0.6 + Math.random() * 1.8,
    dx: -0.3 + Math.random() * 0.6
  }));

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);

  function tick() {
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    for (const f of flakes) {
      f.y += f.s;
      f.x += f.dx;
      if (f.y > h) { f.y = -10; f.x = Math.random() * w; }
      if (f.x > w) f.x = 0;
      if (f.x < 0) f.x = w;

      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    snowAnim = requestAnimationFrame(tick);
  }
  stopSnow();
  tick();

  startSnow._cleanup = () => {
    window.removeEventListener("resize", resize);
  };
}
function stopSnow() {
  if (snowAnim) cancelAnimationFrame(snowAnim);
  snowAnim = null;
  if (startSnow._cleanup) startSnow._cleanup();
}

// ----- EXPORT JSON -----

function exportJson() {
  if (!state.draw) return toast("Niente da esportare. Estrai prima.");

  const exportObj = {
    generatedAt: new Date().toISOString(),
    participants: state.participants,
    exclusions: state.exclusions,
    draw: state.draw
  };

  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "secret-santa-results.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("JSON esportato.");
}

// ----- DEMO -----

function loadDemoData() {
  if (isLocked()) return toast("Partecipanti bloccati dopo estrazione.");
  state.participants = [
    { id: uid(), name: "Marco", email: "marco@example.com", notes: "Ama libri" },
    { id: uid(), name: "Luisa", email: "luisa@example.com", notes: "No profumi" },
    { id: uid(), name: "Giorgio", email: "giorgio@example.com", notes: "Fan di tecnologia" },
    { id: uid(), name: "Sara", email: "sara@example.com", notes: "" }
  ];
  state.exclusions = [];
  state.draw = null;
  renderParticipants();
  toast("Demo data caricati.");
}

// ----- INIT / BIND -----

function bindUI() {
  // stepper
  $("#stepBtn1").addEventListener("click", () => setStep(1));
  $("#stepBtn2").addEventListener("click", () => setStep(2));
  $("#stepBtn3").addEventListener("click", () => setStep(3));

  $("#goToDraw").addEventListener("click", () => {
    const err = validateParticipantsBasic();
    if (err) return toast(err);
    setStep(2);
  });
  $("#goToSend").addEventListener("click", () => {
    if (!state.draw) return toast("Prima fai l’estrazione.");
    setStep(3);
  });
  $("#backToDraw").addEventListener("click", () => setStep(2));

  // participants form
  $("#participantForm").addEventListener("submit", (e) => {
    e.preventDefault();
    addOrUpdateParticipant();
  });
  $("#btnClearForm").addEventListener("click", clearForm);

  // exclusions
  $("#btnAddExclusion").addEventListener("click", addExclusion);
  $("#btnClearExclusions").addEventListener("click", clearExclusions);

  // draw settings
  $("#seedMode").addEventListener("change", (e) => {
    state.settings.seedMode = e.target.value;
    saveState();
  });
  $("#customEmailText").addEventListener("input", (e) => {
    state.settings.emailTemplate = e.target.value;
    saveState();
  });
  $("#emailSubject").addEventListener("input", (e) => {
    state.settings.emailSubject = e.target.value;
    saveState();
  });

  $("#demoMode").addEventListener("change", (e) => {
    state.settings.demoMode = e.target.checked;
    saveState();
  });

  $("#freezeParticipants").addEventListener("change", (e) => {
    state.settings.lockAfterDraw = e.target.checked;
    saveState();
    toast(state.settings.lockAfterDraw ? "Bloccherò modifiche dopo estrazione." : "Modifiche consentite anche dopo estrazione.");
  });

  $("#lockAfterDraw").addEventListener("change", (e) => {
    state.settings.lockAfterDraw = e.target.checked;
    $("#freezeParticipants").checked = e.target.checked;
    saveState();
  });

  // draw buttons
  $("#btnDraw").addEventListener("click", () => {
    const res = drawSecretSanta();
    if (!res.ok) return toast(res.error);
    persistDraw(res.map);
    renderDrawTable();
    renderSendStatus();
    toast("Estrazione completata.");
  });

  $("#btnReDraw").addEventListener("click", () => {
    const res = drawSecretSanta();
    if (!res.ok) return toast(res.error);
    persistDraw(res.map);
    renderDrawTable();
    renderSendStatus();
    toast("Estrazione aggiornata.");
  });

  $("#btnClearDraw").addEventListener("click", clearDraw);

  // send
  $("#btnSendAll").addEventListener("click", sendAll);

  $("#btnPreviewAll").addEventListener("click", async () => {
    if (!state.draw) return toast("Prima fai l’estrazione.");
    const subject = $("#emailSubject").value.trim() || state.settings.emailSubject;
    const tpl = ($("#customEmailText").value.trim() || state.settings.emailTemplate);

    const example = state.participants[0];
    const assigned = getAssignedName(example.id);
    const body = fillTemplate(tpl, { nome: example.name, assegnato: assigned || "???" });

    await confirmModal(`Esempio:\n\nA: ${example.email}\nOggetto: ${subject}\n\n${body}`);
  });

  // export
  $("#btnExportJson").addEventListener("click", exportJson);

  // reset
  $("#btnResetAll").addEventListener("click", async () => {
    const ok = await confirmModal("Reset totale? Cancella partecipanti, esclusioni e estrazione dal browser.");
    if (!ok) return;
    localStorage.removeItem(LS_KEY);
    location.reload();
  });

  // demo
  $("#btnDemoData").addEventListener("click", loadDemoData);

  // theme
  $("#btnToggleTheme").addEventListener("click", () => {
    state.settings.themeXmas = !state.settings.themeXmas;
    saveState();
    applyTheme();
  });

  // method change
  $("#sendMethod").addEventListener("change", () => saveState());
}

function hydrateUIFromState() {
  $("#customEmailText").value = state.settings.emailTemplate || "";
  $("#emailSubject").value = state.settings.emailSubject || "";
  $("#demoMode").checked = !!state.settings.demoMode;
  $("#freezeParticipants").checked = !!state.settings.lockAfterDraw;
  $("#lockAfterDraw").checked = !!state.settings.lockAfterDraw;
  $("#seedMode").value = state.settings.seedMode || "secure";
  applyTheme();
}

(function init() {
  loadState();
  bindUI();
  hydrateUIFromState();
  renderParticipants();
  renderDrawTable();
  renderSendStatus();
})();
