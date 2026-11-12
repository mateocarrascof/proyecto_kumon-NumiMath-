-- Semilla de DESARROLLO: versiones legales PROVISIONALES ("NO VÁLIDO LEGALMENTE").
-- Las huellas son el SHA-256 de docs/legal-provisional/*.md. Si cambias un texto, cambia su versión
-- y su huella aquí (las versiones publicadas son inmutables).
insert into public.legal_document_versions (kind, version, content_sha256, is_current, covers_sheets) values
  ('terms',             'terminos-prov-1',   'def710ab867f2ae040068bf8e21c1a629ed33ce5dbcf83791dd6c5d070591f14', true, false),
  -- privacidad-prov-2 (CU-A12): agrega el guardado local para practicar sin internet. Al cambiar la
  -- versión vigente, la app vuelve a pedir el consentimiento a todos los tutores.
  ('privacy',           'privacidad-prov-1', 'c6cec82fbc4a2f629c13c869d8f7978491c9fb861435860006bea99f42341aea', false, false),
  ('privacy',           'privacidad-prov-2', 'a796179b399dff97b9f6c87f6041e090f9c1a92125e506d18a43d174a8d69958', true, false),
  ('adult_declaration', 'declaracion-prov-1','4d5a426f45ea49294af2b8f7883810341e804f9aa6adc6096f4d97e23a989d27', true, false),
  ('teacher_authorization', 'autorizacion-docente-prov-5', '96074311e9fbcc789ef8682056309065b902cef49fdb2d56194f84a8127d1ea6', true, true);
