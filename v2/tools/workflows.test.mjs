// Pruebas de los workflows de GitHub Actions (node --test). No se fía de buscar «pipefail» en el texto: extrae los
// pasos críticos de los YAML y los EJECUTA con la misma orden que usa GitHub (`bash --noprofile --norc -eo pipefail`
// con `shell: bash`; `bash -e` sin él), con un artefacto roto y otro válido, y con un `npx` falso que falla o responde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { releaseScope } from './release-scope.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WF = path.join(ROOT, '.github/workflows');
const files = readdirSync(WF).filter((f) => /^v2-.*\.yml$/.test(f));
const wf = Object.fromEntries(files.map((f) => [f, parse(readFileSync(path.join(WF, f), 'utf8'))]));
const release = wf['v2-release.yml'];

const GITHUB_BASH = ['--noprofile', '--norc', '-eo', 'pipefail']; // shell: bash
const DEFAULT_BASH = ['-e']; // sin shell (lo que había antes)

/** El `run:` del paso y la orden de bash que usará GitHub según su shell efectivo (paso, job o workflow). */
/** Shell efectivo de un paso. Como en GitHub, `defaults.run` del job sustituye entero al del workflow (no se combinan). */
const effectiveShell = (w, job, s) => s.shell ?? (job.defaults?.run ? job.defaults.run.shell : w.defaults?.run?.shell);
function step(job, id) {
  const s = release.jobs[job].steps.find((x) => x.id === id);
  assert.ok(s, `paso ${job}.${id}`);
  const shell = effectiveShell(release, release.jobs[job], s);
  return { run: s.run, flags: shell === 'bash' ? GITHUB_BASH : DEFAULT_BASH };
}
/** Ejecuta un `run:` como GitHub: lo escribe en un archivo y lo pasa a bash. */
function runStep(script, { cwd, env = {}, flags }) {
  const file = path.join(cwd, '.step.sh');
  writeFileSync(file, script);
  const out = path.join(cwd, '.out'), summary = path.join(cwd, '.summary');
  writeFileSync(out, ''); writeFileSync(summary, '');
  const r = spawnSync('bash', [...flags, file], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, ...env } });
  return { code: r.status, stdout: r.stdout + r.stderr, output: readFileSync(out, 'utf8'), summary: readFileSync(summary, 'utf8') };
}
const tmp = () => mkdtempSync(path.join(tmpdir(), 'skitrip-wf-'));
/** `npx` falso al principio del PATH. */
function fakeNpx(dir, body) {
  const bin = path.join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'npx'), `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path.join(bin, 'npx'), 0o755);
  return `${bin}:${process.env.PATH}`;
}

test('todos los pasos con run de los workflows v2 usan shell bash (pipefail)', () => {
  const bad = [];
  for (const [f, w] of Object.entries(wf)) {
    for (const [name, job] of Object.entries(w.jobs)) {
      for (const s of job.steps ?? []) {
        if (!s.run) continue;
        const shell = effectiveShell(w, job, s);
        if (shell !== 'bash') bad.push(`${f} · ${name} · ${s.name ?? s.run.split('\n')[0]}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

// GitHub rechaza el workflow entero (422 al lanzarlo) si el env del workflow o del job usa un contexto que allí no existe.
// Contextos permitidos: https://docs.github.com/actions/learn-github-actions/contexts#context-availability
test('el env del workflow y del job solo usa contextos disponibles en ese nivel', () => {
  const allowed = { workflow: ['github', 'inputs', 'vars', 'secrets'], job: ['github', 'needs', 'strategy', 'matrix', 'vars', 'secrets', 'inputs'] };
  const bad = [];
  const check = (f, level, env) => {
    for (const [k, v] of Object.entries(env ?? {})) {
      for (const m of String(v).matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
        for (const ctx of m[1].matchAll(/(?<![\w.'"-])([a-z_]+)\s*[.[]/gi)) if (!allowed[level].includes(ctx[1])) bad.push(`${f} · ${level} · ${k}: ${ctx[1]}`);
      }
    }
  };
  for (const [f, w] of Object.entries(wf)) {
    check(f, 'workflow', w.env);
    for (const job of Object.values(w.jobs)) check(f, 'job', job.env);
  }
  assert.deepEqual(bad, []);
});

test('verificación del artefacto de Pages: uno roto bloquea la subida, uno válido pasa', () => {
  const { run: script, flags } = step('pages-build', 'verify-artifact');
  const make = (index, extra = {}) => {
    const dir = tmp();
    mkdirSync(path.join(dir, 'tools'));
    copyFileSync(path.join(ROOT, 'v2/tools/verify-pages-artifact.sh'), path.join(dir, 'tools/verify-pages-artifact.sh'));
    chmodSync(path.join(dir, 'tools/verify-pages-artifact.sh'), 0o755);
    mkdirSync(path.join(dir, 'dist-pages/assets'), { recursive: true });
    writeFileSync(path.join(dir, 'dist-pages/index.html'), index);
    writeFileSync(path.join(dir, 'dist-pages/assets/index-abc.js'), 'console.log(1)');
    for (const [p, c] of Object.entries(extra)) writeFileSync(path.join(dir, 'dist-pages', p), c);
    return dir;
  };
  const API = 'https://skitrip.ejemplo.workers.dev';
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src ${API} https://identitytoolkit.googleapis.com">`;
  const valid = `<!doctype html><html><head>${csp}<script type="module" src="/skitrip/assets/index-abc.js"></script></head><body></body></html>`;
  const noCsp = valid.replace(csp, '');
  const env = { VITE_API_BASE_URL: API };

  const ok = runStep(script, { cwd: make(valid), env, flags });
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.summary, /Artefacto de Pages correcto/);

  const broken = runStep(script, { cwd: make(noCsp), env, flags });
  assert.notEqual(broken.code, 0, 'sin CSP el paso debe fallar');
  assert.match(broken.summary, /Falta la CSP/);
  // El fallo que señaló la revisión: con el shell por defecto (bash -e, sin pipefail) `| tee` devolvía 0.
  assert.equal(runStep(script, { cwd: make(noCsp), env, flags: DEFAULT_BASH }).code, 0);

  assert.notEqual(runStep(script, { cwd: make(valid, { 'datos.csv': 'a,b' }), env, flags }).code, 0, 'un CSV en el artefacto debe bloquear');
  assert.notEqual(runStep(script, { cwd: make(valid), env: { VITE_API_BASE_URL: 'https://otra.workers.dev' }, flags }).code, 0, 'CSP con otro origen');
  // La subida solo ocurre en un paso posterior del mismo job: si este falla, no se llega a ella.
  const steps = release.jobs['pages-build'].steps;
  assert.ok(steps.findIndex((s) => s.id === 'verify-artifact') < steps.findIndex((s) => String(s.uses).startsWith('actions/upload-pages-artifact')));
});

test('marcador de Time Travel: sin marcador (o si wrangler falla) no se llega a las migraciones', () => {
  const { run: script, flags } = step('api', 'bookmark');
  const BM = '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';
  const run = (body) => { const d = tmp(); return runStep(script, { cwd: d, env: { PATH: fakeNpx(d, body) }, flags }); };

  const ok = run(`echo "🚧 Time Traveling..."; echo "⚠️ The current bookmark is '${BM}'"`);
  assert.equal(ok.code, 0, ok.stdout);
  assert.equal(ok.output.trim(), `bookmark=${BM}`);
  assert.match(ok.summary, new RegExp(BM));

  assert.notEqual(run('echo "Authentication error [code: 10000]" >&2; exit 1').code, 0);
  assert.notEqual(run('echo "nada útil"').code, 0);
  // El paso anterior (`… | tee -a` sin pipefail) seguía con wrangler fallando:
  const d = tmp();
  const old = runStep('npx wrangler d1 time-travel info skitrip -c wrangler.deploy.jsonc | tee -a "$GITHUB_STEP_SUMMARY"\n', { cwd: d, env: { PATH: fakeNpx(d, 'exit 1') }, flags: DEFAULT_BASH });
  assert.equal(old.code, 0);
  // Y las migraciones van justo después, en el mismo job.
  const ids = release.jobs.api.steps.map((s) => s.id ?? s.name);
  assert.ok(ids.indexOf('bookmark') < ids.findIndex((n) => /migraciones/.test(n)));
});

test('despliegue del Worker: si wrangler falla, el paso falla aunque `tee` funcione', () => {
  const { run: script, flags } = step('api', 'deploy');
  const run = (body) => { const d = tmp(); return runStep(script, { cwd: d, env: { PATH: fakeNpx(d, body) }, flags }); };
  assert.notEqual(run('echo "Uploaded skitrip"; echo "https://skitrip.x.workers.dev"; exit 1').code, 0);
  const ok = run('echo "Deployed skitrip triggers"; echo "  https://skitrip.ejemplo.workers.dev"');
  assert.equal(ok.code, 0, ok.stdout);
  assert.equal(ok.output.trim(), 'url=https://skitrip.ejemplo.workers.dev');
});

test('publicación atada a las pruebas del mismo SHA, API antes que Pages, solo desde main', () => {
  const j = release.jobs;
  assert.deepEqual(Object.keys(release.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(release.on.push.branches, ['main']);
  assert.equal(j.verify.uses, './.github/workflows/v2-verify.yml');
  assert.equal(j.verify.with.sha, '${{ github.sha }}');
  assert.deepEqual(j.api.needs, ['scope', 'verify']);
  assert.deepEqual(j['pages-build'].needs, ['scope', 'verify', 'api']);
  assert.match(j['pages-build'].if, /needs\.verify\.result == 'success'/);
  assert.match(j['pages-build'].if, /needs\.api\.result == 'success' \|\| needs\.api\.result == 'skipped'/);
  assert.deepEqual([j['pages-deploy'].needs].flat(), ['pages-build']);
  assert.match(j['pages-deploy'].if, /needs\.pages-build\.result == 'success'/);
  for (const name of ['api', 'pages-build']) {
    const co = j[name].steps.find((s) => String(s.uses).startsWith('actions/checkout'));
    assert.equal(co.with.ref, '${{ github.sha }}', `${name} usa el mismo commit`);
  }
  assert.match(j.scope.steps[0].run, /refs\/heads\/main/);
  // La batería de pruebas comprueba que ha sacado exactamente ese commit y no tiene secretos.
  const verify = wf['v2-verify.yml'];
  assert.ok(verify.jobs.test.steps.some((s) => /git rev-parse HEAD/.test(s.run ?? '')));
  for (const s of ['typecheck', 'npm test', 'test:workflows', 'verify-pages-artifact', 'playwright test']) {
    assert.ok(verify.jobs.test.steps.some((x) => (x.run ?? '').includes(s)), `la batería incluye ${s}`);
  }
  // Los antiguos workflows independientes ya no existen.
  assert.ok(!files.includes('v2-pages.yml') && !files.includes('v2-deploy-api.yml'));
});

test('sin privilegios para código no confiable', () => {
  for (const [f, w] of Object.entries(wf)) {
    assert.ok(!('pull_request_target' in (w.on ?? {})), `${f} no usa pull_request_target`);
    assert.ok(!('workflow_run' in (w.on ?? {})), `${f} no usa workflow_run`);
  }
  for (const f of ['v2-ci.yml', 'v2-verify.yml']) {
    const text = readFileSync(path.join(WF, f), 'utf8');
    assert.ok(!/secrets\./.test(text), `${f} sin secretos`);
    assert.deepEqual(wf[f].permissions, { contents: 'read' });
  }
  assert.deepEqual(wf['v2-ci.yml'].on.push['branches-ignore'], ['main']);
});

test('alcance del despliegue según los archivos cambiados', () => {
  const s = (...f) => releaseScope(f);
  const both = { api: true, pages: true }, api = { api: true, pages: false }, pages = { api: false, pages: true }, none = { api: false, pages: false };
  assert.deepEqual(s('v2/package.json'), both);
  assert.deepEqual(s('v2/package-lock.json'), both);
  assert.deepEqual(s('v2/src/core/compare.ts'), both);
  assert.deepEqual(s('.github/workflows/v2-release.yml'), both);
  assert.deepEqual(s('v2/data/catalog.json'), api);
  assert.deepEqual(s('v2/tools/import-legacy.ts'), api);
  assert.deepEqual(s('v2/tools/deploy-config.mjs'), api);
  assert.deepEqual(s('v2/wrangler.jsonc'), api);
  assert.deepEqual(s('v2/migrations/0010_x.sql'), api);
  assert.deepEqual(s('data/open_km_history.json'), api);
  assert.deepEqual(s('v2/src/worker/index.ts'), api);
  assert.deepEqual(s('v2/src/web/App.tsx'), pages);
  assert.deepEqual(s('v2/vite.config.ts'), pages);
  assert.deepEqual(s('v2/tools/verify-pages-artifact.sh'), pages);
  assert.deepEqual(s('v2/docs/DEPLOY.md', 'v2/test/core/x.test.ts'), none);
  assert.deepEqual(releaseScope(null), both);
  // Lo que cambia en esos archivos dispara el workflow (filtro de rutas del push).
  const paths = release.on.push.paths.map((p) => new RegExp(`^${p.replace(/\./g, '\\.').replace(/\*\*/g, '.+').replace(/(?<!\.)\*/g, '[^/]+')}$`));
  for (const f of ['v2/package.json', 'v2/package-lock.json', 'v2/data/catalog.json', 'v2/tools/import-legacy.ts', 'v2/wrangler.jsonc', 'v2/tools/deploy-config.mjs', 'data/hotel_price_history.json', '.github/workflows/v2-verify.yml']) {
    assert.ok(paths.some((re) => re.test(f)), `el push de ${f} lanza la publicación`);
  }
});
