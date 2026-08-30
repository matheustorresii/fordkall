import { useMemo, useState, type FormEvent } from 'react'
import { normalizeProfile } from '../../services/profile'
import type { LocalProfile } from '../../types'
import { ProfileStudio } from '../Profile/ProfileStudio'
import { BrandMark } from '../ui/BrandMark'
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

const initialAuthMode = (): AuthMode => {
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    const preview = new URL(window.location.href).searchParams.get('preview')
    if (preview === 'profile') return 'create'
  }
  return 'invite'
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
  const [mode, setMode] = useState<AuthMode>(initialAuthMode)
  const [inviteCode, setInviteCode] = useState(initialInvite)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [profile, setProfile] = useState<LocalProfile>({ displayName: '', appearance: undefined })
  const [localError, setLocalError] = useState('')
  const [checkingInvite, setCheckingInvite] = useState(false)

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setLocalError('')
    onClearError()
  }

  const checkInvite = async (event: FormEvent) => {
    event.preventDefault()
    setLocalError('')
    onClearError()
    if (!inviteCode.trim()) {
      setLocalError('Digite a chave que você recebeu.')
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
    const normalizedProfile = normalizeProfile(profile)
    if (!normalizedProfile.displayName) {
      setLocalError('Escolha o nome que vai aparecer na call.')
      return
    }
    if (password !== confirmPassword) {
      setLocalError('As duas senhas precisam ser iguais.')
      return
    }
    const activated = await onActivate({
      code: inviteCode,
      email: email.trim(),
      password,
      displayName: normalizedProfile.displayName,
      avatarDataUrl: normalizedProfile.avatarDataUrl,
      bio: normalizedProfile.bio,
      appearance: normalizedProfile.appearance,
    })
    if (activated) {
      const url = new URL(window.location.href)
      url.searchParams.delete('invite')
      window.history.replaceState(null, '', url)
    }
  }

  return (
    <main className={`auth-shell auth-shell--${mode}`}>
      <div className="lobby-grid" aria-hidden="true" />
      <header className="auth-topbar">
        <div className="brand brand--welcome">
          <BrandMark />
          <div><p className="brand__eyebrow">PRIVATE COMMS</p><h1>FORD KALL</h1></div>
        </div>
        <div className="auth-topbar__right">
          {mode !== 'login' && <button onClick={() => switchMode('login')} type="button">Já tenho uma conta</button>}
          {mode === 'login' && <button onClick={() => switchMode('invite')} type="button"><Icon name="chevron" /> Voltar ao convite</button>}
          <span className="auth-topbar__badge"><span className="status-dot" /> Acesso fechado</span>
        </div>
      </header>

      {mode === 'invite' && (
        <section className="invite-home">
          <div className="invite-home__copy">
            <p className="eyebrow">UMA CALL. SUA GALERA.</p>
            <h2>A garagem é<br /><em>fechada.</em></h2>
            <p>Ford Kall agora é só por convite. Se alguém te passou uma chave, você já está quase dentro.</p>
          </div>
          <form className="invite-gate" onSubmit={checkInvite}>
            <header><span className="invite-gate__number">01</span><div><p>CHAVE DE ACESSO</p><h3>Qual é a senha da garagem?</h3></div></header>
            <label>
              <Icon name="keyboard" />
              <input autoCapitalize="characters" autoComplete="off" autoFocus onChange={(event) => setInviteCode(event.target.value)} placeholder="FK-XXXX-XXXX-XXXX-XXXX" spellCheck={false} value={inviteCode} />
            </label>
            {(localError || error) && <div className="inline-error" role="alert"><Icon name="warning" /><span>{localError || error}</span></div>}
            {!configured && <div className="inline-error"><Icon name="warning" />Este build ainda não recebeu a configuração do Supabase.</div>}
            <button disabled={!configured || checkingInvite} type="submit">
              {checkingInvite ? <><span className="spinner" /> Conferindo</> : <>Usar esta chave <Icon name="chevron" /></>}
            </button>
            <small>Convites são individuais, expiram e funcionam uma única vez.</small>
          </form>
          <div className="invite-home__road" aria-hidden="true"><i /><i /><i /></div>
        </section>
      )}

      {mode === 'login' && (
        <section className="auth-layout auth-layout--login">
          <div className="auth-copy">
            <p className="eyebrow">DE VOLTA À PISTA</p>
            <h2>Sua conta.<br /><em>Seu perfil.</em></h2>
            <p>Entre com a conta já ativada e continue exatamente de onde parou.</p>
          </div>
          <form className="auth-card" onSubmit={submitLogin}>
            <header className="auth-card__heading"><span>ACESSO EXISTENTE</span><h3>Ligue o motor.</h3><p>Use o e-mail e a senha da sua conta.</p></header>
            <label className="auth-field"><span>E-mail</span><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com" type="email" value={email} /></label>
            <label className="auth-field"><span>Senha</span><input autoComplete="current-password" minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" type="password" value={password} /></label>
            {(localError || error) && <div className="inline-error" role="alert"><Icon name="warning" /><span>{localError || error}</span></div>}
            <button className="auth-submit" disabled={busy || !configured} type="submit">{busy ? <><span className="spinner" /> Aguarde</> : <>Entrar no Ford Kall <Icon name="chevron" /></>}</button>
          </form>
        </section>
      )}

      {mode === 'create' && (
        <form className="profile-onboarding" onSubmit={createAccount}>
          <header className="profile-onboarding__heading">
            <div><p className="eyebrow">CHAVE ACEITA · PASSO 02</p><h2>Monte seu piloto.</h2><p>Você pode mudar tudo depois. A aparência acompanha sua conta em qualquer dispositivo.</p></div>
            <button onClick={() => switchMode('invite')} type="button"><Icon name="chevron" /> Trocar chave</button>
          </header>
          <div className="profile-onboarding__body">
            <ProfileStudio onChange={setProfile} value={profile} />
            <section className="profile-onboarding__account">
              <header><span>03</span><div><p>ÚLTIMO PASSO</p><h3>Proteja sua conta</h3></div></header>
              <label className="auth-field"><span>E-mail</span><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com" type="email" value={email} /></label>
              <label className="auth-field"><span>Senha</span><input autoComplete="new-password" minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" type="password" value={password} /></label>
              <label className="auth-field"><span>Confirmar senha</span><input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repita sua senha" type="password" value={confirmPassword} /></label>
              {(localError || error) && <div className="inline-error" role="alert"><Icon name="warning" /><span>{localError || error}</span></div>}
              <button className="auth-submit" disabled={busy || !configured} type="submit">{busy ? <><span className="spinner" /> Criando perfil</> : <>Criar minha conta <Icon name="chevron" /></>}</button>
              <small>A chave será invalidada depois que a conta for criada.</small>
            </section>
          </div>
        </form>
      )}
    </main>
  )
}
