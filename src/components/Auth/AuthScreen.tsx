import { useMemo, useState, type FormEvent } from 'react'
import type { LocalProfile } from '../../types'
import { BrandMark } from '../ui/BrandMark'
import { DesktopUpdateControl } from '../ui/DesktopUpdateControl'
import { Icon } from '../ui/Icon'

type AuthMode = 'invite' | 'create' | 'login'

interface AuthScreenProps {
  busy: boolean
  configured: boolean
  error: string
  onActivate: (values: {
    code: string
    email: string
    password: string
    displayName: string
    avatarDataUrl?: string
    bio?: string
    appearance?: LocalProfile['appearance']
  }) => Promise<boolean>
  onClearError: () => void
  onLogin: (email: string, password: string) => Promise<boolean>
  onValidateInvite: (code: string) => Promise<boolean>
}

const inviteFromUrl = () => {
  if (typeof window === 'undefined') return ''
  return new URL(window.location.href).searchParams.get('invite') || ''
}

const nameFromEmail = (email: string) => {
  const localPart = email.trim().split('@')[0] || 'Usuário'
  return localPart.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48)
}

export const AuthScreen = ({
  busy,
  configured,
  error,
  onActivate,
  onClearError,
  onLogin,
  onValidateInvite,
}: AuthScreenProps) => {
  const initialInvite = useMemo(inviteFromUrl, [])
  const [mode, setMode] = useState<AuthMode>('invite')
  const [inviteCode, setInviteCode] = useState(initialInvite)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [checkingInvite, setCheckingInvite] = useState(false)

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setLocalError('')
    onClearError()
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  const checkInvite = async (event: FormEvent) => {
    event.preventDefault()
    setLocalError('')
    onClearError()
    if (!inviteCode.trim()) {
      setLocalError('Digite o código do convite.')
      return
    }
    setCheckingInvite(true)
    const valid = await onValidateInvite(inviteCode)
    setCheckingInvite(false)
    if (valid) setMode('create')
  }

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault()
    setLocalError('')
    onClearError()
    await onLogin(email.trim(), password)
  }

  const createAccount = async (event: FormEvent) => {
    event.preventDefault()
    setLocalError('')
    onClearError()
    if (password !== confirmPassword) {
      setLocalError('As senhas não são iguais.')
      return
    }
    const activated = await onActivate({
      code: inviteCode,
      email: email.trim(),
      password,
      displayName: nameFromEmail(email),
    })
    if (activated) {
      const url = new URL(window.location.href)
      url.searchParams.delete('invite')
      window.history.replaceState(null, '', url)
    }
  }

  const message = localError || error

  return (
    <main className="auth-shell auth-shell--minimal">
      <div className="lobby-grid" aria-hidden="true" />
      <section className="access-panel">
        <header className="access-panel__brand">
          <BrandMark />
          <span>Ford Kall</span>
        </header>

        <div className="access-card">
          {mode === 'invite' && (
            <form onSubmit={checkInvite}>
              <header className="access-card__heading">
                <h1>Entrar no Ford Kall</h1>
                <p>Digite o código do convite para continuar.</p>
              </header>
              <label className="access-field">
                <span>Convite</span>
                <input
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => setInviteCode(event.target.value)}
                  placeholder="FK-XXXX-XXXX-XXXX-XXXX"
                  spellCheck={false}
                  value={inviteCode}
                />
              </label>
              {message && <div className="access-error" role="alert"><Icon name="warning" /><span>{message}</span></div>}
              {!configured && <div className="access-error"><Icon name="warning" /><span>O acesso ainda não foi configurado.</span></div>}
              <button className="access-primary" disabled={!configured || checkingInvite} type="submit">
                {checkingInvite ? <><span className="spinner" /> Verificando</> : <>Continuar <Icon name="chevron" /></>}
              </button>
              <button className="access-link" onClick={() => switchMode('login')} type="button">Já tenho uma conta</button>
            </form>
          )}

          {mode === 'create' && (
            <form onSubmit={createAccount}>
              <header className="access-card__heading">
                <h1>Criar conta</h1>
                <p>Seu convite foi validado. Defina seus dados de acesso.</p>
              </header>
              <label className="access-field"><span>E-mail</span><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com" required type="email" value={email} /></label>
              <label className="access-field"><span>Senha</span><input autoComplete="new-password" minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required type="password" value={password} /></label>
              <label className="access-field"><span>Confirmar senha</span><input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repita a senha" required type="password" value={confirmPassword} /></label>
              {message && <div className="access-error" role="alert"><Icon name="warning" /><span>{message}</span></div>}
              <button className="access-primary" disabled={busy || !configured} type="submit">
                {busy ? <><span className="spinner" /> Criando conta</> : <>Criar conta <Icon name="chevron" /></>}
              </button>
              <button className="access-link" onClick={() => switchMode('invite')} type="button">Usar outro convite</button>
            </form>
          )}

          {mode === 'login' && (
            <form onSubmit={submitLogin}>
              <header className="access-card__heading">
                <h1>Entrar</h1>
                <p>Use o e-mail e a senha da sua conta.</p>
              </header>
              <label className="access-field"><span>E-mail</span><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com" required type="email" value={email} /></label>
              <label className="access-field"><span>Senha</span><input autoComplete="current-password" minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" required type="password" value={password} /></label>
              {message && <div className="access-error" role="alert"><Icon name="warning" /><span>{message}</span></div>}
              <button className="access-primary" disabled={busy || !configured} type="submit">
                {busy ? <><span className="spinner" /> Entrando</> : <>Entrar <Icon name="chevron" /></>}
              </button>
              <button className="access-link" onClick={() => switchMode('invite')} type="button">Voltar para o convite</button>
            </form>
          )}
        </div>
        <DesktopUpdateControl variant="auth" />
      </section>
    </main>
  )
}
