"""test_multi_tf.py — 大少 2026-08-09 21:33 M5 Multi-TF pytest

M5 Multi-TF 13 個 scenario (Stage 2 第一次 focus):
  1:   3 個 TF 全 UP, conflict=false, consensus=aligned
  1b:  3 個 TF verdicts 全部 UP
  2:   3 個 TF 全 DOWN, conflict=false
  3:   3 個 TF 全 SIDEWAYS, conflict=false
  4:   2 個 TF UP + 1 個 SIDEWAYS, conflict=false, partial consensus
  5:   1D UP + 1W UP + 1M DOWN → 2 UP, 1 DOWN, conflict=true, 1M 逆 warning
  5b:  2 UP + 1 DOWN confidence = base * 0.85
  6:   1D UP + 1W DOWN + 1M DOWN → 1 UP, 2 DOWN, conflict=true, 1D 逆 warning
  7:   1D UP + 1W DOWN + 1M UP → 2 UP, 1 DOWN, conflict=true, 1W 逆 warning (mixed)
  8:   加權 default (25/35/40) baseConfidence 計算啱
  8b:  3 TF 一致, confidence multiplier = 1.0
  9:   加權自訂 (30/30/40) — 大少可調
  10:  3 TF 唔同方向 → state=CONFLICT, conflict=true, divergent consensus
  10b: CONFLICT confidence = base * 0.5
  10c: CONFLICT warning 包含 3 個 TF state
  11:  1D 數據不足 (< 90) 拋 error
  12:  3 TF 全 UP + 1M high confidence → turn_around = true
  13:  meta fields 啱 (tf_weights 25/35/40 + data_days_xxx = 100 + sub_module = "ma-alignment")
  13b: meta.data_days_xxx 對應 100 條
  13c: meta.sub_module = "ma-alignment"

Implementation: 用 subprocess run Node.js test script, parse exit code 0/1
  因為 multi-tf.ts 係 .ts file, Python pytest 唔可以直接 import

Spec: docs/research/AS-03-cycle-detection/MODULE-05-MULTI-TIMEFRAME.md
"""
import os
import subprocess
from pathlib import Path

import pytest

# 計 Node.js test script path
REPO_ROOT = Path(__file__).resolve().parents[2]
NODE_TEST_SCRIPT = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "tests" / "test-multi-tf.mjs"


class TestMultiTFCycleSynthesizer:
    """M5 Multi-TF · 13 個 scenario (Stage 2 第一次 focus)"""

    def test_node_test_script_exists(self):
        """確認 Node.js test script 存在"""
        assert NODE_TEST_SCRIPT.exists(), f"Node.js test script 唔存在: {NODE_TEST_SCRIPT}"

    def test_node_test_script_passes(self):
        """跑 Node.js test script — 全部 assertion 必須 pass

        13 個 scenario 拆做多個 sub-assertion 內聯喺 Node.js script 入面
        預設 20+ 個 assert (13 個 scenario + 1b/5b/8b/10b/10c/13b/13c sub)
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


class TestMultiTFBundleExists:
    """M5 esbuild bundle 必須存在 (browser side 入口)"""

    def test_bundle_file_exists(self):
        """確認 esbuild bundle output 存在"""
        bundle_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "build" / "multi-tf.bundle.js"
        assert bundle_path.exists(), f"esbuild bundle 唔存在: {bundle_path}"

    def test_bundle_file_has_content(self):
        """確認 bundle file 有 content (唔係空 file)"""
        bundle_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "build" / "multi-tf.bundle.js"
        if not bundle_path.exists():
            pytest.skip(f"esbuild bundle 唔存在, skip: {bundle_path}")
        assert bundle_path.stat().st_size > 1000, f"Bundle file size 太少, 可能 build 失敗: {bundle_path}"


class TestMultiTFTypeExports:
    """M5 synthesizeMultiTF 嘅 function signature 啱 (browser 入口 contract)"""

    def test_module_file_exists(self):
        """確認 TypeScript source 存在"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "multi-tf.ts"
        assert module_path.exists(), f"M5 module 唔存在: {module_path}"

    def test_module_exports_synthesizeMultiTF(self):
        """確認 multi-tf.ts 有 export synthesizeMultiTF function"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "multi-tf.ts"
        if not module_path.exists():
            pytest.skip(f"M5 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        assert "export function synthesizeMultiTF" in content, (
            "multi-tf.ts 缺少 export function synthesizeMultiTF"
        )

    def test_module_has_default_config(self):
        """確認 DEFAULT_MULTI_TF_CONFIG 存在 + 3 個 TF weights 對應大少 21:33 D2 揀 A (25/35/40)"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "multi-tf.ts"
        if not module_path.exists():
            pytest.skip(f"M5 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        assert "DEFAULT_MULTI_TF_CONFIG" in content, (
            "multi-tf.ts 缺少 DEFAULT_MULTI_TF_CONFIG"
        )
        assert "'1D': 0.25" in content, "tfWeights['1D'] 應該係 0.25 (大少 21:33 揀 A)"
        assert "'1W': 0.35" in content, "tfWeights['1W'] 應該係 0.35 (大少 21:33 揀 A)"
        assert "'1M': 0.40" in content, "tfWeights['1M'] 應該係 0.40 (大少 21:33 揀 A)"


class TestMultiTFSpecDoc:
    """M5 spec doc 必須存在 (大少 21:33 spec workflow)"""

    def test_module_spec_doc_exists(self):
        """確認 M5 spec doc 存在"""
        spec_path = REPO_ROOT / "docs" / "research" / "AS-03-cycle-detection" / "MODULE-05-MULTI-TIMEFRAME.md"
        assert spec_path.exists(), f"M5 spec doc 唔存在: {spec_path}"
        content = spec_path.read_text(encoding="utf-8")
        # 簡單 sanity check
        assert "Multi-TF" in content or "MultiTF" in content, (
            "M5 spec doc 內容不對"
        )
        # Spec doc 用中文描述 interface, 唔強求字面 function name
        assert "時間框架" in content, "M5 spec doc 缺少時間框架描述"
        assert "1D" in content and "1W" in content and "1M" in content, (
            "M5 spec doc 缺少 3 個 timeframe 描述"
        )
        assert ("synthesizeMultiTF" in content
                or "MultiTFVerdict" in content
                or "interface" in content.lower()), (
            "M5 spec doc 缺少 synthesizeMultiTF / MultiTFVerdict interface 描述"
        )
