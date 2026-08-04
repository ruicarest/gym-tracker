// ============================================================
//  Camada de dados. Interface única (`db`) que funciona quer com
//  Supabase (cloud) quer com localStorage (local). A app (app.js)
//  não sabe qual está a ser usado.
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
        .select('id, name, kind, muscle_group, image_url')
        .order('name');
      if (error) throw error;
      return data;
    },

    async getOrCreateExercise(name, exKind, muscleGroup, imageUrl) {
      const clean = name.trim();
      const { data: found } = await supabase
        .from('exercises')
        .select('id, name, kind, muscle_group, image_url')
        .ilike('name', clean)
        .maybeSingle();
      if (found) {
        if (imageUrl && !found.image_url) {
          await supabase.from('exercises').update({ image_url: imageUrl }).eq('id', found.id);
          found.image_url = imageUrl;
        }
        return found;
      }

      const { data, error } = await supabase
        .from('exercises')
        .insert({ name: clean, kind: exKind || 'strength', muscle_group: muscleGroup || null, image_url: imageUrl || null })
        .select('id, name, kind, muscle_group, image_url')
        .single();
      if (error) throw error;
      return data;
    },

    async addWorkout(w) {
      const { data: workout, error: wErr } = await supabase
        .from('workouts')
        .insert({
          date: w.date,
          type: w.type || null,
          notes: w.notes || null,
          partner: w.partner || null,
          started_at: w.startedAt || null,
          ended_at: w.endedAt || null,
          duration_sec: w.durationSec ?? null,
        })
        .select('id')
        .single();
      if (wErr) throw wErr;

      const rows = [];
      let pos = 0;
      for (const entry of w.entries) {
        const ex = await this.getOrCreateExercise(entry.name, entry.kind, entry.muscleGroup, entry.imageUrl);
        for (const r of entry.rows) {
          rows.push({
            workout_id: workout.id,
            exercise_id: ex.id,
            position: ++pos,
            weight: r.weight ?? null,
            weight_partner: r.weightPartner ?? null,
            reps: r.reps ?? null,
            duration_min: r.durationMin ?? null,
            distance_km: r.distanceKm ?? null,
          });
        }
      }
      if (rows.length) {
        const { error: eErr } = await supabase.from('entries').insert(rows);
        if (eErr) throw eErr;
      }
      return workout.id;
    },

    async listWorkouts() {
      const { data, error } = await supabase
        .from('workouts')
        .select(
          'id, date, type, notes, partner, duration_sec, ' +
            'entries(id, position, weight, weight_partner, reps, duration_min, distance_km, ' +
            'exercise:exercises(id, name, kind, muscle_group, image_url))'
        )
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeWorkout);
    },

    async deleteWorkout(id) {
      const { error } = await supabase.from('workouts').delete().eq('id', id);
      if (error) throw error;
    },

    async progressFor(exerciseId, exKind) {
      const { data, error } = await supabase
        .from('entries')
        .select('weight, weight_partner, reps, duration_min, distance_km, workout:workouts(date)')
        .eq('exercise_id', exerciseId);
      if (error) throw error;
      const flat = (data || []).map((r) => ({
        date: r.workout?.date,
        weight: r.weight,
        weightPartner: r.weight_partner,
        reps: r.reps,
        durationMin: r.duration_min,
        distanceKm: r.distance_km,
      }));
      return exKind === 'cardio'
        ? { kind: 'cardio', points: groupProgressCardio(flat) }
        : { kind: 'strength', points: groupProgressStrength(flat) };
    },
  };
}

// ------------------------------------------------------------
//  BACKEND: localStorage (fallback offline / sem config)
// ------------------------------------------------------------
const LS_KEY = 'gymtracker.v2';

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || { exercises: [], workouts: [], entries: [] };
  } catch {
    return { exercises: [], workouts: [], entries: [] };
  }
}
function saveStore(store) {
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}
function uid() {
  return 'id-' + Math.random().toString(36).slice(2) + '-' + performance.now().toString(36);
}

function localBackend() {
  // Pré-carrega os exercícios de cardio na primeira utilização.
  const seed = loadStore();
  if (!seed.exercises.length) {
    seed.exercises = ['Corrida', 'Bicicleta', 'Remo', 'Elíptica'].map((name) => ({
      id: uid(), name, kind: 'cardio', muscle_group: 'cardio',
    }));
    saveStore(seed);
  }

  function findOrCreate(store, name, exKind, muscleGroup, imageUrl) {
    const clean = name.trim();
    let ex = store.exercises.find((e) => e.name.toLowerCase() === clean.toLowerCase());
    if (!ex) {
      ex = { id: uid(), name: clean, kind: exKind || 'strength', muscle_group: muscleGroup || null, image_url: imageUrl || null };
      store.exercises.push(ex);
    } else if (imageUrl && !ex.image_url) {
      ex.image_url = imageUrl;
    }
    return ex;
  }

  return {
    kind: 'local',

    async listExercises() {
      return loadStore().exercises.slice().sort((a, b) => a.name.localeCompare(b.name));
    },

    async getOrCreateExercise(name, exKind, muscleGroup, imageUrl) {
      const store = loadStore();
      const ex = findOrCreate(store, name, exKind, muscleGroup, imageUrl);
      saveStore(store);
      return ex;
    },

    async addWorkout(w) {
      const store = loadStore();
      const workout = {
        id: uid(),
        date: w.date,
        type: w.type || null,
        notes: w.notes || null,
        partner: w.partner || null,
        started_at: w.startedAt || null,
        ended_at: w.endedAt || null,
        duration_sec: w.durationSec ?? null,
        created_at: new Date().toISOString(),
      };
      store.workouts.push(workout);

      let pos = 0;
      for (const entry of w.entries) {
        const ex = findOrCreate(store, entry.name, entry.kind, entry.muscleGroup, entry.imageUrl);
        for (const r of entry.rows) {
          store.entries.push({
            id: uid(),
            workout_id: workout.id,
            exercise_id: ex.id,
            position: ++pos,
            weight: r.weight ?? null,
            weight_partner: r.weightPartner ?? null,
            reps: r.reps ?? null,
            duration_min: r.durationMin ?? null,
            distance_km: r.distanceKm ?? null,
          });
        }
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
          const entries = store.entries
            .filter((s) => s.workout_id === w.id)
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map((s) => ({ ...s, exercise: byId[s.exercise_id] || { name: '—', kind: 'strength' } }));
          return normalizeWorkout({ ...w, duration_sec: w.duration_sec, entries });
        });
    },

    async deleteWorkout(id) {
      const store = loadStore();
      store.workouts = store.workouts.filter((w) => w.id !== id);
      store.entries = store.entries.filter((s) => s.workout_id !== id);
      saveStore(store);
    },

    async progressFor(exerciseId, exKind) {
      const store = loadStore();
      const byWorkout = Object.fromEntries(store.workouts.map((w) => [w.id, w]));
      const flat = store.entries
        .filter((s) => s.exercise_id === exerciseId)
        .map((s) => ({
          date: byWorkout[s.workout_id]?.date,
          weight: s.weight,
          weightPartner: s.weight_partner,
          reps: s.reps,
          durationMin: s.duration_min,
          distanceKm: s.distance_km,
        }));
      return exKind === 'cardio'
        ? { kind: 'cardio', points: groupProgressCardio(flat) }
        : { kind: 'strength', points: groupProgressStrength(flat) };
    },
  };
}

// ------------------------------------------------------------
//  Helpers partilhados
// ------------------------------------------------------------
function normalizeWorkout(w) {
  const groups = new Map();
  for (const s of w.entries || []) {
    const ex = s.exercise || { id: s.exercise_id, name: '—', kind: 'strength' };
    if (!groups.has(ex.id)) groups.set(ex.id, { exercise: ex, kind: ex.kind || 'strength', rows: [] });
    groups.get(ex.id).rows.push({
      weight: s.weight,
      weightPartner: s.weight_partner,
      reps: s.reps,
      durationMin: s.duration_min,
      distanceKm: s.distance_km,
      position: s.position,
    });
  }
  for (const g of groups.values()) g.rows.sort((a, b) => (a.position || 0) - (b.position || 0));

  const exercises = [...groups.values()];
  const strengthSets = (w.entries || []).filter((s) => (s.exercise?.kind || 'strength') === 'strength').length;
  const totalVolume = (w.entries || []).reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
  const hasPartner = !!w.partner;

  return {
    id: w.id,
    date: w.date,
    type: w.type,
    notes: w.notes,
    partner: w.partner,
    hasPartner,
    durationSec: w.duration_sec ?? null,
    exercises,
    totalSets: strengthSets,
    totalVolume,
  };
}

function groupProgressStrength(flat) {
  const byDate = new Map();
  for (const r of flat) {
    if (!r.date) continue;
    const cur = byDate.get(r.date) || {
      date: r.date,
      bestWeight: 0, best1RM: 0, topSet: null,
      bestWeightPartner: 0, best1RMPartner: 0, topSetPartner: null,
    };
    if ((r.weight || 0) > cur.bestWeight) {
      cur.bestWeight = r.weight || 0;
      cur.topSet = { weight: r.weight, reps: r.reps };
    }
    const e1 = estimate1RM(r.weight, r.reps);
    if (e1 > cur.best1RM) cur.best1RM = e1;

    if ((r.weightPartner || 0) > cur.bestWeightPartner) {
      cur.bestWeightPartner = r.weightPartner || 0;
      cur.topSetPartner = { weight: r.weightPartner, reps: r.reps };
    }
    const e1p = estimate1RM(r.weightPartner, r.reps);
    if (e1p > cur.best1RMPartner) cur.best1RMPartner = e1p;

    byDate.set(r.date, cur);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function groupProgressCardio(flat) {
  const byDate = new Map();
  for (const r of flat) {
    if (!r.date) continue;
    const cur = byDate.get(r.date) || { date: r.date, bestDistance: 0, bestDuration: 0, totalDistance: 0 };
    cur.bestDistance = Math.max(cur.bestDistance, r.distanceKm || 0);
    cur.bestDuration = Math.max(cur.bestDuration, r.durationMin || 0);
    cur.totalDistance += r.distanceKm || 0;
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
