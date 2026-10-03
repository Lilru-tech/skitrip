import { get } from '../api';
import { Comments, type CommentItem } from '../components/Comments';
import { ErrorState, Loading } from '../components/States';
import { TripShell } from '../components/TripTabs';
import { useResource } from '../hooks';
import { useProfile } from '../session';

export function TripCommentsPage({ tripId }: { tripId: string }) {
  return <TripShell tripId={tripId} tab="comentarios" title="Comentarios">{() => <TripComments tripId={tripId} />}</TripShell>;
}

function TripComments({ tripId }: { tripId: string }) {
  const me = useProfile();
  const r = useResource(() => get<{ comments: CommentItem[] }>(`/api/trips/${tripId}/comments`), [tripId]);
  if (r.loading && !r.data) return <Loading />;
  if (r.error && !r.data) return <ErrorState message={r.error} onRetry={r.reload} />;
  return (
    <section className="panel stack" aria-label="Comentarios privados del viaje">
      <p className="muted small">Solo los miembros del viaje ven estos comentarios.</p>
      <Comments comments={r.data!.comments} meId={me.id} target={{ scope: 'trip_private', tripId }} onChanged={() => void r.reload()} emptyText="Aún no hay comentarios en este viaje." />
    </section>
  );
}
