-- Port Ainé: la nota del punto de llegada (0017) solo citaba el aparcamiento de Rabasta. La estación publica seis
-- aparcamientos gratuitos escalonados en la carretera de acceso (pirineu365.cat, información práctica, consultada el
-- 16/10/2026), sin coordenadas. El punto no cambia (base Cota 2000) y sigue siendo aproximado.
UPDATE area_access SET
  note = 'El punto es la base Cota 2000 (Hotel Port Ainé 2000), al final de la carretera de acceso desde Rialp. En invierno se aparca en los aparcamientos escalonados de esa carretera (Cota 1650, Riu Sec, Rabasta, Roní, Jet Cim y La Font), cuya ubicación exacta no está publicada: el último tramo puede ser algo más corto.',
  source = 'https://www.skiresort.com/en/ski-resort/port-aine/arrival-car/ · https://surtdecasa.cat/pirineus/llocs-interes/rialp/estacio-de-muntanya-de-port-aine · https://pirineu365.cat/en/portaine/resort/practical-information/'
WHERE area_id = 'port-aine' AND confidence = 'approximate';
