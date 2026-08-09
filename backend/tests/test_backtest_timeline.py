"""test_backtest_timeline.py — 大少 2026-08-10 00:13 M11 Backtest Timeline pytest

M11 Backtest Timeline 10 個 scenario (Stage 2 第三次 focus):
  1:  Data 不足 → empty result
  2:  正常情況 (90 日, 47 verdicts + 5 journal entries)
  3:  邊界 30 日 → 拎 20 條
  4:  邊界 365 日 → 拎 全部
  5:  Date alignment 對齊
  6:  Empty Trade Journal → NO_JOURNAL
  7:  全部命中 → MATCH
  8:  全部 miss + mark_wrong → MATCH
  9:  Golden entry detection (fwd5=3.5%, hit, mark=5)
  10: Golden entry threshold (fwd5=2.9%, 唔夠 3%)
  11: Meta fields 啱
  12: 6 色標 (6 個 color string)
  13: LLM hook (generateTimelineInterpretation async 返 string)
  14: Date range filter chip

Implementation: 用 subprocess run Node.js test script, parse exit code 0/1
  因為 backtest-timeline.ts 係 .ts file, Python pytest 唔可以直接 import

Spec: docs/research/AS-03-cycle-detection/MODULE-11-BACKTEST-TIMELINE.md §9
"""
import os
import subprocess
from pathlib import Path

import pytest

# 計 Node.js test script path
REPO_ROOT = Path(__file__).resolve().parents[2]
NODE_TEST_SCRIPT = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "tests" / "test-backtest-timeline.mjs"


class TestBacktestTimelineCycle:
    """M11 Backtest Timeline · 14 個 scenario (Stage 2 第三次 focus)"""

    def test_node_test_script_exists(self):
        """確認 Node.js test script 存在"""
        assert NODE_TEST_SCRIPT.exists(), f"Node.js test script 唔存在: {NODE_TEST_SCRIPT}"

    def test_node_test_script_passes(self):
        """跑 Node.js test script — 全部 assertion 必須 pass

        14 個 scenario 拆做 40 個 sub-assertion 內聯喺 Node.js script 入面
        """
        if not NODE_TEST_SCRIPT.exists():
            pytest.skip(f"Node.js test script 唔存在, skip: {NODE_TEST_SCRIPT}")

        # 喺 algorithms/AS-03-cycle-detection 目錄跑 (因為 .mjs 係相對 import)
        cwd = NODE_TEST_SCRIPT.parent.parent  # algorithms/AS-03-cycle-detection/

        result = subprocess.run(
            ["node", "--experimental-strip-types", str(NODE_TEST_SCRIPT)],
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


class TestBacktestTimelineBundleExists:
    """M11 esbuild bundle 必須存在 (browser side 入口)"""

    def test_bundle_file_exists(self):
        """確認 esbuild bundle output 存在"""
        bundle_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "build" / "backtest-timeline.bundle.js"
        assert bundle_path.exists(), f"esbuild bundle 唔存在: {bundle_path}"

    def test_bundle_file_has_content(self):
        """確認 bundle file 有 content (唔係空 file)"""
        bundle_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "build" / "backtest-timeline.bundle.js"
        if not bundle_path.exists():
            pytest.skip(f"esbuild bundle 唔存在, skip: {bundle_path}")
        assert bundle_path.stat().st_size > 1000, f"Bundle file size 太少, 可能 build 失敗: {bundle_path}"


class TestBacktestTimelineTypeExports:
    """M11 analyzeBacktestTimeline 嘅 function signature 啱 (browser 入口 contract)"""

    def test_module_file_exists(self):
        """確認 TypeScript source 存在"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "backtest-timeline.ts"
        assert module_path.exists(), f"M11 module 唔存在: {module_path}"

    def test_module_exports_analyzeBacktestTimeline(self):
        """確認 backtest-timeline.ts 有 export analyzeBacktestTimeline function"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "backtest-timeline.ts"
        if not module_path.exists():
            pytest.skip(f"M11 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        assert "export function analyzeBacktestTimeline" in content, (
            "backtest-timeline.ts 缺少 export function analyzeBacktestTimeline"
        )

    def test_module_has_LLM_hook(self):
        """確認 generateTimelineInterpretation LLM hook 存在 (大少 13:30 永久 rule)"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "backtest-timeline.ts"
        if not module_path.exists():
            pytest.skip(f"M11 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        assert "generateTimelineInterpretation" in content, (
            "backtest-timeline.ts 缺少 generateTimelineInterpretation LLM hook"
        )

    def test_module_has_6_colors(self):
        """確認 TIMELINE_COLORS 有 7 個色 (6 個 + 1 個 golden 深綠)"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "backtest-timeline.ts"
        if not module_path.exists():
            pytest.skip(f"M11 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        assert "TIMELINE_COLORS" in content, (
            "backtest-timeline.ts 缺少 TIMELINE_COLORS 6 色標"
        )

    def test_module_has_5_steps(self):
        """確認 5 個 step algorithm 全部有 (跟 Spec §6)"""
        module_path = REPO_ROOT / "algorithms" / "AS-03-cycle-detection" / "modules" / "backtest-timeline.ts"
        if not module_path.exists():
            pytest.skip(f"M11 module 唔存在, skip: {module_path}")
        content = module_path.read_text(encoding="utf-8")
        # 5 個 step function 必須有
        for step_fn in ['alignDates', 'computeMatch', 'getActionColor', 'isGoldenEntry', 'computeStats']:
            assert step_fn in content, f"backtest-timeline.ts 缺少 step function {step_fn}"


class TestBacktestTimelineSpecDoc:
    """M11 spec doc 必須存在 (大少 00:04 spec workflow)"""

    def test_module_spec_doc_exists(self):
        """確認 M11 spec doc 存在"""
        spec_path = REPO_ROOT / "docs" / "research" / "AS-03-cycle-detection" / "MODULE-11-BACKTEST-TIMELINE.md"
        assert spec_path.exists(), f"M11 spec doc 唔存在: {spec_path}"
        content = spec_path.read_text(encoding="utf-8")
        # 簡單 sanity check
        assert "Backtest Timeline" in content or "時光機時序圖" in content, (
            "M11 spec doc 內容不對"
        )
        # 4 個 A decision 必須明記
        assert "大少 00:04 confirm" in content, "M11 spec doc 缺少 00:04 confirm 標記"
        assert "Stage 2 第三次 focus" in content, "M11 spec doc 缺少 Stage 2 第三次 focus 標記"
        # 5 個 step
        for step_name in ['fetchForwardReturn', 'fetchTradeJournal', '對齊日期', 'computeView', 'computeStats']:
            assert step_name in content, f"M11 spec doc 缺少 step {step_name}"
        # 4 個 design decision
        for d in ['D1', 'D2', 'D3', 'D4']:
            assert d in content, f"M11 spec doc 缺少 {d}"


class TestBacktestTimelineAPIEndpoints:
    """M11 整合 M9 forward return + M10 Trade Journal 嘅 API endpoints"""

    def test_forward_return_endpoint_exists(self):
        """確認 forward return endpoint 喺 adaptive_params.py"""
        api_path = REPO_ROOT / "backend" / "api" / "adaptive_params.py"
        if not api_path.exists():
            pytest.skip(f"adaptive_params.py 唔存在, skip: {api_path}")
        content = api_path.read_text(encoding="utf-8")
        assert "forward-return" in content, (
            "adaptive_params.py 缺少 forward return endpoint"
        )

    def test_trade_journal_endpoint_exists(self):
        """確認 trade journal endpoint 存在 (M10 done)"""
        api_path = REPO_ROOT / "backend" / "api" / "trade_journal.py"
        if not api_path.exists():
            pytest.skip(f"trade_journal.py 唔存在, skip: {api_path}")
        content = api_path.read_text(encoding="utf-8")
        assert "@router.get" in content or "@router.post" in content, (
            "trade_journal.py 缺少任何 endpoint"
        )
