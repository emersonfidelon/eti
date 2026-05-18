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
