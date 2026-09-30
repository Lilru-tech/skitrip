-- 0006: alias exactos (normalizados) para emparejar filas de agregadores, en orden de prioridad.
ALTER TABLE sources ADD COLUMN match_aliases TEXT;
