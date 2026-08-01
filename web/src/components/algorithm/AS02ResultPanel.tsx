// components/algorithm/AS02ResultPanel.tsx — AS-02 兩組 result display
// 大少 2026-08-01 Phase 5 (AS-02 Frontend)
// 跟 AS-01 ResultGrid pattern: 兩組 Tabs (qualified + disqualified) + breakdown bars + reasons
//
// Usage:
//   <AS02ResultPanel
//     qualifiedStocks={qualifiedResults}
//     disqualifiedStocks={disqualifiedResults}
//     loading={loading}
//     hasRun={hasRun}
//     errorMessage={lastError}
//     rankedAt={rankedAt}
//     canSave={hasRun && qualifiedResults.length > 0 && !loading}
//     onSave={(codes) => saveFlow.show()}
//     saving={saveFlow.saving}
//   />

import React from 'react';
import {
  Card,
  Tabs,
  Tag,
  Empty,
  Spin,
  Typography,
  Progress,
  List,
  Button,
  Alert,
  Space,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { AS02Stock } from '../../types/algorithm';

const { Paragraph, Text } = Typography;

interface AS02ResultPanelProps {
  qualifiedStocks: AS02Stock[];
  disqualifiedStocks: AS02Stock[];
  loading: boolean;
  hasRun: boolean;
  errorMessage: string | null;
  rankedAt: string | null;
  canSave: boolean;
  saving?: boolean;
  onSave?: (selectedCodes: Set<string>) => void;
}

// ============================================================================
// AS02StockCard — single stock breakdown display
// ============================================================================
function AS02StockCard({ stock }: { stock: AS02Stock }) {
  const isQualified = stock.classification === 'qualified';
  const breakdown = stock.breakdown;

  // 6 個 dimension labels (跟 AS-02 spec)
  const dimensions = [
    { key: 'financial', label: '財務健康', weight: 30 },
    { key: 'business', label: '業務模式', weight: 20 },
    { key: 'management', label: '管理層', weight: 15 },
    { key: 'industry', label: '行業前景', weight: 15 },
    { key: 'valuation', label: '估值', weight: 10 },
    { key: 'risk', label: '風險', weight: 10 },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space>
          <Text strong>{stock.code}</Text>
          <Text>{stock.name}</Text>
          <Tag color={isQualified ? 'green' : 'red'}>
            {isQualified ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            {' '}{stock.classification}
          </Tag>
          <Text strong style={{ fontSize: 16 }}>
            {stock.score.toFixed(1)} 分
          </Text>
        </Space>
      }
    >
      {/* 6 個 breakdown bars */}
      <Row gutter={[16, 8]}>
        {dimensions.map((dim) => {
          const value = (breakdown as any)[dim.key] || 0;
          const color = isQualified
            ? value >= 70 ? '#52c41a' : value >= 50 ? '#faad14' : '#ff4d4f'
            : '#bfbfbf';
          return (
            <Col span={12} key={dim.key}>
              <Space style={{ width: '100%' }} direction="vertical" size={0}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {dim.label} ({dim.weight}%)
                </Text>
                <Progress
                  percent={value}
                  strokeColor={color}
                  format={(p) => `${p?.toFixed(0) ?? 0}`}
                  size="small"
                />
              </Space>
            </Col>
          );
        })}
      </Row>

      {/* reasons */}
      {stock.reasons.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong style={{ fontSize: 12 }}>📋 原因:</Text>
          <List
            size="small"
            dataSource={stock.reasons}
            renderItem={(item, idx) => (
              <List.Item style={{ padding: '4px 0', border: 'none' }}>
                <Text style={{ fontSize: 12 }}>{idx + 1}. {item}</Text>
              </List.Item>
            )}
            style={{ marginTop: 4 }}
          />
        </div>
      )}

      {/* analysis_text (full paragraph) */}
      {stock.analysis_text && (
        <Paragraph
          style={{
            marginTop: 12,
            marginBottom: 0,
            padding: 8,
            background: '#fafafa',
            borderRadius: 4,
            fontSize: 12,
            color: '#595959',
          }}
        >
          {stock.analysis_text}
        </Paragraph>
      )}

      {/* data sources footer */}
      {stock.data_sources && stock.data_sources.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 10 }}>
            數據源: {stock.data_sources.join(' + ')}
          </Text>
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// Main Panel
// ============================================================================
export default function AS02ResultPanel({
  qualifiedStocks,
  disqualifiedStocks,
  loading,
  hasRun,
  errorMessage,
  rankedAt,
  canSave,
  saving = false,
  onSave,
}: AS02ResultPanelProps) {
  // Loading state
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="LLM 分析中 (每隻股票 ~20s)..." />
      </div>
    );
  }

  // Error state
  if (errorMessage) {
    return (
      <Alert
        type="error"
        message="執行失敗"
        description={errorMessage}
        showIcon
        style={{ margin: 16 }}
      />
    );
  }

  // Empty state (未執行過)
  if (!hasRun) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size={4}>
              <Text type="secondary">尚未執行 AS-02</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                喺左邊輸入 stock codes, 撳「🔍 執行」
              </Text>
            </Space>
          }
        />
      </div>
    );
  }

  const total = qualifiedStocks.length + disqualifiedStocks.length;

  return (
    <div style={{ padding: 16 }}>
      {/* 統計 row */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="✅ 合格"
              value={qualifiedStocks.length}
              valueStyle={{ color: '#52c41a', fontSize: 28 }}
              suffix={`/ ${total}`}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="❌ 不合格"
              value={disqualifiedStocks.length}
              valueStyle={{ color: '#ff4d4f', fontSize: 28 }}
              suffix={`/ ${total}`}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Text type="secondary" style={{ fontSize: 11 }}>執行時間</Text>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {rankedAt ? new Date(rankedAt).toLocaleString('zh-HK') : '—'}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 兩組 tabs */}
      <Tabs
        defaultActiveKey="qualified"
        items={[
          {
            key: 'qualified',
            label: (
              <span>
                <CheckCircleOutlined /> 合格 ({qualifiedStocks.length})
              </span>
            ),
            children:
              qualifiedStocks.length === 0 ? (
                <Empty description="無合格股票" />
              ) : (
                qualifiedStocks.map((s) => <AS02StockCard key={s.code} stock={s} />)
              ),
          },
          {
            key: 'disqualified',
            label: (
              <span>
                <CloseCircleOutlined /> 不合格 ({disqualifiedStocks.length})
              </span>
            ),
            children:
              disqualifiedStocks.length === 0 ? (
                <Empty description="無不合格股票" />
              ) : (
                disqualifiedStocks.map((s) => <AS02StockCard key={s.code} stock={s} />)
              ),
          },
        ]}
      />

      {/* Save button */}
      {onSave && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            disabled={!canSave}
            loading={saving}
            onClick={() => onSave(new Set(qualifiedStocks.map((s) => s.code)))}
          >
            💾 儲存 {qualifiedStocks.length} 隻合格股票
          </Button>
        </div>
      )}
    </div>
  );
}