// ElliottWave - Elliott Wave 指標計算模組
// 基於 ZigZag 轉向點識別波浪

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
}

// ============ Wave Label Text ============

function waveLabelText(wave: number): string {
  if (wave === 0) return 'A'
  if (wave === -1) return 'B'
  if (wave === -2) return 'C'
  return String(wave)
}

// ============ Main Elliott Wave Calculation ============

/**
 * 計算 Elliott Wave - 簡單版本
 * 
 * ZigZag 點是高點和低點交替的轉向點序列。
 * 
 * 這個算法簡單地：
 * 1. 確定趨勢方向（根據第一個和最後一個點的價格）
 * 2. 根據波浪理論分配編號：
 *    - 推進浪（1,3,5）：順著趨勢
 *    - 調整浪（2,4）：逆著趨勢
 * 3. 如果是最後一個完整波段，添加 A-B-C
 */
export function calculateElliottWave(
  zigzagPoints: Array<{ time: Time; value: number }>,
  options: {
    // 推進/調整最小幅度比率（默認0.3，即30%）
    minImpulseRatio?: number
  } = {}
): ElliottWaveResult {
  const { minImpulseRatio = 0.3 } = options
  
  if (zigzagPoints.length < 4) {
    return { waves: [], labels: [], connections: [] }
  }

  const waves: ElliottWavePoint[] = []
  const labels: Array<{ wave: number; time: Time; price: number; text: string }> = []
  const connections: Array<{ from: Time; to: Time; priceFrom: number; priceTo: number; wave: number }> = []

  // ---- 步驟1: 確定主要趨勢方向 ----
  const firstPrice = zigzagPoints[0].value
  const lastPrice = zigzagPoints[zigzagPoints.length - 1].value
  const isDowntrend = lastPrice < firstPrice

  // ---- 步驟2: 為每個 ZigZag 點分配極值類型 ----
  for (let i = 0; i < zigzagPoints.length; i++) {
    const point = zigzagPoints[i]
    let type: 'high' | 'low'
    
    if (i === 0) {
      type = point.value > zigzagPoints[1].value ? 'high' : 'low'
    } else if (i === zigzagPoints.length - 1) {
      type = point.value > zigzagPoints[zigzagPoints.length - 2].value ? 'high' : 'low'
    } else {
      const prev = zigzagPoints[i - 1].value
      const next = zigzagPoints[i + 1].value
      if (point.value > prev && point.value > next) {
        type = 'high'
      } else if (point.value < prev && point.value < next) {
        type = 'low'
      } else {
        type = point.value > prev ? 'high' : 'low'
      }
    }
    
    waves.push({
      wave: 0,
      type,
      time: point.time,
      price: point.value,
    })
  }

  // ---- 步驟3: 識別波浪 ----
  // 
  // 在下跌趨勢中：
  // - 推進浪（1,3,5）應該是 LOWS（價格下跌）
  // - 調整浪（2,4）應該是 HIGHS（價格回升）
  // - 第一個明顯的低點是 Wave 1
  //
  // 在上升趨勢中：
  // - 推進浪（1,3,5）應該是 HIGHS（價格上漲）
  // - 調整浪（2,4）應該是 LOWS（價格回調）
  
  // 找到第一個推進浪（主要趨勢方向的第一個顯著移動）
  let waveAssignments: number[] = new Array(waves.length).fill(0)
  let waveCounter = 0
  
  // 確定波浪分配規則
  // 推進浪的類型（high 或 low）
  const impulseType = isDowntrend ? 'low' : 'high'
  
  // 遍歷波浪，分配波浪編號
  for (let i = 1; i < waves.length; i++) {
    const prev = waves[i - 1]
    const curr = waves[i]
    
    if (waveCounter === 0) {
      // 還沒有分配 Wave 1 - 尋找第一個順勢移動
      const isImpulse = isDowntrend ? curr.type === 'low' : curr.type === 'high'
      if (isImpulse) {
        // 這個點是 Wave 1 的終點
        waveCounter = 1
        waveAssignments[i] = 1
      }
    } else if (waveCounter === 1) {
      // Wave 1 已分配，等待 Wave 2（逆勢調整）
      const isCorrective = isDowntrend ? curr.type === 'high' : curr.type === 'low'
      if (isCorrective) {
        waveCounter = 2
        waveAssignments[i] = 2
      }
    } else if (waveCounter === 2) {
      // Wave 2 已分配，等待 Wave 3（順勢）
      const isImpulse = isDowntrend ? curr.type === 'low' : curr.type === 'high'
      if (isImpulse) {
        waveCounter = 3
        waveAssignments[i] = 3
      }
    } else if (waveCounter === 3) {
      // Wave 3 已分配，等待 Wave 4（逆勢）
      const isCorrective = isDowntrend ? curr.type === 'high' : curr.type === 'low'
      if (isCorrective) {
        waveCounter = 4
        waveAssignments[i] = 4
      }
    } else if (waveCounter === 4) {
      // Wave 4 已分配，等待 Wave 5（順勢）
      const isImpulse = isDowntrend ? curr.type === 'low' : curr.type === 'high'
      if (isImpulse) {
        waveCounter = 5
        waveAssignments[i] = 5
      }
    } else if (waveCounter === 5) {
      // Wave 5 已分配，進入調整浪 A-B-C
      // A: 逆勢（與 Wave 2 方向相同）
      const isCorrectiveA = isDowntrend ? curr.type === 'high' : curr.type === 'low'
      if (isCorrectiveA) {
        waveCounter = 6
        waveAssignments[i] = 0  // A = 0
      }
    } else if (waveCounter === 6) {
      // A 已分配，等待 B（順勢）
      const isImpulseB = isDowntrend ? curr.type === 'low' : curr.type === 'high'
      if (isImpulseB) {
        waveCounter = 7
        waveAssignments[i] = -1  // B = -1
      }
    } else if (waveCounter === 7) {
      // B 已分配，等待 C（逆勢，與 A 方向相同）
      const isCorrectiveC = isDowntrend ? curr.type === 'high' : curr.type === 'low'
      if (isCorrectiveC) {
        waveCounter = 8
        waveAssignments[i] = -2  // C = -2
      }
    }
  }

  // ---- 步驟4: 應用波浪分配 ----
  for (let i = 0; i < waves.length; i++) {
    waves[i].wave = waveAssignments[i]
    
    // 只為關鍵波浪添加標籤
    if (waveAssignments[i] > 0) {
      labels.push({
        wave: waveAssignments[i],
        time: waves[i].time,
        price: waves[i].price,
        text: waveLabelText(waveAssignments[i]),
      })
    } else if (waveAssignments[i] === 0 && i > 0) {
      labels.push({
        wave: 0,
        time: waves[i].time,
        price: waves[i].price,
        text: 'A',
      })
    } else if (waveAssignments[i] === -1) {
      labels.push({
        wave: -1,
        time: waves[i].time,
        price: waves[i].price,
        text: 'B',
      })
    } else if (waveAssignments[i] === -2) {
      labels.push({
        wave: -2,
        time: waves[i].time,
        price: waves[i].price,
        text: 'C',
      })
    }
  }

  // ---- 步驟5: 構建連接線 ----
  // 只連接有波浪編號的連續點
  for (let i = 1; i < waves.length; i++) {
    const prev = waves[i - 1]
    const curr = waves[i]
    
    // 如果兩個連續點都有波浪編號（除了起點），繪製連接線
    if (prev.wave > 0 || curr.wave > 0) {
      // 跳過從未標記點到已標記點的連接（除非是波浪的起點）
      if (prev.wave === 0 && curr.wave === 0) continue
      if (prev.wave === 0 && curr.wave > 0 && i > 1) continue  // 跳過起點到第一波浪的連接
      
      connections.push({
        from: prev.time,
        to: curr.time,
        priceFrom: prev.price,
        priceTo: curr.price,
        wave: curr.wave > 0 ? curr.wave : curr.wave,
      })
    }
  }

  return { waves, labels, connections }
}