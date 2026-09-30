// Lista de comentarios con alta, edición y borrado de los propios. Moderación opcional (admin).
import { useState, type FormEvent } from 'react';
import { del, errorMessage, patch, post } from '../api';
import { ConfirmDialog } from './Dialog';
import { useToast } from './Toast';
import { instant } from '../format';

export interface CommentItem { id: string; body: string; created_at: number; updated_at: number; author_id: string; author_alias: string }

interface Props {
  comments: CommentItem[];
  meId: string | null;
  target: { scope: 'area_public'; areaId: string } | { scope: 'trip_private'; tripId: string };
  onChanged: () => void;
  isAdmin?: boolean;
  emptyText: string;
}

export function Comments({ comments, meId, target, onChanged, isAdmin, emptyText }: Props) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = useState<CommentItem | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) { setError('Escribe algo antes de publicar.'); return; }
    setBusy('new'); setError(null);
    try {
      await post('/api/comments', { ...target, body: body.trim() });
      setBody('');
      toast.show('Comentario publicado.');
      onChanged();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(null); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(`edit:${editing.id}`);
    try {
      await patch(`/api/comments/${editing.id}`, { body: editing.body.trim() });
      setEditing(null);
      toast.show('Comentario actualizado.');
      onChanged();
    } catch (err) { toast.show(errorMessage(err), 'error'); } finally { setBusy(null); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy('del');
    try {
      await del(`/api/comments/${deleting.id}`);
      setDeleting(null);
      toast.show('Comentario borrado.');
      onChanged();
    } catch (err) { toast.show(errorMessage(err), 'error'); } finally { setBusy(null); }
  };

  const hide = async (c: CommentItem) => {
    setBusy(`hide:${c.id}`);
    try {
      await post(`/api/admin/comments/${c.id}/hide`, { hidden: true, reason: 'moderación desde la ficha' });
      toast.show('Comentario ocultado.');
      onChanged();
    } catch (err) { toast.show(errorMessage(err), 'error'); } finally { setBusy(null); }
  };

  return (
    <div className="stack">
      {comments.length === 0 ? <p className="muted">{emptyText}</p> : (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <p className="comment-meta"><strong>{c.author_alias}</strong> <span className="muted">· {instant(c.created_at)}{c.updated_at !== c.created_at && ' (editado)'}</span></p>
              {editing?.id === c.id ? (
                <form className="stack-s" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
                  <label className="visually-hidden" htmlFor={`edit-${c.id}`}>Editar comentario</label>
                  <textarea id={`edit-${c.id}`} className="textarea" rows={3} maxLength={2000} value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} />
                  <div className="cluster-s">
                    <button type="submit" className="btn btn-small btn-primary" disabled={busy !== null || !editing.body.trim()}>Guardar</button>
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(null)}>Cancelar</button>
                  </div>
                </form>
              ) : <p className="comment-body">{c.body}</p>}
              {editing?.id !== c.id && (c.author_id === meId || isAdmin) && (
                <div className="cluster-s">
                  {c.author_id === meId && <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing({ id: c.id, body: c.body })}>Editar<span className="visually-hidden"> tu comentario</span></button>}
                  {c.author_id === meId && <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeleting(c)}>Borrar<span className="visually-hidden"> tu comentario</span></button>}
                  {isAdmin && c.author_id !== meId && <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void hide(c)}>Ocultar (moderación)</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {meId && (
        <form className="stack-s" onSubmit={submit} noValidate>
          <label htmlFor={`new-comment-${target.scope}`} className="field-label">Nuevo comentario</label>
          <textarea id={`new-comment-${target.scope}`} className="textarea" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div><button type="submit" className="btn btn-primary" disabled={busy !== null}>{busy === 'new' ? 'Publicando…' : 'Publicar'}</button></div>
        </form>
      )}
      <ConfirmDialog open={deleting !== null} title="¿Borrar tu comentario?" body={<p>Dejará de verse. No se puede deshacer.</p>} confirmLabel="Borrar" danger
        busy={busy === 'del'} onConfirm={() => void doDelete()} onClose={() => setDeleting(null)} />
    </div>
  );
}
