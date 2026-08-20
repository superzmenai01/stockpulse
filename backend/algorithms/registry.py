"""
backend/algorithms/registry.py — Registry pattern (大少 2026-08-20 Phase 1)

凡人話: 算法 register / 拎算法 嘅 mechanism
- 每個 algorithm import 時 register 落 _REGISTRY
- 之後加新 algorithm (M1/M2/...) 唔使改 main.py, 只需要喺 algorithms/__init__.py 加 import

對應 backup: backups/zigzag-frontend-2026-08-20/RESTORE.md
Spec: docs/research/AS-03-cycle-detection/MODULE-XX-*.md (per algorithm)
Algorithm: register(algorithm) / get_algorithm(name) / list_algorithms()
凡人話: 一個 Python dict, 將 algorithm 名 (string) 對應到 Algorithm 實例
"""

from typing import Dict
from .base import Algorithm

# 凡人話: 私有 dict, key 係 algorithm name, value 係 Algorithm 實例
_REGISTRY: Dict[str, Algorithm] = {}


def register(algorithm: Algorithm) -> None:
    """凡人話: 將 algorithm 實例 register 落 registry

    Args:
        algorithm: Algorithm 實例 (必須 set name 同 version)

    Raises:
        ValueError: 冇 set name / 撞名 (可能 import 兩次)
    """
    if not algorithm.name:
        raise ValueError(
            f"Algorithm {type(algorithm).__name__} 冇 set name attribute, "
            f"請喺 class 寫 name = 'xxx'"
        )
    if algorithm.name in _REGISTRY:
        raise ValueError(
            f"Algorithm '{algorithm.name}' 已經 register 過, "
            f"可能 algorithms/__init__.py import 兩次"
        )
    _REGISTRY[algorithm.name] = algorithm
    print(f"[Registry] Registered: {algorithm.name} v{algorithm.version}")


def get_algorithm(name: str) -> Algorithm:
    """凡人話: 拎 algorithm 實例 by name

    Args:
        name: Algorithm name (e.g. "zigzag")

    Returns:
        Algorithm 實例

    Raises:
        KeyError: Algorithm name 唔存在, error message 會 list 返 available
    """
    if name not in _REGISTRY:
        available = list(_REGISTRY.keys())
        raise KeyError(
            f"Algorithm '{name}' 唔存在. Available: {available}"
        )
    return _REGISTRY[name]


def list_algorithms() -> list[str]:
    """凡人話: 拎所有 registered algorithms 嘅 name list"""
    return list(_REGISTRY.keys())
