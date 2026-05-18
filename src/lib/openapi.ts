export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'ETI Visual Generation Engine',
    version: '1.0.0',
    description:
      'Headless API that receives HTML slides, renders them to PNG via Playwright, and returns preview URLs and ZIP downloads.',
  },
  servers: [{ url: '/api/v1', description: 'Current server' }],
  components: {
    securitySchemes: {
      ApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Global service API key',
      },
      UserToken: {
        type: 'apiKey',
        in: 'header',
        name: 'x-user-token',
        description: 'Per-user token obtained via OTP flow',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
      },
      Generation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
          content_type: { type: 'string', enum: ['post', 'carousel'] },
          source_type: { type: 'string', enum: ['message', 'news', 'image', 'date'] },
          user_input: { type: 'string', nullable: true },
          preview_url: { type: 'string', nullable: true },
          zip_url: { type: 'string', nullable: true },
          error_message: { type: 'string', nullable: true },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                position: { type: 'integer' },
                png_url: { type: 'string', nullable: true },
              },
            },
          },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', nullable: true },
          segment: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
      VisualIdentity: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          logo_url: { type: 'string', nullable: true },
          primary_color: { type: 'string', example: '#FF5733', nullable: true },
          secondary_color: { type: 'string', example: '#33FF57', nullable: true },
          typography: { type: 'string', nullable: true },
          visual_style: { type: 'string', nullable: true },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/auth/request-code': {
      post: {
        tags: ['Auth'],
        summary: 'Request OTP code',
        description: 'Sends a 6-digit OTP to the user email. Always returns 200 to prevent email enumeration.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { email: { type: 'string', format: 'email' } },
                required: ['email'],
              },
            },
          },
        },
        security: [{ ApiKey: [] }],
        responses: {
          '200': { description: 'Code sent (or silently ignored if email not found)' },
          '400': { description: 'Missing email', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/verify-code': {
      post: {
        tags: ['Auth'],
        summary: 'Verify OTP and get user token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  code: { type: 'string', example: '123456' },
                },
                required: ['email', 'code'],
              },
            },
          },
        },
        security: [{ ApiKey: [] }],
        responses: {
          '200': {
            description: 'Valid code — returns user token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { user_token: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
          '401': { description: 'Invalid or expired code', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/generations': {
      post: {
        tags: ['Generations'],
        summary: 'Create a new generation',
        description: 'Enqueues a render job. Returns immediately with status "pending". Rate limited to 10 req/min per user token.',
        security: [{ ApiKey: [], UserToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  content_type: { type: 'string', enum: ['post', 'carousel'] },
                  source_type: { type: 'string', enum: ['message', 'news', 'image', 'date'] },
                  user_input: { type: 'string' },
                  slides: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        position: { type: 'integer', minimum: 1 },
                        html: { type: 'string', description: 'Full HTML of the slide (sanitized server-side)' },
                      },
                      required: ['position', 'html'],
                    },
                  },
                },
                required: ['content_type', 'source_type', 'slides'],
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Generation enqueued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    status: { type: 'string', example: 'pending' },
                    status_url: { type: 'string', example: '/api/v1/generations/uuid' },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '429': { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/generations/{id}': {
      get: {
        tags: ['Generations'],
        summary: 'Get generation status',
        description: 'Poll until status is "completed" or "failed".',
        security: [{ ApiKey: [], UserToken: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Generation data',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Generation' } } },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/assets': {
      post: {
        tags: ['Assets'],
        summary: 'Upload an asset',
        description: 'Upload an image or logo. Max 10MB. Real MIME type validated (not just extension).',
        security: [{ ApiKey: [], UserToken: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                  asset_type: { type: 'string', enum: ['image', 'logo'] },
                  generation_id: { type: 'string', format: 'uuid', description: 'Optional — links asset to a generation' },
                },
                required: ['file', 'asset_type'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Asset uploaded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    url: { type: 'string' },
                    asset_type: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid file or missing field', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '413': { description: 'File too large (max 10MB)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/customers/me': {
      get: {
        tags: ['Customers'],
        summary: 'Get current customer profile',
        security: [{ ApiKey: [], UserToken: [] }],
        responses: {
          '200': {
            description: 'Customer profile',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      put: {
        tags: ['Customers'],
        summary: 'Update current customer profile',
        security: [{ ApiKey: [], UserToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  segment: { type: 'string', description: 'e.g. church, pastor, ministry, youth' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated customer',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } },
          },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/visual-identity': {
      get: {
        tags: ['Visual Identity'],
        summary: 'Get visual identity',
        security: [{ ApiKey: [], UserToken: [] }],
        responses: {
          '200': {
            description: 'Visual identity data (null fields if not set)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VisualIdentity' } } },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      put: {
        tags: ['Visual Identity'],
        summary: 'Save visual identity',
        description: 'Creates or updates visual identity (upsert). All fields optional.',
        security: [{ ApiKey: [], UserToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  logo_url: { type: 'string' },
                  primary_color: { type: 'string', example: '#FF5733', pattern: '^#[0-9A-Fa-f]{6}$' },
                  secondary_color: { type: 'string', example: '#33FF57', pattern: '^#[0-9A-Fa-f]{6}$' },
                  typography: { type: 'string', description: 'Font name or description' },
                  visual_style: { type: 'string', description: 'Overall visual style description' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated visual identity',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VisualIdentity' } } },
          },
          '400': { description: 'Validation error (e.g. invalid hex color)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
}
