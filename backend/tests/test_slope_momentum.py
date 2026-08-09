"""test_slope_momentum.py — 大少 2026-08-09 22:34 M8 SlopeMomentum pytest

M8 SlopeMomentum 13+ 個 scenario (Stage 2 第二次 focus):
  1:  升勢 → state=UP, M1 + M3 + M5 觸發
  1b: M1 觸發 (MA5 加速上升)
  1c: confidence >= 0.7 (有 strong rule)
  2:  跌勢 → state=DOWN, M2 觸發
  2b: M2 觸發 (MA5 加速下跌)
  3:  斜率由負轉正 → state=TRANSITION, M7 觸發
  3b: M7 觸發 (短期斜率轉正)
  4:  斜率由正轉負 → state=TRANSITION, M8 觸發
  4b: M8 觸發 (短期斜率轉負)
  5:  全平 → state=SIDEWAYS, M9 觸發
  5b: M9 觸發 (動能減弱)
  5c: confidence = 0.6 (weak only)
  6:  強 UP → state=UP, 至少 3 條 rule 觸發
  6b: 至少 3 條 rule 觸發
  6c: confidence = 0.8 (strong + 1 weak bonus)
  7:  M1 強 vs M4 中期矛盾 → state=UP (M1 priority)
  8:  M7 + M8 同時 → state=TRANSITION (priority order 處理)
  9:  數據不足 (< 20) 拋 error
  10: weak only confidence = 0.6
  11: consecutiveDays=3 預設可 trigger M1
  11b: consecutiveDays=5 較嚴
  12: default threshold 0.005 跟 v1.0 一致
  12b: 自訂 threshold 0.003 唔影響 verdict
  13: meta.matchedRules 係 array of string
  13b-g: meta.latestSlopeMA5/10/60, dataDays, configUsed
  14: DEFAULT_SLOPE_MOMENTUM_CONFIG 對應 4 個 A decision

Implementation: 用 subprocess run Node.js test script, parse exit code 0/1
  因為 slope-momentum.ts 係 .ts file, Python pytest 唔可以直接 import

Spec: docs/research/AS-03-cycle-detection/MODULE-08-SLOPE-MOMENTUM.md
"""
import os
import subprocess
from pathlib import Path

import pytest

# 計 Node.js test script path
REPO_ROOT = Path(__file__).resolve().parents[2]
NODE_TEST_SCRIPT = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "tests" / "test-slope-momentum.mjs"


class TestSlopeMomentumCycle:
    """M8 SlopeMomentum · 14 個 scenario (Stage 2 第二次 focus)"""

    def test_node_test_script_exists(self):
        """確認 Node.js test script 存在"""
        assert NODE_TEST_SCRIPT.exists(), f"Node.js test script 唔存在: {NODE_TEST_SCRIPT}"

    def test_node_test_script_passes(self):
        """跑 Node.js test script — 全部 assertion 必須 pass

        14 個 scenario 拆做 28 個 sub-assertion 內聯喺 Node.js script 入面
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

        # 印 output 方便 debug (大少 #10299 永久 rule: 結果要 evidence-based report)
        if result.stdout:
            print("\n=== Node.js test output ===")
            print(result.stdout)
        if result.stderr:
            print("\n=== Node.js test stderr ===")
            print(result.stderr)

        assert result.returncode == 0, (
            f"Node.js test script 失敗 (exit code {result.returncode})"
        )


class TestSlopeMomentumBundleExists:
    """M8 esbuild bundle 必須存在 (browser side 入口)"""

    def test_bundle_file_exists(self):
        """確認 esbuild bundle output 存在"""
        bundle_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "build" / "slope-momentum.bundle.js"
        assert bundle_path.exists(), f"esbuild bundle 唔存在: {bundle_path}"

    def test_bundle_file_has_content(self):
        """確認 bundle file 有 content (唔係空 file)"""
        bundle_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "build" / "slope-momentum.bundle.js"
        if not bundle_path.exists():
            pytest.skip(f"esbuild bundle 唔存在, skip: {bundle_path}")
        assert bundle_path.stat().st_size > 1000, f"Bundle file size 太少, 可能 build 失敗: {bundle_path}"


class TestSlopeMomentumTypeExports:
    """M8 analyzeSlopeMomentum 嘅 function signature 啱 (browser 入口 contract)"""

    def test_module_file_exists(self):
        """確認 TypeScript source 存在"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "slope-momentum.ts"
        assert module_path.exists(), f"M8 module 唔存在: {module_path}"

    def test_module_exports_analyzeSlopeMomentum(self):
        """確認 slope-momentum.ts 有 export analyzeSlopeMomentum function"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "slope-momentum.ts"
        if not module_path.exists():
            pytest.skip(f"M8 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        assert "export function analyzeSlopeMomentum" in content, (
            "slope-momentum.ts 缺少 export function analyzeSlopeMomentum"
        )

    def test_module_has_default_config(self):
        """確認 DEFAULT_SLOPE_MOMENTUM_CONFIG 存在 + 4 個 A decision 對應"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "slope-momentum.ts"
        if not module_path.exists():
            pytest.skip(f"M8 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        assert "DEFAULT_SLOPE_MOMENTUM_CONFIG" in content, (
            "slope-momentum.ts 缺少 DEFAULT_SLOPE_MOMENTUM_CONFIG"
        )
        # D2 揀 A: shortSlopeThreshold = 0.005
        assert "shortSlopeThreshold: 0.005" in content, (
            "DEFAULT_SLOPE_MOMENTUM_CONFIG.shortSlopeThreshold 應該係 0.005 (D2 揀 A)"
        )
        # D3 揀 A: reversalWindow = 5
        assert "reversalWindow: 5" in content, (
            "DEFAULT_SLOPE_MOMENTUM_CONFIG.reversalWindow 應該係 5 (D3 揀 A)"
        )

    def test_module_has_10_rules(self):
        """確認 10 條 rule M1-M10 全部有 (跟 v1.0 spec)"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "slope-momentum.ts"
        if not module_path.exists():
            pytest.skip(f"M8 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        for rule_id in ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10']:
            assert f"'{rule_id}'" in content, f"missing rule {rule_id} in slope-momentum.ts"


class TestSlopeMomentumSpecDoc:
    """M8 spec doc 必須存在 (大少 22:34 spec workflow)"""

    def test_module_spec_doc_exists(self):
        """確認 M8 spec doc 存在"""
        spec_path = REPO_ROOT / "docs" / "research" / "AS-03-cycle-detection" / "MODULE-08-SLOPE-MOMENTUM.md"
        assert spec_path.exists(), f"M8 spec doc 唔存在: {spec_path}"
        content = spec_path.read_text(encoding="utf-8")
        # 簡單 sanity check
        assert "SlopeMomentum" in content or "斜率動能" in content, (
            "M8 spec doc 內容不對"
        )
        # 4 個 A decision 必須明記
        assert "大少 22:34 confirm" in content, "M8 spec doc 缺少 22:34 confirm 標記"
        assert ("0.5%" in content or "0.005" in content), (
            "M8 spec doc 缺少 D2 (短期 slope threshold 0.5%)"
        )
        assert ("5 日" in content or "reversalWindow: 5" in content), (
            "M8 spec doc 缺少 D3 (reversal window 5 日)"
        )
        # 10 條 rule
        for rule_id in ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10']:
            assert rule_id in content, f"M8 spec doc 缺少 rule {rule_id}"
