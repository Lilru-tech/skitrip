-- Cremallera como partida del presupuesto (Vall de Núria: no se llega en coche).
-- Si el destino exige cremallera (area_access.mode = 'rack_railway') y no consta que el forfait o el paquete de la
-- opción lo incluyan, el presupuesto queda con la partida pendiente y no puede presentarse ni puntuar como completo.
-- Precio por persona para toda la estancia (una ida y vuelta, o una por día si se duerme abajo), en céntimos, en los mismos tres sitios que el resto de costes del destino.
ALTER TABLE trip_budget ADD COLUMN railway_cents_per_person INTEGER CHECK (railway_cents_per_person IS NULL OR railway_cents_per_person >= 0);
ALTER TABLE trip_destination_costs ADD COLUMN railway_cents_per_person INTEGER CHECK (railway_cents_per_person IS NULL OR railway_cents_per_person >= 0);
ALTER TABLE trip_candidates ADD COLUMN railway_cents_per_person INTEGER CHECK (railway_cents_per_person IS NULL OR railway_cents_per_person >= 0);
-- 'yes': el forfait o paquete de esta opción incluye el cremallera a quien esquía (no se suma otra vez); 'no'; 'unknown'.
ALTER TABLE trip_candidates ADD COLUMN railway_included TEXT NOT NULL DEFAULT 'unknown' CHECK (railway_included IN ('yes', 'no', 'unknown'));
-- La nota de Núria (0017) decía que el billete «no se suma al transporte»: ahora es una partida propia del presupuesto.
UPDATE area_access SET note = 'Sin acceso en coche: la ruta llega al aparcamiento del cremallera en Queralbs. No incluye la subida en cremallera de Queralbs a Núria (unos 17 min y unos 750 m de desnivel): en el presupuesto es la partida «Cremallera», pendiente hasta indicar su precio o que el forfait o paquete de la opción lo incluye. Horarios y precios en valldenuria.cat. También se puede subir desde Ribes de Freser (unos 39 min).'
WHERE area_id = 'vall-de-nuria' AND mode = 'rack_railway';
