import { db, estimate1RM } from './db.js';

// ------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const dateFmt = new Intl.DateTimeFormat('pt-PT', { weekday: 'long', day: 'numeric', month: 'short' });
function prettyDate(iso) {
  if (!iso) return '';
  return dateFmt.format(new Date(iso + 'T00:00:00')).replace('.', '');
}
function fmtNum(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
function formatClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function formatDuration(sec) {
  if (sec == null) return null;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}min` : `${h}h`;
}
function formatTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2400);
}

// ------------------------------------------------------------
//  Navegação por abas
// ------------------------------------------------------------
$$('.tab').forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));

function switchView(viewId) {
  $$('.view').forEach((v) => (v.hidden = v.id !== viewId));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === viewId));
  if (viewId === 'view-history') renderHistory();
  if (viewId === 'view-progress') renderProgressView();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------
//  Parceiro/a
// ------------------------------------------------------------
const partnerToggle = $('#partner-toggle');
const partnerNameInput = $('#partner-name');

function partnerName() {
  return partnerNameInput.value.trim() || 'Parceiro/a';
}
function applyPartnerUI() {
  const on = partnerToggle.checked;
  document.body.classList.toggle('partner-on', on);
  partnerNameInput.hidden = !on;
  $$('.partner-name').forEach((el) => (el.textContent = partnerName()));
}
partnerToggle.addEventListener('change', () => { applyPartnerUI(); persistActive(); });
partnerNameInput.addEventListener('input', () => {
  $$('.partner-name').forEach((el) => (el.textContent = partnerName()));
  persistActive();
});

// ------------------------------------------------------------
//  Sessão a decorrer (timer + persistência)
// ------------------------------------------------------------
const ACTIVE_KEY = 'gymtracker.active';
const exercisesEl = $('#exercises');
let startedAt = null;   // Date
let tickTimer = null;
let durationEdited = false;
let editingWorkoutId = null; // id do treino a editar (null = novo treino)

function elapsedSec() {
  return startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : 0;
}
function tick() {
  const e = elapsedSec();
  $('#clock').textContent = formatClock(e);
  if (!durationEdited) $('#duration-min').value = Math.round(e / 60);
}
function startTicking() {
  clearInterval(tickTimer);
  tick();
  tickTimer = setInterval(tick, 1000);
}

function showActive(on) {
  $('#start-btn').hidden = on;
  $('#timer-active').hidden = !on;
  $('#active-body').hidden = !on;
}

function startSession(restoredStartedAt) {
  startedAt = restoredStartedAt || new Date();
  showActive(true);
  startTicking();
  if (!restoredStartedAt && !$$('.exercise-card').length) addStrengthCard(); // arranca com um exercício
  persistActive();
}

$('#start-btn').addEventListener('click', () => startSession());
$('#duration-min').addEventListener('input', () => { durationEdited = true; persistActive(); });

$('#cancel-btn').addEventListener('click', () => {
  const wasEditing = !!editingWorkoutId;
  const msg = wasEditing ? 'Descartar as alterações?' : 'Cancelar este treino? As séries introduzidas serão descartadas.';
  if (!confirm(msg)) return;
  endSession();
  if (wasEditing) switchView('view-history');
});

// Carrega um treino concluído para edição (sem timer a correr).
function loadWorkoutForEdit(w) {
  endSession();
  editingWorkoutId = w.id;
  $('#workout-date').value = w.date || todayISO();
  $('#workout-type').value = w.type || '';
  $('#workout-notes').value = w.notes || '';
  partnerToggle.checked = !!w.partner;
  if (w.partner) partnerNameInput.value = w.partner;
  applyPartnerUI();

  exercisesEl.innerHTML = '';
  for (const g of w.exercises) {
    const name = g.exercise.name;
    const imageUrl = g.exercise.image_url || '';
    if (g.kind === 'cardio') {
      const r = g.rows[0] || {};
      addCardioCard({ name, imageUrl, forWho: g.forWho, durationMin: r.durationMin ?? '', distanceKm: r.distanceKm ?? '', inclinePct: r.inclinePct ?? '' });
    } else {
      const sets = g.rows.map((r) => ({ weight: r.weight ?? '', weightPartner: r.weightPartner ?? '', reps: r.reps ?? '' }));
      addStrengthCard({ name, imageUrl, forWho: g.forWho, sets });
    }
  }

  startedAt = null;          // edição não corre cronómetro
  durationEdited = true;
  $('#duration-min').value = w.durationSec != null ? Math.round(w.durationSec / 60) : '';
  $('#clock').textContent = formatClock(w.durationSec || 0);
  showActive(true);
  $('#finish-btn').textContent = '💾 Guardar alterações';
  $('#cancel-btn').textContent = 'Cancelar edição';
  switchView('view-log');
}

function endSession() {
  clearInterval(tickTimer);
  tickTimer = null;
  startedAt = null;
  durationEdited = false;
  editingWorkoutId = null;
  localStorage.removeItem(ACTIVE_KEY);
  exercisesEl.innerHTML = '';
  $('#workout-notes').value = '';
  $('#duration-min').value = '';
  $('#clock').textContent = '00:00';
  $('#workout-date').value = todayISO();
  $('#finish-btn').textContent = '⏹️ Terminar treino';
  $('#cancel-btn').textContent = 'Cancelar treino';
  showActive(false);
}

// ------------------------------------------------------------
//  Cartões de exercício (força / cardio)
// ------------------------------------------------------------
let exerciseCache = [];
const sameKind = (e, kind) => (kind === 'cardio' ? e.kind === 'cardio' : e.kind !== 'cardio');

// Preenche o <select> com os exercícios guardados + "➕ Novo…".
function populateSelect(sel, kind, selectedName) {
  const list = exerciseCache.filter((e) => sameKind(e, kind));
  const opts = [`<option value="" disabled${selectedName ? '' : ' selected'}>Escolher exercício…</option>`];
  for (const e of list) {
    opts.push(`<option value="${escapeHtml(e.name)}"${e.name === selectedName ? ' selected' : ''}>${escapeHtml(e.name)}</option>`);
  }
  opts.push('<option value="__new__">➕ Novo exercício…</option>');
  sel.innerHTML = opts.join('');
}

// Ao escolher um exercício já feito, pré-carrega a carga máxima + reps (minha e do parceiro/a).
async function prefillFromHistory(card, name, kind) {
  const ex = exerciseCache.find((e) => sameKind(e, kind) && e.name === name);
  if (!ex) return;
  let res;
  try { res = await db.progressFor(ex.id, kind); } catch { return; }
  const points = res?.points || [];
  if (!points.length) return;

  if (kind === 'cardio') {
    const bestDur = Math.max(...points.map((p) => p.bestDuration || 0));
    const bestDist = Math.max(...points.map((p) => p.bestDistance || 0));
    if (bestDur) card.querySelector('.cardio-duration').value = fmtNum(bestDur);
    if (bestDist) card.querySelector('.cardio-distance').value = fmtNum(bestDist);
    return;
  }
  const best = points.reduce((a, p) => (p.bestWeight > a.bestWeight ? p : a), points[0]);
  const bestP = points.reduce((a, p) => (p.bestWeightPartner > a.bestWeightPartner ? p : a), points[0]);
  const row = card.querySelector('.set-row');
  if (row && best.topSet) {
    row.querySelector('.set-weight').value = fmtNum(best.topSet.weight);
    row.querySelector('.set-reps').value = best.topSet.reps ?? 12;
    if (bestP.topSetPartner && bestP.bestWeightPartner > 0) {
      row.querySelector('.set-weight-partner').value = fmtNum(bestP.topSetPartner.weight);
    }
  }
}

function buildExPicker(node, kind, dataName) {
  const sel = node.querySelector('.ex-select');
  const newInput = node.querySelector('.ex-name-new');
  populateSelect(sel, kind, dataName);
  // Nome guardado que ainda não existe no catálogo → modo "novo" já preenchido.
  if (dataName && !exerciseCache.some((e) => sameKind(e, kind) && e.name === dataName)) {
    sel.value = '__new__';
    newInput.hidden = false;
    newInput.value = dataName;
  }
  sel.addEventListener('change', async () => {
    const isNew = sel.value === '__new__';
    newInput.hidden = !isNew;
    delete node.dataset.imageUrl; // mudou de exercício → esquece imagem escolhida
    if (isNew) { newInput.value = ''; newInput.focus(); }
    else if (sel.value) await prefillFromHistory(node, sel.value, kind);
    updateCardImage(node);
    persistActive();
  });
  newInput.addEventListener('input', persistActive);
  node.querySelector('.pick-image').addEventListener('click', () => openImagePicker(node));
  node.querySelector('.ex-thumb').addEventListener('click', () => {
    const src = node.querySelector('.ex-thumb').getAttribute('src');
    if (src) openExerciseDetail(src, exNameOf(node));
  });
  node.querySelector('.collapse-btn').addEventListener('click', () => toggleDone(node));
  const pn = node.querySelector('.for-who .partner-name');
  if (pn) pn.textContent = partnerName();
  $$('.for-who .seg-btn', node).forEach((b) => b.addEventListener('click', () => {
    node.dataset.forWho = b.dataset.for;
    applyForWho(node);
    persistActive();
  }));
  updateCardImage(node);
}

function addSetRow(setsEl, data = {}) {
  const node = $('#set-template').content.firstElementChild.cloneNode(true);
  node.querySelector('.set-weight').value = data.weight ?? '';
  node.querySelector('.set-weight-partner').value = data.weightPartner ?? '';
  node.querySelector('.set-reps').value = data.reps ?? 12; // 12 reps por defeito
  node.querySelector('.partner-name').textContent = partnerName();
  node.querySelector('.remove-set').addEventListener('click', () => {
    node.remove();
    renumberSets(setsEl);
    persistActive();
  });
  setsEl.appendChild(node);
  renumberSets(setsEl);
}
function renumberSets(setsEl) {
  $$('.set-row .set-index', setsEl).forEach((el, i) => (el.textContent = i + 1));
}

// Resumo de um cartão (para o estado "concluído/colapsado").
function exSummary(card) {
  if (card.dataset.kind === 'cardio') {
    const parts = [];
    const d = card.querySelector('.cardio-duration').value;
    const k = card.querySelector('.cardio-distance').value;
    const i = card.querySelector('.cardio-incline').value;
    if (d) parts.push(`${d} min`);
    if (k) parts.push(`${k} km`);
    if (i) parts.push(`${i}%`);
    return parts.join(' · ') || '—';
  }
  const partner = document.body.classList.contains('partner-on');
  const sets = $$('.set-row', card).map((row) => {
    const r = row.querySelector('.set-reps').value;
    if (!r) return null;
    const w = row.querySelector('.set-weight').value || 0;
    const wp = row.querySelector('.set-weight-partner').value;
    return partner && wp !== '' ? `${w}/${wp}×${r}` : `${w}×${r}`;
  }).filter(Boolean);
  return sets.join(' · ') || '—';
}
function markDone(card) {
  card.classList.add('done');
  card.querySelector('.ex-done-summary').textContent = exSummary(card);
  const b = card.querySelector('.collapse-btn');
  b.textContent = '✏️'; b.title = 'Reabrir';
}
function toggleDone(card) {
  if (card.classList.contains('done')) {
    card.classList.remove('done');
    const b = card.querySelector('.collapse-btn');
    b.textContent = '✔️'; b.title = 'Concluir exercício';
  } else {
    markDone(card);
  }
  persistActive();
}
function applyForWho(card) {
  const val = card.dataset.forWho || 'both';
  $$('.for-who .seg-btn', card).forEach((b) => b.classList.toggle('active', b.dataset.for === val));
}

function addStrengthCard(data = null, { prepend = false } = {}) {
  const node = $('#strength-template').content.firstElementChild.cloneNode(true);
  const setsEl = node.querySelector('.sets');
  if (data?.imageUrl) node.dataset.imageUrl = data.imageUrl;
  buildExPicker(node, 'strength', data?.name);
  node.dataset.forWho = data?.forWho || 'both';
  applyForWho(node);
  node.querySelector('.add-set').addEventListener('click', () => {
    // Nova série copia os valores da anterior (mais rápido de registar).
    const rows = $$('.set-row', setsEl);
    const last = rows[rows.length - 1];
    addSetRow(setsEl, last ? {
      weight: last.querySelector('.set-weight').value,
      weightPartner: last.querySelector('.set-weight-partner').value,
      reps: last.querySelector('.set-reps').value,
    } : {});
    persistActive();
  });
  node.querySelector('.remove-exercise').addEventListener('click', () => { node.remove(); persistActive(); });
  const sets = data?.sets?.length ? data.sets : [{}];
  sets.forEach((s) => addSetRow(setsEl, s));
  if (data?.done) markDone(node);
  if (prepend) exercisesEl.prepend(node); else exercisesEl.appendChild(node);
  if (!data) node.querySelector('.ex-select').focus();
}

function addCardioCard(data = null, { prepend = false } = {}) {
  const node = $('#cardio-template').content.firstElementChild.cloneNode(true);
  if (data?.imageUrl) node.dataset.imageUrl = data.imageUrl;
  buildExPicker(node, 'cardio', data?.name);
  node.dataset.forWho = data?.forWho || 'both';
  applyForWho(node);
  node.querySelector('.cardio-duration').value = data?.durationMin ?? '';
  node.querySelector('.cardio-distance').value = data?.distanceKm ?? '';
  node.querySelector('.cardio-incline').value = data?.inclinePct ?? '';
  node.querySelector('.remove-exercise').addEventListener('click', () => { node.remove(); persistActive(); });
  if (data?.done) markDone(node);
  if (prepend) exercisesEl.prepend(node); else exercisesEl.appendChild(node);
  if (!data) node.querySelector('.ex-select').focus();
}

$('#add-strength').addEventListener('click', () => { addStrengthCard(null, { prepend: true }); persistActive(); });
$('#add-cardio').addEventListener('click', () => { addCardioCard(null, { prepend: true }); persistActive(); });
// Persiste a cada tecla dentro dos exercícios
exercisesEl.addEventListener('input', persistActive);
$('#workout-notes').addEventListener('input', persistActive);
$('#workout-date').addEventListener('input', persistActive);
$('#workout-type').addEventListener('input', persistActive);

// ------------------------------------------------------------
//  Ler / persistir / restaurar a sessão
// ------------------------------------------------------------
function readExercisesFromDOM() {
  return $$('.exercise-card').map((card) => {
    const kind = card.dataset.kind;
    const sel = card.querySelector('.ex-select');
    const newInput = card.querySelector('.ex-name-new');
    const name = sel.value === '__new__' ? newInput.value : sel.value;
    const imageUrl = card.dataset.imageUrl || '';
    const done = card.classList.contains('done');
    const forWho = card.dataset.forWho || 'both';
    if (kind === 'strength') {
      const sets = $$('.set-row', card).map((row) => ({
        weight: row.querySelector('.set-weight').value,
        weightPartner: row.querySelector('.set-weight-partner').value,
        reps: row.querySelector('.set-reps').value,
      }));
      return { kind, name, imageUrl, done, forWho, sets };
    }
    return {
      kind, name, imageUrl, done, forWho,
      durationMin: card.querySelector('.cardio-duration').value,
      distanceKm: card.querySelector('.cardio-distance').value,
      inclinePct: card.querySelector('.cardio-incline').value,
    };
  });
}

function persistActive() {
  if (!startedAt) return;
  const state = {
    startedAt: startedAt.toISOString(),
    date: $('#workout-date').value,
    type: $('#workout-type').value,
    notes: $('#workout-notes').value,
    partnerOn: partnerToggle.checked,
    partnerName: partnerNameInput.value,
    durationEdited,
    durationMin: $('#duration-min').value,
    exercises: readExercisesFromDOM(),
  };
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(state));
}

function restoreActive() {
  let state;
  try { state = JSON.parse(localStorage.getItem(ACTIVE_KEY)); } catch { state = null; }
  if (!state || !state.startedAt) return false;

  $('#workout-date').value = state.date || todayISO();
  $('#workout-type').value = state.type || '';
  $('#workout-notes').value = state.notes || '';
  partnerToggle.checked = !!state.partnerOn;
  partnerNameInput.value = state.partnerName || 'Cláudia';
  applyPartnerUI();

  exercisesEl.innerHTML = '';
  for (const ex of state.exercises || []) {
    if (ex.kind === 'cardio') addCardioCard(ex);
    else addStrengthCard(ex);
  }
  durationEdited = !!state.durationEdited;
  startSession(new Date(state.startedAt));
  if (durationEdited) $('#duration-min').value = state.durationMin || '';
  return true;
}

// ------------------------------------------------------------
//  Terminar treino (guardar)
// ------------------------------------------------------------
$('#finish-btn').addEventListener('click', async (e) => {
  const partnerOn = partnerToggle.checked;
  const entries = [];
  for (const ex of readExercisesFromDOM()) {
    const name = (ex.name || '').trim();
    if (!name) continue;
    if (ex.kind === 'strength') {
      const fw = partnerOn ? (ex.forWho || 'both') : 'me';
      const rows = [];
      for (const s of ex.sets) {
        const reps = parseInt(s.reps, 10);
        if (!reps || reps <= 0) continue;
        let weight = null, weightPartner = null;
        if (fw === 'partner') weightPartner = parseFloat(s.weightPartner) || 0;
        else if (fw === 'me') weight = parseFloat(s.weight) || 0;
        else { weight = parseFloat(s.weight) || 0; weightPartner = parseFloat(s.weightPartner) || null; }
        rows.push({ weight, weightPartner, reps, forWho: fw });
      }
      if (rows.length) entries.push({ name, kind: 'strength', imageUrl: ex.imageUrl || null, rows });
    } else {
      const dur = parseFloat(ex.durationMin);
      const dist = parseFloat(ex.distanceKm);
      const inc = parseFloat(ex.inclinePct);
      if (!dur && !dist) continue;
      const fw = partnerOn ? (ex.forWho || 'both') : null;
      entries.push({ name, kind: 'cardio', muscleGroup: 'cardio', imageUrl: ex.imageUrl || null, rows: [{ durationMin: dur || null, distanceKm: dist || null, inclinePct: inc || null, forWho: fw }] });
    }
  }

  if (!entries.length) {
    toast('Adiciona pelo menos um exercício preenchido', true);
    return;
  }

  const durationSec = durationEdited
    ? Math.round((parseFloat($('#duration-min').value) || 0) * 60)
    : elapsedSec();

  const payload = {
    date: $('#workout-date').value || todayISO(),
    type: $('#workout-type').value.trim(),
    notes: $('#workout-notes').value.trim(),
    partner: partnerOn ? partnerName() : null,
    durationSec,
    entries,
  };

  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const wasEditing = !!editingWorkoutId;
    if (wasEditing) {
      await db.updateWorkout(editingWorkoutId, payload);
    } else {
      await db.addWorkout({ ...payload, startedAt: startedAt ? startedAt.toISOString() : null, endedAt: new Date().toISOString() });
    }
    endSession();
    await refreshExerciseLists();
    toast(wasEditing ? 'Treino atualizado ✅' : 'Treino guardado 💪');
    switchView('view-history');
  } catch (err) {
    console.error(err);
    toast('Erro ao guardar: ' + (err.message || err), true);
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------
//  Histórico
// ------------------------------------------------------------
function card(value, label) {
  return `<div class="card"><div class="big-num">${value}</div><div class="lbl">${label}</div></div>`;
}

async function renderHistory() {
  const list = $('#history-list');
  const empty = $('#history-empty');
  const summary = $('#history-summary');
  list.innerHTML = '';
  summary.innerHTML = '';

  let workouts;
  try {
    workouts = await db.listWorkouts();
  } catch (err) {
    console.error(err);
    toast('Erro ao carregar histórico', true);
    return;
  }

  empty.hidden = workouts.length > 0;
  if (!workouts.length) return;

  const now = new Date();
  const thisMonth = workouts.filter((w) => {
    const d = new Date(w.date + 'T00:00:00');
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const totalSec = workouts.reduce((s, w) => s + (w.durationSec || 0), 0);
  summary.innerHTML = `
    ${card(workouts.length, 'Treinos')}
    ${card(thisMonth, 'Este mês')}
    ${card(formatDuration(totalSec) || '0 min', 'Tempo total')}
  `;

  for (const w of workouts) {
    const el = document.createElement('div');
    el.className = 'workout-card';
    const lines = w.exercises.map((g) => exerciseLine(g, w.partner)).join('');
    const dur = formatDuration(w.durationSec);
    el.innerHTML = `
      <div class="wc-head">
        <div>
          <div class="wc-date">${prettyDate(w.date)}</div>
          <div class="wc-sub">${w.startedAt ? formatTime(w.startedAt) + ' · ' : ''}${plural(w.exercises.length, 'exercício', 'exercícios')}${dur ? ' · ' + dur : ''}</div>
        </div>
        <div class="wc-tags">
          ${w.type ? `<span class="type-tag">${escapeHtml(w.type)}</span>` : ''}
          ${w.partner ? `<span class="partner-tag">👥 ${escapeHtml(w.partner)}</span>` : ''}
        </div>
      </div>
      ${lines}
      ${w.notes ? `<div class="wc-notes">${escapeHtml(w.notes)}</div>` : ''}
      <div class="wc-foot">
        <button class="icon-btn edit-btn">✏️ Editar</button>
        <button class="icon-btn del-btn">🗑 Apagar</button>
      </div>
    `;
    el.querySelector('.edit-btn').addEventListener('click', () => loadWorkoutForEdit(w));
    el.querySelector('.del-btn').addEventListener('click', async () => {
      if (!confirm('Apagar este treino?')) return;
      await db.deleteWorkout(w.id);
      renderHistory();
    });
    list.appendChild(el);
  }
}

function exerciseLine(g, partner) {
  const icon = g.kind === 'cardio' ? '🏃' : '🏋️';
  const lead = g.exercise.image_url
    ? `<img class="ex-thumb-sm" src="${escapeHtml(g.exercise.image_url)}" data-name="${escapeHtml(g.exercise.name)}" alt="" />`
    : icon;
  const forWho = g.forWho || 'both';
  const partnerLabel = partner || 'Parceiro/a';
  const whoTag = (partner && forWho === 'me') ? ` <span class="ppl">(Eu)</span>`
    : (partner && forWho === 'partner') ? ` <span class="ppl">(${escapeHtml(partnerLabel)})</span>` : '';

  if (g.kind === 'cardio') {
    const r = g.rows[0] || {};
    const parts = [];
    if (r.durationMin) parts.push(`${fmtNum(r.durationMin)} min`);
    if (r.distanceKm) parts.push(`${fmtNum(r.distanceKm)} km`);
    if (r.inclinePct) parts.push(`${fmtNum(r.inclinePct)}% incl.`);
    return `<div class="exercise-line">
      <div class="ex-title">${lead} ${escapeHtml(g.exercise.name)}${whoTag}</div>
      <div class="ex-sets">${parts.join(' · ') || '—'}</div>
    </div>`;
  }

  if (partner && forWho === 'both') {
    const mine = g.rows.map((r) => `${fmtNum(r.weight)}×${r.reps}`).join(' · ');
    const theirs = g.rows.map((r) => `${fmtNum(r.weightPartner)}×${r.reps}`).join(' · ');
    return `<div class="exercise-line">
      <div class="ex-title">${lead} ${escapeHtml(g.exercise.name)}</div>
      <div class="ex-sets"><span class="ppl">Eu:</span> ${mine}</div>
      <div class="ex-sets"><span class="ppl">${escapeHtml(partnerLabel)}:</span> ${theirs}</div>
    </div>`;
  }
  const line = forWho === 'partner'
    ? g.rows.map((r) => `${fmtNum(r.weightPartner)}×${r.reps}`).join(' · ')
    : g.rows.map((r) => `${fmtNum(r.weight)}×${r.reps}`).join(' · ');
  return `<div class="exercise-line">
    <div class="ex-title">${lead} ${escapeHtml(g.exercise.name)}${whoTag}</div>
    <div class="ex-sets">${line}</div>
  </div>`;
}

// ------------------------------------------------------------
//  Progresso
// ------------------------------------------------------------
const progressSelect = $('#progress-exercise');
let currentPerson = 'me';

progressSelect.addEventListener('change', () => { currentPerson = 'me'; syncSeg(); renderProgressChart(); });
$$('#progress-person .seg-btn').forEach((b) =>
  b.addEventListener('click', () => { currentPerson = b.dataset.person; syncSeg(); renderProgressChart(); })
);
function syncSeg() {
  $$('#progress-person .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.person === currentPerson));
}

// ---------- Resumo geral (Mês / Ano) ----------
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
let reviewGranularity = 'month';
let reviewWorkouts = null;

$$('#review-toggle .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    reviewGranularity = b.dataset.gran;
    $$('#review-toggle .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.gran === reviewGranularity));
    if (reviewWorkouts) renderReview(reviewWorkouts);
  })
);

function computeReview(workouts, gran) {
  const now = new Date();
  const buckets = [];
  if (gran === 'month') {
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS_SHORT[d.getMonth()], count: 0 });
    }
  } else {
    const years = workouts.map((w) => +(w.date || '').slice(0, 4)).filter(Boolean);
    const minY = years.length ? Math.min(...years) : now.getFullYear();
    for (let y = minY; y <= now.getFullYear(); y++) buckets.push({ key: String(y), label: String(y), count: 0 });
  }
  const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
  for (const w of workouts) {
    const key = gran === 'month' ? (w.date || '').slice(0, 7) : (w.date || '').slice(0, 4);
    if (idx[key] != null) buckets[idx[key]].count++;
  }
  return buckets;
}

function renderReview(workouts) {
  const statsEl = $('#review-stats'), chartEl = $('#review-chart'), empty = $('#review-empty');
  if (!workouts.length) { empty.hidden = false; statsEl.innerHTML = ''; chartEl.innerHTML = ''; return; }
  empty.hidden = true;
  const withDur = workouts.filter((w) => w.durationSec);
  const avgSec = withDur.length ? Math.round(withDur.reduce((s, w) => s + w.durationSec, 0) / withDur.length) : 0;
  const now = new Date();
  const periodCount = reviewGranularity === 'month'
    ? workouts.filter((w) => { const d = new Date(w.date + 'T00:00:00'); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length
    : workouts.filter((w) => +(w.date || '').slice(0, 4) === now.getFullYear()).length;
  statsEl.innerHTML =
    card(workouts.length, 'Treinos') +
    card(formatDuration(avgSec) || '—', 'Duração média') +
    card(periodCount, reviewGranularity === 'month' ? 'Este mês' : 'Este ano');
  chartEl.innerHTML = buildBarChart(computeReview(workouts, reviewGranularity));
}

function buildBarChart(buckets) {
  const W = 320, H = 150, padL = 8, padR = 8, padT = 20, padB = 22;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const n = buckets.length, gap = 8;
  const bw = (W - padL - padR - gap * (n - 1)) / n;
  const bars = buckets.map((b, i) => {
    const h = (b.count / max) * (H - padT - padB);
    const x = padL + i * (bw + gap);
    const y = H - padB - h;
    const cx = x + bw / 2;
    return `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" />
      ${b.count ? `<text class="bar-val" x="${cx.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${b.count}</text>` : ''}
      <text class="chart-label" x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle">${escapeHtml(b.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Treinos por período">
    <line class="chart-grid" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" />
    ${bars}
  </svg>`;
}

async function renderProgressView() {
  const [exercises, workouts] = await Promise.all([db.listExercises(), db.listWorkouts()]);
  reviewWorkouts = workouts;
  renderReview(workouts);
  $('#progress-person [data-person="partner"]').textContent = partnerName();
  const prev = progressSelect.value;
  progressSelect.innerHTML = exercises.length
    ? exercises.map((e) => `<option value="${e.id}" data-kind="${e.kind}">${e.kind === 'cardio' ? '🏃' : '🏋️'} ${escapeHtml(e.name)}</option>`).join('')
    : '<option value="">— sem exercícios ainda —</option>';
  if (exercises.some((e) => e.id === prev)) progressSelect.value = prev;
  renderProgressChart();
}

async function renderProgressChart() {
  const chartWrap = $('#progress-chart');
  const statsEl = $('#progress-stats');
  const tableEl = $('#progress-table');
  const empty = $('#progress-empty');
  const seg = $('#progress-person');
  chartWrap.innerHTML = '';
  statsEl.innerHTML = '';
  tableEl.innerHTML = '';

  const opt = progressSelect.selectedOptions[0];
  const exerciseId = progressSelect.value;
  const kind = opt?.dataset.kind || 'strength';
  if (!exerciseId) { empty.hidden = false; seg.hidden = true; return; }

  const { points } = await db.progressFor(exerciseId, kind);
  empty.hidden = points.length > 0;
  if (!points.length) { seg.hidden = true; return; }

  if (kind === 'cardio') {
    seg.hidden = true;
    const bestDist = Math.max(...points.map((p) => p.bestDistance));
    const bestDur = Math.max(...points.map((p) => p.bestDuration));
    const useDistance = bestDist > 0;
    statsEl.innerHTML = `
      ${card(fmtNum(bestDist) + ' km', 'Melhor distância')}
      ${card(fmtNum(bestDur) + ' min', 'Melhor tempo')}
      ${card(points.length, 'Sessões')}
    `;
    chartWrap.innerHTML = buildChart(points, (p) => (useDistance ? p.bestDistance : p.bestDuration), true);
    const rows = points.slice().reverse().map((p) =>
      `<tr><td>${prettyDate(p.date)}</td><td>${fmtNum(p.bestDistance)} km</td><td>${fmtNum(p.bestDuration)} min</td></tr>`
    ).join('');
    tableEl.innerHTML = `<table class="prog-table"><thead><tr><th>Data</th><th>Distância</th><th>Tempo</th></tr></thead><tbody>${rows}</tbody></table>`;
    return;
  }

  // Força
  const hasPartner = points.some((p) => p.bestWeightPartner > 0);
  seg.hidden = !hasPartner;
  if (!hasPartner) currentPerson = 'me';
  syncSeg();
  const isPartner = currentPerson === 'partner';
  const weightOf = (p) => (isPartner ? p.bestWeightPartner : p.bestWeight);
  const rmOf = (p) => (isPartner ? p.best1RMPartner : p.best1RM);
  const topOf = (p) => (isPartner ? p.topSetPartner : p.topSet);

  const bestWeight = Math.max(...points.map(weightOf));
  const best1RM = Math.max(...points.map(rmOf));
  statsEl.innerHTML = `
    ${card(fmtNum(bestWeight) + ' kg', 'Melhor peso')}
    ${card(fmtNum(best1RM) + ' kg', '1RM estimado')}
    ${card(points.length, 'Sessões')}
  `;
  chartWrap.innerHTML = buildChart(points, weightOf, false);
  const rows = points.slice().reverse().map((p) => {
    const t = topOf(p);
    return `<tr><td>${prettyDate(p.date)}</td><td>${t ? `${fmtNum(t.weight)}×${t.reps}` : '—'}</td><td>${fmtNum(rmOf(p))} kg</td></tr>`;
  }).join('');
  tableEl.innerHTML = `<table class="prog-table"><thead><tr><th>Data</th><th>Melhor série</th><th>1RM est.</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Gráfico de linha em SVG (sem bibliotecas).
function buildChart(points, valueFn, isCardio) {
  const W = 320, H = 150, padL = 36, padR = 12, padT = 14, padB = 26;
  const values = points.map(valueFn);
  const maxV = Math.max(...values), minV = Math.min(...values);
  const span = maxV - minV || 1;
  const yMax = maxV + span * 0.15;
  const yMin = Math.max(0, minV - span * 0.15);

  const x = (i) => points.length === 1 ? padL + (W - padL - padR) / 2 : padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);

  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(valueFn(p)).toFixed(1)}`);
  const linePath = 'M' + pts.join(' L');
  const areaPath = `M${x(0).toFixed(1)},${(H - padB).toFixed(1)} L${pts.join(' L')} L${x(points.length - 1).toFixed(1)},${(H - padB).toFixed(1)} Z`;
  const dots = points.map((p, i) => `<circle class="chart-dot${isCardio ? ' cardio' : ''}" cx="${x(i).toFixed(1)}" cy="${y(valueFn(p)).toFixed(1)}" r="3" />`).join('');
  const c = isCardio ? ' cardio' : '';

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução">
    <defs>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4ade80" stop-opacity="0.28" /><stop offset="100%" stop-color="#4ade80" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="areaGradCardio" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.28" /><stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
      </linearGradient>
    </defs>
    <line class="chart-grid" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" />
    <path class="chart-area${c}" d="${areaPath}" />
    <path class="chart-line${c}" d="${linePath}" />
    ${dots}
    <text class="chart-label" x="4" y="${(y(yMax) + 4).toFixed(1)}">${fmtNum(Math.round(yMax))}</text>
    <text class="chart-label" x="4" y="${(y(yMin) + 4).toFixed(1)}">${fmtNum(Math.round(yMin))}</text>
    <text class="chart-label" x="${padL}" y="${H - 8}">${prettyDate(points[0].date)}</text>
    <text class="chart-label" x="${W - padR}" y="${H - 8}" text-anchor="end">${prettyDate(points[points.length - 1].date)}</text>
  </svg>`;
}

// ------------------------------------------------------------
//  Catálogo de exercícios (para os <select>)
// ------------------------------------------------------------
async function refreshExerciseLists() {
  try {
    exerciseCache = await db.listExercises();
  } catch (err) {
    console.error(err);
  }
}

// ------------------------------------------------------------
//  Imagens de exercícios (free-exercise-db, grátis, sem chave)
// ------------------------------------------------------------
const DB_URL = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json';
const IMG_BASE = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/';
// Sinónimos PT→EN para a pesquisa (a base está em inglês).
const PT_SYN = {
  supino: 'bench', agachamento: 'squat', 'peso morto': 'deadlift', rosca: 'curl',
  biceps: 'curl', bíceps: 'curl', triceps: 'tricep', tríceps: 'tricep', remada: 'row',
  desenvolvimento: 'press', ombro: 'shoulder', ombros: 'shoulder', afundo: 'lunge',
  extensao: 'extension', extensão: 'extension', flexao: 'push-up', flexão: 'push-up',
  peito: 'chest', costas: 'back', perna: 'leg', pernas: 'leg', gluteo: 'glute', glúteo: 'glute',
  elevacao: 'raise', elevação: 'raise', panturrilha: 'calf', gemeos: 'calf', gémeos: 'calf',
  abdominais: 'crunch', abdominal: 'crunch', prancha: 'plank',
};

let exerciseDb = null;
let imgTargetCard = null;

async function loadExerciseDb() {
  if (exerciseDb) return exerciseDb;
  $('#img-status').textContent = 'A carregar base de exercícios…';
  try {
    exerciseDb = await (await fetch(DB_URL)).json();
    $('#img-status').textContent = '';
  } catch (e) {
    console.error(e);
    exerciseDb = [];
    $('#img-status').textContent = 'Não foi possível carregar as imagens.';
  }
  return exerciseDb;
}

function searchTerms(q) {
  q = (q || '').toLowerCase().trim();
  const terms = new Set();
  if (q) terms.add(q);
  for (const [pt, en] of Object.entries(PT_SYN)) if (q.includes(pt)) terms.add(en);
  return [...terms];
}

function renderImageResults(q) {
  const results = $('#img-results');
  if (!exerciseDb || !exerciseDb.length) { results.innerHTML = ''; return; }
  const terms = searchTerms(q);
  const list = !terms.length
    ? exerciseDb.slice(0, 24)
    : exerciseDb.filter((e) => { const n = e.name.toLowerCase(); return terms.some((t) => n.includes(t)); }).slice(0, 30);
  if (!list.length) {
    results.innerHTML = '';
    $('#img-status').textContent = 'Sem resultados. Tenta em inglês (bench, squat…).';
    return;
  }
  $('#img-status').textContent = '';
  results.innerHTML = list.map((e) => {
    const url = IMG_BASE + (e.images && e.images[0] ? e.images[0] : '');
    return `<div class="img-item" data-url="${escapeHtml(url)}"><img loading="lazy" src="${escapeHtml(url)}" alt="${escapeHtml(e.name)}" /><span>${escapeHtml(e.name)}</span></div>`;
  }).join('');
  $$('.img-item', results).forEach((el) => el.addEventListener('click', () => pickImage(el.dataset.url)));
}

async function openImagePicker(card) {
  imgTargetCard = card;
  $('#img-overlay').hidden = false;
  const search = $('#img-search');
  const typed = card.querySelector('.ex-name-new')?.value?.trim() || '';
  search.value = typed;
  await loadExerciseDb();
  renderImageResults(search.value);
  search.focus();
}

function pickImage(url) {
  if (imgTargetCard) {
    imgTargetCard.dataset.imageUrl = url;
    updateCardImage(imgTargetCard);
    persistActive();
  }
  closeImagePicker();
}

function closeImagePicker() {
  $('#img-overlay').hidden = true;
  imgTargetCard = null;
}

// Mostra miniatura + botão de escolher imagem conforme o estado do cartão.
function updateCardImage(card) {
  const sel = card.querySelector('.ex-select');
  const val = sel.value;
  const thumb = card.querySelector('.ex-thumb');
  const pickBtn = card.querySelector('.pick-image');
  let img = card.dataset.imageUrl || '';
  if (!img && val && val !== '__new__') {
    const ex = exerciseCache.find((e) => e.name === val);
    if (ex && ex.image_url) img = ex.image_url;
  }
  if (img) { thumb.src = img; thumb.hidden = false; } else { thumb.hidden = true; thumb.removeAttribute('src'); }
  const isNew = val === '__new__';
  pickBtn.hidden = !(isNew || (val && val !== '__new__' && !img));
}

$('#img-close').addEventListener('click', closeImagePicker);
$('#img-overlay').addEventListener('click', (e) => { if (e.target.id === 'img-overlay') closeImagePicker(); });
$('#img-search').addEventListener('input', (e) => renderImageResults(e.target.value));

// ------------------------------------------------------------
//  Detalhe do exercício (foto expandida + instruções)
// ------------------------------------------------------------
const MUSCLE_PT = {
  abdominals: 'abdominais', abductors: 'abdutores', adductors: 'adutores', biceps: 'bíceps',
  calves: 'gémeos', chest: 'peito', forearms: 'antebraços', glutes: 'glúteos',
  hamstrings: 'isquiotibiais', lats: 'dorsais', 'lower back': 'lombar', 'middle back': 'costas',
  neck: 'pescoço', quadriceps: 'quadríceps', shoulders: 'ombros', traps: 'trapézios', triceps: 'tríceps',
};
const dbIdFromImage = (url) => { const s = (url || '').split('/exercises/')[1]; return s ? s.split('/')[0] : null; };

async function openExerciseDetail(imageUrl, name) {
  const overlay = $('#detail-overlay'), body = $('#detail-body');
  $('#detail-title').textContent = name || 'Exercício';
  body.innerHTML = '<p class="img-status">A carregar…</p>';
  overlay.hidden = false;
  await loadExerciseDb();
  const id = dbIdFromImage(imageUrl);
  const ex = id ? exerciseDb.find((e) => e.id === id) : null;

  const imgUrls = ex?.images?.length ? ex.images.map((p) => IMG_BASE + p) : (imageUrl ? [imageUrl] : []);
  let html = '';
  if (imgUrls.length) html += `<div class="detail-imgs">${imgUrls.map((u) => `<img src="${escapeHtml(u)}" alt="" />`).join('')}</div>`;
  if (ex) {
    const chips = [
      ...(ex.primaryMuscles || []).map((m) => `<span class="detail-chip muscle">${escapeHtml(MUSCLE_PT[m] || m)}</span>`),
      ex.equipment ? `<span class="detail-chip">${escapeHtml(ex.equipment)}</span>` : '',
    ].filter(Boolean).join('');
    if (chips) html += `<div class="detail-meta">${chips}</div>`;
    if (ex.instructions?.length) {
      html += `<p class="detail-note">Como fazer (em inglês, da base de exercícios):</p>`;
      html += `<ol class="detail-steps">${ex.instructions.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
    }
  }
  if (!ex || !ex.instructions?.length) html += `<p class="img-status">Sem descrição disponível para este exercício.</p>`;
  body.innerHTML = html;
}
function closeExerciseDetail() { $('#detail-overlay').hidden = true; }
$('#detail-close').addEventListener('click', closeExerciseDetail);
$('#detail-overlay').addEventListener('click', (e) => { if (e.target.id === 'detail-overlay') closeExerciseDetail(); });

function exNameOf(card) {
  const sel = card.querySelector('.ex-select');
  return sel.value === '__new__' ? card.querySelector('.ex-name-new').value : sel.value;
}

// Tocar numa miniatura no Histórico → abre o detalhe.
$('#history-list').addEventListener('click', (e) => {
  const img = e.target.closest('.ex-thumb-sm');
  if (img) openExerciseDetail(img.getAttribute('src'), img.dataset.name || '');
});

// ------------------------------------------------------------
//  Arranque
// ------------------------------------------------------------
let appBooted = false;
let currentSpace = null;

async function bootApp() {
  if (appBooted) return;
  appBooted = true;
  $('#workout-date').value = todayISO();
  applyPartnerUI();
  await refreshExerciseLists();
  restoreActive(); // retoma um treino em curso, se existir
}

function setBadge() {
  const badge = $('#backend-badge');
  if (db.kind === 'cloud') {
    badge.textContent = '☁ Cloud';
    badge.classList.add('cloud');
    badge.title = 'Ligado ao Supabase';
  } else {
    badge.textContent = '📱 Local';
    badge.title = 'Guardado neste dispositivo (localStorage).';
  }
}

function showScreen(which) { // 'auth' | 'space' | 'app'
  $('#view-auth').hidden = which !== 'auth';
  $('#view-space').hidden = which !== 'space';
  $('#app-shell').hidden = which !== 'app';
}

function authMsg(m, err) { const el = $('#auth-msg'); el.textContent = m || ''; el.hidden = !m; el.className = 'auth-msg' + (m ? (err ? ' err' : ' ok') : ''); }
function spaceMsg(m, err) { const el = $('#space-msg'); el.textContent = m || ''; el.hidden = !m; el.className = 'auth-msg' + (m ? (err ? ' err' : ' ok') : ''); }
function fillAccount(session) {
  $('#account-email').textContent = session?.user?.email || '(Google)';
  $('#account-space').textContent = currentSpace?.name || '—';
  $('#invite-code').textContent = currentSpace?.invite_code || '------';
}

async function routeAuth(session) {
  if (!session) { appBooted = false; currentSpace = null; showScreen('auth'); return; }
  let spaces = [];
  try { spaces = await db.mySpaces(); } catch (e) { console.error(e); }
  if (!spaces.length) { showScreen('space'); return; }
  currentSpace = spaces[0];
  db.setSpace(currentSpace.id);
  fillAccount(session);
  showScreen('app');
  await bootApp();
}

function wireAuthUI() {
  let mode = 'signin';
  const paint = () => {
    $('#auth-sub').textContent = mode === 'signin' ? 'Entra para registares os teus treinos.' : 'Cria a tua conta (registo instantâneo).';
    $('#auth-submit').textContent = mode === 'signin' ? 'Entrar' : 'Criar conta';
    $('#auth-pass').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    $('#auth-toggle-txt').textContent = mode === 'signin' ? 'Ainda não tens conta?' : 'Já tens conta?';
    $('#auth-toggle-btn').textContent = mode === 'signin' ? 'Criar conta' : 'Entrar';
  };
  $('#auth-toggle-btn').addEventListener('click', () => { mode = mode === 'signin' ? 'signup' : 'signin'; authMsg(''); paint(); });
  paint();

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim(), pass = $('#auth-pass').value;
    const btn = $('#auth-submit'); btn.disabled = true; authMsg('');
    try {
      const res = mode === 'signin' ? await db.signInEmail(email, pass) : await db.signUpEmail(email, pass);
      if (res.error) authMsg(res.error.message, true);
      else if (mode === 'signup' && !res.data.session) { authMsg('Conta criada! Confirma o email e depois entra.'); mode = 'signin'; paint(); }
      // caso contrário, onAuthChange trata da rota
    } catch (err) { authMsg(err.message || String(err), true); }
    finally { btn.disabled = false; }
  });

  $('#google-btn').addEventListener('click', async () => {
    authMsg('');
    try { const res = await db.signInGoogle(); if (res?.error) authMsg(res.error.message, true); }
    catch (err) { authMsg(err.message || String(err), true); }
  });

  $('#create-space-form').addEventListener('submit', async (e) => {
    e.preventDefault(); spaceMsg('');
    try { await db.createSpace($('#space-name').value); const { data } = await db.getSession(); routeAuth(data.session); }
    catch (err) { spaceMsg(err.message || String(err), true); }
  });
  $('#join-space-form').addEventListener('submit', async (e) => {
    e.preventDefault(); spaceMsg('');
    try { await db.joinSpace($('#join-code').value); const { data } = await db.getSession(); routeAuth(data.session); }
    catch (err) { spaceMsg(err.message || String(err), true); }
  });
  $('#space-logout').addEventListener('click', () => db.signOut());

  $('#account-btn').addEventListener('click', () => { $('#account-overlay').hidden = false; });
  $('#account-close').addEventListener('click', () => { $('#account-overlay').hidden = true; });
  $('#account-overlay').addEventListener('click', (e) => { if (e.target.id === 'account-overlay') $('#account-overlay').hidden = true; });
  $('#logout-btn').addEventListener('click', () => { $('#account-overlay').hidden = true; db.signOut(); });
  $('#copy-code').addEventListener('click', () => {
    const code = $('#invite-code').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Código copiado 📋')).catch(() => {});
  });
}

async function init() {
  setBadge();
  if (!db.requiresAuth) { // modo local — sem login
    $('#account-btn').hidden = true;
    showScreen('app');
    await bootApp();
    return;
  }
  $('#account-btn').hidden = false;
  wireAuthUI();
  db.onAuthChange((session) => setTimeout(() => routeAuth(session), 0));
  // Rota inicial explícita — não depender só do onAuthChange (evita ecrã em branco).
  try {
    const { data } = await db.getSession();
    routeAuth(data.session);
  } catch (e) {
    console.error(e);
    showScreen('auth');
  }
}

init();
