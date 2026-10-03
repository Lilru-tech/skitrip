// Importaciones «?raw» de Vite para cargar fixtures como texto (funciona dentro de workerd).
declare module '*?raw' {
  const content: string;
  export default content;
}
