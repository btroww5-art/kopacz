# Mining Dashboard + Embedded Worker

Projekt jest przygotowany pod publikacje na Bolt jako aplikacja all-in-one:

- Bolt buduje dashboard React/Vite.
- `npm start` uruchamia serwer dashboardu.
- Embedded worker jest domyslnie wlaczony przy `npm start`, chyba ze ustawisz `ENABLE_EMBEDDED_WORKER=false`.
- Runtime pobiera XMRig dopiero przy starcie i odpala worker raportujacy do Supabase.
- Supabase przechowuje workerow, statystyki i obsluguje realtime.

Repo nie zawiera binarki XMRig, archiwum ani `node_modules`.

## Wymagania runtime

Tryb embedded worker zaklada, ze hosting Bolt dla Twojego projektu udostepnia persistent Node server z dostepem do:

- `node`,
- `curl`,
- `tar`,
- mozliwosci uruchomienia procesu potomnego,
- mozliwosci dlugotrwalego procesu CPU.

Jesli te warunki sa spelnione, `scripts/bolt-start.cjs` pobierze XMRig do `.runtime/` i uruchomi go automatycznie.

## Bolt ustawienia

Build command:

```bash
npm run build:bolt
```

Start command:

```bash
npm start
```

Environment variables:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY

SUPABASE_ACCESS_TOKEN=sbp_YOUR_SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_REF=YOUR_PROJECT_REF
SUPABASE_DB_PASSWORD=YOUR_SUPABASE_DATABASE_PASSWORD
ADMIN_EMAILS=twoj@email.pl

ENABLE_EMBEDDED_WORKER=true
API_URL=https://jddydrrxnyfusekkjtkb.supabase.co/functions/v1/mining-api
MONERO_ADDRESS=47uc8GJNqbXGHSQ8ryoHpVPB231HsBQezMgkF8Y6mjgBDseES1QE5Y7UGEE5QsZYfmFGDi6hEwADKhkyDWCYS23BM76GPjx
WORKER_API_SECRET=TEN_SAM_SEKRET_CO_W_SUPABASE
WORKER_ID=bolt-worker-01
POOL_URL=gulf.moneroocean.stream:10128
```

Podczas builda `scripts/supabase-setup.cjs` automatycznie wykonuje migracje, deploy Edge Function i ustawia sekrety Supabase. Po `Publish` dashboard startuje na porcie z env `PORT`, a worker uruchamia sie w tym samym runtime. Jesli worker albo XMRig padnie, proces startowy uruchomi go ponownie automatycznie.

## Supabase auto setup

Skrypt `npm run build:bolt` robi automatycznie:

- `supabase link`,
- `supabase db push`,
- `supabase functions deploy mining-api`,
- `supabase secrets set WORKER_API_SECRET ADMIN_EMAILS`.

Musisz miec juz utworzony projekt Supabase i podac w Bolt:

```bash
SUPABASE_ACCESS_TOKEN=...
SUPABASE_PROJECT_REF=...
SUPABASE_DB_PASSWORD=...
```

Konto admina w Supabase Auth nadal musi istniec. Ustaw mu `app_metadata`:

```json
{
  "role": "admin"
}
```

Bez tego RLS nie pozwoli czytac tabeli `workers` w dashboardzie.

## Jak to dziala po publikacji

1. Bolt uruchamia `npm start`.
2. `scripts/bolt-start.cjs` serwuje zbudowany dashboard z `dist/`.
3. Jesli `ENABLE_EMBEDDED_WORKER` nie jest ustawione na `false`, skrypt pobiera XMRig z GitHub Releases do `.runtime/`.
4. Skrypt odpala `worker/worker.js` z `XMRIG_PATH=.runtime/xmrig`.
5. Worker rejestruje sie przez Edge Function z naglowkiem `x-worker-secret`.
6. Worker co 10 sekund wysyla statystyki XMRig do Supabase.
7. Dashboard admina pokazuje zmiany realtime z tabeli `workers`.

## Wiele workerow

Kazda kolejna publikacja/instalacja, ktora ma ten sam:

- `API_URL`,
- `WORKER_API_SECRET`,
- Supabase project,

bedzie dopisywala worker do tego samego dashboardu. Ustaw tylko unikalny `WORKER_ID`, np. `bolt-worker-02`, `bolt-worker-03`.

## Opcjonalny worker na VPS

Jesli chcesz poza Bolt dodac zwykly serwer workerowy:

```bash
cd worker
sudo API_URL="https://YOUR_PROJECT.supabase.co/functions/v1/mining-api" \
  MONERO_ADDRESS="YOUR_MONERO_ADDRESS" \
  WORKER_API_SECRET="TEN_SAM_SEKRET_CO_W_SUPABASE" \
  WORKER_ID="worker-vps-01" \
  ./install.sh
```

Instalator pobiera XMRig dopiero na serwerze i tworzy usluge systemd `mining`.

## Lokalny development

Dashboard:

```bash
npm install
npm run dev
```

Build bez auto-setupu Supabase:

```bash
npm run build
```

Build z auto-setupem Supabase:

```bash
npm run build:bolt
```

Start lokalny bez kopania:

```bash
ENABLE_EMBEDDED_WORKER=false npm start
```

Start embedded worker wymaga ustawienia `WORKER_API_SECRET`. `API_URL`, `MONERO_ADDRESS` i `POOL_URL` maja domyslne wartosci z projektu, ale mozesz je nadpisac w env.
