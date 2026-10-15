-- Semilla de DESARROLLO: versiones legales PROVISIONALES ("NO VÁLIDO LEGALMENTE").
-- Las huellas son el SHA-256 de docs/legal-provisional/*.md. Si cambias un texto, cambia su versión
-- y su huella aquí (las versiones publicadas son inmutables).
insert into public.legal_document_versions (kind, version, content_sha256, is_current) values
  ('terms',             'terminos-prov-1',   'def710ab867f2ae040068bf8e21c1a629ed33ce5dbcf83791dd6c5d070591f14', true),
  ('privacy',           'privacidad-prov-1', 'c6cec82fbc4a2f629c13c869d8f7978491c9fb861435860006bea99f42341aea', true),
  ('adult_declaration', 'declaracion-prov-1','4d5a426f45ea49294af2b8f7883810341e804f9aa6adc6096f4d97e23a989d27', true);
