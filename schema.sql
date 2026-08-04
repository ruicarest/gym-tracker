-- ============================================================
--  Gym Tracker — esquema da base de dados (Supabase / PostgreSQL)
--  Corre isto no  SQL Editor  do teu projeto Supabase.
-- ============================================================

-- Exercícios (catálogo, reutilizado entre treinos).
-- kind: 'strength' (peso × reps) ou 'cardio' (minutos + km).
create table if not exists exercises (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  kind          text not null default 'strength' check (kind in ('strength', 'cardio')),
  muscle_group  text,
  created_at    timestamptz not null default now()
);

-- Treinos (sessões)
create table if not exists workouts (
  id            uuid primary key default gen_random_uuid(),
  date          date not null default current_date,
  type          text,
  notes         text,
  partner       text,                 -- nome do parceiro/a (ex: "Cláudia"); null = a solo
  started_at    timestamptz,          -- carimbo do botão "Começar"
  ended_at      timestamptz,          -- carimbo do botão "Terminar"
  duration_sec  integer,              -- duração total do treino, em segundos
  created_at    timestamptz not null default now()
);

-- Registos: uma linha por série (força) ou por bloco de cardio.
--   Força → weight / weight_partner / reps
--   Cardio → duration_min / distance_km
create table if not exists entries (
  id             uuid primary key default gen_random_uuid(),
  workout_id     uuid not null references workouts(id) on delete cascade,
  exercise_id    uuid not null references exercises(id) on delete restrict,
  position       integer,
  weight         numeric,   -- força: o meu peso
  weight_partner numeric,   -- força: peso do parceiro/a
  reps           integer,   -- força
  duration_min   numeric,   -- cardio: minutos
  distance_km    numeric,   -- cardio: km
  created_at     timestamptz not null default now()
);

create index if not exists idx_entries_workout  on entries(workout_id);
create index if not exists idx_entries_exercise on entries(exercise_id);
create index if not exists idx_workouts_date     on workouts(date desc);

-- ============================================================
--  Segurança (modo "sem login")
-- ------------------------------------------------------------
--  Sem autenticação, damos acesso total à chave pública (role
--  "anon"). Qualquer pessoa com o URL do site + a chave pode
--  ler/escrever. Para dados de ginásio é um risco baixo.
--
--  >> Para tornar privado depois: adiciona Supabase Auth e troca
--     estas policies por  "using (auth.uid() = user_id)".
-- ============================================================
alter table exercises enable row level security;
alter table workouts  enable row level security;
alter table entries   enable row level security;

create policy "anon full access - exercises" on exercises
  for all to anon using (true) with check (true);
create policy "anon full access - workouts" on workouts
  for all to anon using (true) with check (true);
create policy "anon full access - entries" on entries
  for all to anon using (true) with check (true);

-- ============================================================
--  Exercícios pré-carregados (podes apagar/editar à vontade)
-- ============================================================
insert into exercises (name, kind, muscle_group) values
  ('Corrida',   'cardio', 'cardio'),
  ('Bicicleta', 'cardio', 'cardio'),
  ('Remo',      'cardio', 'cardio'),
  ('Elíptica',  'cardio', 'cardio')
on conflict (name) do nothing;
