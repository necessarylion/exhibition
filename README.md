# Exhibition

A Bun web app with a JSON API and Vue pages.

- **Server:** Bun, Hono, Zod, `@hono/zod-openapi`, Edge.js, tsyringe
- **Pages:** Inertia.js with Vue 3, built by Vite. SSR is optional.
- **Database:** `Bun.SQL`. SQLite in development, PostgreSQL in production.
- **Tools:** Biome (format and lint), `bun test`

## Features

One app and one login. The role of the company decides the pages.

- **Customer:** plans exhibition projects, adds items from the catalog (with what is free
  on the dates of the project) and sends the request. Each supplier gets one order. After
  a reject or a cancel, "Add these items again" puts the items back in the project. A
  customer can also keep own items: they are free in its projects.
- **Supplier:** owns items with photos, gets orders, accepts or rejects them, cancels an
  accepted one with a reason, and marks it completed. The order page shows what is free
  for the dates before the click on "Accept". A supplier that signs up by itself waits for
  an admin first ("Suppliers need approval").
- **Admin:** manages customers, suppliers, their users and organization groups, and
  approves suppliers. The admin sees every project, with its orders inside it, and can
  cancel a stuck order with a reason. The admin can **act as a customer** to make a
  project or send an order for them. The admin company can also own items and get orders
  ("Orders for our items").
- **Organization groups:** customer companies in one group share their items for free.
- **Notifications:** a bell in the menu tells what happened with orders and approvals.
- **Forgot password:** `/forgot-password` says who can set a new one (the owner of the
  company under Team, or the platform admin). No email is sent.

## Setup

You need [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
cp .env.example .env
bun run migrate
bun run seed          # optional: test data for every role, see "Test data"
```

Without the test data, create the first admin by hand (it asks for the password):

```sh
bun run create-admin "Your Name" you@example.com
```

Customers and suppliers sign up at `/register`. Nobody can sign up as an admin.

## Run

One command starts the server and the Vite dev server together:

```sh
bun run dev        # open http://localhost:3000
```

Then open:

- `http://localhost:3000/register` to create an account
- `http://localhost:3000/docs` for the API docs (Scalar). In production it is off. Set `API_DOCS=true` to turn it on.
- `http://localhost:3000/api/v1/openapi.json` for the OpenAPI spec. It is on and off together with the docs page.

## Commands

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `bun run dev`       | Start the server and Vite. Restart on changes   |
| `bun run build`     | Build the Vue files (client and SSR bundle)     |
| `bun run start`     | Start the server in production mode             |
| `bun run migrate`   | Run the migrations that have not run yet        |
| `bun run create-admin "Name" email` | Create an admin user. It asks for the password, or reads `ADMIN_PASSWORD` |
| `bun run seed`      | Fill an empty database with test data. `--fresh` empties it first. See "Test data" for its guard |
| `bun test`          | Run the tests on in-memory SQLite               |
| `bun run test:pg`   | Run the tests on PostgreSQL (see below)         |
| `bun run lint`      | Check format and lint                           |
| `bun run format`    | Fix format and lint problems                    |
| `bun run typecheck` | Check the types of the `.ts` and the `.vue` files |

### Test data

`bun run seed` fills the database of `DATABASE_URL` with a small trade-fair world, so every
page of every role has something on it. It runs the migrations first and takes about 2
seconds. It goes through the same services as the app, so every rule holds.

- When the database already has companies it changes nothing and says so.
  `bun run seed --fresh` empties the app tables first (ALL data of that database, and the
  photo files). The tables themselves stay.
- It cannot hit a real database by accident. It runs only when all of this holds:
  - `NODE_ENV` is not `production`. No flag changes that.
  - Without `--fresh`: the database has no companies (SQLite or PostgreSQL).
  - With `--fresh` on SQLite: nothing more is needed. A SQLite file is a development database.
  - With `--fresh` on PostgreSQL: you must also pass `--i-know-this-deletes-data`:
    `bun run seed --fresh --i-know-this-deletes-data`.
- Before `--fresh` deletes anything it prints the host and the name of the database and
  how many companies it deletes. The check runs before the migrations, so a refused run
  changes nothing.
- Every user has the same password: `exhibition-demo-1`, or `SEED_PASSWORD` when you set it.
- It prints this table at the end:

| Email | Role | Company | What to try |
| ----- | ---- | ------- | ----------- |
| `admin@exhibition.test` | admin | Exhibition Platform | Everything: customers, suppliers, groups, projects, act as a customer |
| `ops@exhibition.test` | admin | Exhibition Platform | A second admin (not the owner) |
| `owner@golden.test` | supplier | Golden Stand Builders | Orders in every status, one with a line that is short of stock |
| `sales@golden.test` | supplier | Golden Stand Builders | A second user (not the owner): read-only Team page |
| `owner@lumen.test` | supplier | Lumen Stage & Light | Lighting and screens: an order to accept, a rejected one, a chart |
| `owner@nordic.test` | supplier | Nordic Furniture Rental | A hidden item and an item that is over-booked |
| `owner@fresh.test` | supplier | Fresh Booth Co | Waiting for approval: the banner, items not in the catalog |
| `owner@truemoney.test` | customer | True Money | Projects in every status, shared items of the group |
| `owner@truesim.test` | customer | True Sim | In True Group: a project made by an admin, a waiting order |
| `owner@tea.test` | customer | Mandalay Tea House | Not in a group: done projects, a rejected order |
| `buyer@tea.test` | customer | Mandalay Tea House | A second user (not the owner) |
| `owner@robots.test` | customer | Shwe Robotics | Cancelled orders to add again, a cancelled project |
| `owner@crafts.test` | customer (disabled) | Old Bagan Crafts | Cannot log in: the company is disabled |

The data has projects in every status (draft, waiting, confirmed, done, cancelled), orders
in every status (also cancelled by the customer, by the supplier and by the admin), two
projects on the same days that want the same limited booth, old orders from the last
months, and read and unread notifications.

### Tests on PostgreSQL

`bun test` uses in-memory SQLite. Production uses PostgreSQL, so run the tests there too.
You need Docker.

```sh
docker run -d --name exhibition-test-db -p 5433:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=exhibition_test postgres:17-alpine
bun run test:pg
docker rm -f exhibition-test-db
```

`bun run test:pg` sets `TEST_DATABASE_URL` to the database above. Set the variable yourself to
use another one. **Every run empties that database first.** Never point it at real data.
GitHub Actions runs both: `bun test` and the same tests on PostgreSQL.

## Environment variables

The app checks them at the start. A wrong value stops it with a clear message.

| Name                  | Default                        | Meaning                                                        |
| --------------------- | ------------------------------ | -------------------------------------------------------------- |
| `NODE_ENV`            | (development)                  | `production` turns on auto-migration and the built Vue files   |
| `PORT`                | `3000`                         | The port of the server. A whole number from 1 to 65535.        |
| `APP_NAME`            | `Exhibition`                   | The name in the page title and of the admin company            |
| `DATABASE_URL`        | `sqlite://database/dev.sqlite` | `sqlite:`, `postgres:` or `postgresql:`. Required in production. |
| `STORAGE_DIR`         | `./storage`                    | The folder for uploaded item photos. It must survive a restart. |
| `TOKEN_TTL_DAYS`      | `30`                           | How many days a login token stays valid. A number above 0.     |
| `RATE_LIMIT_MAX`      | `10`                           | In 15 minutes: wrong logins of one client address for one email, sign-ups per client address, wrong "current password" tries per user |
| `RATE_LIMIT_IP_MAX`   | `50`                           | In 15 minutes: wrong logins per client address, and "add a user" calls per user |
| `RATE_LIMIT_EMAIL_MAX` | `100`                         | In 15 minutes: wrong logins for one email from every address together |
| `TRUSTED_PROXIES`     | `0`                            | How many proxies of your own are in front of the app. See "Client address". |
| `API_DOCS`            | `true`, in production `false`  | Serve `/docs` and the OpenAPI spec                             |
| `LOG_REQUESTS`        | `true`, in tests `false`       | Print one line per request: method, path, status, time         |
| `INERTIA_SSR`         | `false`                        | `true` renders pages on the server. It needs `bun run build` first. |
| `VITE_DEV_SERVER_URL` | `http://localhost:5173`        | The Vite dev server. Used only when not in production.         |
| `POSTGRES_PASSWORD`   |                                | Used by `docker-compose.yml` only                              |
| `TEST_DATABASE_URL`   |                                | Used by the tests only. See "Tests on PostgreSQL".             |
| `ADMIN_PASSWORD`      |                                | Read by `bun run create-admin` when there is no terminal to ask in |
| `SEED_PASSWORD`       | `exhibition-demo-1`            | The password of every user that `bun run seed` makes           |

## Production

- **Health check:** `GET /health` answers `200 {"status":"ok"}` when the database answers,
  and `503` when it does not. The Docker image uses it as its `HEALTHCHECK`.
- **Security headers:** every response has them, with a Content-Security-Policy. Scripts load
  only from the app itself. Only `/docs` may load the script of the docs from a CDN.
- **Attempt limits:** the answer is `429` with a `Retry-After` header.
  - Login: only a wrong email or password counts. 10 per client address and email, 50 per
    client address, and 100 per email from every address together (`RATE_LIMIT_MAX`,
    `RATE_LIMIT_IP_MAX`, `RATE_LIMIT_EMAIL_MAX`). The last one is high on purpose: wrong
    tries from one place do not lock the real user out at another place.
  - The attempt is taken before the password check and given back after a right login, so
    requests at the same moment cannot pass the limit together.
  - Sign-up: every attempt counts, 10 per client address.
  - "Change my password": 10 wrong current passwords per user.
  - "Add a user": 50 calls per user who may add users. A call that is refused with 403 or
    404 does not count.
  - An IPv6 client counts as its /64 network.
  - The counts are in memory, per server. A full limiter (100,000 keys) drops the oldest
    keys. It never refuses a login or a sign-up because it is full.
- **Client address:** set `TRUSTED_PROXIES` to the number of your own proxies in front of
  the app. With `0` the header `X-Forwarded-For` is ignored and the address of the
  connection is used. Behind a proxy that would be the proxy for every user, so set it.
  With `1` the app takes the LAST value of `X-Forwarded-For`: that is the one your proxy
  wrote. With `2` it takes the second value from the right, and so on. Values further left
  come from the client and are never trusted. nginx: `proxy_set_header X-Forwarded-For
  $proxy_add_x_forwarded_for;`. A port in the value (`203.0.113.9:51000`,
  `[2001:db8::9]:443`) is cut off. The old `TRUST_PROXY` is gone; the app does not start
  with `TRUST_PROXY=true`.
- **Request size:** a JSON body can be up to 100 KB (`413` above that). A photo upload can
  be up to 5 MB.
- **Dates:** a date must be between 2000-01-01 and 2100-12-31 (`422` outside of that).
- **Text input:** control characters (also NUL) are refused with `422` in every text field.
  A text of more than one line may hold tabs and line breaks.
- **Limits:** a company can have up to 5000 items (`409 too_many_items`).
- **Request log:** one line per request. No tokens, no passwords, no bodies, no query strings.
- **Expired tokens** are deleted at the start and then once a day. Notifications older
  than 90 days and rows of the admin log older than one year are deleted in the same run.
- **Shutdown:** on `SIGTERM` or `SIGINT` the server lets the running requests finish, closes
  the database and exits.
- **Lists:** the list endpoints return a JSON array. They take `limit` (1-200, default 100),
  `offset`, a search text `q` and the filters of that list (`status`, `category`, `owner`,
  `open`, `hasWaitingOrders`). The search and the filters run in the database, so a list
  is right at any size. Upper and lower case are the same, and `%` and `_` are plain
  characters. `X-Total-Count` has the number of rows that match. `X-Counts` is JSON with
  more numbers of the whole list: the rows per status for the same search, `totalCents`,
  `hidden`, `waiting`, `disabled`. The pages load 100 rows and have "Load more".

## API

All data goes through the JSON API. Inertia only picks which page to show. Pages get no
data props; they call the API from the browser. So a third-party client can use the same API.

| Method | Path                    | Auth   | What it does                    |
| ------ | ----------------------- | ------ | ------------------------------- |
| POST   | `/api/v1/auth/register` | none   | Create an account, get a token  |
| POST   | `/api/v1/auth/login`    | none   | Get a token                     |
| POST   | `/api/v1/auth/logout`   | Bearer | Delete the token                |
| POST   | `/api/v1/auth/logout-all` | Bearer | Delete all my tokens          |
| GET    | `/api/v1/users/me`      | Bearer | Get the logged-in user          |
| PATCH  | `/api/v1/users/me`      | Bearer | Change my name                  |
| POST   | `/api/v1/users/me/password` | Bearer | Change my password          |
| POST   | `/api/v1/users/{id}/password` | Bearer | Set a new password for a teammate (owner or admin) |
| GET    | `/api/v1/company`       | Bearer | Get my company and its profile  |
| PATCH  | `/api/v1/company`       | Bearer | Change my company (owner only)  |
| GET    | `/api/v1/dashboard`     | Bearer | The numbers of the first page, by role |
| POST   | `/api/v1/companies/{id}/approve` | Admin | Approve a supplier that signed up by itself |
| POST   | `/api/v1/companies/{id}/impersonate` | Admin | Act as a customer company: a 2 hour token for its owner |
| POST   | `/api/v1/auth/stop-impersonating` | Bearer | End the acting session of this token |
| GET    | `/api/v1/admin-actions` | Admin  | What admins did while they acted as a customer, newest first |
| POST   | `/api/v1/orders/{id}/cancel` | Bearer | Customer: a waiting order. Supplier: an accepted one, with a reason. Admin: a waiting or accepted one of any company, with a reason |
| POST   | `/api/v1/projects/{id}/orders/{orderId}/add-again` | Customer | Put the items of a rejected or cancelled order back as lines that are not sent |
| GET    | `/api/v1/items/categories` | Bearer | The categories of my items (`scope=mine`) or of my catalog (`scope=catalog`) |
| GET, POST | `/api/v1/organizations` | Admin | List the organization groups, create one |
| GET, PATCH, DELETE | `/api/v1/organizations/{id}` | Admin | Get, rename or delete a group |
| PUT, DELETE | `/api/v1/organizations/{id}/companies/{companyId}` | Admin | Add a customer company to a group, or remove it |
| GET    | `/api/v1/notifications` | Bearer | My notifications, newest first. `X-Unread-Count` has the new ones |
| POST   | `/api/v1/notifications/read` | Bearer | Mark all mine as read      |
| POST   | `/api/v1/notifications/{id}/read` | Bearer | Mark one of mine as read |
| GET    | `/health`               | none   | Health check                    |

The full list is in the API docs at `/docs`.

Send the token in a header: `Authorization: Bearer <token>`.

Tokens are random strings. The database stores only a SHA-256 hash of each token, so logout
really removes it. Passwords are hashed with `Bun.password` (argon2id).

Errors always have this shape, also for a JSON body that cannot be read (`400 bad_request`):

```json
{ "error": { "code": "unauthorized", "message": "..." } }
```

A validation error (`422`) also has `details`: one plain sentence per wrong field, with the
label of the field ("Price is too high."). `message` is the first of them.

### Stock is availability by event dates

This is a rental business. The same chair goes to one event after another.

- `stock` of an item is the TOTAL number the owner has. `null` means no limit. An order
  never lowers it.
- An order in status `accepted` or `completed` holds its quantity from its setup day (or
  its first day, when there is no setup day) to its last day. Both days count.
- Available on some dates = stock minus the **busiest day**: the highest total that such
  orders hold on one single day of these dates. Two orders that never meet are not added
  up. Stock 10, 5 out on 1-2 May and 5 out on 9-10 May: an event from 1 to 10 May can
  still get 5.
- The owner can set the stock below what is already booked (things break). The orders stay
  as they are. "My items" and the item form then show the days that are over-booked
  (`overbooked` on the item, only for its owner).
- `GET /orders/{id}` of a waiting order tells the supplier (and an admin) per line how many
  are free on the dates of the order (`available`). The page turns "Accept" off and says
  why when a line is short.
- The check runs when a customer adds or changes a line (`422 not_enough_stock`), on send
  (`409`) and on accept (`409`). On accept the item rows are locked first, so two accepts
  for the last piece cannot both pass.
- `GET /items/catalog?projectId=...` and `GET /items/{id}?projectId=...` set `available`
  of each item for the dates of that project. Without `projectId` it is the stock.
- The items of the customer itself, and the items its organization group shares, are not
  checked by date. They show their stock.
- A pending order holds nothing. The first accept wins.
- The supplier can cancel an accepted order with a reason
  (`POST /orders/{id}/cancel` with `{ "reason": "..." }`). The dates are free again.
- With `projectId`, each catalog item also has `inProject`: how many of it the project
  already holds in lines that are not sent. The pages offer `available - inProject`.

### An order is a copy of the event

When a project is sent, each order stores its own copy of the event facts: name, venue,
city, hall, booth, dates, setup date and notes. The order pages read this copy.

- While an order of a project is `pending` or `accepted`, the dates, the place and the
  booth of the project cannot change (`409 project_locked`). The name and the notes can.
- `POST /projects/{id}/send` needs `expectedTotalCents`: the total the customer saw. When
  a price changed since then, the answer is `409 prices_changed` and nothing is sent.
- A rejected or cancelled order shows no contact details of the other company.
- "Mark as done" needs: at least one item, no order that waits, and no item that is not
  sent yet. A project with only own and shared items can be done.

### On the admin side, orders live inside projects

An order belongs to one project (`orders.project_id` is required, with a foreign key). A
project can have many orders. There is no list of all orders.

- The admin Projects list shows the orders of each project ("3 orders · 1 waiting") and its
  total, with the filter "Has waiting orders". The project page shows every order: number,
  supplier, status, lines, total and reason, with a link to the order page.
- An admin can cancel a `pending` or `accepted` order of any company from the project page,
  with a reason. The customer and the supplier are told. This is how a stuck order is
  solved, for example the accepted order of a supplier that was disabled.
- `GET /orders` gives an admin only the orders for the items of the admin company
  (menu "Orders for our items").
- Disabling a company cancels its waiting orders ("The supplier is not available any
  more.") and tells the other company. Its accepted orders stay; the confirm of the page
  says how many, and the admin can cancel them from the project page.
- "Send request" and "disable" of one company never run at the same moment: both lock the
  company row. So a company that was just disabled gets no new waiting order (`409`).
- Order numbers count up: `ORD-1001`, `ORD-1002`, …

### An admin acts as a customer

"Act as customer" on the Customers list (and on the Users page of a customer) lets an
admin work in the account of that customer: make a project, add items, send or cancel.

- `POST /companies/{id}/impersonate` gives a token for the OWNER of the customer company.
  It lasts 2 hours. Only for a customer company that is not disabled.
- The token works exactly like a login of that customer. It cannot reach an admin
  endpoint or another company. `GET /users/me` has `actingAdmin: { id, name }`.
- Every page shows a bar: "You are acting as True Money (Zin Mar)." with "Stop". Stop ends
  the token on the server (`POST /auth/stop-impersonating`) and goes back to the admin's
  own session.
- In the browser both tokens are one JSON record in `localStorage` (`access_token`):
  `{ token, adminToken }`. `token` is the one that is sent. `adminToken` is there only
  while acting and is never sent. All tabs read the same record, so every tab agrees on
  who is logged in, and "Stop" works in every tab.
- "Log out" in any tab ends the acting session and the admin's own session, and clears
  the record.
- A 401 never moves the browser to another token. Only when the dead token is the acting
  token of the record, the admin goes back to the own session (Customers page, "You stopped
  acting as the customer."). In every other case the record is cleared and the login page
  opens.
- When another tab changes who is logged in (log in, log out, act as, stop), an open tab
  loads again at the home page of the new user. It does not keep pages of the old user.
- Blocked while acting (`403 not_while_acting`): change the name or the password, log out
  everywhere, add or remove users, reset a password, act as somebody else.
- The acting token also ends when: the customer logs out everywhere or changes the
  password, the company is disabled, the admin logs out, or the admin user is removed.
- What stays: a row in `admin_actions` for the start (`impersonate`) and for every request
  with the acting token that changed something (`POST /projects/<id>/send`, …, and
  `POST /auth/stop-impersonating` for "Stop"). A GET and a request that failed leave no
  row. One middleware writes them (`app/middleware/acting-log.middleware.ts`). An admin
  reads the log on the page **Admin activity** (`/admin/activity`) or with
  `GET /admin-actions`. Rows older than one year are deleted by the daily cleaner.
  Also: a notification to every user of the
  customer ("<Admin> (platform admin) worked in your account."), and the name of the admin
  on every project and order made while acting ("Created by <admin> (platform admin) for
  <company>"). Nothing in a request can set that mark; only the token does.

### Organization groups

A group, like "True Group", holds customer companies, like "True Money" and "True Sim".
The companies of one group share their items with each other for free.

- Only a platform admin creates, renames and deletes groups, and adds or removes companies
  (menu "Groups"). Only a customer company can be in a group, and only in one
  (`409 not_a_customer`, `409 already_in_group`). A group name is unique (`409 group_name_taken`).
- A customer sees, in the catalog, the items of the other companies of its group that are
  not hidden, marked "Shared by <company>" and "Free". The catalog filter "My group" shows
  only these. A company outside the group never sees them: the catalog does not list them,
  and the single item and "add to project" answer `404`.
- A shared item in a project is a line with state `shared`. It is like an own line: the
  price is 0, it is never in an order, it needs no approval, it is not checked by date, and
  it does not block "Mark as done". "Send request" skips it.
- The company that owns a shared item sees nothing of the other project: no order, no
  count, no notification.
- When a company leaves a group, or the group is deleted, the companies and their items
  stay. Shared lines that are already in a project stay as they are and can be removed.
  Their quantity cannot change any more (`409 item_unavailable`), and no new shared line
  can be added (`404`).
- A hidden item and the items of a disabled company are never shared.
- `GET /company` has `organization` with the names of the companies of my group, or `null`.

### Suppliers need approval, and company names are unique

- A supplier that signs up by itself waits for an admin (`approvedAt` is `null`). Its users
  can log in and add items, and every page shows a banner. Its items are in no catalog and
  cannot be added, sent or accepted (`404`, `409 item_unavailable`, `403 not_approved`).
- An admin approves it on the Suppliers list (`POST /companies/{id}/approve`). The admin
  home page shows how many wait. There is no "un-approve": use "Disable" for that.
- A customer, the admin company, a company that an admin creates and every supplier from
  before this rule are approved from the start.
- Two companies cannot have the same name. A name is stored in one clean form: Unicode
  NFKC, no invisible characters (zero-width space, soft hyphen, direction marks), one
  space between words, none at the ends. Then upper and lower case do not count. So
  "True Money", " true  money " and "True Money" with a hidden character are one name.
  Group names follow the same rule. Sign-up, admin create and both renames answer
  `409 company_name_taken`. The guard is a unique index on `companies.name_key`. Old data
  with the same name twice keeps its names: the migration gives the later ones a key with
  their id, and an admin can rename them.

### Notifications

Messages inside the app. No email is sent. An event writes one row for every user of the
company that should know, in the same transaction as the event.

| Event | Who is told |
| ----- | ----------- |
| A customer sends an order | every user of the supplier |
| The supplier accepts, rejects, completes, or cancels an accepted order | every user of the customer |
| An admin cancels an order, or disables a company with waiting orders | every user of the customer and of the supplier |
| An admin starts to act as a customer | every user of that customer |
| The customer cancels an order, or cancels the project with waiting orders | every user of the supplier |
| A supplier signs up and waits for approval | every admin |
| An admin approves a supplier | every user of that supplier |

The menu shows a bell with the number of new ones. It is asked on every page load.
A user reaches only their own notifications. Another user's one answers `404`.

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
| `app/middleware`    | Bearer auth, rate limit, error handler, Inertia adapter  |
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
- On PostgreSQL the migrator takes an advisory lock. Two servers that start together do
  not both migrate: the second one waits and then finds nothing to do.
- SQLite checks foreign keys only when it is told to. `database/open-database.ts` turns
  them on for every connection, so development and tests act like PostgreSQL.

## Deploy

### Docker Compose

```sh
cp .env.example .env    # set POSTGRES_PASSWORD
docker compose up -d --build
```

This starts the app and PostgreSQL. The app runs the migrations when it starts.

Then create the first admin. Without an admin no supplier is ever approved, so the catalog
stays empty.

```sh
docker compose exec app bun run create-admin "Your Name" you@example.com
```

It asks for the password (8 characters or more), so run it in a terminal. In a script,
where nothing can be asked, pass the password in the environment:

```sh
docker compose exec -e ADMIN_PASSWORD='a-long-password' app bun run create-admin "Your Name" you@example.com
```

Run it again with another email for every further admin. Later admins can also be added on
the Team page.

`POSTGRES_PASSWORD` is put into `DATABASE_URL` as it is. Use only letters, digits, `-` and
`_` in it. A password with `@`, `:`, `/`, `#` or `%` breaks the URL and the app does not
start.

Do not run `bun run seed` on a production database. It refuses when `NODE_ENV=production`,
and on PostgreSQL `--fresh` needs a second flag (see "Test data").

### GitHub Actions

`.github/workflows/docker.yml` runs lint, type check, the tests (on SQLite and on
PostgreSQL) and the build. It runs on every pull request and on every push to `main`.
After a push (not for a pull request) it pushes the image to `ghcr.io/<owner>/<repo>`:

- on a push to `main`: tags `latest` and `sha-<commit>`
- on a version tag like `v1.2.0`: tag `1.2.0`

Run the image with `DATABASE_URL` set to your PostgreSQL database.

## Known limitations

- **The server cannot block a page like `/dashboard`.** The browser does not send a Bearer
  token on a page load. So the page checks the token itself and redirects to `/login`.
  The API is the real protection: without a valid token it returns no data.
- **tsyringe gets few releases.** Only the `@singleton()` lines and `app/container.ts`
  depend on it, so it is easy to replace.
- **The token is kept in `localStorage`.** A script injected into the page (XSS) could read it.
- **The rate limit is in memory, per process.** Each server counts by itself and a restart
  clears the counts. Use a shared store when the app runs on more than one server.
- **There is no email verification.** The app sends no email. Anyone can sign up with any
  email address that looks valid, and a forgotten password is set again by the owner of
  the company or by an admin.
- **Photos keep their EXIF data.** A photo is stored as it was uploaded. A phone photo can
  hold the place where it was taken. Remove that data before the upload if it matters.
- **Photo URLs are public.** The file name is a random UUID that cannot be guessed, but
  anyone who has the URL can open the photo, also of a hidden item. No login is asked.
- **The bell count is not live.** It is asked when a page loads. A new notification shows
  after the next page load. There is no email and no push message.
- **A user gets only the notifications from after they joined.** A notification is one
  row per user at the moment of the event. A removed user loses theirs.
- **Group members are trusted.** A shared item is not checked by date and not by stock, and
  the owner company is not asked and not told. The companies of a group arrange it themselves.
- **Company names are compared as text.** Case, extra spaces and invisible characters do
  not count, but "True Money" and "True Money Ltd" are two names. Letters that only look
  the same (a Latin "a" and a Cyrillic "а") are two names too. A name from before this
  rule keeps its old key until it is renamed.
- **The admin log shows requests, not sentences.** A row of "Admin activity" is the method
  and the path of the request, like `POST /orders/<id>/cancel`. An acting session that
  ends by itself after 2 hours leaves no "stop" row.
- **A tab that is open on the login page does not follow a login in another tab.** Only the
  pages inside the app load again when the logged-in user changes.
- **The search of SQLite knows only A-Z without case.** "é" does not find "É" there.
  PostgreSQL (production) knows every letter.
- **Not built:** email or push messages, payments and invoices, a second currency, print
  layouts beyond the browser's print of an order, deleting or copying items and projects,
  partial accept of an order, a change of email, a new owner for a company.
- **A pending order holds no stock.** Two customers can ask for the same last piece for
  the same days. The supplier accepts one; the other accept is refused.
- **"Today" is checked in UTC, with one day of slack.** A new project cannot start before
  yesterday in UTC, so the own "today" of every time zone works.
- **The type check of `.vue` files needs TypeScript 6.** `vue-tsc` cannot use the native
  TypeScript 7. So the dev dependency `typescript-6` (TypeScript 6 under another name) is
  its engine (`scripts/typecheck-vue.cjs`). `tsc` (TypeScript 7) still checks the `.ts` files.
- **SQLite is for development and tests only.** It has one connection, so the app runs
  one API request at a time there (`TransactionRunner`). So a save of one request is never
  lost in the rolled-back transaction of another. The body of a request is read before it
  waits for its turn, so a slow upload holds nobody up. A request that keeps its turn for
  more than 30 seconds gets a `503 busy` and the next one goes on. PostgreSQL runs requests
  side by side. Use PostgreSQL in production.
