import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'
import { syncNextAuthUrlFromRuntime } from '@/lib/runtime-public-url'

const handler = NextAuth(authOptions)

export async function GET(request: Request, context: unknown) {
  syncNextAuthUrlFromRuntime()
  return handler(request, context as never)
}

export async function POST(request: Request, context: unknown) {
  syncNextAuthUrlFromRuntime()
  return handler(request, context as never)
}
