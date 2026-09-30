import { usePageTitle } from '../router';

export function ComingSoon({ title, what }: { title: string; what: string }) {
  usePageTitle(title);
  return (
    <div className="page">
      <h1>{title}</h1>
      <div className="panel">
        <p className="state-title">Sección en construcción</p>
        <p>Aquí podrás {what}. Todavía no está disponible, así que no mostramos datos de ejemplo.</p>
      </div>
    </div>
  );
}
