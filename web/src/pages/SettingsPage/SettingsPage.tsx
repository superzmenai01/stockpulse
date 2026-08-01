import React, { useState, useEffect } from 'react';
import { Card, Typography, Tag, Button, Table, Space, Modal, Input, App as AntApp } from 'antd';
import { PlusOutlined, DeleteOutlined, ThunderboltOutlined, ReloadOutlined } from '@ant-design/icons';
import { AppLayout } from '../../components/layout';

// 大少 2026-08-01 #9146 — Settings UI 集中管理
const { Title, Text } = Typography;

const PREDEFINED_PROVIDERS = [
  { value: 'minimax', label: 'MiniMax M3', endpoint: 'https://api.minimaxi.chat/v1', model: 'MiniMax-M3-highspeed' },
  { value: 'kimi', label: 'Kimi K2.7', endpoint: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { value: 'openai', label: 'GPT-4o', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { value: 'gemini', label: 'Gemini 1.5 Flash', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-1.5-flash' },
];

interface Provider {
  id: number;
  provider: string;
  api_key_masked: string;
  endpoint?: string;
  model?: string;
  is_active: boolean;
  is_custom: boolean;
}

export default function SettingsPage() {
  const { message, modal } = AntApp.useApp();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [addApiKeyModal, setAddApiKeyModal] = useState<{ open: boolean; provider: string }>({ open: false, provider: '' });
  const [newApiKey, setNewApiKey] = useState('');
  const [addCustomModal, setAddCustomModal] = useState(false);
  const [customForm, setCustomForm] = useState({ provider: '', endpoint: '', model: '', api_key: '' });
  const [switchModal, setSwitchModal] = useState<{ open: boolean; toProvider: string }>({ open: false, toProvider: '' });
  const [switchAutoCheck, setSwitchAutoCheck] = useState(true);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/llm-settings');
      const data = await resp.json();
      setProviders(data);
      const active = data.find((p: Provider) => p.is_active);
      setActiveProvider(active?.provider || null);
    } catch (e: any) {
      message.error('載入失敗: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProviders(); }, []);

  const handleSaveApiKey = async () => {
    try {
      const resp = await fetch('/api/llm-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: addApiKeyModal.provider, api_key: newApiKey }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      message.success(`已儲存 ${addApiKeyModal.provider}`);
      setAddApiKeyModal({ open: false, provider: '' });
      setNewApiKey('');
      await loadProviders();
      // 第一次加 → auto-active（後端已設）
      // 已有 active → 問切換
      if (!activeProvider) {
        message.success(`${addApiKeyModal.provider} 已自動設為 Active`);
      } else {
        setSwitchModal({ open: true, toProvider: addApiKeyModal.provider });
      }
    } catch (e: any) {
      message.error('儲存失敗: ' + e.message);
    }
  };

  const handleSwitchConfirm = async () => {
    try {
      const resp = await fetch('/api/llm-settings/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: switchModal.toProvider }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      message.success(`已切換去 ${switchModal.toProvider}`);
      setSwitchModal({ open: false, toProvider: '' });
      await loadProviders();
    } catch (e: any) {
      message.error('切換失敗: ' + e.message);
    }
  };

  const handleDelete = (provider: string) => {
    modal.confirm({
      title: `刪除 ${provider}?`,
      content: '此操作會永久刪除 API key，唔可復原。',
      okText: '確認刪除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const resp = await fetch(`/api/llm-settings/${provider}`, { method: 'DELETE' });
          if (!resp.ok) throw new Error(await resp.text());
          message.success('已刪除');
          await loadProviders();
        } catch (e: any) {
          message.error('刪除失敗: ' + e.message);
        }
      },
    });
  };

  const handleAddCustom = async () => {
    try {
      const resp = await fetch('/api/llm-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...customForm, is_custom: true }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      message.success(`已儲存 Custom ${customForm.provider}`);
      setAddCustomModal(false);
      setCustomForm({ provider: '', endpoint: '', model: '', api_key: '' });
      await loadProviders();
      if (!activeProvider) {
        message.success(`${customForm.provider} 已自動設為 Active`);
      } else {
        setSwitchModal({ open: true, toProvider: customForm.provider });
      }
    } catch (e: any) {
      message.error('儲存失敗: ' + e.message);
    }
  };

  const existingProviders = new Set(providers.map(p => p.provider));
  const availableProviders = PREDEFINED_PROVIDERS.filter(p => !existingProviders.has(p.value));

  return (
    <AppLayout>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title level={2} style={{ margin: 0 }}>
            <ThunderboltOutlined /> 設定
          </Title>
          <Button icon={<ReloadOutlined />} onClick={loadProviders}>重新載入</Button>
        </div>
        <Text type="secondary">
          所有設定集中喺呢度。改 settings 即用，唔需要重啟 server。
        </Text>

        <Card
          title="🤖 AI Model"
          style={{ marginTop: 24 }}
          extra={activeProvider ? <Tag color="green">Active: {activeProvider}</Tag> : <Tag color="red">未設定</Tag>}
        >
          <Text type="secondary">
            所有演算法（包括 AS-02 公司質素分析）都會用呢度設定嘅 AI Provider。
          </Text>

          {providers.length > 0 && (
            <>
              <Title level={5} style={{ marginTop: 16 }}>已加入 ({providers.length})</Title>
              <Table
                dataSource={providers}
                rowKey="id"
                loading={loading}
                pagination={false}
                size="small"
                columns={[
                  {
                    title: 'Provider', dataIndex: 'provider', key: 'provider',
                    render: (p: string) => (
                      <Tag color={p === activeProvider ? 'green' : 'default'}>
                        {p === activeProvider ? '✅ ' : ''}{p}
                      </Tag>
                    ),
                  },
                  { title: 'API Key', dataIndex: 'api_key_masked', key: 'api_key_masked', render: (k: string) => <code>{k}</code> },
                  { title: 'Status', dataIndex: 'is_active', key: 'is_active', render: (a: boolean) => a ? <Tag color="green">Active</Tag> : <Tag>備用</Tag> },
                  {
                    title: '動作', key: 'actions',
                    render: (_, record: Provider) => (
                      <Space>
                        {!record.is_active && (
                          <Button size="small" type="primary" onClick={() => setSwitchModal({ open: true, toProvider: record.provider })}>
                            切換使用
                          </Button>
                        )}
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.provider)}>
                          刪除
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          )}

          {availableProviders.length > 0 && (
            <>
              <Title level={5} style={{ marginTop: 24 }}>加入 Pre-defined Provider</Title>
              <Space wrap>
                {availableProviders.map(p => (
                  <Button key={p.value} icon={<PlusOutlined />}
                    onClick={() => setAddApiKeyModal({ open: true, provider: p.value })}>
                    + {p.label}
                  </Button>
                ))}
              </Space>
            </>
          )}

          <Title level={5} style={{ marginTop: 24 }}>Custom Provider</Title>
          <Button icon={<PlusOutlined />} onClick={() => setAddCustomModal(true)}>
            + Add Custom (OpenAI-compatible)
          </Button>
        </Card>

        <Modal title="🎯 切換去新 Provider?" open={switchModal.open}
          onOk={handleSwitchConfirm}
          onCancel={() => setSwitchModal({ open: false, toProvider: '' })}
          okText="✅ 切換（立即用）" cancelText="⏸️ 暫時唔切"
          okButtonProps={{ autoFocus: switchAutoCheck }}
          onOkCapture={() => setSwitchAutoCheck(true)}>
          <p>原本用：<strong>{activeProvider || '未設定'}</strong></p>
          <p>切換後：<strong>{switchModal.toProvider}</strong></p>
          <Text type="secondary">所有演算法（包括 AS-02）下次跑會用新 provider。</Text>
        </Modal>

        <Modal title={`🔑 ${addApiKeyModal.provider} API Key`} open={addApiKeyModal.open}
          onOk={handleSaveApiKey}
          onCancel={() => { setAddApiKeyModal({ open: false, provider: '' }); setNewApiKey(''); }}
          okText="💾 Save" cancelText="取消">
          <Input.Password
            placeholder="sk-pas…here"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            size="large"
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            API Key 會用 AES-256 加密儲存喺 DB，UI 只會顯示 masked 版本。
          </Text>
        </Modal>

        <Modal title="➕ Add Custom Provider" open={addCustomModal}
          onOk={handleAddCustom}
          onCancel={() => setAddCustomModal(false)}
          okText="💾 Save" cancelText="取消" width={600}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input placeholder="Provider 名 (e.g. DeepSeek)" value={customForm.provider}
              onChange={(e) => setCustomForm({ ...customForm, provider: e.target.value })} />
            <Input placeholder="Endpoint URL (e.g. https://api.deepseek.com/v1)" value={customForm.endpoint}
              onChange={(e) => setCustomForm({ ...customForm, endpoint: e.target.value })} />
            <Input placeholder="Model name (e.g. deepseek-chat)" value={customForm.model}
              onChange={(e) => setCustomForm({ ...customForm, model: e.target.value })} />
            <Input.Password placeholder="API Key" value={customForm.api_key}
              onChange={(e) => setCustomForm({ ...customForm, api_key: e.target.value })} />
          </Space>
        </Modal>
      </div>
    </AppLayout>
  );
}
