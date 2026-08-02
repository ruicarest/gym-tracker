# 🏋️ Gym Tracker

A tiny, dependency-free web app to log your gym workouts — the days you trained,
the type of session, and the **weight × reps** for every set — plus a progress
chart per exercise. Static site, hostable **free on GitHub Pages**, with an
optional **free Supabase** database for cross-device sync.

- **Works instantly** with the browser's `localStorage` (no setup needed to try it).
- **Add cloud sync** by dropping your Supabase keys into `config.js`.
- No build step, no framework — just open `index.html`.

## Tabs

- **Treinar** — log a session: date, type (Push/Pull/Legs…), exercises, and sets.
- **Histórico** — every past session, with monthly count and total volume.
- **Progresso** — pick an exercise, see best weight over time + estimated 1RM.

---

## Run locally

Because it uses ES modules, open it through a local server (not `file://`):

```bash
cd gym-tracker
python3 -m http.server 8000
# open http://localhost:8000
```

Until you configure Supabase it stores data locally in your browser
(a **📱 Local** badge shows in the header).

---

## Enable free cloud sync (Supabase)

1. Create a free project at <https://supabase.com>.
2. In the **SQL Editor**, paste and run the contents of [`schema.sql`](schema.sql).
3. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
4. Paste both into [`config.js`](config.js) and reload. The badge turns **☁ Cloud**.

> **Note on "no login":** the app is static, so the anon key ships in the page.
> That means anyone with your site URL + key can read/write the data. For gym
> data that's a low risk. To lock it down later, add Supabase Auth and swap the
> RLS policies in `schema.sql` for user-scoped ones.

---

## Deploy to GitHub Pages

```bash
cd gym-tracker
git init
git add .
git commit -m "Initial commit: gym tracker"
gh repo create gym-tracker --public --source=. --push
```

Then enable Pages: **repo → Settings → Pages → Source: `main` / root**.
Your app will be live at `https://<username>.github.io/gym-tracker/`.

---

## Data model

| Table       | Holds                                              |
|-------------|----------------------------------------------------|
| `exercises` | catalogue of exercises (name, muscle group)        |
| `workouts`  | a session (date, type, notes)                      |
| `sets`      | one set: workout, exercise, **weight, reps**       |

## Files

| File         | Purpose                                             |
|--------------|-----------------------------------------------------|
| `index.html` | markup + templates                                  |
| `styles.css` | dark, mobile-first styling                          |
| `app.js`     | UI logic (tabs, form, history, SVG progress chart)  |
| `db.js`      | data layer — Supabase **or** localStorage           |
| `config.js`  | your Supabase keys (placeholders by default)        |
| `schema.sql` | database schema for Supabase                        |
