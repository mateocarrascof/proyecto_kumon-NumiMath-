"""`scripts/create_admin.py`: pide la contraseña por teclado y nunca la imprime."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import httpx
import pytest
import respx

URL = "http://127.0.0.1:54321/auth/v1/admin/users"
PASSWORD = "Clave-del-admin-1234"


def _script(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "llave-de-servicio-de-prueba")
    path = Path(__file__).resolve().parents[1] / "scripts" / "create_admin.py"
    spec = importlib.util.spec_from_file_location("create_admin", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _passwords(monkeypatch: pytest.MonkeyPatch, module: ModuleType, *values: str) -> None:
    answers = iter(values)
    monkeypatch.setattr(module.getpass, "getpass", lambda _prompt="": next(answers))


def test_crea_el_admin_con_rol_y_no_imprime_la_clave(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    module = _script(monkeypatch)
    _passwords(monkeypatch, module, PASSWORD, PASSWORD)
    with respx.mock() as mock:
        route = mock.post(URL).mock(return_value=httpx.Response(200, json={"id": "x"}))
        assert module.main(["create_admin.py", "Admin@Empresa.test"]) == 0
    sent = json.loads(route.calls[0].request.content)
    assert sent["email"] == "admin@empresa.test"
    assert sent["app_metadata"] == {"role": "admin"} and sent["email_confirm"] is True
    out = capsys.readouterr()
    assert PASSWORD not in out.out + out.err and "llave-de-servicio" not in out.out + out.err


def test_contrasenas_distintas_o_cortas_no_crean_nada(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _script(monkeypatch)
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(URL).mock(return_value=httpx.Response(200, json={}))
        _passwords(monkeypatch, module, PASSWORD, "otra-distinta-123")
        assert module.main(["create_admin.py", "a@b.test"]) == 1
        _passwords(monkeypatch, module, "corta", "corta")
        assert module.main(["create_admin.py", "a@b.test"]) == 1
        assert not route.called


def test_correo_existente_no_cambia_nada(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    module = _script(monkeypatch)
    _passwords(monkeypatch, module, PASSWORD, PASSWORD)
    with respx.mock() as mock:
        mock.post(URL).mock(return_value=httpx.Response(422, json={"error_code": "email_exists"}))
        assert module.main(["create_admin.py", "a@b.test"]) == 1
    assert "ya tiene una cuenta" in capsys.readouterr().out
