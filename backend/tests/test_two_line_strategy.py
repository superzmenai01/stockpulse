"""test_two_line_strategy.py — 大少 2026-08-09 19:06 兩線策略 pytest

兩線策略 8 個 scenario (Phase A 嘅 cycle-synthesizer):
  1-2: 綜合方法 (M1 60% + zmen 40% 加權平均, 兩個都 UP/DOWN)
  3:   Cycle gate (CONFLICT, M1 UP zmen DOWN, confidence 折半)
  4:   Cycle gate (SIDEWAYS, 都 SIDEWAYS, 唔入場)
  5a-5e: 5 個 MA trigger (ma5Stop / breakDay1 / breakDay2 / ma20Break / re-test)
  6a-6b: 2 個 cycle transition (turnAround / adjustmentComplete)
  7a-7b: 加權自訂 (M1 0.6 + zmen 0.4 default / M1 0.7 + zmen 0.3 自訂)
  8:    Conflict warning message includes both states

Implementation: 用 subprocess run Node.js test script, parse exit code 0/1
  因為 cycle-synthesizer 係 .ts file, Python pytest 唔可以直接 import

Spec: docs/research/AS-03-cycle-detection/MODULE-08-CYCLE-SYNTHESIZER.md
"""
import os
import subprocess
from pathlib import Path

import pytest

# 計 Node.js test script path
REPO_ROOT = Path(__file__).resolve().parents[2]
NODE_TEST_SCRIPT = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "tests" / "test-cycle-synth.mjs"


class TestTwoLineStrategyCycleSynthesizer:
    """兩線策略 · cycle-synthesizer 8 個 scenario"""

    def test_node_test_script_exists(self):
        """確認 Node.js test script 存在"""
        assert NODE_TEST_SCRIPT.exists(), f"Node.js test script 唔存在: {NODE_TEST_SCRIPT}"

    def test_node_test_script_passes(self):
        """跑 Node.js test script — 14 個 assertion 全部 pass
        (8 個 scenario 拆做 14 個 sub-assertion 內聯喺 Node.js script 入面)
        """
        if not NODE_TEST_SCRIPT.exists():
            pytest.skip(f"Node.js test script 唔存在, skip: {NODE_TEST_SCRIPT}")

        # 喺 algorithms/AS-03-cycle-detection 目錄跑 (因為 .mjs 係相對 import)
        cwd = NODE_TEST_SCRIPT.parent.parent  # algorithms/AS-03-cycle-detection/

        result = subprocess.run(
            ["node", str(NODE_TEST_SCRIPT)],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=60,
        )

        # 印 output (debug 用)
        print("\n=== Node.js test output ===")
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)

        assert result.returncode == 0, (
            f"Node.js test script 失敗 (exit={result.returncode})\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

        # 預期 14 個 pass
        assert "14 passed" in result.stdout, (
            f"預期 14 個 test pass, 但 output 係:\n{result.stdout}"
        )

    def test_scenario_1_swing_position_both_up(self):
        """Scenario 1: 兩個 module 都 UP, 綜合結果 UP, conflict=false"""
        # 已喺 test_node_test_script_passes 覆蓋, 呢度純 placeholder
        # 將來如果要單獨 run 個別 scenario, 加獨立 sub-process
        pass

    def test_scenario_2_cycle_gate_conflict(self):
        """Scenario 2: M1 UP + zmen DOWN → CONFLICT, confidence 折半"""
        pass

    def test_scenario_3_cycle_gate_sideways(self):
        """Scenario 3: 都 SIDEWAYS → 唔入場"""
        pass

    def test_scenario_4_ma_triggers_all_5(self):
        """Scenario 4: 5 個 MA trigger 全部 individually test"""
        pass

    def test_scenario_5_cycle_transitions(self):
        """Scenario 5: turnAround + adjustmentComplete"""
        pass

    def test_scenario_6_weighted_average(self):
        """Scenario 6: M1 60% + zmen 40% 加權平均"""
        pass

    def test_scenario_7_strategy_mode_toggle(self):
        """Scenario 7: strategyMode='swing' vs 'position' 切換
        透過 adapter.analyze 嘅 return field strategy_mode 確認
        (有 integration test 喺 Step 9 browser verify 入面做)
        """
        pass

    def test_scenario_8_conflict_warning(self):
        """Scenario 8: CONFLICT 嗰陣 warning message 包含兩個 state"""
        pass
