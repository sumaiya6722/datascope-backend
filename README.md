# DataScope Backend

REST API for **DataScope**, a role-based data exploration platform. It lets teams define datasets, search and filter large record collections, save and share views, export data, and track usage, with access controlled at both the **role** level and the **per-dataset** level.

Built with Node.js, Express 5, MongoDB, and [Better Auth](https://www.better-auth.com/).

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Authentication and roles](#authentication-and-roles)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Seeding demo data](#seeding-demo-data)
- [Testing](#testing)
- [Security notes](#security-notes)
- [Known issues](#known-issues)

## Features

- **Authentication**: email/password and Google OAuth via Better Auth, using HTTP-only session cookies.
- **Role-based access control**: three roles (`viewer`, `dataAnalyst`, `administrator`) with distinct capabilities.
- **Per-dataset grants**: non-admin users can only see datasets they have been explicitly granted (`read`, `export`).
- **Flexible datasets**: records are schema-less JSON, described by per-dataset field definitions that control what is searchable, filterable, sortable, and visible by default.
- **Search**: partial, exact, and MongoDB full-text modes.
- **Typed filters**: string, number/currency, date, and boolean operators, combined with AND.
- **Pagination, sorting, and column selection** on record listings.
- **Saved views**: personal search/filter/sort/column configurations that can be shared with other users.
- **Search history**: the latest 200 searches per user are kept.
- **Export**: JSON export, plus CSV export of selected or filtered records.
- **Analytics**: record counts by category and status, data growth, search activity, and most-used filters.
- **Admin tools**: user role management and dataset permission management.
- **Demo data seeder**: generates up to 300,000 deterministic synthetic records across three related datasets.

## Tech stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js **>= 22.13** (ES modules) |
| Web framework | Express 5 |
| Database | MongoDB via Mongoose 9 and the native MongoDB driver |
| Auth | Better Auth with `@better-auth/mongo-adapter` |
| Other | `cors` |
| Dev / test | `@faker-js/faker`, `mongodb-memory-server`, Node's built-in test runner |

## Project structure

```
datascope-backend/
├── src/
│   ├── server.js                      # Entry point: validates env, connects DB, starts the server
│   ├── app.js                         # Express app: CORS, routers, error handling
│   ├── auth.js                        # Better Auth configuration (providers, roles, hooks)
│   ├── config/
│   │   └── database.js                # MongoDB connection (database name: "datascope")
│   ├── authorization/
│   │   ├── permissions.js             # Role -> permission matrix
│   │   ├── middleware.js              # requireAuthentication / requirePermission
│   │   ├── dataset-routes.js          # Datasets, fields, records, search/filter, export
│   │   ├── saved-search-routes.js     # Saved views and search history
│   │   ├── analytics-routes.js        # Analytics for analysts and admins
│   │   ├── admin-routes.js            # Users, roles, dataset permissions, system info
│   │   └── initialize-first-admin.js  # Logic for promoting the first administrator
│   ├── auth/
│   │   └── permissions.js             # Auto-grants demo dataset access to new users
│   ├── middleware/
│   │   └── error-handler.js           # 404 and error responses
│   ├── models/                        # Mongoose models (see "Data model")
│   ├── routes/
│   │   └── health.js                  # GET /api/health
│   └── scripts/
│       ├── initialize-first-admin.js  # CLI: promote the first administrator
│       └── seed-demo-data.js          # CLI: generate demo datasets
└── test/                              # Node test runner suites
```

> Note: there are two files named `permissions.js`. `src/authorization/permissions.js` defines the RBAC role matrix, while `src/auth/permissions.js` only contains the helper that grants new users read access to the demo datasets.

## Getting started

### Prerequisites

- Node.js **22.13 or newer**
- A MongoDB instance (local or MongoDB Atlas)
- (Optional) A Google OAuth client, if you want Google sign-in

### Installation

```bash
git clone https://github.com/sumaiya6722/datascope-backend.git
cd datascope-backend
npm install
```

### Configure the environment

Create a `.env` file in the project root (see [Environment variables](#environment-variables)):

```env
PORT=5000
FRONTEND_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:5000
BETTER_AUTH_SECRET=<a-random-string-of-at-least-32-characters>
MONGODB_URI=mongodb://localhost:27017
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
```

Generate a strong secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Run the server

```bash
npm run dev     # watch mode, restarts on file changes
npm start       # plain start
```

The API listens on `http://localhost:5000` by default. Verify it with:

```bash
curl http://localhost:5000/api/health
# {"status":"ok","service":"datascope-api","database":"connected"}
```

### Create the first administrator

Administrators cannot be created through sign-up or the API. After registering a normal account, promote it once with:

```bash
npm run initialize:first-admin -- --email you@example.com
```

This can only succeed **once**: it records a claim in the `authorizationBootstrap` collection, and refuses to run if another administrator already exists or the slot was claimed by a different account. Re-running it for the same account is safe.

### Available scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start with `node --watch` and `.env` loaded |
| `npm start` | Start the server with `.env` loaded |
| `npm test` | Run the test suites |
| `npm run initialize:first-admin -- --email <email>` | Promote the first administrator |
| `npm run seed:demo -- --creator-email <email>` | Generate demo datasets (see [Known issues](#known-issues)) |

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Port to listen on. Defaults to `5000`. |
| `FRONTEND_URL` | Yes | Origin of the frontend, e.g. `http://localhost:3000`. Used for CORS and as a Better Auth trusted origin. Must be an `http(s)` origin with **no path and no trailing slash**. |
| `BETTER_AUTH_URL` | Yes | Public origin of this API, e.g. `http://localhost:5000`. Same format rules as `FRONTEND_URL`. |
| `BETTER_AUTH_SECRET` | Yes | Signing secret, at least 32 characters. Startup fails if it is shorter or contains the words "replace" or "generate". |
| `MONGODB_URI` | Yes | MongoDB connection string. The database name `datascope` is set in code. |
| `GOOGLE_CLIENT_ID` | For Google sign-in | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | For Google sign-in | Google OAuth client secret. |
| `NODE_ENV` | No | Set to `production` to enable secure cookies. |

For Google sign-in, add this authorized redirect URI in the Google Cloud Console:

```
<BETTER_AUTH_URL>/api/auth/callback/google
```

The server validates its configuration at startup and exits with a clear error if anything is missing or malformed.

## Authentication and roles

Authentication is handled by Better Auth, mounted at `/api/auth/*`. Sessions are stored in HTTP-only cookies (`sameSite=lax`, `secure` in production). Session tokens are stripped from auth responses, and every user object returned includes its computed `permissions`.

Common endpoints (from Better Auth):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/sign-up/email` | Register with email and password |
| `POST` | `/api/auth/sign-in/email` | Sign in |
| `POST` | `/api/auth/sign-out` | Sign out |
| `GET` | `/api/auth/get-session` | Get the current session |

Sign-up accepts an optional `requestedRole`:

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "password": "a-strong-password",
  "requestedRole": "dataAnalyst"
}
```

Only `viewer` and `dataAnalyst` are honored. Anything else, including attempts to request `administrator`, falls back to `viewer`.

### Permission matrix

| Capability | Viewer | Data Analyst | Administrator |
| --- | :---: | :---: | :---: |
| Read granted datasets and records | Yes | Yes | Yes (all) |
| Basic search and basic filters | Yes | Yes | Yes |
| Advanced search modes (`exact`, `text`) | No | Yes | Yes |
| Multiple filter conditions | No | Yes | Yes |
| Create and manage personal saved views | No | Yes | Yes |
| Access views shared with them | Yes | Yes | Yes |
| Export data | No | Yes* | Yes |
| Analytics | No | Yes | Yes |
| Create, edit, and delete datasets and fields | No | No | Yes |
| Manage users, dataset permissions, system info | No | No | Yes |

\* Export also requires an `export` grant on that specific dataset for non-administrators.

### Two layers of access

1. **Role permissions** decide *what kind* of action a user may perform.
2. **Dataset grants** (`read`, `export`) decide *which datasets* a non-admin may touch. Administrators bypass dataset grants.

New `viewer` and `dataAnalyst` accounts are automatically granted `read` access to the three demo datasets (`customer-directory`, `product-inventory`, `sales-transactions`) if those exist.

## API reference

All endpoints are under `/api`. Unless noted as public, they require a valid session cookie, so browser clients must send requests with `credentials: "include"`.

**Error format**

```json
{ "error": "Forbidden", "message": "You do not have permission to perform this action." }
```

Common statuses: `400` invalid input, `401` not signed in, `403` not allowed, `404` not found, `409` conflict (e.g. duplicate slug), `413` export too large.

### System

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Public. `200` when MongoDB is connected, `503` otherwise. |
| `GET` | `/api/me` | Current user with role and permissions. |

### Datasets and fields

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/api/datasets` | `dataset:read` | List datasets the user can read, with record counts. |
| `POST` | `/api/datasets` | `dataset:manage` | Create a dataset. |
| `GET` | `/api/datasets/:datasetId` | `dataset:read` | Get one dataset (includes `canManage`). |
| `PATCH` | `/api/datasets/:datasetId` | `dataset:manage` | Update a dataset. |
| `DELETE` | `/api/datasets/:datasetId` | `dataset:manage` | Delete a dataset and everything attached to it (fields, records, permissions, history, relationships, saved views, search history). |
| `GET` | `/api/datasets/:datasetId/fields` | `dataset:read` | List field definitions. |
| `POST` | `/api/datasets/:datasetId/fields` | `dataset:manage` | Add a field. |
| `PATCH` | `/api/datasets/:datasetId/fields/:fieldId` | `dataset:manage` | Update a field. |
| `DELETE` | `/api/datasets/:datasetId/fields/:fieldId` | `dataset:manage` | Delete a field. |

**Create dataset** requires `name` (2-160 chars), `slug` (lowercase letters, numbers, single hyphens), `category`, and `dataSource` (`{ name, type, description? }`). `description` is optional.

**Field properties**: `name` (starts with a letter; letters, numbers, underscores; up to 80 chars), `label`, `dataType`, and the boolean flags `searchable`, `filterable`, `sortable`, `visibleByDefault`.

Supported `dataType` values: `string`, `number`, `date`, `boolean`, `email`, `phone`, `currency`, `object`.

### Records: search, filter, sort, paginate

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/api/datasets/:datasetId/records` | `dataset:records:read` |
| `GET` | `/api/datasets/:datasetId/records/:recordId` | `dataset:records:read` |

Query parameters for the list endpoint (anything else returns `400`):

| Parameter | Description |
| --- | --- |
| `page` | Page number, starting at 1. Default `1`. |
| `pageSize` | 1 to 100. Default `25`. |
| `sort` | Up to 3 entries as `field:asc` or `field:desc`. Repeat the parameter for multiple. Fields must be `sortable`. Default is newest first. |
| `fields` | Comma-separated field names to return (up to 40). Defaults to fields marked `visibleByDefault`. |
| `q` | Search text, up to 100 characters. Searches fields marked `searchable`. |
| `qMode` | `partial` (default), `exact`, or `text`. Anything other than `partial` requires the advanced-search permission. |
| `filters` | JSON array of 1 to 10 filter conditions, combined with AND. More than one requires the multiple-filters permission. |

**Search modes**

- `partial`: case-insensitive "contains" match across searchable text fields.
- `exact`: case-insensitive full-value match.
- `text`: MongoDB full-text search. The text index covers `companyName`, `industry`, `country`, `category`, and `contact`, and this mode requires **all five** to be defined as searchable fields on the dataset.

**Filter conditions** have the shape `{ "field": "...", "operator": "...", "value": "...", "valueTo": "..." }`. The field must be marked `filterable`. Values are sent as **strings**, including numbers.

| Field type | Operators |
| --- | --- |
| `string`, `email`, `phone` | `equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith` |
| `number`, `currency` | `equals`, `notEquals`, `greaterThan`, `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual`, `between` |
| `date` | `before`, `after`, `between` (ISO dates such as `2024-01-31`) |
| `boolean` | `isTrue`, `isFalse` (no `value`) |

`between` uses `value` as the lower bound and `valueTo` as the upper bound.

**Example**

```bash
curl -G "http://localhost:5000/api/datasets/<datasetId>/records" \
  -b cookies.txt \
  --data-urlencode "q=acme" \
  --data-urlencode "sort=price:desc" \
  --data-urlencode "pageSize=50" \
  --data-urlencode 'filters=[{"field":"status","operator":"equals","value":"available"},{"field":"price","operator":"between","value":"10","valueTo":"100"}]'
```

**Response**

```json
{
  "dataset": { "id": "...", "name": "...", "slug": "...", "totalRecords": 100000 },
  "records": [
    { "id": "...", "datasetId": "...", "createdAt": "...", "updatedAt": "...", "data": { } }
  ],
  "page": 1,
  "pageSize": 50,
  "totalMatchingRecords": 1234,
  "totalPages": 25,
  "sort": ["price:desc"],
  "fields": ["sku", "name", "price"],
  "search": "acme"
}
```

### Export

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/datasets/:datasetId/export` | JSON export of the first 1,000 records. |
| `POST` | `/api/datasets/:datasetId/export/csv` | CSV download. |

Both require the `dataset:export` permission, and non-administrators also need an `export` grant on the dataset.

CSV request body:

```json
{
  "mode": "filtered",
  "fields": ["sku", "name", "price"],
  "q": "acme",
  "qMode": "partial",
  "filters": [{ "field": "status", "operator": "equals", "value": "available" }]
}
```

- `mode` is `selected` (provide `recordIds`, 1 to 5,000) or `filtered` (provide `q` and/or `filters`).
- `fields` is 1 to 40 distinct dataset fields.
- Exports are capped at **5,000 records** (`413` above that).
- Cells starting with `=`, `+`, `-`, or `@` are prefixed with a quote to prevent spreadsheet formula injection.

### Saved views and search history

Mounted at `/api`. All routes require authentication.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/saved-views?datasetId=` | Views the user owns or that are shared with them (up to 100). |
| `POST` | `/api/saved-views` | Create a view. Requires `view:manage:personal`. |
| `PATCH` | `/api/saved-views/:viewId` | Update a view. Owner only. |
| `DELETE` | `/api/saved-views/:viewId` | Delete a view. Owner only. |
| `GET` | `/api/search-history?datasetId=` | The user's 50 most recent searches. |
| `POST` | `/api/search-history` | Record a search (needs a query or at least one filter). Only the latest 200 per user are kept. |

A saved view stores: `datasetId`, `name` (up to 120 chars), `description` (up to 500), `query`, `searchMode`, `filters`, `sort` (up to 3), `visibleFields` (up to 40), and `sharedWith` (up to 100 user IDs).

Sharing rules: every recipient must exist, must already have `read` access to the dataset (administrators are exempt), and must be allowed to use the view's search mode and number of filters.

### Analytics

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/api/analytics` | `dataset:analyze` |

Scoped to datasets the user can read (all datasets for administrators). Returns `totalRecords`, `recordsByCategory`, `recordsByStatus`, `dataGrowth` (by month), `searchActivity` (by day), and `frequentFilters` (top 10).

### Administration

Requires the `administrator` role.

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/api/admin/users` | `user:manage` | List all users. |
| `PATCH` | `/api/admin/users/:userId/role` | `user:manage` | Set a user's role to `dataAnalyst` or `viewer`. Administrators cannot be modified here. |
| `GET` | `/api/admin/analytics` | `analytics:admin` | Total users, datasets, and records. |
| `GET` | `/api/admin/system-config` | `system:manage` | Application name and available roles. |
| `GET` | `/api/admin/datasets/:datasetId/permissions` | `dataset:permissions:manage` | List who has access to a dataset. |
| `PUT` | `/api/admin/datasets/:datasetId/permissions/:userId` | `dataset:permissions:manage` | Set a user's grants. Body: `{ "permissions": ["read", "export"] }`. |
| `DELETE` | `/api/admin/datasets/:datasetId/permissions/:userId` | `dataset:permissions:manage` | Revoke a user's access. |

## Data model

| Model | Collection | Purpose |
| --- | --- | --- |
| `Dataset` | `datasets` | Dataset metadata: name, unique slug, category, data source, creator. |
| `DatasetField` | `datasetFields` | Field definitions and the searchable / filterable / sortable / visible flags. |
| `DatasetRecord` | `records` | Records, stored as a flexible `data` object, with indexes for common filters and a text index. |
| `DatasetAccessPermission` | `datasetPermissions` | Per-user, per-dataset grants (`read`, `export`). |
| `SavedView` | `savedViews` | Saved search/filter/sort configurations, optionally shared. |
| `SearchHistory` | `searchHistory` | Per-user search log. |
| `RecordHistory` | `recordHistory` | Audit trail model (not yet used by any route). |
| `RecordRelationship` | `recordRelationships` | Links between records (not yet used by any route). |
| `UserPreference` | `userPreferences` | Theme, page size, date format, time zone (not yet used by any route). |

Better Auth manages its own collections (`user`, `session`, `account`, `verification`), and the first-admin process uses `authorizationBootstrap`. User IDs are stored as strings in application collections.

## Seeding demo data

The seeder creates three linked, deterministic datasets (faker is seeded, so results are reproducible):

| Dataset (slug) | Contents |
| --- | --- |
| `customer-directory` | Names, email, phone, company, industry, city, country, registration date, status |
| `product-inventory` | SKU, name, category, description, price, stock, supplier, status |
| `sales-transactions` | Orders that reference real customer and product records, with quantity, prices, payment method, date, status |

```bash
npm run seed:demo -- --creator-email admin@example.com [--size 100000] [--batch 5000] [--reset] [--quiet]
```

| Flag | Description |
| --- | --- |
| `--creator-email` | **Required.** Email of an existing user, recorded as the datasets' creator. |
| `--size` | Records per dataset. Default `100000` (300,000 in total). |
| `--batch` | Insert batch size. Default `5000`. |
| `--reset` | Delete previously seeded records first. |
| `--quiet` | Suppress progress output. |

Records carry a `seedKey`, so re-running the seeder skips records that already exist. Existing `viewer` users are granted `read` access to the demo datasets.

## Testing

```bash
npm test
```

Tests use Node's built-in runner and an in-memory MongoDB (`mongodb-memory-server`, which downloads a MongoDB binary on first run, so allow network access the first time).

| Suite | Covers |
| --- | --- |
| `test/auth.test.js` | Registration, login, sessions, logout, secure production cookies |
| `test/authorization.test.js` | Role matrix, first-admin initialization, dataset-scoped access, filter validation, saved views and history, dataset management, record retrieval |
| `test/models.test.js` | Model registration and the seed workflow |

## Security notes

- Every protected route re-checks the session on the server, then the role permission, then the dataset grant.
- Request bodies and query strings are validated against strict allow-lists; unknown keys are rejected.
- User-supplied search and filter text is regex-escaped before reaching MongoDB.
- CORS allows a single configured origin, with credentials.
- CSV exports neutralize spreadsheet formula injection.
- `.env` is git-ignored. Never commit it, and rotate any secret that has been shared.

## Known issues

These were found while documenting the code. Remove this section once they are fixed.

1. **`npm run seed:demo` fails to start.** `src/scripts/seed-demo-data.js` redeclares `creator`, `datasets`, and `viewers` several times inside `seedDemo()`, which is a `SyntaxError` (`Identifier 'creator' has already been declared`).
2. **`test/models.test.js` cannot load the seed script.** It imports `seedSyntheticBusinessData`, which the current seed script no longer exports, and still expects a single 100,000-record dataset.
3. **`text` search mode does not work on the demo datasets.** It requires searchable `companyName`, `industry`, `country`, `category`, and `contact` fields, which none of the three demo datasets define, so requests return `400`.
