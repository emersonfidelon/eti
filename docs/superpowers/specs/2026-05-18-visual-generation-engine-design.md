# Visual Generation Engine API — Design Spec
**Date:** 2026-05-18
**Status:** Approved

## Scope

Headless API that receives HTML slides generated externally (GPT or direct client), renders them to PNG via Playwright, and returns preview URLs and ZIP download. No payment integration, no GPT integration in this phase — validates the core rendering engine.

---

## Architecture

```
Client (GPT or direct)
  headers: x-api-key: SERVICE_KEY
           x-user-token: USER_TOKEN (after auth)
    │
    ├── POST /api/v1/auth/request-code   → sends OTP via email
    ├── POST /api/v1/auth/verify-code    → validates OTP → returns user_token
    │
    ├── POST /api/v1/generations         → enqueues render job
    ├── GET  /api/v1/generations/:id     → status + preview_url + zip_url
    │
    ├── POST /api/v1/assets              → upload image → returns asset_url
    │
    ├── GET  /api/v1/customers/me        → profile + segment
    ├── PUT  /api/v1/customers/me        → update profile
    │
    ├── GET  /api/v1/visual-identity     → fetch visual identity
    └── PUT  /api/v1/visual-identity     → save visual identity
    │
    ▼
BullMQ Queue (Redis)
    ▼
Playwright Worker (same Next.js process)
    ▼
Storage (Supabase local dev / Cloudflare R2 prod)
    ▼
Prisma + PostgreSQL (Supabase)
```

**Stack:**
- Framework: Next.js (Route Handlers)
- ORM: Prisma + PostgreSQL (Supabase)
- Queue: BullMQ + Redis (Upstash in prod)
- Renderer: Playwright
- Storage: S3-compatible — Supabase Storage (dev), Cloudflare R2 (prod)
- Email: Resend

---

## Authentication

### Two-layer model

**Layer 1 — Service auth** (`x-api-key`): single global key, confirms the caller is a valid client. Required on all routes.

**Layer 2 — User identification** (`x-user-token`): identifies which user is making the request. Required on all routes except `/auth/*`.

### OTP flow

```
POST /api/v1/auth/request-code
  body: { "email": "user@example.com" }
  → generates 6-digit code, stores with 10min expiry, sends via Resend
  → 200 OK (always, to avoid email enumeration)

POST /api/v1/auth/verify-code
  body: { "email": "user@example.com", "code": "123456" }
  → 200 { "user_token": "uuid" }   if valid and user exists
  → 401 { "error": "invalid_code" } if invalid or expired
  → 404 { "error": "user_not_found" } if email not in database
```

- Code is single-use: `used_at` set on successful verification
- `user_token` has no expiry in MVP — manually revocable

### Middleware

Executes on all routes except `/auth/*`:
1. Validate `x-api-key` → 401 if missing/invalid
2. Validate `x-user-token` → 401 if missing/invalid
3. Inject `user` + `customer` into request context

---

## Data Model

```sql
users
  id              uuid PK
  email           text UNIQUE NOT NULL
  name            text
  status          enum(active, inactive)
  created_at      timestamptz

auth_codes
  id              uuid PK
  user_id         uuid FK users
  code            varchar(6)
  expires_at      timestamptz
  used_at         timestamptz       -- null = not yet used

user_tokens
  id              uuid PK
  user_id         uuid FK users
  token           uuid UNIQUE        -- x-user-token value
  created_at      timestamptz
  last_used_at    timestamptz

customers
  id              uuid PK
  user_id         uuid FK users UNIQUE
  name            text
  segment         text               -- church, pastor, ministry, etc.
  status          enum(active, inactive)
  created_at      timestamptz

visual_identities
  id              uuid PK
  customer_id     uuid FK customers UNIQUE
  logo_url        text
  primary_color   varchar(7)
  secondary_color varchar(7)
  typography      text
  visual_style    text
  updated_at      timestamptz

generations
  id              uuid PK
  customer_id     uuid FK customers
  content_type    enum(post, carousel)
  source_type     text               -- message, news, image, date
  user_input      text
  status          enum(pending, processing, completed, failed)
  preview_url     text               -- png_url of slide 1
  zip_url         text               -- all slides zipped (carousel)
  error_message   text
  created_at      timestamptz

slides
  id              uuid PK
  generation_id   uuid FK generations
  position        int
  html            text
  png_url         text
  created_at      timestamptz

assets
  id              uuid PK
  customer_id     uuid FK customers
  generation_id   uuid FK generations NULL  -- null = standalone asset
  asset_type      text                       -- image, logo
  url             text
  created_at      timestamptz
```

**Relations:** `users` 1→1 `customers` 1→1 `visual_identities`, `customers` 1→N `generations` 1→N `slides` + `assets`

---

## Generation Flow

### POST /api/v1/generations

Request:
```json
{
  "content_type": "post | carousel",
  "source_type": "message | news | image | date",
  "user_input": "free text",
  "slides": [
    { "position": 1, "html": "<html>...</html>" },
    { "position": 2, "html": "<html>...</html>" }
  ]
}
```

Response (immediate):
```json
{
  "id": "uuid",
  "status": "pending",
  "status_url": "/api/v1/generations/uuid"
}
```

### Worker (BullMQ)

```
For each slide in order:
  1. Playwright opens HTML in 1080x1080 viewport
  2. Waits for networkidle + fonts loaded
  3. Screenshots PNG → saves to storage
  4. Updates slide.png_url

If carousel:
  5. Packages all PNGs into ZIP → saves to storage
  6. Sets generation.zip_url

7. generation.preview_url = slide 1 png_url
8. generation.status = "completed"

On error:
  status = "failed", error_message = reason
```

### GET /api/v1/generations/:id

Client polls until `status: completed | failed`:
```json
{
  "id": "uuid",
  "status": "completed",
  "content_type": "carousel",
  "preview_url": "https://storage.../slide-1.png",
  "zip_url": "https://storage.../generation-uuid.zip",
  "slides": [
    { "position": 1, "png_url": "..." },
    { "position": 2, "png_url": "..." }
  ]
}
```

---

## Security

- OTP: 10-minute expiry, single-use
- Ownership validation on every data access: `generation.customer_id === req.customer.id`
- HTML sanitized server-side (DOMPurify) before Playwright renders — prevents malicious script execution
- Asset upload: real MIME type validation (not extension only), 10MB size limit
- Rate limiting: max 10 req/min per `x-user-token` on generation endpoints
- Logs: no sensitive data (no full HTML, no tokens)

---

## Project Structure

```
/
├── src/
│   ├── app/
│   │   └── api/v1/
│   │       ├── auth/
│   │       │   ├── request-code/route.ts
│   │       │   └── verify-code/route.ts
│   │       ├── generations/
│   │       │   ├── route.ts              (POST)
│   │       │   └── [id]/route.ts         (GET)
│   │       ├── assets/
│   │       │   └── route.ts              (POST)
│   │       ├── customers/
│   │       │   └── me/route.ts           (GET, PUT)
│   │       └── visual-identity/
│   │           └── route.ts              (GET, PUT)
│   │
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── middleware.ts
│   │   │   └── otp.ts
│   │   ├── queue/
│   │   │   ├── client.ts
│   │   │   ├── worker.ts
│   │   │   └── jobs/render-generation.ts
│   │   ├── renderer/
│   │   │   ├── playwright.ts
│   │   │   └── zip.ts
│   │   ├── storage/
│   │   │   └── client.ts
│   │   ├── email/
│   │   │   └── resend.ts
│   │   └── db/
│   │       └── prisma.ts
│   │
│   └── types/
│       └── api.ts
│
├── prisma/
│   └── schema.prisma
│
├── worker.ts
└── .env
```

---

## Environment Variables

```
DATABASE_URL
SERVICE_API_KEY
REDIS_URL
STORAGE_ENDPOINT
STORAGE_BUCKET
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
STORAGE_PUBLIC_URL
RESEND_API_KEY
```

---

## Out of Scope (this phase)

- Payment integration (Mercado Pago)
- ChatGPT GPT Actions integration
- Plan limits / subscription management
- Frontend / admin panel
- Multi-customer per user
