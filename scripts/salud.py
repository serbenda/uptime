#!/usr/bin/env python3
"""Revisa el estado de las fuentes tras una actualización.

Sale con código 1 e imprime un informe en Markdown si algún proveedor lleva
varias ejecuciones seguidas sin responder; la Action lo usa para abrir un issue.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from actualizar import FALLOS_PARA_AVISAR, SALIDA  # noqa: E402


def main():
    try:
        proveedores = json.loads((SALIDA / "estado.json").read_text("utf-8")).get("proveedores", [])
    except (OSError, ValueError) as e:
        print(f"No se ha podido leer `estado.json`: {e}")
        return 1
    caidas = [p for p in proveedores if (p.get("fuente") or {}).get("fallos_seguidos", 0) >= FALLOS_PARA_AVISAR]
    if not caidas:
        print("Todas las fuentes responden.")
        return 0
    print(f"Estas fuentes llevan al menos {FALLOS_PARA_AVISAR} actualizaciones seguidas fallando. "
          "La web las muestra como *sin datos*.\n")
    print("| Proveedor | Error | Fallos seguidos | Último dato bueno |")
    print("|---|---|---|---|")
    for p in caidas:
        f = p["fuente"]
        print(f"| {p['nombre']} | {f.get('error') or '-'} | {f.get('fallos_seguidos')} | {f.get('ultimo_ok') or 'nunca'} |")
    ejecucion = os.environ.get("ENLACE_EJECUCION")
    if ejecucion:
        print(f"\nRegistro de la ejecución: {ejecucion}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
