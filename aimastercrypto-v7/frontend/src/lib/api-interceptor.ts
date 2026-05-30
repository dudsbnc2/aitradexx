/**
 * AIMasterCrypto — api.ts patch V7
 * ====================================
 * Atualização do interceptor do axios para usar auth-manager em vez de localStorage.
 *
 * INSTRUÇÃO:
 * No teu api.ts existente, localiza o request interceptor e substitui pelo código abaixo.
 * Também adiciona um response interceptor para renovar token automaticamente em 401.
 *
 * ANTES (V6 — REMOVER):
 *   api.interceptors.request.use((config) => {
 *     const token = localStorage.getItem('access_token')
 *     if (token) config.headers.Authorization = `Bearer ${token}`
 *     return config
 *   })
 *
 * DEPOIS (V7 — USAR ESTE FICHEIRO):
 *   Copiar as funções setupApiInterceptors e chamar no bootstrap da app.
 */

import axios, { AxiosInstance } from 'axios'
import { getAccessToken, initAuth, clearAuth } from '@/lib/auth-manager'

/**
 * Configura os interceptors do axios para auth V7.
 * Chamar uma vez na inicialização da app.
 *
 * @param api - A instância axios existente
 *
 * Exemplo:
 *   import api from '@/lib/api'
 *   import { setupApiInterceptors } from '@/lib/api-interceptor'
 *   setupApiInterceptors(api)
 */
export function setupApiInterceptors(api: AxiosInstance): void {

  // ── Request interceptor: injetar access token ──────────────────────────────
  api.interceptors.request.use(
    (config) => {
      const token = getAccessToken()
      if (token) {
        config.headers = config.headers ?? {}
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    },
    (error) => Promise.reject(error),
  )

  // ── Response interceptor: renovar token em 401 ────────────────────────────
  // Se a API devolver 401, tentamos renovar o token via httpOnly cookie
  // e repetir o pedido original. Apenas uma tentativa de renovação.

  let _isRefreshing = false
  let _failedQueue: Array<{
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
  }> = []

  function processQueue(error: unknown, token: string | null = null) {
    _failedQueue.forEach(({ resolve, reject }) => {
      if (error) {
        reject(error)
      } else {
        resolve(token)
      }
    })
    _failedQueue = []
  }

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config

      // Não tentar renovar em rotas de auth
      const isAuthRoute =
        originalRequest?.url?.includes('/auth/') ||
        originalRequest?._retried

      if (error.response?.status !== 401 || isAuthRoute) {
        return Promise.reject(error)
      }

      // Marcar o pedido como já retried (evitar loop infinito)
      originalRequest._retried = true

      if (_isRefreshing) {
        // Há uma renovação em curso — enfileirar este pedido
        return new Promise((resolve, reject) => {
          _failedQueue.push({ resolve, reject })
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        })
      }

      _isRefreshing = true

      try {
        const newToken = await initAuth()

        if (!newToken) {
          // Renovação falhou — logout
          clearAuth()
          processQueue(new Error('Session expired'), null)
          // Emitir evento para a app redirecionar para login
          window.dispatchEvent(new CustomEvent('auth:expired'))
          return Promise.reject(error)
        }

        processQueue(null, newToken)
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)

      } catch (refreshError) {
        clearAuth()
        processQueue(refreshError, null)
        window.dispatchEvent(new CustomEvent('auth:expired'))
        return Promise.reject(refreshError)

      } finally {
        _isRefreshing = false
      }
    },
  )
}


/**
 * Hook para escutar expiração de sessão e redirecionar para login.
 * Usar no RootLayout ou _app.tsx.
 *
 * Exemplo:
 *   import { useAuthExpiredRedirect } from '@/lib/api-interceptor'
 *
 *   export default function RootLayout({ children }) {
 *     useAuthExpiredRedirect('/login')
 *     return <html>{children}</html>
 *   }
 */
export function useAuthExpiredRedirect(loginPath = '/login'): void {
  // Importar useEffect dinamicamente para não quebrar em SSR
  if (typeof window === 'undefined') return

  const handler = () => {
    const current = window.location.pathname
    if (!current.startsWith(loginPath)) {
      window.location.href = `${loginPath}?expired=1`
    }
  }

  window.addEventListener('auth:expired', handler)

  // Não há cleanup aqui porque é um listener global da app —
  // para uso em componente React, usar useEffect:
  //
  // useEffect(() => {
  //   window.addEventListener('auth:expired', handler)
  //   return () => window.removeEventListener('auth:expired', handler)
  // }, [])
}
