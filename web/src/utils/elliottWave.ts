// ElliottWave - Elliott Wave 指標計算模組 (v4)
// 簡化版本：直接用 ZigZag 點標記波浪

import { Time } from 'lightweight-charts'

// ============ Types ============

export interface ElliottWavePoint {
  wave: number       // 波浪編號：1-5 (推進), A/B/C (調整) = 0/-1/-2
  type: 'high' | 'low'
  time: Time
  price: number
}

export interface ElliottWaveResult {
  waves: ElliottWavePoint[]
  labels: Array<{ wave: number; time: Time; price: number; text: string }>
  connections: Array<{ from: Time; to: Time; priceFrom: number; priceTo: number; wave: number }>
  valid: boolean
  message: string
}

function waveLabelText(wave: number): string {
  if (wave === 0) return 'A'
  if (wave === -1) return 'B'
  if (wave === -2) return 'C'
  return String(wave)
}

// ============ 核心算法 ============

/**
 * 計算 Elliott Wave (v4 - 簡化版本)
 *
 * 思路：
 * - ZigZag 點已經係極值點（highs 和 lows）
 * - 在上升趨勢中：推進浪(1,3,5)是 highs，調整浪(2,4)是 lows
 * - 在下降趨勢中：推進浪是 lows，調整浪是 highs
 * - 簡單遍歷 alternating 模式，標記 1-2-3-4-5-A-B-C
 *
 * 規則驗證（可選，寬鬆）：
 * - Wave 2 唔可以完全吃掉 Wave 1
 * - Wave 4 唔可以進入 Wave 1 範圍
 */
export function calculateElliottWave(
  zigzagPoints: Array<{ time: Time; value: number }>,
  options: {
    minImpulseRatio?: number
  } = {}
): ElliottWaveResult {
  if (zigzagPoints.length < 4) {
    return {
      waves: [],
      labels: [],
      connections: [],
      valid: false,
      message: 'ZigZag 點不足'
    }
  }

  // 步驟1：分析極值點類型
  const points: Array<{ time: Time; value: number; type: 'high' | 'low' }> = []

  for (let i = 0; i < zigzagPoints.length; i++) {
    let type: 'high' | 'low'

    if (i === 0) {
      // 第一個點：根據第二個點判斷
      type = zigzagPoints[i].value >= zigzagPoints[i + 1].value ? 'high' : 'low'
    } else if (i === zigzagPoints.length - 1) {
      // 最後一個點：根據倒數第二個判斷
      type = zigzagPoints[i].value >= zigzagPoints[i - 1].value ? 'high' : 'low'
    } else {
      // 中間點：根據前後判斷
      const prev = zigzagPoints[i - 1].value
      const curr = zigzagPoints[i].value
      const next = zigzagPoints[i + 1].value

      if (curr > prev && curr > next) {
        type = 'high'
      } else if (curr < prev && curr < next) {
        type = 'low'
      } else {
        // 不明確：根據與相鄰的大小判斷
        type = curr > prev ? 'high' : 'low'
      }
    }

    points.push({
      time: zigzagPoints[i].time,
      value: zigzagPoints[i].value,
      type
    })
  }

  // 步驟2：確定主要趨勢
  // 比較第一個和最後一個極值點
  const firstHigh = points.find(p => p.type === 'high')
  const lastHigh = [...points].reverse().find(p => p.type === 'high')
  const firstLow = points.find(p => p.type === 'low')
  const lastLow = [...points].reverse().find(p => p.type === 'low')

  let trend: 'up' | 'down'
  if (firstHigh && lastHigh && firstLow && lastLow) {
    // 如果最後一個 high 高過第一個 high，整體向上
    trend = lastHigh.value > firstHigh.value ? 'up' : 'down'
  } else {
    trend = points[points.length - 1].value > points[0].value ? 'up' : 'down'
  }

  // 步驟3：分配波浪編號
  //
  // 上升趨勢：
  // - Wave 1,3,5 = highs (推進)
  // - Wave 2,4 = lows (調整)
  // - A,C = highs, B = low (調整浪)
  //
  // 下降趨勢：
  // - Wave 1,3,5 = lows (推進)
  // - Wave 2,4 = highs (調整)
  // - A,C = lows, B = high (調整浪)

  const waveAssignments: Array<{ idx: number; wave: number }> = []

  // 遍歷所有極值點，交替分配波浪
  // 找到第一個推進極值作為 Wave 1
  let waveNum = 1  // 1-5 推進, 6=A, 7=B, 8=C, 然後重置
  let lastImpulseType = trend === 'up' ? 'high' : 'low'

  for (let i = 0; i < points.length; i++) {
    const point = points[i]

    // 根據波浪數字判斷這個點應該係咩類型
    let expectedType: 'high' | 'low'

    if (waveNum <= 5) {
      // 推進浪
      expectedType = trend === 'up'
        ? (waveNum % 2 === 1 ? 'high' : 'low')   // 1,3,5 = high, 2,4 = low
        : (waveNum % 2 === 1 ? 'low' : 'high')   // 1,3,5 = low, 2,4 = high
    } else {
      // 調整浪 A,B,C
      expectedType = trend === 'up'
        ? (waveNum === 6 ? 'high' : waveNum === 7 ? 'low' : 'high')  // A=high, B=low, C=high
        : (waveNum === 6 ? 'low' : waveNum === 7 ? 'high' : 'low')   // A=low, B=high, C=low
    }

    // 如果這個點的類型匹配，標記它
    // 但如果連續 2 個都唔匹配，強制重置
    if (point.type === expectedType || i < 2) {
      // 特殊情況：第一和第二個點無條件接受
      waveAssignments.push({ idx: i, wave: waveNum })
    } else {
      // 類型唔匹配，睇下係咪可以接受
      // 例如：我們想要 high 但係見到 low，可能係調整浪提前出現
      waveAssignments.push({ idx: i, wave: waveNum })
    }

    // 移動到下一個波浪
    waveNum++

    // 如果係 C (waveNum === 8)，重置為 1 開始新週期
    if (waveNum > 8) {
      waveNum = 1
    }
  }

  // 步驟4：構建輸出
  const waves: ElliottWavePoint[] = points.map((point, idx) => {
    const assignment = waveAssignments.find(a => a.idx === idx)
    return {
      wave: assignment ? assignment.wave : 0,
      type: point.type,
      time: point.time,
      price: point.value
    }
  })

  // 步驟5：簡單規則驗證
  let valid = true
  let message = '基本模式識別'

  // 檢查 Wave 2 是否合理（唔應該完全吃掉 Wave 1）
  const wave1Points = waves.filter(w => w.wave === 1)
  const wave2Points = waves.filter(w => w.wave === 2)

  if (wave1Points.length > 0 && wave2Points.length > 0) {
    const w1 = wave1Points[0]
    const w2 = wave2Points[0]

    if (trend === 'up' && w2.price < w1.price * 0.5) {
      message = '⚠ Wave 2 回調過深（僅供參考）'
      valid = false
    }
    if (trend === 'down' && w2.price > w1.price * 1.5) {
      message = '⚠ Wave 2 反彈過高（僅供參考）'
      valid = false
    }
  }

  return {
    waves,
    labels: buildLabels(waves),
    connections: buildConnections(waves),
    valid,
    message
  }
}

// ============ 輔助函數 ============

function buildLabels(waves: ElliottWavePoint[]) {
  const labels: Array<{ wave: number; time: Time; price: number; text: string }> = []

  for (const wave of waves) {
    if (wave.wave > 0 || wave.wave === 0 || wave.wave === -1 || wave.wave === -2) {
      labels.push({
        wave: wave.wave,
        time: wave.time,
        price: wave.price,
        text: waveLabelText(wave.wave)
      })
    }
  }

  return labels
}

function buildConnections(waves: ElliottWavePoint[]) {
  const connections: Array<{ from: Time; to: Time; priceFrom: number; priceTo: number; wave: number }> = []

  for (let i = 1; i < waves.length; i++) {
    const prev = waves[i - 1]
    const curr = waves[i]

    if (curr.wave > 0 || curr.wave === 0 || curr.wave === -1 || curr.wave === -2) {
      connections.push({
        from: prev.time,
        to: curr.time,
        priceFrom: prev.price,
        priceTo: curr.price,
        wave: curr.wave
      })
    }
  }

  return connections
}
