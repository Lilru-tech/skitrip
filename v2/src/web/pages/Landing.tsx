import { Link, usePageTitle } from '../router';

export function Landing() {
  usePageTitle('');
  return (
    <main id="main" className="landing">
      <section className="landing-hero">
        <p className="eyebrow">Viajes de esquí entre amigos</p>
        <h1>Encontrad las fechas que os van bien a todos, sin hojas de cálculo.</h1>
        <p className="lead">
          SkiTrip reúne vuestra disponibilidad de la temporada, los viajes que estáis organizando y quién se apunta.
          Cada persona decide con quién comparte su calendario.
        </p>
        <div className="cluster">
          <Link to="/registro" className="btn btn-primary btn-large">Crear cuenta</Link>
          <Link to="/entrar" className="btn btn-secondary btn-large">Entrar</Link>
        </div>
      </section>
      <svg className="landing-ridge" viewBox="0 0 800 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 110 L90 60 L140 85 L230 22 L300 70 L360 45 L450 95 L540 30 L610 72 L680 50 L800 105" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M212 34 L230 22 L248 36 M524 41 L540 30 L556 42" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <section className="landing-points" aria-label="Qué puedes hacer">
        <div>
          <h2>Calendario compartido</h2>
          <p>Marca tus días como libre, quizá u ocupado. Lo que no marques queda «sin indicar» y nunca cuenta como libre.</p>
        </div>
        <div>
          <h2>Ventanas candidatas</h2>
          <p>Ved qué llegadas y salidas encajan con el grupo, cuántas noches y quién falta por responder.</p>
        </div>
        <div>
          <h2>Viajes con invitación</h2>
          <p>Invita a tus amistades o comparte un enlace. Tu email nunca se muestra a nadie.</p>
        </div>
      </section>
    </main>
  );
}
