"""M7 Synthesizer (SSI + TCM + Alignment + Grade + Kelly) v2.0.1 backend algorithm — 大少 11/9 confirm fix
凡人話: 對齊 v2.0.1 永久 rule — weight discount 加 category check (stock_state 唔 trigger) + normalize fallback (5 個 module 全部 trigger 嗰陣 1/n 補返) + cycleLabel 跟 state 而唔係 grade + module_verdicts emit normalized weight
"""
from .algorithm import SynthesizerAlgorithm  # noqa: F401
from .config import DEFAULT_SYNTHESIZER_CONFIG  # noqa: F401
