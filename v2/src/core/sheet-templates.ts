// Plantillas CSV de la hoja antigua (las mismas que docs/templates/sheets-*.csv): cabeceras en español y la estación
// por su nombre, sin identificadores internos. Un test comprueba que se importan sin errores ni avisos.
export type TemplateKind = 'availability' | 'comments' | 'shopping';

export const SHEET_TEMPLATES: Record<TemplateKind, { file: string; label: string; csv: string; help: string }> = {
  availability: {
    file: 'plantilla-disponibilidad.csv', label: 'Disponibilidad',
    csv: 'fecha,persona,estado\n10/01/2026,Nombre como en la hoja,ocupado\n11/01/2026,Nombre como en la hoja,quizá\n12/01/2026,Nombre como en la hoja,libre\n',
    help: 'Una fila por persona y día. Fecha en DD/MM/AAAA o AAAA-MM-DD. Estado: ocupado, libre o quizá (si falta la columna, cada fila cuenta como «ocupado»; cualquier otro valor se conserva sin interpretar). Los días que no aparecen quedan «sin indicar», nunca libres.',
  },
  comments: {
    file: 'plantilla-comentarios.csv', label: 'Comentarios',
    csv: 'estacion,autor,comentario,fecha\nGrandvalira,Nombre como en la hoja,"Buena nieve por la mañana, mucha cola en el telesilla",12/01/2026\ngeneral,Nombre como en la hoja,"Llevad cadenas aunque no esté nevando",13/01/2026\n',
    help: 'La estación se escribe por su nombre, como aparece en Comparar, o «general» para consejos del viaje. No hace falta ningún identificador interno. El autor es texto libre: no se asocia a ninguna cuenta hasta que lo vincules.',
  },
  shopping: {
    file: 'plantilla-compra.csv', label: 'Compra',
    csv: 'nombre,cantidad,precio,persona\nPan de molde,2,"1,35",grupo\nLeche,6,,Nombre como en la hoja\n',
    help: 'El precio se guarda como texto (sin fecha ni tienda): nunca se usa como precio actual. Las columnas que no se reconocen se conservan.',
  },
};

