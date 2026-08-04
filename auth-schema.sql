-- ============================================================
--  Gym Tracker — AUTH & espaços partilhados (Fase 1)
--  Aplicado de forma ADITIVA: as policies antigas "anon" ficam
--  a funcionar até ao cutover final (que as remove).
-- ============================================================

-- Espaços de treino (grupos partilhados) --------------------
create table if not exists spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'O meu ginásio',
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists space_members (
  space_id   uuid not null references spaces(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

-- Cada treino / exercício passa a pertencer a um espaço --------
alter table workouts  add column if not exists space_id uuid references spaces(id) on delete cascade;
alter table exercises add column if not exists space_id uuid references spaces(id) on delete cascade;
create index if not exists idx_workouts_space  on workouts(space_id);
create index if not exists idx_exercises_space on exercises(space_id);

-- Helper: o utilizador atual é membro do espaço? --------------
create or replace function is_member(p_space uuid) returns boolean
  language sql security definer stable
  set search_path = public as $$
  select exists (select 1 from space_members m where m.space_id = p_space and m.user_id = auth.uid());
$$;

-- RPCs para criar / entrar num espaço (bypassam RLS) ----------
create or replace function create_space(p_name text default 'O meu ginásio') returns spaces
  language plpgsql security definer set search_path = public as $$
declare s spaces;
begin
  insert into spaces(name, created_by) values (coalesce(nullif(trim(p_name), ''), 'O meu ginásio'), auth.uid()) returning * into s;
  insert into space_members(space_id, user_id) values (s.id, auth.uid());
  return s;
end $$;

create or replace function join_space(p_code text) returns spaces
  language plpgsql security definer set search_path = public as $$
declare s spaces;
begin
  select * into s from spaces where invite_code = upper(trim(p_code));
  if s.id is null then raise exception 'Código de convite inválido'; end if;
  insert into space_members(space_id, user_id) values (s.id, auth.uid()) on conflict do nothing;
  return s;
end $$;

grant execute on function is_member(uuid)   to authenticated;
grant execute on function create_space(text) to authenticated;
grant execute on function join_space(text)   to authenticated;

-- Policies para utilizadores autenticados (coexistem com as "anon") --
alter table spaces        enable row level security;
alter table space_members enable row level security;

create policy "auth reads space"    on spaces        for select to authenticated using (is_member(id));
create policy "auth reads members"  on space_members for select to authenticated using (is_member(space_id));
create policy "auth rw workouts"    on workouts  for all to authenticated using (is_member(space_id)) with check (is_member(space_id));
create policy "auth rw exercises"   on exercises for all to authenticated using (is_member(space_id)) with check (is_member(space_id));
create policy "auth rw entries"     on entries   for all to authenticated
  using      (exists (select 1 from workouts w where w.id = entries.workout_id and is_member(w.space_id)))
  with check (exists (select 1 from workouts w where w.id = entries.workout_id and is_member(w.space_id)));
