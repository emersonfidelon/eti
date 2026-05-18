# Visual Generation Engine API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a headless REST API that receives HTML slides, renders them to PNG via Playwright, and returns preview URLs and ZIP download links.

**Architecture:** Next.js 15 Route Handlers serve the API; BullMQ (Redis) queues render jobs; a separate worker process runs Playwright to screenshot each HTML slide and upload PNGs/ZIPs to S3-compatible storage. Auth uses a two-layer model: global `x-api-key` + per-user OTP-issued `x-user-token`.

**Tech Stack:** Next.js 15, TypeScript, Prisma 5 + PostgreSQL (Supabase), BullMQ + ioredis, Playwright, @aws-sdk/client-s3, Resend, sanitize-html, archiver, file-type, Zod, Vitest

---

## File Map

```
src/
  app/api/v1/
    auth/request-code/route.ts     POST — send OTP
    auth/verify-code/route.ts      POST — verify OTP, return user_token
    generations/route.ts           POST — create generation
    generations/[id]/route.ts      GET  — poll generation status
    assets/route.ts                POST — upload asset
    customers/me/route.ts          GET, PUT — customer profile
    visual-identity/route.ts       GET, PUT — visual identity
  lib/
    auth/
      middleware.ts                withAuth(), withApiKey() helpers
      otp.ts                       createOtp(), consumeOtp()
      rate-limit.ts                checkRateLimit() sliding window
    db/
      prisma.ts                    singleton PrismaClient
    email/
      resend.ts                    sendOtpEmail()
    queue/
      client.ts                    Redis connection + renderQueue (BullMQ Queue)
      worker.ts                    startWorker() (BullMQ Worker)
      jobs/
        render-generation.ts       processRenderJob()
    renderer/
      playwright.ts                renderHtmlToPng()
      zip.ts                       createZip()
    storage/
      client.ts                    uploadBuffer()
  types/
    api.ts                         AuthContext, GenerationCreateBody, etc.
  instrumentation.ts               starts BullMQ worker on server boot (prod)
prisma/
  schema.prisma
worker.ts                          standalone worker entrypoint (dev)
vitest.config.ts
.env.example
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`

- [ ] **Step 1: Bootstrap Next.js project**

```bash
cd /Users/emerson/projetos/eti
npx create-next-app@latest . --typescript --no-tailwind --no-eslint --no-src-dir --app --no-import-alias
```

When prompted, accept defaults. After bootstrap, move source into `src/`:

```bash
mkdir -p src/app src/lib src/types
mv app/* src/app/ 2>/dev/null || true
rm -rf app
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add @prisma/client bullmq ioredis playwright @aws-sdk/client-s3 \
  resend sanitize-html archiver file-type zod uuid
pnpm add -D prisma typescript tsx vitest @vitest/coverage-v8 \
  vite-tsconfig-paths @types/node @types/sanitize-html \
  @types/archiver @types/uuid
```

Then install Playwright browsers:
```bash
npx playwright install chromium
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    },
    "baseUrl": "."
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright', 'archiver']
}

export default nextConfig
```

- [ ] **Step 5: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true
  }
})
```

- [ ] **Step 6: Write `.env.example`**

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"

# Service auth
SERVICE_API_KEY="change-me-service-key"

# Redis
REDIS_URL="redis://localhost:6379"

# Storage (Supabase local dev)
STORAGE_ENDPOINT="http://localhost:54321/storage/v1/s3"
STORAGE_BUCKET="generations"
STORAGE_ACCESS_KEY="your-access-key"
STORAGE_SECRET_KEY="your-secret-key"
STORAGE_PUBLIC_URL="http://localhost:54321/storage/v1/object/public"

# Email
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="noreply@yourdomain.com"

# Node env
NODE_ENV="development"
```

Copy to `.env`:
```bash
cp .env.example .env
```

- [ ] **Step 7: Add scripts to `package.json`**

Add these scripts:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "worker": "tsx worker.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 8: Start Supabase and Redis (dev prerequisites)**

```bash
# Supabase (must have Supabase CLI installed: brew install supabase/tap/supabase)
supabase start

# Redis (requires Docker)
docker run -d --name redis-dev -p 6379:6379 redis:alpine
```

Note the DATABASE_URL from `supabase status` output and update `.env`.

- [ ] **Step 9: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold Next.js project with dependencies"
```

---

## Task 2: Prisma Schema + Migration

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserStatus {
  active
  inactive
}

enum CustomerStatus {
  active
  inactive
}

enum ContentType {
  post
  carousel
}

enum GenerationStatus {
  pending
  processing
  completed
  failed
}

model User {
  id        String     @id @default(uuid())
  email     String     @unique
  name      String?
  status    UserStatus @default(active)
  createdAt DateTime   @default(now()) @map("created_at")

  authCodes AuthCode[]
  tokens    UserToken[]
  customer  Customer?

  @@map("users")
}

model AuthCode {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  code      String    @db.VarChar(6)
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")

  user      User      @relation(fields: [userId], references: [id])

  @@map("auth_codes")
}

model UserToken {
  id         String    @id @default(uuid())
  userId     String    @map("user_id")
  token      String    @unique @default(uuid())
  createdAt  DateTime  @default(now()) @map("created_at")
  lastUsedAt DateTime? @map("last_used_at")

  user       User      @relation(fields: [userId], references: [id])

  @@map("user_tokens")
}

model Customer {
  id        String         @id @default(uuid())
  userId    String         @unique @map("user_id")
  name      String?
  segment   String?
  status    CustomerStatus @default(active)
  createdAt DateTime       @default(now()) @map("created_at")

  user           User            @relation(fields: [userId], references: [id])
  visualIdentity VisualIdentity?
  generations    Generation[]
  assets         Asset[]

  @@map("customers")
}

model VisualIdentity {
  id             String   @id @default(uuid())
  customerId     String   @unique @map("customer_id")
  logoUrl        String?  @map("logo_url")
  primaryColor   String?  @map("primary_color") @db.VarChar(7)
  secondaryColor String?  @map("secondary_color") @db.VarChar(7)
  typography     String?
  visualStyle    String?  @map("visual_style")
  updatedAt      DateTime @updatedAt @map("updated_at")

  customer       Customer @relation(fields: [customerId], references: [id])

  @@map("visual_identities")
}

model Generation {
  id           String           @id @default(uuid())
  customerId   String           @map("customer_id")
  contentType  ContentType      @map("content_type")
  sourceType   String           @map("source_type")
  userInput    String?          @map("user_input")
  status       GenerationStatus @default(pending)
  previewUrl   String?          @map("preview_url")
  zipUrl       String?          @map("zip_url")
  errorMessage String?          @map("error_message")
  createdAt    DateTime         @default(now()) @map("created_at")

  customer     Customer         @relation(fields: [customerId], references: [id])
  slides       Slide[]
  assets       Asset[]

  @@map("generations")
}

model Slide {
  id           String     @id @default(uuid())
  generationId String     @map("generation_id")
  position     Int
  html         String
  pngUrl       String?    @map("png_url")
  createdAt    DateTime   @default(now()) @map("created_at")

  generation   Generation @relation(fields: [generationId], references: [id])

  @@map("slides")
}

model Asset {
  id           String      @id @default(uuid())
  customerId   String      @map("customer_id")
  generationId String?     @map("generation_id")
  assetType    String      @map("asset_type")
  url          String
  createdAt    DateTime    @default(now()) @map("created_at")

  customer     Customer    @relation(fields: [customerId], references: [id])
  generation   Generation? @relation(fields: [generationId], references: [id])

  @@map("assets")
}
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name init
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 4: Generate Prisma client**

```bash
npx prisma generate
```

Expected output: `Generated Prisma Client`

- [ ] **Step 5: Verify schema in Prisma Studio (optional)**

```bash
npx prisma studio
```

Open `http://localhost:5555` and verify all tables exist.

- [ ] **Step 6: Commit**

```bash
git add prisma/
git commit -m "feat: add Prisma schema with all tables"
```

---

## Task 3: Prisma Singleton + API Types

**Files:**
- Create: `src/lib/db/prisma.ts`
- Create: `src/types/api.ts`

- [ ] **Step 1: Write `src/lib/db/prisma.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
```

- [ ] **Step 2: Write `src/types/api.ts`**

```typescript
export interface AuthContext {
  user: {
    id: string
    email: string
    name: string | null
  }
  customer: {
    id: string
    name: string | null
    segment: string | null
    status: string
  }
}

export interface GenerationCreateBody {
  content_type: 'post' | 'carousel'
  source_type: 'message' | 'news' | 'image' | 'date'
  user_input?: string
  slides: Array<{
    position: number
    html: string
  }>
}

export interface GenerationResponse {
  id: string
  status: string
  content_type: string
  source_type: string
  user_input?: string | null
  preview_url?: string | null
  zip_url?: string | null
  error_message?: string | null
  slides: Array<{
    position: number
    png_url?: string | null
  }>
  created_at: string
}

export interface CustomerUpdateBody {
  name?: string
  segment?: string
}

export interface VisualIdentityBody {
  logo_url?: string
  primary_color?: string
  secondary_color?: string
  typography?: string
  visual_style?: string
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/prisma.ts src/types/api.ts
git commit -m "feat: add Prisma singleton and API types"
```

---

## Task 4: Storage Client

**Files:**
- Create: `src/lib/storage/client.ts`
- Create: `src/lib/storage/client.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/lib/storage/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({})
  })),
  PutObjectCommand: vi.fn()
}))

describe('uploadBuffer', () => {
  beforeEach(() => {
    process.env.STORAGE_ENDPOINT = 'http://localhost:54321/storage/v1/s3'
    process.env.STORAGE_BUCKET = 'generations'
    process.env.STORAGE_ACCESS_KEY = 'test-key'
    process.env.STORAGE_SECRET_KEY = 'test-secret'
    process.env.STORAGE_PUBLIC_URL = 'http://localhost:54321/storage/v1/object/public'
  })

  it('returns public URL after upload', async () => {
    const { uploadBuffer } = await import('./client')
    const buf = Buffer.from('fake-png')
    const url = await uploadBuffer(buf, 'generations/abc/slide-1.png', 'image/png')
    expect(url).toBe(
      'http://localhost:54321/storage/v1/object/public/generations/generations/abc/slide-1.png'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/lib/storage/client.test.ts
```

Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 3: Write `src/lib/storage/client.ts`**

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

function getClient(): S3Client {
  return new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT!,
    region: 'auto',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY!,
      secretAccessKey: process.env.STORAGE_SECRET_KEY!
    },
    forcePathStyle: true
  })
}

export async function uploadBuffer(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const client = getClient()

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.STORAGE_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  )

  return `${process.env.STORAGE_PUBLIC_URL}/${process.env.STORAGE_BUCKET}/${key}`
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/lib/storage/client.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/
git commit -m "feat: add S3-compatible storage client"
```

---

## Task 5: Email Client

**Files:**
- Create: `src/lib/email/resend.ts`
- Create: `src/lib/email/resend.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/lib/email/resend.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockSend = vi.fn().mockResolvedValue({ id: 'email-id' })
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend }
  }))
}))

describe('sendOtpEmail', () => {
  it('sends email with OTP code', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    process.env.RESEND_FROM_EMAIL = 'noreply@test.com'

    const { sendOtpEmail } = await import('./resend')
    await sendOtpEmail('user@example.com', '123456')

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        from: 'noreply@test.com'
      })
    )
    expect(mockSend.mock.calls[0][0].text).toContain('123456')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/lib/email/resend.test.ts
```

Expected: FAIL — `Cannot find module './resend'`

- [ ] **Step 3: Write `src/lib/email/resend.ts`**

```typescript
import { Resend } from 'resend'

let client: Resend | null = null

function getClient(): Resend {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY!)
  }
  return client
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  await getClient().emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: email,
    subject: 'Seu código de verificação',
    text: `Seu código é: ${code}\n\nEle expira em 10 minutos.`
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/lib/email/resend.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/
git commit -m "feat: add Resend email client for OTP"
```

---

## Task 6: Queue Client

**Files:**
- Create: `src/lib/queue/client.ts`

- [ ] **Step 1: Write `src/lib/queue/client.ts`**

```typescript
import { Queue } from 'bullmq'
import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
})

export const renderQueue = new Queue('render', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50
  }
})
```

- [ ] **Step 2: Verify Redis is reachable**

```bash
redis-cli -u $REDIS_URL ping
```

Expected: `PONG`

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/client.ts
git commit -m "feat: add BullMQ queue and Redis client"
```

---

## Task 7: OTP Logic

**Files:**
- Create: `src/lib/auth/otp.ts`
- Create: `src/lib/auth/otp.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/auth/otp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const mockFindFirst = vi.fn()
const mockUpdate = vi.fn()
const mockFindUnique = vi.fn()

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    authCode: {
      create: mockCreate,
      findFirst: mockFindFirst,
      update: mockUpdate
    },
    userToken: {
      create: vi.fn().mockResolvedValue({ token: 'new-token-uuid' })
    },
    user: {
      findUnique: mockFindUnique
    }
  }
}))

describe('generateCode', () => {
  it('returns 6-digit numeric string', async () => {
    const { generateCode } = await import('./otp')
    const code = generateCode()
    expect(code).toMatch(/^\d{6}$/)
  })
})

describe('createOtp', () => {
  it('creates auth_code record and returns code', async () => {
    mockCreate.mockResolvedValue({})
    const { createOtp } = await import('./otp')
    const code = await createOtp('user-id-1')
    expect(code).toMatch(/^\d{6}$/)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-id-1', code })
      })
    )
  })
})

describe('consumeOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when user not found', async () => {
    mockFindUnique.mockResolvedValue(null)
    const { consumeOtp } = await import('./otp')
    const result = await consumeOtp('unknown@example.com', '123456')
    expect(result).toBeNull()
  })

  it('returns null when code is invalid', async () => {
    mockFindUnique.mockResolvedValue({ id: 'user-1' })
    mockFindFirst.mockResolvedValue(null)
    const { consumeOtp } = await import('./otp')
    const result = await consumeOtp('user@example.com', '000000')
    expect(result).toBeNull()
  })

  it('returns user_token string when code is valid', async () => {
    mockFindUnique.mockResolvedValue({ id: 'user-1' })
    mockFindFirst.mockResolvedValue({ id: 'code-1' })
    mockUpdate.mockResolvedValue({})
    const { prisma } = await import('@/lib/db/prisma')
    ;(prisma.userToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'token-abc-123'
    })
    const { consumeOtp } = await import('./otp')
    const result = await consumeOtp('user@example.com', '123456')
    expect(result).toBe('token-abc-123')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/lib/auth/otp.test.ts
```

Expected: FAIL — `Cannot find module './otp'`

- [ ] **Step 3: Write `src/lib/auth/otp.ts`**

```typescript
import { prisma } from '@/lib/db/prisma'

export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function createOtp(userId: string): Promise<string> {
  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  await prisma.authCode.create({
    data: { userId, code, expiresAt }
  })

  return code
}

export async function consumeOtp(
  email: string,
  code: string
): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return null

  const authCode = await prisma.authCode.findFirst({
    where: {
      userId: user.id,
      code,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { expiresAt: 'desc' }
  })

  if (!authCode) return null

  await prisma.authCode.update({
    where: { id: authCode.id },
    data: { usedAt: new Date() }
  })

  const userToken = await prisma.userToken.create({
    data: { userId: user.id }
  })

  return userToken.token
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/lib/auth/otp.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/otp.ts src/lib/auth/otp.test.ts
git commit -m "feat: add OTP creation and consumption logic"
```

---

## Task 8: Auth Middleware

**Files:**
- Create: `src/lib/auth/middleware.ts`
- Create: `src/lib/auth/middleware.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/auth/middleware.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockFindUnique = vi.fn()

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userToken: {
      findUnique: mockFindUnique,
      update: vi.fn()
    }
  }
}))

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/test', {
    headers: new Headers(headers)
  })
}

describe('withApiKey', () => {
  beforeEach(() => {
    process.env.SERVICE_API_KEY = 'valid-key'
    vi.clearAllMocks()
  })

  it('returns 401 when x-api-key is missing', async () => {
    const { withApiKey } = await import('./middleware')
    const res = await withApiKey(makeRequest(), async () => {
      return new Response('ok')
    })
    expect(res.status).toBe(401)
  })

  it('calls handler when x-api-key is valid', async () => {
    const { withApiKey } = await import('./middleware')
    const handler = vi.fn().mockResolvedValue(new Response('ok'))
    await withApiKey(makeRequest({ 'x-api-key': 'valid-key' }), handler)
    expect(handler).toHaveBeenCalled()
  })
})

describe('withAuth', () => {
  beforeEach(() => {
    process.env.SERVICE_API_KEY = 'valid-key'
    vi.clearAllMocks()
  })

  it('returns 401 when x-user-token is missing', async () => {
    const { withAuth } = await import('./middleware')
    const res = await withAuth(
      makeRequest({ 'x-api-key': 'valid-key' }),
      async () => new Response('ok')
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when token not found in DB', async () => {
    mockFindUnique.mockResolvedValue(null)
    const { withAuth } = await import('./middleware')
    const res = await withAuth(
      makeRequest({ 'x-api-key': 'valid-key', 'x-user-token': 'bad-token' }),
      async () => new Response('ok')
    )
    expect(res.status).toBe(401)
  })

  it('calls handler with ctx when token is valid', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'token-1',
      user: {
        id: 'user-1',
        email: 'a@b.com',
        name: 'Test',
        customer: { id: 'cust-1', name: 'Igreja X', segment: 'church', status: 'active' }
      }
    })
    const { withAuth } = await import('./middleware')
    const handler = vi.fn().mockResolvedValue(new Response('ok'))
    await withAuth(
      makeRequest({ 'x-api-key': 'valid-key', 'x-user-token': 'good-token' }),
      handler
    )
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ email: 'a@b.com' }),
        customer: expect.objectContaining({ id: 'cust-1' })
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/lib/auth/middleware.test.ts
```

Expected: FAIL — `Cannot find module './middleware'`

- [ ] **Step 3: Write `src/lib/auth/middleware.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

export async function withApiKey(
  req: NextRequest,
  handler: () => Promise<Response>
): Promise<Response> {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.SERVICE_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return handler()
}

export async function withAuth(
  req: NextRequest,
  handler: (ctx: AuthContext) => Promise<Response>
): Promise<Response> {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.SERVICE_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const token = req.headers.get('x-user-token')
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const record = await prisma.userToken.findUnique({
    where: { token },
    include: {
      user: {
        include: { customer: true }
      }
    }
  })

  if (!record || !record.user.customer) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  await prisma.userToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() }
  })

  return handler({
    user: {
      id: record.user.id,
      email: record.user.email,
      name: record.user.name
    },
    customer: {
      id: record.user.customer.id,
      name: record.user.customer.name,
      segment: record.user.customer.segment,
      status: record.user.customer.status
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/lib/auth/middleware.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/middleware.ts src/lib/auth/middleware.test.ts
git commit -m "feat: add auth middleware with API key and user token validation"
```

---

## Task 9: Auth Routes

**Files:**
- Create: `src/app/api/v1/auth/request-code/route.ts`
- Create: `src/app/api/v1/auth/verify-code/route.ts`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src/app/api/v1/auth/request-code
mkdir -p src/app/api/v1/auth/verify-code
```

- [ ] **Step 2: Write `src/app/api/v1/auth/request-code/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiKey } from '@/lib/auth/middleware'
import { createOtp } from '@/lib/auth/otp'
import { sendOtpEmail } from '@/lib/email/resend'
import { prisma } from '@/lib/db/prisma'

const schema = z.object({
  email: z.string().email()
})

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => {
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
    }

    const { email } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })

    // Always return 200 to avoid email enumeration
    if (!user || user.status !== 'active') {
      return NextResponse.json({ ok: true })
    }

    const code = await createOtp(user.id)
    await sendOtpEmail(email, code)

    return NextResponse.json({ ok: true })
  })
}
```

- [ ] **Step 3: Write `src/app/api/v1/auth/verify-code/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiKey } from '@/lib/auth/middleware'
import { consumeOtp } from '@/lib/auth/otp'
import { prisma } from '@/lib/db/prisma'

const schema = z.object({
  email: z.string().email(),
  code: z.string().length(6)
})

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => {
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    const { email, code } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const token = await consumeOtp(email, code)
    if (!token) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 401 })
    }

    return NextResponse.json({ user_token: token })
  })
}
```

- [ ] **Step 4: Start dev server and smoke test auth routes**

```bash
pnpm dev
```

In a separate terminal:

```bash
# Should return 200 ok:true (even if email doesn't exist — anti-enumeration)
curl -s -X POST http://localhost:3000/api/v1/auth/request-code \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-service-key" \
  -d '{"email": "test@example.com"}' | jq

# Should return 401 unauthorized (missing x-api-key):
curl -s -X POST http://localhost:3000/api/v1/auth/request-code \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}' | jq
```

Expected first: `{"ok":true}`. Expected second: `{"error":"unauthorized"}`.

- [ ] **Step 5: Create a test user directly in DB for manual testing**

```bash
npx prisma studio
```

In Studio, create:
1. A `users` record: `email = test@yourmail.com`, `status = active`
2. A `customers` record: `user_id = <user id>`, `name = Test Igreja`, `segment = church`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/auth/
git commit -m "feat: add OTP auth routes (request-code, verify-code)"
```

---

## Task 10: Playwright Renderer

**Files:**
- Create: `src/lib/renderer/playwright.ts`
- Create: `src/lib/renderer/playwright.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/lib/renderer/playwright.test.ts
import { describe, it, expect } from 'vitest'
import { renderHtmlToPng } from './playwright'

describe('renderHtmlToPng', () => {
  it('returns a PNG buffer for valid HTML', async () => {
    const html = `<!DOCTYPE html>
<html>
<head><style>body { background: red; width: 1080px; height: 1080px; margin: 0; }</style></head>
<body><h1 style="color:white">Test Slide</h1></body>
</html>`

    const buffer = await renderHtmlToPng(html)

    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(1000)
    // PNG magic bytes: 89 50 4E 47
    expect(buffer[0]).toBe(0x89)
    expect(buffer[1]).toBe(0x50)
    expect(buffer[2]).toBe(0x4e)
    expect(buffer[3]).toBe(0x47)
  }, 30000) // Playwright can take time

  it('strips script tags before rendering', async () => {
    // Should not throw even with malicious HTML
    const html = `<html><body><script>while(true){}</script><p>Safe</p></body></html>`
    const buffer = await renderHtmlToPng(html)
    expect(buffer).toBeInstanceOf(Buffer)
  }, 30000)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/lib/renderer/playwright.test.ts
```

Expected: FAIL — `Cannot find module './playwright'`

- [ ] **Step 3: Write `src/lib/renderer/playwright.ts`**

```typescript
import { chromium, type Browser } from 'playwright'
import sanitizeHtml from 'sanitize-html'

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
  }
  return browser
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}

export async function renderHtmlToPng(rawHtml: string): Promise<Buffer> {
  const html = sanitizeHtml(rawHtml, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'html', 'head', 'body', 'meta', 'link', 'style',
      'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'use', 'defs', 'g'
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['class', 'id', 'style', 'data-*'],
      link: ['rel', 'href'],
      meta: ['name', 'content', 'charset'],
      svg: ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke'],
      path: ['d', 'fill', 'stroke', 'stroke-width'],
      use: ['href', 'xlink:href']
    },
    allowedSchemes: ['https', 'http', 'data'],
    allowVulnerableTags: false
  })

  const b = await getBrowser()
  const page = await b.newPage()

  try {
    await page.setViewportSize({ width: 1080, height: 1080 })
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 })

    const buffer = await page.screenshot({ type: 'png' })
    return Buffer.from(buffer)
  } finally {
    await page.close()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/lib/renderer/playwright.test.ts
```

Expected: PASS (2 tests). Note: tests are slow (~5-10s) due to Playwright.

- [ ] **Step 5: Commit**

```bash
git add src/lib/renderer/playwright.ts src/lib/renderer/playwright.test.ts
git commit -m "feat: add Playwright HTML-to-PNG renderer with HTML sanitization"
```

---

## Task 11: ZIP Packager

**Files:**
- Create: `src/lib/renderer/zip.ts`
- Create: `src/lib/renderer/zip.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/lib/renderer/zip.test.ts
import { describe, it, expect } from 'vitest'
import { createZip } from './zip'

describe('createZip', () => {
  it('returns a non-empty buffer', async () => {
    const entries = [
      { name: 'slide-1.png', buffer: Buffer.from('fake-png-1') },
      { name: 'slide-2.png', buffer: Buffer.from('fake-png-2') }
    ]

    const zip = await createZip(entries)

    expect(zip).toBeInstanceOf(Buffer)
    expect(zip.length).toBeGreaterThan(0)
    // ZIP magic bytes: 50 4B 03 04
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
  })

  it('handles single entry', async () => {
    const entries = [{ name: 'slide-1.png', buffer: Buffer.from('png') }]
    const zip = await createZip(entries)
    expect(zip).toBeInstanceOf(Buffer)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/lib/renderer/zip.test.ts
```

Expected: FAIL — `Cannot find module './zip'`

- [ ] **Step 3: Write `src/lib/renderer/zip.ts`**

```typescript
import archiver from 'archiver'
import { Readable } from 'stream'

interface ZipEntry {
  name: string
  buffer: Buffer
}

export async function createZip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const archive = archiver('zip', { zlib: { level: 6 } })

    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)

    for (const entry of entries) {
      archive.append(Readable.from(entry.buffer), { name: entry.name })
    }

    archive.finalize()
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/lib/renderer/zip.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/renderer/zip.ts src/lib/renderer/zip.test.ts
git commit -m "feat: add ZIP packager for carousel slides"
```

---

## Task 12: Render Job

**Files:**
- Create: `src/lib/queue/jobs/render-generation.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/lib/queue/jobs
```

- [ ] **Step 2: Write `src/lib/queue/jobs/render-generation.ts`**

```typescript
import type { Job } from 'bullmq'
import { prisma } from '@/lib/db/prisma'
import { renderHtmlToPng } from '@/lib/renderer/playwright'
import { createZip } from '@/lib/renderer/zip'
import { uploadBuffer } from '@/lib/storage/client'

export interface RenderJobData {
  generationId: string
}

export async function processRenderJob(job: Job<RenderJobData>): Promise<void> {
  const { generationId } = job.data

  await prisma.generation.update({
    where: { id: generationId },
    data: { status: 'processing' }
  })

  try {
    const generation = await prisma.generation.findUniqueOrThrow({
      where: { id: generationId },
      include: { slides: { orderBy: { position: 'asc' } } }
    })

    const renderedSlides: Array<{ position: number; pngUrl: string; buffer: Buffer }> = []

    for (const slide of generation.slides) {
      const buffer = await renderHtmlToPng(slide.html)
      const key = `generations/${generationId}/slide-${slide.position}.png`
      const url = await uploadBuffer(buffer, key, 'image/png')

      await prisma.slide.update({
        where: { id: slide.id },
        data: { pngUrl: url }
      })

      renderedSlides.push({ position: slide.position, pngUrl: url, buffer })
    }

    let zipUrl: string | undefined

    if (generation.contentType === 'carousel') {
      const zipBuffer = await createZip(
        renderedSlides.map((s) => ({
          name: `slide-${s.position}.png`,
          buffer: s.buffer
        }))
      )
      const zipKey = `generations/${generationId}/slides.zip`
      zipUrl = await uploadBuffer(zipBuffer, zipKey, 'application/zip')
    }

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: 'completed',
        previewUrl: renderedSlides[0]?.pngUrl ?? null,
        zipUrl: zipUrl ?? null
      }
    })
  } catch (error) {
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown render error'
      }
    })
    throw error
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/jobs/render-generation.ts
git commit -m "feat: add BullMQ render job with Playwright + ZIP + storage upload"
```

---

## Task 13: BullMQ Worker

**Files:**
- Create: `src/lib/queue/worker.ts`
- Create: `worker.ts` (root — standalone entrypoint)

- [ ] **Step 1: Write `src/lib/queue/worker.ts`**

```typescript
import { Worker } from 'bullmq'
import { redis } from './client'
import { processRenderJob } from './jobs/render-generation'
import type { RenderJobData } from './jobs/render-generation'

export function startWorker() {
  const worker = new Worker<RenderJobData>('render', processRenderJob, {
    connection: redis,
    concurrency: 2
  })

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message)
  })

  return worker
}
```

- [ ] **Step 2: Write root `worker.ts`**

```typescript
import 'dotenv/config'
import { startWorker } from './src/lib/queue/worker'
import { closeBrowser } from './src/lib/renderer/playwright'

console.log('[worker] Starting render worker...')
const worker = startWorker()
console.log('[worker] Ready')

async function shutdown() {
  console.log('[worker] Shutting down...')
  await worker.close()
  await closeBrowser()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

- [ ] **Step 3: Install dotenv**

```bash
pnpm add dotenv
```

- [ ] **Step 4: Verify worker starts**

```bash
pnpm worker
```

Expected output:
```
[worker] Starting render worker...
[worker] Ready
```

Press Ctrl+C. Expected: graceful shutdown message.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue/worker.ts worker.ts
git commit -m "feat: add BullMQ worker entrypoint with graceful shutdown"
```

---

## Task 14: Rate Limiting

**Files:**
- Create: `src/lib/auth/rate-limit.ts`
- Create: `src/lib/auth/rate-limit.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/lib/auth/rate-limit.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockExec = vi.fn()
const mockPipeline = vi.fn(() => ({
  zremrangebyscore: vi.fn().mockReturnThis(),
  zadd: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  pexpire: vi.fn().mockReturnThis(),
  exec: mockExec
}))

vi.mock('@/lib/queue/client', () => ({
  redis: { pipeline: mockPipeline }
}))

describe('checkRateLimit', () => {
  it('returns true when under limit', async () => {
    mockExec.mockResolvedValue([null, null, [null, 5], null])
    const { checkRateLimit } = await import('./rate-limit')
    const allowed = await checkRateLimit('user-1', 10, 60000)
    expect(allowed).toBe(true)
  })

  it('returns false when over limit', async () => {
    mockExec.mockResolvedValue([null, null, [null, 11], null])
    const { checkRateLimit } = await import('./rate-limit')
    const allowed = await checkRateLimit('user-1', 10, 60000)
    expect(allowed).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/lib/auth/rate-limit.test.ts
```

Expected: FAIL — `Cannot find module './rate-limit'`

- [ ] **Step 3: Write `src/lib/auth/rate-limit.ts`**

```typescript
import { redis } from '@/lib/queue/client'

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now()
  const windowStart = now - windowMs
  const redisKey = `rate:${key}`

  const pipeline = redis.pipeline()
  pipeline.zremrangebyscore(redisKey, '-inf', windowStart)
  pipeline.zadd(redisKey, now, `${now}-${Math.random()}`)
  pipeline.zcard(redisKey)
  pipeline.pexpire(redisKey, windowMs)

  const results = await pipeline.exec()
  const count = (results?.[2]?.[1] as number) ?? 0

  return count <= limit
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/lib/auth/rate-limit.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/rate-limit.ts src/lib/auth/rate-limit.test.ts
git commit -m "feat: add Redis sliding window rate limiter"
```

---

## Task 15: POST /api/v1/generations

**Files:**
- Create: `src/app/api/v1/generations/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/app/api/v1/generations
```

- [ ] **Step 2: Write `src/app/api/v1/generations/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { prisma } from '@/lib/db/prisma'
import { renderQueue } from '@/lib/queue/client'
import type { AuthContext, GenerationCreateBody } from '@/types/api'

const slideSchema = z.object({
  position: z.number().int().positive(),
  html: z.string().min(1).max(500_000)
})

const schema = z.object({
  content_type: z.enum(['post', 'carousel']),
  source_type: z.enum(['message', 'news', 'image', 'date']),
  user_input: z.string().max(5000).optional(),
  slides: z.array(slideSchema).min(1).max(20)
})

async function handler(ctx: AuthContext, body: GenerationCreateBody) {
  const allowed = await checkRateLimit(ctx.customer.id, 10, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limit_exceeded' }, { status: 429 })
  }

  const generation = await prisma.generation.create({
    data: {
      customerId: ctx.customer.id,
      contentType: body.content_type,
      sourceType: body.source_type,
      userInput: body.user_input,
      status: 'pending',
      slides: {
        create: body.slides.map((s) => ({
          position: s.position,
          html: s.html
        }))
      }
    }
  })

  await renderQueue.add('render-generation', { generationId: generation.id })

  return NextResponse.json(
    {
      id: generation.id,
      status: 'pending',
      status_url: `/api/v1/generations/${generation.id}`
    },
    { status: 202 }
  )
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    return handler(ctx, parsed.data)
  })
}
```

- [ ] **Step 3: Smoke test (requires dev server + worker running)**

In terminal 1: `pnpm dev`
In terminal 2: `pnpm worker`

Get a valid `user_token` by running through auth flow (Task 9 step 5):
```bash
# First, request OTP for test user
curl -s -X POST http://localhost:3000/api/v1/auth/request-code \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-service-key" \
  -d '{"email": "test@yourmail.com"}' | jq

# Check DB for the code (Prisma Studio or psql), then verify:
curl -s -X POST http://localhost:3000/api/v1/auth/verify-code \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-service-key" \
  -d '{"email": "test@yourmail.com", "code": "XXXXXX"}' | jq
# → {"user_token": "..."}

# Create a generation:
curl -s -X POST http://localhost:3000/api/v1/generations \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-service-key" \
  -H "x-user-token: YOUR_TOKEN" \
  -d '{
    "content_type": "post",
    "source_type": "message",
    "user_input": "Test post",
    "slides": [{"position": 1, "html": "<html><body style=\"background:blue;width:1080px;height:1080px\"><h1 style=\"color:white\">Hello</h1></body></html>"}]
  }' | jq
```

Expected: `{"id": "...", "status": "pending", "status_url": "..."}`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/generations/route.ts
git commit -m "feat: add POST /generations with BullMQ enqueue and rate limiting"
```

---

## Task 16: GET /api/v1/generations/:id

**Files:**
- Create: `src/app/api/v1/generations/[id]/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p "src/app/api/v1/generations/[id]"
```

- [ ] **Step 2: Write `src/app/api/v1/generations/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

async function handler(
  ctx: AuthContext,
  id: string
): Promise<NextResponse> {
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: { slides: { orderBy: { position: 'asc' } } }
  })

  if (!generation) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (generation.customerId !== ctx.customer.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    id: generation.id,
    status: generation.status,
    content_type: generation.contentType,
    source_type: generation.sourceType,
    user_input: generation.userInput,
    preview_url: generation.previewUrl,
    zip_url: generation.zipUrl,
    error_message: generation.errorMessage,
    slides: generation.slides.map((s) => ({
      position: s.position,
      png_url: s.pngUrl
    })),
    created_at: generation.createdAt.toISOString()
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return withAuth(req, (ctx) => handler(ctx, id))
}
```

- [ ] **Step 3: Smoke test**

```bash
# Use the generation ID from Task 15
curl -s http://localhost:3000/api/v1/generations/YOUR_GENERATION_ID \
  -H "x-api-key: change-me-service-key" \
  -H "x-user-token: YOUR_TOKEN" | jq
```

Expected: generation object with `status: "completed"` and `preview_url` populated (after worker finishes).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/v1/generations/[id]/route.ts"
git commit -m "feat: add GET /generations/:id with ownership check"
```

---

## Task 17: POST /api/v1/assets

**Files:**
- Create: `src/app/api/v1/assets/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/app/api/v1/assets
```

- [ ] **Step 2: Write `src/app/api/v1/assets/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { uploadBuffer } from '@/lib/storage/client'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 10 * 1024 * 1024 // 10MB

async function handler(ctx: AuthContext, req: NextRequest): Promise<NextResponse> {
  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'invalid_form_data' }, { status: 400 })
  }

  const file = formData.get('file')
  const assetType = formData.get('asset_type')?.toString() ?? 'image'

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 400 })
  }

  // Validate real MIME type by magic bytes (ESM dynamic import)
  const { fileTypeFromBuffer } = await import('file-type')
  const detected = await fileTypeFromBuffer(buffer)

  if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime)) {
    return NextResponse.json({ error: 'invalid_file_type' }, { status: 400 })
  }

  const ext = detected.ext
  const key = `assets/${ctx.customer.id}/${Date.now()}.${ext}`
  const url = await uploadBuffer(buffer, key, detected.mime)

  const asset = await prisma.asset.create({
    data: {
      customerId: ctx.customer.id,
      assetType,
      url
    }
  })

  return NextResponse.json({ id: asset.id, url: asset.url, asset_type: asset.assetType })
}

export async function POST(req: NextRequest) {
  return withAuth(req, (ctx) => handler(ctx, req))
}
```

- [ ] **Step 3: Smoke test**

```bash
# Upload a test PNG (use any PNG file)
curl -s -X POST http://localhost:3000/api/v1/assets \
  -H "x-api-key: change-me-service-key" \
  -H "x-user-token: YOUR_TOKEN" \
  -F "file=@/path/to/test.png" \
  -F "asset_type=image" | jq
```

Expected: `{"id": "...", "url": "...", "asset_type": "image"}`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/assets/route.ts
git commit -m "feat: add POST /assets with MIME validation and S3 upload"
```

---

## Task 18: GET + PUT /api/v1/customers/me

**Files:**
- Create: `src/app/api/v1/customers/me/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/app/api/v1/customers/me
```

- [ ] **Step 2: Write `src/app/api/v1/customers/me/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  segment: z.string().min(1).max(100).optional()
})

function formatCustomer(customer: {
  id: string
  name: string | null
  segment: string | null
  status: string
  createdAt: Date
}) {
  return {
    id: customer.id,
    name: customer.name,
    segment: customer.segment,
    status: customer.status,
    created_at: customer.createdAt.toISOString()
  }
}

async function getHandler(ctx: AuthContext): Promise<NextResponse> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: ctx.customer.id }
  })
  return NextResponse.json(formatCustomer(customer))
}

async function putHandler(ctx: AuthContext, req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const customer = await prisma.customer.update({
    where: { id: ctx.customer.id },
    data: parsed.data
  })

  return NextResponse.json(formatCustomer(customer))
}

export async function GET(req: NextRequest) {
  return withAuth(req, (ctx) => getHandler(ctx))
}

export async function PUT(req: NextRequest) {
  return withAuth(req, (ctx) => putHandler(ctx, req))
}
```

- [ ] **Step 3: Smoke test**

```bash
curl -s http://localhost:3000/api/v1/customers/me \
  -H "x-api-key: change-me-service-key" \
  -H "x-user-token: YOUR_TOKEN" | jq

curl -s -X PUT http://localhost:3000/api/v1/customers/me \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-service-key" \
  -H "x-user-token: YOUR_TOKEN" \
  -d '{"name": "Igreja Renovada", "segment": "church"}' | jq
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/customers/
git commit -m "feat: add GET and PUT /customers/me"
```

---

## Task 19: GET + PUT /api/v1/visual-identity

**Files:**
- Create: `src/app/api/v1/visual-identity/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/app/api/v1/visual-identity
```

- [ ] **Step 2: Write `src/app/api/v1/visual-identity/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/prisma'
import type { AuthContext } from '@/types/api'

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()

const schema = z.object({
  logo_url: z.string().url().optional(),
  primary_color: hexColor,
  secondary_color: hexColor,
  typography: z.string().max(200).optional(),
  visual_style: z.string().max(500).optional()
})

function formatIdentity(vi: {
  id: string
  logoUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
  typography: string | null
  visualStyle: string | null
  updatedAt: Date
}) {
  return {
    id: vi.id,
    logo_url: vi.logoUrl,
    primary_color: vi.primaryColor,
    secondary_color: vi.secondaryColor,
    typography: vi.typography,
    visual_style: vi.visualStyle,
    updated_at: vi.updatedAt.toISOString()
  }
}

async function getHandler(ctx: AuthContext): Promise<NextResponse> {
  const identity = await prisma.visualIdentity.findUnique({
    where: { customerId: ctx.customer.id }
  })

  if (!identity) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json(formatIdentity(identity))
}

async function putHandler(ctx: AuthContext, req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const identity = await prisma.visualIdentity.upsert({
    where: { customerId: ctx.customer.id },
    create: {
      customerId: ctx.customer.id,
      logoUrl: parsed.data.logo_url ?? null,
      primaryColor: parsed.data.primary_color ?? null,
      secondaryColor: parsed.data.secondary_color ?? null,
      typography: parsed.data.typography ?? null,
      visualStyle: parsed.data.visual_style ?? null
    },
    update: {
      logoUrl: parsed.data.logo_url,
      primaryColor: parsed.data.primary_color,
      secondaryColor: parsed.data.secondary_color,
      typography: parsed.data.typography,
      visualStyle: parsed.data.visual_style
    }
  })

  return NextResponse.json(formatIdentity(identity))
}

export async function GET(req: NextRequest) {
  return withAuth(req, (ctx) => getHandler(ctx))
}

export async function PUT(req: NextRequest) {
  return withAuth(req, (ctx) => putHandler(ctx, req))
}
```

- [ ] **Step 3: Smoke test**

```bash
curl -s -X PUT http://localhost:3000/api/v1/visual-identity \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-service-key" \
  -H "x-user-token: YOUR_TOKEN" \
  -d '{
    "primary_color": "#FF5500",
    "secondary_color": "#FFFFFF",
    "typography": "Inter",
    "visual_style": "modern"
  }' | jq

curl -s http://localhost:3000/api/v1/visual-identity \
  -H "x-api-key: change-me-service-key" \
  -H "x-user-token: YOUR_TOKEN" | jq
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/visual-identity/
git commit -m "feat: add GET and PUT /visual-identity with upsert"
```

---

## Task 20: Full Integration Smoke Test

**Goal:** Validate the entire flow end-to-end: auth → create generation → worker renders → poll for result.

- [ ] **Step 1: Ensure services are running**

```bash
# Terminal 1
supabase start

# Terminal 2
docker start redis-dev

# Terminal 3
pnpm dev

# Terminal 4
pnpm worker
```

- [ ] **Step 2: Create test user via Prisma Studio**

Open `http://localhost:5555`. Create:
- `users`: `email = smoke@test.com`, `status = active`, `name = Smoke Test`
- `customers`: `user_id = <above user id>`, `name = Igreja Smoke`, `segment = church`, `status = active`

- [ ] **Step 3: Run full auth → generation flow**

```bash
#!/bin/bash
BASE="http://localhost:3000/api/v1"
API_KEY="change-me-service-key"
EMAIL="smoke@test.com"

# 1. Request OTP
echo "=== Requesting OTP ==="
curl -s -X POST "$BASE/auth/request-code" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"email\": \"$EMAIL\"}" | jq

echo "Check auth_codes table in Prisma Studio for the code, then:"
echo "Enter OTP code: "
read CODE

# 2. Verify OTP
echo "=== Verifying OTP ==="
TOKEN=$(curl -s -X POST "$BASE/auth/verify-code" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"email\": \"$EMAIL\", \"code\": \"$CODE\"}" | jq -r '.user_token')
echo "user_token: $TOKEN"

# 3. Create generation
echo "=== Creating generation ==="
GEN_ID=$(curl -s -X POST "$BASE/generations" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "x-user-token: $TOKEN" \
  -d '{
    "content_type": "carousel",
    "source_type": "message",
    "user_input": "Smoke test",
    "slides": [
      {"position": 1, "html": "<html><body style=\"background:#FF5500;width:1080px;height:1080px;display:flex;align-items:center;justify-content:center\"><h1 style=\"color:white;font-size:80px\">Slide 1</h1></body></html>"},
      {"position": 2, "html": "<html><body style=\"background:#0055FF;width:1080px;height:1080px;display:flex;align-items:center;justify-content:center\"><h1 style=\"color:white;font-size:80px\">Slide 2</h1></body></html>"}
    ]
  }' | jq -r '.id')
echo "generation_id: $GEN_ID"

# 4. Poll until completed
echo "=== Polling generation status ==="
for i in {1..10}; do
  sleep 3
  RESULT=$(curl -s "$BASE/generations/$GEN_ID" \
    -H "x-api-key: $API_KEY" \
    -H "x-user-token: $TOKEN")
  STATUS=$(echo $RESULT | jq -r '.status')
  echo "Attempt $i — status: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo $RESULT | jq
    break
  fi
done
```

Expected final output: generation with `status: "completed"`, `preview_url` set, `zip_url` set, both slides with `png_url`.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all unit tests pass.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "test: add integration smoke test script and verify full render flow"
```

---

## Dev Startup Checklist

Each dev session requires:
```bash
supabase start           # PostgreSQL + Storage
docker start redis-dev   # Redis
pnpm dev                 # Next.js API server (terminal 1)
pnpm worker              # BullMQ render worker (terminal 2)
```

## Environment Notes

- **Supabase Storage bucket:** Create a bucket named `generations` in Supabase Studio (`http://localhost:54323`) with public access enabled
- **Resend:** In dev, use `onboarding@resend.dev` as `RESEND_FROM_EMAIL` (works without domain verification for the first recipient)
- **Cloudflare R2 (prod):** Replace `STORAGE_*` env vars — same S3 interface, zero egress fees
