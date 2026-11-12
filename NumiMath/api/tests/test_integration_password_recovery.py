"""Recuperar contraseña de punta a punta contra el Supabase LOCAL (Auth + Mailpit).

No corren por defecto. Con `supabase start` y las variables definidas:

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<llave anon local> \\
        api/.venv/Scripts/python -m pytest -q api -m integration -k recovery

La llave anon es PÚBLICA por diseño (sale de `supabase status -o env`, ANON_KEY).

Diseño del enlace: el correo trae un enlace a LA APP (`<SiteURL>/nueva-clave?token_hash=…`), no al
`/auth/v1/verify` de Supabase. Abrir ese enlace no gasta nada: el código se canjea después, con un
POST a /verify, cuando la persona pulsa el botón. Así un escáner de correo que solo abre el enlace
no lo consume ni obtiene una sesión.

Lo que se comprueba: misma respuesta exista o no el correo (y la limitación conocida del 429), el
correo llega solo si hay cuenta, el código sirve una sola vez, la regla de contraseña la exige
también el servidor, y cambiar la contraseña cierra todas las sesiones. La caducidad (30 min) se
confía a `otp_expiry` de la configuración, que se verifica abajo: esperar 30 minutos no es práctico.
"""

from __future__ import annotations

import os
import re
import time
import tomllib
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

pytestmark = pytest.mark.integration

_URL = os.environ.get("SUPABASE_URL", "")
_ANON = os.environ.get("SUPABASE_ANON_KEY", "")
_MAIL = os.environ.get("MAILPIT_URL", "http://127.0.0.1:54324")
_APP = "http://localhost:8100"
_OLD = "Clave-inicial-123"
_NEW = "Clave-nueva-456"
_CONFIG = Path(__file__).resolve().parents[2] / "supabase" / "config.toml"


@pytest.fixture
def auth() -> httpx.Client:
    if not _URL or not _ANON:
        pytest.skip("faltan SUPABASE_URL y SUPABASE_ANON_KEY")
    return httpx.Client(
        base_url=f"{_URL.rstrip('/')}/auth/v1",
        headers={"apikey": _ANON, "Content-Type": "application/json"},
        timeout=15,
        follow_redirects=False,
    )


@pytest.fixture
def account(auth: httpx.Client) -> str:
    email = f"rec-{uuid.uuid4().hex[:12]}@example.test"
    response = auth.post("/signup", json={"email": email, "password": _OLD})
    assert response.status_code == 200, response.text
    return email


def _recover(
    auth: httpx.Client, email: str, redirect_to: str = f"{_APP}/nueva-clave"
) -> httpx.Response:
    return auth.post("/recover", params={"redirect_to": redirect_to}, json={"email": email})


def _mails_to(email: str, wait: float = 6.0) -> list[dict]:
    """Correos para `email` en Mailpit (espera un poco: el envío es asíncrono)."""
    deadline = time.time() + wait
    while True:
        found = httpx.get(f"{_MAIL}/api/v1/search", params={"query": f"to:{email}"}, timeout=5)
        messages = found.json().get("messages", [])
        if messages or time.time() >= deadline:
            return messages
        time.sleep(0.4)


def _recovery_link(email: str) -> str:
    messages = _mails_to(email)
    assert messages, "no llegó el correo de recuperación"
    detail = httpx.get(f"{_MAIL}/api/v1/message/{messages[0]['ID']}", timeout=5).json()
    match = re.search(r'href="([^"]+/nueva-clave\?[^"]+)"', detail["HTML"])
    assert match, "el correo no trae el enlace a la app"
    return match.group(1).replace("&amp;", "&")


def _redeem(auth: httpx.Client, link: str) -> httpx.Response:
    """Canjea el código del enlace (lo que hace la app al pulsar el botón)."""
    query = parse_qs(urlparse(link).query)
    return auth.post(
        "/verify", json={"type": query["type"][0], "token_hash": query["token_hash"][0]}
    )


# ---- misma respuesta exista o no la cuenta ------------------------------------------------------


def test_recovery_responde_igual_exista_o_no_el_correo(auth: httpx.Client, account: str) -> None:
    unknown = f"nadie-{uuid.uuid4().hex[:12]}@example.test"
    known_response = _recover(auth, account)
    unknown_response = _recover(auth, unknown)
    assert known_response.status_code == unknown_response.status_code == 200
    assert known_response.json() == unknown_response.json()


def test_recovery_solo_envia_correo_si_hay_cuenta(auth: httpx.Client, account: str) -> None:
    unknown = f"nadie-{uuid.uuid4().hex[:12]}@example.test"
    _recover(auth, account)
    _recover(auth, unknown)
    assert _mails_to(account), "debía llegar el correo a la cuenta"
    assert _mails_to(unknown, wait=2.0) == [], "no debe llegar nada a un correo sin cuenta"


def test_limitacion_conocida_gotrue_el_segundo_pedido_seguido_delata_la_cuenta(
    auth: httpx.Client, account: str
) -> None:
    """LIMITACIÓN CONOCIDA de Supabase Auth, documentada a propósito (no es una propiedad deseada).

    El límite `max_frequency` es POR USUARIO: un segundo pedido seguido devuelve 429 si el correo
    tiene cuenta y 200 si no. Quien llame directo a /auth/v1/recover con la llave anon (pública)
    puede usarlo para enumerar cuentas. La app NO lo muestra (siempre el mismo mensaje), pero el
    endpoint es público. Mitigación pendiente para producción: captcha de Supabase o un proxy por
    la API con límite por IP (ver docs/privacy/pendientes-legales.md, 25).
    """
    unknown = f"nadie-{uuid.uuid4().hex[:12]}@example.test"
    assert _recover(auth, account).status_code == 200
    assert _recover(auth, account).status_code == 429  # con cuenta: se limita
    assert _recover(auth, unknown).status_code == 200
    assert _recover(auth, unknown).status_code == 200  # sin cuenta: nunca se limita


# ---- el enlace del correo ----------------------------------------------------------------------


def test_el_correo_esta_en_espanol_y_el_enlace_va_a_la_app_no_al_servidor_de_auth(
    auth: httpx.Client, account: str
) -> None:
    _recover(auth, account)
    message = _mails_to(account)[0]
    assert "contraseña" in message["Subject"].lower()
    link = _recovery_link(account)
    parsed = urlparse(link)
    assert f"{parsed.scheme}://{parsed.netloc}" == _APP
    assert parsed.path == "/nueva-clave"
    assert parse_qs(parsed.query)["type"] == ["recovery"]
    assert "/auth/v1/" not in link, "abrir el enlace no debe tocar el servidor de Auth"


def test_un_redirect_ajeno_en_el_pedido_no_cambia_a_donde_apunta_el_enlace(
    auth: httpx.Client, account: str
) -> None:
    _recover(auth, account, redirect_to="http://evil.example/x")
    link = _recovery_link(account)
    assert "evil.example" not in link
    assert urlparse(link).netloc == urlparse(_APP).netloc


def test_el_codigo_sirve_una_sola_vez(auth: httpx.Client, account: str) -> None:
    _recover(auth, account)
    link = _recovery_link(account)

    first = _redeem(auth, link)
    assert first.status_code == 200, first.text
    session = first.json()
    assert session.get("access_token") and session.get("refresh_token")

    second = _redeem(auth, link)
    assert second.status_code in (400, 403), second.text
    assert "access_token" not in second.json(), "el código no puede dar sesión dos veces"


def test_un_codigo_inventado_no_da_sesion(auth: httpx.Client) -> None:
    response = auth.post("/verify", json={"type": "recovery", "token_hash": "x" * 40})
    assert response.status_code in (400, 403, 422)
    assert "access_token" not in response.json()


# ---- contraseña nueva: regla actual y cierre de sesiones ---------------------------------------


def _recovery_session(auth: httpx.Client, email: str) -> dict[str, str]:
    _recover(auth, email)
    return _redeem(auth, _recovery_link(email)).json()


def _bearer(session: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['access_token']}"}


def test_el_servidor_rechaza_una_contrasena_corta(auth: httpx.Client, account: str) -> None:
    session = _recovery_session(auth, account)
    response = auth.put("/user", headers=_bearer(session), json={"password": "corta"})
    assert response.status_code == 422
    assert response.json().get("error_code") == "weak_password"


def test_cambiar_la_contrasena_invalida_la_anterior_y_cierra_las_sesiones(
    auth: httpx.Client, account: str
) -> None:
    old_session = auth.post(
        "/token", params={"grant_type": "password"}, json={"email": account, "password": _OLD}
    ).json()
    session = _recovery_session(auth, account)

    changed = auth.put("/user", headers=_bearer(session), json={"password": _NEW})
    assert changed.status_code == 200, changed.text
    auth.post("/logout", params={"scope": "global"}, headers=_bearer(session))

    # La contraseña vieja ya no entra y la nueva sí.
    bad = auth.post(
        "/token", params={"grant_type": "password"}, json={"email": account, "password": _OLD}
    )
    assert bad.status_code == 400
    good = auth.post(
        "/token", params={"grant_type": "password"}, json={"email": account, "password": _NEW}
    )
    assert good.status_code == 200

    # Las sesiones anteriores (otro dispositivo) quedaron cerradas.
    refresh = auth.post(
        "/token",
        params={"grant_type": "refresh_token"},
        json={"refresh_token": old_session["refresh_token"]},
    )
    assert refresh.status_code in (400, 401)


# ---- configuración -----------------------------------------------------------------------------


def test_la_configuracion_exige_ocho_caracteres_60s_entre_correos_y_30_min_de_vida() -> None:
    config = tomllib.loads(_CONFIG.read_text(encoding="utf-8"))["auth"]
    assert config["minimum_password_length"] >= 8
    assert config["email"]["otp_expiry"] <= 1800
    assert config["email"]["max_frequency"] == "60s"
    assert config["site_url"].rstrip("/") == _APP
    assert f"{_APP}/nueva-clave" in config["additional_redirect_urls"]
    assert config["email"]["notification"]["password_changed"]["enabled"] is True
