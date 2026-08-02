-- ============================================================
--  Gym Tracker — esquema da base de dados (Supabase / PostgreSQL)
--  Corre isto no  SQL Editor  do teu projeto Supabase.
-- ============================================================

-- Exercícios (catálogo, reutilizado entre treinos)
create table if not exists exercises (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  muscle_group  text,
  created_at    timestamptz not null default now()
);

-- Treinos (sessões)
create table if not exists workouts (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default current_date,
  type        text,
  notes       text,
  created_at  timestamptz not null default now()
);

-- Séries (peso × reps de um exercício num treino)
create table if not exists sets (
  id           uuid primary key default gen_random_uuid(),
  workout_id   uuid not null references workouts(id) on delete cascade,
  exercise_id  uuid not null references exercises(id) on delete restrict,
  weight       numeric,
  reps         integer,
  position     integer,
  created_at   timestamptz not null default now()
);

create index if not exists idx_sets_workout  on sets(workout_id);
create index if not exists idx_sets_exercise on sets(exercise_id);
create index if not exists idx_workouts_date on workouts(date desc);

-- ============================================================
--  Segurança (modo "sem login")
-- ------------------------------------------------------------
--  Como não há autenticação, damos acesso total à chave pública
--  (role "anon"). Isto significa que QUALQUER pessoa com o URL do
--  site e a chave pode ler/escrever. Para dados de ginásio é um
--  risco baixo e aceitável.
--
--  >> Quando quiseres tornar privado: adiciona Supabase Auth e
--     troca estas policies por  "using (auth.uid() = user_id)".
-- ============================================================
alter table exercises enable row level security;
alter table workouts  enable row level security;
alter table sets      enable row level security;

create policy "anon full access - exercises" on exercises
  for all to anon using (true) with check (true);
create policy "anon full access - workouts" on workouts
  for all to anon using (true) with check (true);
create policy "anon full access - sets" on sets
  for all to anon using (true) with check (true);
