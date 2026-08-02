import { db, estimate1RM } from './db.js';

// ------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

const dateFmt = new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return dateFmt.format(d).replace('.', '');
}
function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

// ------------------------------------------------------------
//  Navegação por abas
// ------------------------------------------------------------
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

function switchView(viewId) {
  $$('.view').forEach((v) => (v.hidden = v.id !== viewId));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === viewId));
  if (viewId === 'view-history') renderHistory();
  if (viewId === 'view-progress') renderProgressView();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------
//  Formulário: Novo treino
// ------------------------------------------------------------
const exercisesEl = $('#exercises');

function addSetRow(setsEl, weight = '', reps = '') {
  const node = $('#set-template').content.firstElementChild.cloneNode(true);
  node.querySelector('.set-weight').value = weight;
  node.querySelector('.set-reps').value = reps;
  node.querySelector('.remove-set').addEventListener('click', () => {
    node.remove();
    renumberSets(setsEl);
  });
  setsEl.appendChild(node);
  renumberSets(setsEl);
}

function renumberSets(setsEl) {
  $$('.set-row .set-index', setsEl).forEach((el, i) => (el.textContent = i + 1));
}

function addExerciseCard(focus = false) {
  const node = $('#exercise-template').content.firstElementChild.cloneNode(true);
  const setsEl = node.querySelector('.sets');
  node.querySelector('.add-set').addEventListener('click', () => addSetRow(setsEl));
  node.querySelector('.remove-exercise').addEventListener('click', () => {
    node.remove();
    if (!$$('.exercise-card').length) addExerciseCard();
  });
  addSetRow(setsEl); // começa com uma série
  exercisesEl.appendChild(node);
  if (focus) node.querySelector('.ex-name').focus();
}

$('#add-exercise').addEventListener('click', () => addExerciseCard(true));

function collectEntries() {
  const entries = [];
  for (const card of $$('.exercise-card')) {
    const name = card.querySelector('.ex-name').value.trim();
    if (!name) continue;
    const sets = [];
    for (const row of $$('.set-row', card)) {
      const reps = parseInt(row.querySelector('.set-reps').value, 10);
      if (!reps || reps <= 0) continue; // série sem reps é ignorada
      const weight = parseFloat(row.querySelector('.set-weight').value) || 0;
      sets.push({ weight, reps });
    }
    if (sets.length) entries.push({ name, sets });
  }
  return entries;
}

function resetForm() {
  exercisesEl.innerHTML = '';
  addExerciseCard();
  $('#workout-notes').value = '';
  $('#workout-date').value = todayISO();
}

$('#workout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entries = collectEntries();
  if (!entries.length) {
    toast('Adiciona pelo menos um exercício com séries', true);
    return;
  }
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    await db.addWorkout({
      date: $('#workout-date').value || todayISO(),
      type: $('#workout-type').value.trim(),
      notes: $('#workout-notes').value.trim(),
      entries,
    });
    resetForm();
    await refreshExerciseLists();
    toast('Treino guardado 💪');
    switchView('view-history');
  } catch (err) {
    console.error(err);
    toast('Erro ao guardar: ' + (err.message || err), true);
  } finally {
    if (btn) btn.disabled = false;
  }
});

// ------------------------------------------------------------
//  Histórico
// ------------------------------------------------------------
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

  // Cartões de resumo
  const now = new Date();
  const thisMonth = workouts.filter((w) => {
    const d = new Date(w.date + 'T00:00:00');
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const volume = workouts.reduce((s, w) => s + w.totalVolume, 0);
  summary.innerHTML = `
    ${card(workouts.length, 'Treinos')}
    ${card(thisMonth, 'Este mês')}
    ${card(fmtNum(volume / 1000) + ' t', 'Volume total')}
  `;

  // Cartões de treino
  for (const w of workouts) {
    const el = document.createElement('div');
    el.className = 'workout-card';
    const lines = w.exercises
      .map((g) => {
        const sets = g.sets.map((s) => `${fmtNum(s.weight)}×${s.reps}`).join(' · ');
        return `<div class="exercise-line">
          <div class="ex-title">${escapeHtml(g.exercise.name)}</div>
          <div class="ex-sets">${sets}</div>
        </div>`;
      })
      .join('');
    el.innerHTML = `
      <div class="wc-head">
        <div>
          <div class="wc-date">${prettyDate(w.date)}</div>
          <div class="wc-sub">${plural(w.exercises.length, 'exercício', 'exercícios')} · ${plural(w.totalSets, 'série', 'séries')}</div>
        </div>
        ${w.type ? `<span class="type-tag">${escapeHtml(w.type)}</span>` : ''}
      </div>
      ${lines}
      ${w.notes ? `<div class="wc-notes">${escapeHtml(w.notes)}</div>` : ''}
      <div class="wc-foot"><button class="icon-btn del-btn">🗑 Apagar</button></div>
    `;
    el.querySelector('.del-btn').addEventListener('click', async () => {
      if (!confirm('Apagar este treino?')) return;
      await db.deleteWorkout(w.id);
      renderHistory();
    });
    list.appendChild(el);
  }
}

function card(value, label) {
  return `<div class="card"><div class="big-num">${value}</div><div class="lbl">${label}</div></div>`;
}

// ------------------------------------------------------------
//  Progresso
// ------------------------------------------------------------
const progressSelect = $('#progress-exercise');
progressSelect.addEventListener('change', () => renderProgressChart(progressSelect.value));

async function renderProgressView() {
  const exercises = await db.listExercises();
  const prev = progressSelect.value;
  progressSelect.innerHTML = exercises.length
    ? exercises.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')
    : '<option value="">— sem exercícios ainda —</option>';
  if (exercises.some((e) => e.id === prev)) progressSelect.value = prev;
  renderProgressChart(progressSelect.value);
}

async function renderProgressChart(exerciseId) {
  const chartWrap = $('#progress-chart');
  const statsEl = $('#progress-stats');
  const tableEl = $('#progress-table');
  const empty = $('#progress-empty');
  chartWrap.innerHTML = '';
  statsEl.innerHTML = '';
  tableEl.innerHTML = '';

  if (!exerciseId) {
    empty.hidden = false;
    return;
  }

  const points = await db.progressFor(exerciseId);
  empty.hidden = points.length > 0;
  if (!points.length) return;

  const bestWeight = Math.max(...points.map((p) => p.bestWeight));
  const best1RM = Math.max(...points.map((p) => p.best1RM));
  statsEl.innerHTML = `
    ${card(fmtNum(bestWeight) + ' kg', 'Melhor peso')}
    ${card(fmtNum(best1RM) + ' kg', '1RM estimado')}
    ${card(points.length, 'Sessões')}
  `;

  chartWrap.innerHTML = buildChart(points);

  const rows = points
    .slice()
    .reverse()
    .map((p) => {
      const top = p.topSet ? `${fmtNum(p.topSet.weight)}×${p.topSet.reps}` : '—';
      return `<tr><td>${prettyDate(p.date)}</td><td>${top}</td><td>${fmtNum(p.best1RM)} kg</td></tr>`;
    })
    .join('');
  tableEl.innerHTML = `<table class="prog-table">
    <thead><tr><th>Data</th><th>Melhor série</th><th>1RM est.</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// Gráfico de linha em SVG (sem bibliotecas).
function buildChart(points) {
  const W = 320, H = 150, padL = 36, padR = 12, padT = 14, padB = 26;
  const values = points.map((p) => p.bestWeight);
  const maxV = Math.max(...values);
  const minV = Math.min(...values);
  const span = maxV - minV || 1;
  const yMax = maxV + span * 0.15;
  const yMin = Math.max(0, minV - span * 0.15);

  const x = (i) => points.length === 1 ? (padL + (W - padL - padR) / 2)
    : padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);

  const linePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.bestWeight).toFixed(1)}`);
  const linePath = 'M' + linePts.join(' L');
  const areaPath = `M${x(0).toFixed(1)},${(H - padB).toFixed(1)} L` +
    linePts.join(' L') + ` L${x(points.length - 1).toFixed(1)},${(H - padB).toFixed(1)} Z`;

  const dots = points.map((p, i) => `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(p.bestWeight).toFixed(1)}" r="3" />`).join('');

  // rótulos do eixo Y (min e max) e X (primeiro e último)
  const yLabels = `
    <text class="chart-label" x="4" y="${(y(yMax) + 4).toFixed(1)}">${fmtNum(Math.round(yMax))}</text>
    <text class="chart-label" x="4" y="${(y(yMin) + 4).toFixed(1)}">${fmtNum(Math.round(yMin))}</text>`;
  const xLabels = `
    <text class="chart-label" x="${padL}" y="${H - 8}">${prettyDate(points[0].date)}</text>
    <text class="chart-label" x="${W - padR}" y="${H - 8}" text-anchor="end">${prettyDate(points[points.length - 1].date)}</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do peso">
    <defs>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4ade80" stop-opacity="0.28" />
        <stop offset="100%" stop-color="#4ade80" stop-opacity="0" />
      </linearGradient>
    </defs>
    <line class="chart-grid" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" />
    <path class="chart-area" d="${areaPath}" />
    <path class="chart-line" d="${linePath}" />
    ${dots}
    ${yLabels}
    ${xLabels}
  </svg>`;
}

// ------------------------------------------------------------
//  Datalist de exercícios (autocomplete no formulário)
// ------------------------------------------------------------
async function refreshExerciseLists() {
  try {
    const exercises = await db.listExercises();
    $('#exercise-options').innerHTML = exercises.map((e) => `<option value="${escapeHtml(e.name)}"></option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

// ------------------------------------------------------------
//  Utils
// ------------------------------------------------------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------
//  Arranque
// ------------------------------------------------------------
function init() {
  $('#workout-date').value = todayISO();
  addExerciseCard();
  refreshExerciseLists();

  const badge = $('#backend-badge');
  if (db.kind === 'cloud') {
    badge.textContent = '☁ Cloud';
    badge.classList.add('cloud');
    badge.title = 'Ligado ao Supabase';
  } else {
    badge.textContent = '📱 Local';
    badge.title = 'Guardado neste dispositivo (localStorage). Configura o Supabase para sincronizar.';
  }
}

init();
