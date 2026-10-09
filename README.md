# Exhibition

A Bun web app with a JSON API and Vue pages.

- **Server:** Bun, Hono, Zod, `@hono/zod-openapi`, Edge.js, tsyringe
- **Pages:** Inertia.js with Vue 3, built by Vite. SSR is optional.
- **Database:** `Bun.SQL`. SQLite in development, PostgreSQL in production.
- **Tools:** Biome (format and lint), `bun test`

## Setup

You need [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
cp .env.example .env
bun run migrate
```

## Run

Development needs two terminals:

```sh
bun run dev        # the server, on http://localhost:3000
bun run dev:vite   # the Vite dev server for the Vue files
```

Then open:

- `http://localhost:3000/register` to create an account
- `http://localhost:3000/docs` for the Swagger UI
- `http://localhost:3000/api/v1/openapi.json` for the OpenAPI spec

## Commands

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `bun run dev`       | Start the server and restart it on file changes |
| `bun run dev:vite`  | Start the Vite dev server                       |
| `bun run build`     | Build the Vue files (client and SSR bundle)     |
| `bun run start`     | Start the server in production mode             |
| `bun run migrate`   | Run the migrations that have not run yet        |
| `bun test`          | Run the tests                                   |
| `bun run lint`      | Check format and lint                           |
| `bun run format`    | Fix format and lint problems                    |
| `bun run typecheck` | Check the TypeScript types                      |

## Environment variables

See `.env.example`. The important ones:

| Name             | Meaning                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`       | `production` turns on auto-migration and the built Vue files           |
| `DATABASE_URL`   | `sqlite://...` or `postgres://...`. This picks the database.           |
| `TOKEN_TTL_DAYS` | How many days a login token stays valid                                |
| `INERTIA_SSR`    | `true` renders pages on the server. It needs `bun run build` first.    |

## API

All data goes through the JSON API. Inertia only picks which page to show. Pages get no
data props; they call the API from the browser. So a third-party client can use the same API.

| Method | Path                    | Auth   | What it does                    |
| ------ | ----------------------- | ------ | ------------------------------- |
| POST   | `/api/v1/auth/register` | none   | Create an account, get a token  |
| POST   | `/api/v1/auth/login`    | none   | Get a token                     |
| POST   | `/api/v1/auth/logout`   | Bearer | Delete the token                |
| GET    | `/api/v1/users/me`      | Bearer | Get the logged-in user          |

Send the token in a header: `Authorization: Bearer <token>`.

Tokens are random strings. The database stores only a SHA-256 hash of each token, so logout
really removes it. Passwords are hashed with `Bun.password` (argon2id).

Errors always have this shape:

```json
{ "error": { "code": "unauthorized", "message": "..." } }
```

## Structure

A request goes through the layers in this order:

```
route -> controller -> service -> repository -> model
```

| Folder              | Job                                                      |
| ------------------- | -------------------------------------------------------- |
| `app/routes`        | Paths, middleware and schemas. Nothing else.             |
| `app/schemas`       | Zod schemas. They validate input and make the OpenAPI spec. |
| `app/controllers`   | Request in, response out                                 |
| `app/services`      | Business logic                                           |
| `app/repositories`  | All SQL                                                  |
| `app/models`        | Data shapes, one per table                               |
| `app/middleware`    | Bearer auth, error handler, Inertia adapter              |
| `app/config`        | All config, read from environment variables              |
| `app/constants`     | Global constants                                         |
| `database`          | The `Migrator` and the `.sql` migration files            |
| `resources/views`   | `app.edge`, the root HTML template                       |
| `resources/js`      | The Vue app: pages, API client, SSR entry                |

### Dependency injection

Each class has `@singleton()`. tsyringe builds it from the constructor types.
`app/container.ts` registers only the `SQL` connection and the `AppConfig`.

Two rules keep this working:

- Import classes used in a constructor with a normal `import`, not `import type`.
  tsyringe needs the real class at run time. Biome's `useImportType` rule is off for this reason.
- Keep `experimentalDecorators` and `emitDecoratorMetadata` in `tsconfig.json`.

Tests do not use the container. They pass mocks into the constructor.

### Migrations

Add a new numbered file to `database/migrations`, for example `003_create_posts.sql`.

- The same files run on SQLite and PostgreSQL. Use `TEXT` for ids (UUID) and for dates (ISO strings).
- In development, run `bun run migrate` by hand.
- In production, migrations run before the server starts. If one fails, the server does not start.

## Deploy

### Docker Compose

```sh
cp .env.example .env    # set POSTGRES_PASSWORD
docker compose up -d --build
```

This starts the app and PostgreSQL. The app runs the migrations when it starts.

### GitHub Actions

`.github/workflows/docker.yml` runs lint, type check and tests. Then it pushes the image to
`ghcr.io/<owner>/<repo>`:

- on a push to `main`: tags `latest` and `sha-<commit>`
- on a version tag like `v1.2.0`: tag `1.2.0`

Run the image with `DATABASE_URL` set to your PostgreSQL database.

## Known limitations

- **The server cannot block a page like `/dashboard`.** The browser does not send a Bearer
  token on a page load. So the page checks the token itself and redirects to `/login`.
  The API is the real protection: without a valid token it returns no data.
- **Auto-migration is safe when one container starts at a time.** Many copies starting
  together can race. The fix is a PostgreSQL advisory lock in the `Migrator`.
- **tsyringe gets few releases.** Only the `@singleton()` lines and `app/container.ts`
  depend on it, so it is easy to replace.
- **The token is kept in `localStorage`.** A script injected into the page (XSS) could read it.
- **No rate limit on login and register.** Add one before the app is open to the public.
