"""El archivo de configuración se busca junto al código de la API, no en la carpeta actual."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings


def test_el_archivo_de_configuracion_es_el_de_la_carpeta_api() -> None:
    env_file = Settings.model_config["env_file"]
    assert isinstance(env_file, str)
    path = Path(env_file)
    assert path.is_absolute()
    assert path.parent.name == "api"
    assert (path.parent / "app" / "config.py").exists()


def test_arrancar_desde_otra_carpeta_no_cambia_donde_se_busca(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = Settings.model_config["env_file"]
    monkeypatch.chdir(tmp_path)
    assert Settings.model_config["env_file"] == before
