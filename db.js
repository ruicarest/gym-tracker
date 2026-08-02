// ============================================================
//  Camada de dados. Expõe uma interface única (`db`) que funciona
//  quer com Supabase (cloud) quer com localStorage (local).
//  A app (app.js) não sabe qual está a ser usado.
// ============================================================
import { CONFIG } from './config.js';

const isConfigured =
  CONFIG.SUPABASE_URL &&
  CONFIG.SUPABASE_ANON_KEY &&
  !CONFIG.SUPABASE_URL.includes('YOUR_') &&
  !CONFIG.SUPABASE_ANON_KEY.includes('YOUR_');

// Epley: 1RM estimado a partir de peso × repetições.
export function estimate1RM(weight, reps) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

// ------------------------------------------------------------
//  BACKEND: Supabase
// ------------------------------------------------------------
function supabaseBackend(supabase) {
  return {
    kind: 'cloud',

    async listExercises() {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, muscle_group')
        .order('name');
      if (error) throw error;
      return data;
    },

    async getOrCreateExercise(name, muscleGroup) {
      const clean = name.trim();
      const { data: found } = await supabase
        .from('exercises')
        .select('id, name, muscle_group')
        .ilike('name', clean)
        .maybeSingle();
      if (found) return found;

      const { data, error } = await supabase
        .from('exercises')
        .insert({ name: clean, muscle_group: muscleGroup || null })
        .select('id, name, muscle_group')
        .single();
      if (error) throw error;
      return data;
    },

    async addWorkout({ date, type, notes, entries }) {
      const { data: workout, error: wErr } = await supabase
        .from('workouts')
        .insert({ date, type: type || null, notes: notes || null })
        .select('id')
        .single();
      if (wErr) throw wErr;

      const rows = [];
      for (const entry of entries) {
        const ex = await this.getOrCreateExercise(entry.name, entry.muscleGroup);
        entry.sets.forEach((s, i) => {
          rows.push({
            workout_id: workout.id,
            exercise_id: ex.id,
            weight: s.weight,
            reps: s.reps,
            position: i + 1,
          });
        });
      }
      if (rows.length) {
        const { error: sErr } = await supabase.from('sets').insert(rows);
        if (sErr) throw sErr;
      }
      return workout.id;
    },

    async listWorkouts() {
      const { data, error } = await supabase
        .from('workouts')
        .select('id, date, type, notes, sets(id, weight, reps, position, exercise:exercises(id, name, muscle_group))')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeWorkout);
    },

    async deleteWorkout(id) {
      const { error } = await supabase.from('workouts').delete().eq('id', id);
      if (error) throw error;
    },

    async progressFor(exerciseId) {
      const { data, error } = await supabase
        .from('sets')
        .select('weight, reps, workout:workouts(date)')
        .eq('exercise_id', exerciseId);
      if (error) throw error;
      const flat = (data || []).map((r) => ({
        date: r.workout?.date,
        weight: r.weight,
        reps: r.reps,
      }));
      return groupProgress(flat);
    },
  };
}

// ------------------------------------------------------------
//  BACKEND: localStorage (fallback offline / sem config)
// ------------------------------------------------------------
const LS_KEY = 'gymtracker.v1';

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || { exercises: [], workouts: [], sets: [] };
  } catch {
    return { exercises: [], workouts: [], sets: [] };
  }
}
function saveStore(store) {
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}
function uid() {
  return 'id-' + Math.random().toString(36).slice(2) + '-' + performance.now().toString(36);
}

function localBackend() {
  return {
    kind: 'local',

    async listExercises() {
      return loadStore().exercises.slice().sort((a, b) => a.name.localeCompare(b.name));
    },

    async getOrCreateExercise(name, muscleGroup) {
      const store = loadStore();
      const clean = name.trim();
      let ex = store.exercises.find((e) => e.name.toLowerCase() === clean.toLowerCase());
      if (!ex) {
        ex = { id: uid(), name: clean, muscle_group: muscleGroup || null };
        store.exercises.push(ex);
        saveStore(store);
      }
      return ex;
    },

    async addWorkout({ date, type, notes, entries }) {
      const store = loadStore();
      const workout = {
        id: uid(),
        date,
        type: type || null,
        notes: notes || null,
        created_at: new Date().toISOString(),
      };
      store.workouts.push(workout);

      for (const entry of entries) {
        const clean = entry.name.trim();
        let ex = store.exercises.find((e) => e.name.toLowerCase() === clean.toLowerCase());
        if (!ex) {
          ex = { id: uid(), name: clean, muscle_group: entry.muscleGroup || null };
          store.exercises.push(ex);
        }
        entry.sets.forEach((s, i) => {
          store.sets.push({
            id: uid(),
            workout_id: workout.id,
            exercise_id: ex.id,
            weight: s.weight,
            reps: s.reps,
            position: i + 1,
          });
        });
      }
      saveStore(store);
      return workout.id;
    },

    async listWorkouts() {
      const store = loadStore();
      const byId = Object.fromEntries(store.exercises.map((e) => [e.id, e]));
      return store.workouts
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at < b.created_at ? 1 : -1)))
        .map((w) => {
          const sets = store.sets
            .filter((s) => s.workout_id === w.id)
            .sort((a, b) => a.position - b.position)
            .map((s) => ({ ...s, exercise: byId[s.exercise_id] || { name: '—' } }));
          return normalizeWorkout({ ...w, sets });
        });
    },

    async deleteWorkout(id) {
      const store = loadStore();
      store.workouts = store.workouts.filter((w) => w.id !== id);
      store.sets = store.sets.filter((s) => s.workout_id !== id);
      saveStore(store);
    },

    async progressFor(exerciseId) {
      const store = loadStore();
      const byWorkout = Object.fromEntries(store.workouts.map((w) => [w.id, w]));
      const flat = store.sets
        .filter((s) => s.exercise_id === exerciseId)
        .map((s) => ({ date: byWorkout[s.workout_id]?.date, weight: s.weight, reps: s.reps }));
      return groupProgress(flat);
    },
  };
}

// ------------------------------------------------------------
//  Helpers partilhados
// ------------------------------------------------------------
function normalizeWorkout(w) {
  // Agrupa as séries (`sets`) por exercício para a UI.
  const groups = new Map();
  for (const s of w.sets || []) {
    const ex = s.exercise || { id: s.exercise_id, name: '—' };
    if (!groups.has(ex.id)) groups.set(ex.id, { exercise: ex, sets: [] });
    groups.get(ex.id).sets.push({ weight: s.weight, reps: s.reps, position: s.position });
  }
  for (const g of groups.values()) g.sets.sort((a, b) => a.position - b.position);
  return {
    id: w.id,
    date: w.date,
    type: w.type,
    notes: w.notes,
    exercises: [...groups.values()],
    totalSets: (w.sets || []).length,
    totalVolume: (w.sets || []).reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0),
  };
}

function groupProgress(flat) {
  // Um ponto por dia: melhor peso, melhor 1RM estimado e o melhor set.
  const byDate = new Map();
  for (const r of flat) {
    if (!r.date) continue;
    const cur = byDate.get(r.date) || { date: r.date, bestWeight: 0, best1RM: 0, topSet: null };
    if ((r.weight || 0) > cur.bestWeight) {
      cur.bestWeight = r.weight || 0;
      cur.topSet = { weight: r.weight, reps: r.reps };
    }
    const e1rm = estimate1RM(r.weight, r.reps);
    if (e1rm > cur.best1RM) cur.best1RM = e1rm;
    byDate.set(r.date, cur);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ------------------------------------------------------------
//  Seleção do backend + export
// ------------------------------------------------------------
async function makeDb() {
  if (isConfigured) {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      return supabaseBackend(supabase);
    } catch (e) {
      console.error('Falha a ligar ao Supabase, a usar armazenamento local:', e);
    }
  }
  return localBackend();
}

export const db = await makeDb();
