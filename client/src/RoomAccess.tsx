import { FormEvent, useEffect, useState } from 'react';

type Permission = { email: string; role: 'HOST' | 'VIEWER' };

type RoomAccessProps = { slug: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Request failed');
  return response.json();
}

export default function RoomAccess({ slug }: RoomAccessProps) {
  const [owner, setOwner] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Permission['role']>('VIEWER');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<{ room: { role: string } }>(`/api/rooms/${slug}`).then(({ room }) => setOwner(room.role === 'OWNER')).catch(() => setOwner(false));
  }, [slug]);

  if (!owner) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      const result = await request<{ permission: Permission }>(`/api/rooms/${slug}/permissions`, { method: 'POST', body: JSON.stringify({ email, role }) });
      setFeedback(`${result.permission.email} autorizado como ${result.permission.role}.`);
      setEmail('');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível autorizar o usuário.');
    } finally {
      setBusy(false);
    }
  }

  return <div className={`access-control ${open ? 'is-open' : ''}`}>
    <button className="access-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>⚿ <span>Permissões</span></button>
    {open && <form className="access-popover" onSubmit={submit}>
      <p className="eyebrow">ACCESS CONTROL</p>
      <h2>Autorizar usuário</h2>
      <p className="muted">Adicione alguém a esta sala persistente.</p>
      <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@exemplo.com" required />
      <div className="access-row"><select value={role} onChange={(event) => setRole(event.target.value as Permission['role'])}><option value="VIEWER">Viewer</option><option value="HOST">Host</option></select><button className="primary-button compact" disabled={busy}>{busy ? '...' : 'Autorizar'}</button></div>
      {feedback && <p className="invite-status">{feedback}</p>}
    </form>}
  </div>;
}
