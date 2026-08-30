import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { invokeFunction } from '../../services/supabase'
import type { AppRole } from '../../types'
import { BrandMark } from '../ui/BrandMark'
import { Icon } from '../ui/Icon'

type AdminProfile = {
  id: string
  email: string
  display_name: string
  role: AppRole
  status: 'active' | 'suspended'
  invited_by?: string | null
  created_at: string
  last_seen_at?: string | null
}

type Invite = {
  id: string
  code_hint: string
  assigned_email?: string | null
  expires_at: string
  revoked_at?: string | null
  redeemed_at?: string | null
  redeemed_by?: string | null
  created_by: string
  created_at: string
}

type CallEvent = {
  id: number
  event_type: string
  room_sid?: string | null
  room_name?: string | null
  participant_identity?: string | null
  participant_name?: string | null
  occurred_at: string
}

type TokenIssuance = {
  id: number
  user_id: string
  room_name: string
  issued_at: string
}

type DashboardData = {
  profiles: AdminProfile[]
  invites: Invite[]
  events: CallEvent[]
  issuances: TokenIssuance[]
}

interface AdminDashboardProps {
  currentRole: AppRole
  onClose: () => void
}

const timeLabel = (value?: string | null) => {
  if (!value) return 'Nunca'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

const inviteState = (invite: Invite) => {
  if (invite.redeemed_at) return { label: 'Utilizado', className: 'is-used' }
  if (invite.revoked_at) return { label: 'Revogado', className: 'is-revoked' }
  if (new Date(invite.expires_at).getTime() <= Date.now()) return { label: 'Expirado', className: 'is-expired' }
  return { label: 'Disponível', className: 'is-active' }
}

export const AdminDashboard = ({ currentRole, onClose }: AdminDashboardProps) => {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assignedEmail, setAssignedEmail] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('7')
  const [newInvite, setNewInvite] = useState('')
  const [copied, setCopied] = useState(false)
  const [busyTarget, setBusyTarget] = useState('')
  const [section, setSection] = useState<'overview' | 'users' | 'invites' | 'activity'>('overview')

  const refresh = useCallback(async () => {
    setError('')
    try {
      const nextData = await invokeFunction<DashboardData>('admin', { action: 'dashboard' })
      setData(nextData)
    } catch {
      setError('Não foi possível carregar o painel administrativo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeUsers = useMemo(() => data?.profiles.filter((profile) => profile.status === 'active').length || 0, [data])
  const activeInvites = useMemo(() => data?.invites.filter((invite) => inviteState(invite).className === 'is-active').length || 0, [data])
  const rooms24h = useMemo(() => new Set(data?.issuances.map((item) => item.room_name)).size, [data])

  const createInvite = async (event: FormEvent) => {
    event.preventDefault()
    setBusyTarget('new-invite')
    setError('')
    try {
      const result = await invokeFunction<{ code: string }>('admin', {
        action: 'create_invite',
        assignedEmail: assignedEmail.trim() || undefined,
        expiresInDays: Number(expiresInDays),
      })
      setNewInvite(result.code)
      setAssignedEmail('')
      await refresh()
    } catch {
      setError('Não foi possível criar esse convite. Confira o e-mail e tente novamente.')
    } finally {
      setBusyTarget('')
    }
  }

  const perform = async (key: string, body: Record<string, unknown>) => {
    setBusyTarget(key)
    setError('')
    try {
      await invokeFunction('admin', body)
      await refresh()
    } catch {
      setError('Essa alteração não pôde ser concluída.')
    } finally {
      setBusyTarget('')
    }
  }

  const copyInvite = async () => {
    const url = new URL('https://fordkall.11a3.dev/')
    url.searchParams.set('invite', newInvite)
    await navigator.clipboard.writeText(url.toString())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand"><BrandMark /><span>FORD KALL<small>CONTROL ROOM</small></span></div>
        <nav aria-label="Seções administrativas">
          <button className={section === 'overview' ? 'is-active' : ''} onClick={() => setSection('overview')}><Icon name="layout" /> Visão geral</button>
          <button className={section === 'users' ? 'is-active' : ''} onClick={() => setSection('users')}><Icon name="users" /> Usuários</button>
          <button className={section === 'invites' ? 'is-active' : ''} onClick={() => setSection('invites')}><Icon name="keyboard" /> Convites</button>
          <button className={section === 'activity' ? 'is-active' : ''} onClick={() => setSection('activity')}><Icon name="audio" /> Atividade</button>
        </nav>
        <button className="admin-sidebar__back" onClick={onClose}><Icon name="chevron" /> Voltar para a garagem</button>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <div><p className="eyebrow">PAINEL PRIVADO</p><h1>{section === 'overview' ? 'Visão geral' : section === 'users' ? 'Usuários' : section === 'invites' ? 'Convites' : 'Atividade'}</h1></div>
          <div className="admin-header__actions">
            <button aria-label="Atualizar painel" className="icon-button" disabled={loading} onClick={() => { setLoading(true); void refresh() }}><Icon name="refresh" /></button>
            <button aria-label="Fechar painel" className="icon-button" onClick={onClose}><Icon name="x" /></button>
          </div>
        </header>

        {error && <div className="admin-error" role="alert"><Icon name="warning" />{error}</div>}
        {loading && !data ? <div className="admin-loading"><span className="spinner" /> Carregando a garagem…</div> : null}

        {data && section === 'overview' && (
          <div className="admin-overview">
            <div className="admin-metrics">
              <article><span>Contas ativas</span><strong>{activeUsers}</strong><small>{data.profiles.length} cadastradas</small></article>
              <article><span>Convites disponíveis</span><strong>{activeInvites}</strong><small>{data.invites.length} gerados</small></article>
              <article><span>Salas em 24h</span><strong>{rooms24h}</strong><small>{data.issuances.length} acessos emitidos</small></article>
            </div>
            <section className="admin-card admin-card--quick-invite">
              <header><div><p className="eyebrow">ACESSO NOVO</p><h2>Gerar uma chave</h2></div><span>Uso único</span></header>
              <form className="admin-invite-form" onSubmit={createInvite}>
                <label><span>E-mail vinculado <small>opcional</small></span><input onChange={(event) => setAssignedEmail(event.target.value)} placeholder="amigo@exemplo.com" type="email" value={assignedEmail} /></label>
                <label><span>Validade</span><select onChange={(event) => setExpiresInDays(event.target.value)} value={expiresInDays}><option value="1">1 dia</option><option value="3">3 dias</option><option value="7">7 dias</option><option value="30">30 dias</option></select></label>
                <button disabled={busyTarget === 'new-invite'} type="submit">{busyTarget === 'new-invite' ? 'Gerando…' : 'Gerar convite'} <Icon name="chevron" /></button>
              </form>
              {newInvite && <div className="admin-new-invite"><div><span>Convite criado</span><strong>{newInvite}</strong></div><button onClick={() => void copyInvite()}><Icon name="copy" /> {copied ? 'Link copiado' : 'Copiar link'}</button></div>}
            </section>
            <section className="admin-card">
              <header><div><p className="eyebrow">RECENTES</p><h2>Últimos usuários</h2></div><button onClick={() => setSection('users')}>Ver todos</button></header>
              <div className="admin-compact-list">
                {data.profiles.slice(0, 5).map((profile) => <div key={profile.id}><span className="admin-user-avatar">{(profile.display_name || profile.email).slice(0, 2).toUpperCase()}</span><span><strong>{profile.display_name || 'Sem nome'}</strong><small>{profile.email}</small></span><i className={`admin-status ${profile.status === 'active' ? 'is-active' : 'is-suspended'}`}>{profile.status === 'active' ? profile.role : 'suspenso'}</i></div>)}
              </div>
            </section>
          </div>
        )}

        {data && section === 'users' && (
          <section className="admin-card admin-card--table">
            <header><div><p className="eyebrow">{data.profiles.length.toString().padStart(2, '0')} CONTAS</p><h2>Quem tem a chave</h2></div></header>
            <div className="admin-user-list">
              {data.profiles.map((profile) => (
                <article key={profile.id}>
                  <span className="admin-user-avatar">{(profile.display_name || profile.email).slice(0, 2).toUpperCase()}</span>
                  <div className="admin-user-list__identity"><strong>{profile.display_name || 'Sem nome'}</strong><small>{profile.email}</small></div>
                  <div className="admin-user-list__seen"><span>Último acesso</span><small>{timeLabel(profile.last_seen_at)}</small></div>
                  <i className={`admin-status ${profile.status === 'active' ? 'is-active' : 'is-suspended'}`}>{profile.role === 'owner' ? 'owner' : profile.status === 'suspended' ? 'suspenso' : profile.role}</i>
                  <div className="admin-user-list__actions">
                    {profile.role !== 'owner' && currentRole === 'owner' && <button disabled={busyTarget === profile.id} onClick={() => void perform(profile.id, { action: 'set_role', userId: profile.id, role: profile.role === 'admin' ? 'member' : 'admin' })}>{profile.role === 'admin' ? 'Remover admin' : 'Promover'}</button>}
                    {profile.role !== 'owner' && <button className={profile.status === 'active' ? 'is-danger' : ''} disabled={busyTarget === profile.id} onClick={() => void perform(profile.id, { action: 'set_status', userId: profile.id, status: profile.status === 'active' ? 'suspended' : 'active' })}>{profile.status === 'active' ? 'Suspender' : 'Reativar'}</button>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {data && section === 'invites' && (
          <div className="admin-invites-layout">
            <section className="admin-card admin-card--quick-invite">
              <header><div><p className="eyebrow">NOVA CHAVE</p><h2>Criar convite</h2></div></header>
              <form className="admin-invite-form" onSubmit={createInvite}>
                <label><span>E-mail vinculado <small>opcional</small></span><input onChange={(event) => setAssignedEmail(event.target.value)} placeholder="amigo@exemplo.com" type="email" value={assignedEmail} /></label>
                <label><span>Validade</span><select onChange={(event) => setExpiresInDays(event.target.value)} value={expiresInDays}><option value="1">1 dia</option><option value="3">3 dias</option><option value="7">7 dias</option><option value="30">30 dias</option></select></label>
                <button disabled={busyTarget === 'new-invite'} type="submit">Gerar convite <Icon name="chevron" /></button>
              </form>
              {newInvite && <div className="admin-new-invite"><div><span>Convite criado</span><strong>{newInvite}</strong></div><button onClick={() => void copyInvite()}><Icon name="copy" /> {copied ? 'Link copiado' : 'Copiar link'}</button></div>}
            </section>
            <section className="admin-card admin-card--table">
              <header><div><p className="eyebrow">HISTÓRICO</p><h2>Chaves emitidas</h2></div></header>
              <div className="admin-invite-list">
                {data.invites.map((invite) => {
                  const state = inviteState(invite)
                  return <article key={invite.id}><div><strong>•••• {invite.code_hint}</strong><small>{invite.assigned_email || 'Qualquer e-mail'} · vence {timeLabel(invite.expires_at)}</small></div><i className={`admin-status ${state.className}`}>{state.label}</i>{state.className === 'is-active' && <button disabled={busyTarget === invite.id} onClick={() => void perform(invite.id, { action: 'revoke_invite', inviteId: invite.id })}>Revogar</button>}</article>
                })}
              </div>
            </section>
          </div>
        )}

        {data && section === 'activity' && (
          <section className="admin-card admin-card--table">
            <header><div><p className="eyebrow">ÚLTIMAS 24 HORAS</p><h2>Eventos das calls</h2></div></header>
            <div className="admin-event-list">
              {data.events.length === 0 && <p className="admin-empty">Os webhooks começarão a aparecer aqui depois da primeira call.</p>}
              {data.events.map((event) => <article key={event.id}><span className="admin-event-list__icon"><Icon name={event.event_type.includes('participant') ? 'users' : 'audio'} /></span><div><strong>{event.event_type.replaceAll('_', ' ')}</strong><small>{event.participant_name || event.room_name || 'LiveKit'}{event.participant_name && event.room_name ? ` · ${event.room_name}` : ''}</small></div><time>{timeLabel(event.occurred_at)}</time></article>)}
            </div>
          </section>
        )}
      </section>
    </main>
  )
}
