// src/lib/auth.ts
// NextAuth 配置，用户名+密码登录（无邮箱注册，管理员建账号）

import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

async function hydrateTokenFromUsername(token: Record<string, any>) {
  const username = typeof token.name === 'string' ? token.name : null
  if (!username) return token

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, role: true, examType: true },
  })

  if (!user) return token

  token.id = user.id
  token.role = user.role
  token.examType = user.examType
  return token
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: '用户名', type: 'text' },
        password: { label: '密码',   type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { username: credentials.username },
        })

        // 统一错误提示，不区分哪个错（防枚举）
        if (!user) return null

        const passwordMatch = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!passwordMatch) return null

        if (!user.isActive) throw new Error('账号已停用，请联系管理员')

        if (new Date() > user.passwordExpireAt) {
          throw new Error('账号已过期，请联系管理员重置')
        }

        return {
          id: user.id,
          name: user.username,
          role: user.role,
          examType: user.examType,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id       = user.id
        token.role     = (user as any).role
        token.examType = (user as any).examType
        return token
      }

      // Local DB resets can invalidate the stored userId in an old browser session.
      // Rehydrate from username so existing sessions recover instead of failing with
      // "No User found" / update-not-found errors across onboarding and app routes.
      return hydrateTokenFromUsername(token)
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id       = token.id
        ;(session.user as any).role    = token.role
        ;(session.user as any).examType = token.examType
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error:  '/login',
  },
}
