import { Button, FormItem, Input, Modal, Select, Table, Textarea } from '../../../../shared/components'
import type { TableColumn } from '../../../../shared/components/Table'
import type { ProxyIPHealthResult } from '../../types'

import {
  DIRECT_PROXY_PROTOCOL_OPTIONS,
  type DirectImportForm,
  type ProxyDisplayInfo,
  type ProxyImportMode,
} from './helpers'

export interface ProxyEditFormValue {
  proxyName: string
  proxyConfig: string
  dnsServers: string
  groupName: string
}

interface ProxyPoolImportModalProps {
  open: boolean
  groups: string[]
  importMode: ProxyImportMode
  importUrl: string
  importResolvedUrl: string
  importText: string
  importDnsServers: string
  importNamePrefix: string
  importGroupName: string
  directImportForm: DirectImportForm
  fetchingImportUrl: boolean
  canParseImport: boolean
  onClose: () => void
  onParse: () => void
  onFetchImportUrl: () => void
  onImportModeChange: (nextMode: ProxyImportMode) => void
  onImportUrlChange: (nextValue: string) => void
  onImportTextChange: (nextValue: string) => void
  onImportDnsServersChange: (nextValue: string) => void
  onImportNamePrefixChange: (nextValue: string) => void
  onImportGroupNameChange: (nextValue: string) => void
  onDirectImportFormChange: (patch: Partial<DirectImportForm>) => void
}

export function ProxyPoolImportModal({
  open,
  groups,
  importMode,
  importUrl,
  importResolvedUrl,
  importText,
  importDnsServers,
  importNamePrefix,
  importGroupName,
  directImportForm,
  fetchingImportUrl,
  canParseImport,
  onClose,
  onParse,
  onFetchImportUrl,
  onImportModeChange,
  onImportUrlChange,
  onImportTextChange,
  onImportDnsServersChange,
  onImportNamePrefixChange,
  onImportGroupNameChange,
  onDirectImportFormChange,
}: ProxyPoolImportModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导入代理配置"
      width="600px"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={fetchingImportUrl}>
            取消
          </Button>
          <Button onClick={onParse} disabled={fetchingImportUrl || !canParseImport}>
            解析
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={importMode === 'clash' ? undefined : 'secondary'}
            onClick={() => onImportModeChange('clash')}
          >
            Clash 订阅 / YAML
          </Button>
          <Button
            variant={importMode === 'direct' ? undefined : 'secondary'}
            onClick={() => onImportModeChange('direct')}
          >
            HTTP / SOCKS5（测试中）
          </Button>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          {importMode === 'clash'
            ? '支持粘贴 Clash YAML，或通过订阅 URL 自动拉取并解析（含 proxies、dns、proxy-groups）'
            : '支持单条录入 HTTP / HTTPS / SOCKS5 代理，账号和密码均可留空，导入后直接生效，不走 Clash 桥接'}
        </p>
        {importMode === 'clash' && (
          <>
            <FormItem label="订阅 URL（可选）">
              <div className="flex gap-2">
                <Input
                  value={importUrl}
                  onChange={(event) => onImportUrlChange(event.target.value)}
                  placeholder="https://example.com/clash/subscription"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={onFetchImportUrl}
                  loading={fetchingImportUrl}
                  disabled={!importUrl.trim()}
                >
                  从 URL 获取
                </Button>
              </div>
              {importResolvedUrl.trim() && (
                <p className="text-xs text-[var(--color-success)] mt-1 break-all">
                  已绑定订阅：{importResolvedUrl}
                </p>
              )}
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                获取成功后会自动回填 YAML 文本，并尝试自动填充 DNS 与建议分组；自动刷新时间请在列表顶部统一配置
              </p>
            </FormItem>
            <Textarea
              value={importText}
              onChange={(event) => onImportTextChange(event.target.value)}
              rows={12}
              placeholder={`proxies:\n  - name: vless-v6\n    type: vless\n    server: example.com\n    port: 443\n    uuid: your-uuid\n    ...`}
            />
          </>
        )}
        {importMode === 'direct' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormItem label="代理协议" required>
              <Select
                options={[...DIRECT_PROXY_PROTOCOL_OPTIONS]}
                value={directImportForm.protocol}
                onChange={(event) =>
                  onDirectImportFormChange({ protocol: event.target.value as DirectImportForm['protocol'] })
                }
              />
            </FormItem>
            <FormItem label="代理名称（可选）">
              <Input
                value={directImportForm.proxyName}
                onChange={(event) => onDirectImportFormChange({ proxyName: event.target.value })}
                placeholder="例如：香港节点"
              />
            </FormItem>
            <FormItem label="代理地址" required>
              <Input
                value={directImportForm.server}
                onChange={(event) => onDirectImportFormChange({ server: event.target.value })}
                placeholder="例如：127.0.0.1 或 hk.example.com"
              />
            </FormItem>
            <FormItem label="代理端口" required>
              <Input
                type="number"
                min={1}
                max={65535}
                value={directImportForm.port}
                onChange={(event) => onDirectImportFormChange({ port: event.target.value })}
                placeholder="例如：1080"
              />
            </FormItem>
            <FormItem label="账号（可选）">
              <Input
                value={directImportForm.username}
                onChange={(event) => onDirectImportFormChange({ username: event.target.value })}
                placeholder="留空则不使用认证"
              />
            </FormItem>
            <FormItem label="密码（可选）">
              <Input
                type="password"
                value={directImportForm.password}
                onChange={(event) => onDirectImportFormChange({ password: event.target.value })}
                placeholder="留空则不使用密码"
              />
            </FormItem>
          </div>
        )}
        <FormItem label="分组名称（可选）">
          <Input
            value={importGroupName}
            onChange={(event) => onImportGroupNameChange(event.target.value)}
            placeholder="例如：香港、美国、机场A"
            list="proxy-groups-datalist"
          />
          {groups.length > 0 && (
            <datalist id="proxy-groups-datalist">
              {groups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
          )}
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            填写后本次导入的代理将归入该分组，可按分组筛选
          </p>
        </FormItem>
        {importMode === 'clash' && (
          <FormItem label="名称前缀（可选）">
            <Input
              value={importNamePrefix}
              onChange={(event) => onImportNamePrefixChange(event.target.value)}
              placeholder="例如：HK、US、机场A"
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              填写后代理名称将变为 <code className="px-1 bg-[var(--color-bg-secondary)] rounded">前缀-原名称</code>，留空则保持原名
            </p>
          </FormItem>
        )}
        {importMode === 'clash' && (
          <FormItem label="批量 DNS 配置（可选）">
            <Textarea
              value={importDnsServers}
              onChange={(event) => onImportDnsServersChange(event.target.value)}
              rows={5}
              placeholder={`dns:\n  enable: true\n  nameserver:\n    - 119.29.29.29\n    - 223.5.5.5`}
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              留空则不配置 DNS，填写后将应用到本次导入的所有代理
            </p>
          </FormItem>
        )}
      </div>
    </Modal>
  )
}

interface ProxyPoolPreviewModalProps {
  open: boolean
  importMode: ProxyImportMode
  importDnsServers: string
  previewList: ProxyDisplayInfo[]
  removedPreviewProxyNames: string[]
  importing: boolean
  onClose: () => void
  onBack: () => void
  onConfirm: () => void
  onRemoveProxy: (proxyId: string) => void
}

export function ProxyPoolPreviewModal({
  open,
  importMode,
  importDnsServers,
  previewList,
  removedPreviewProxyNames,
  importing,
  onClose,
  onBack,
  onConfirm,
  onRemoveProxy,
}: ProxyPoolPreviewModalProps) {
  const previewColumns: TableColumn<ProxyDisplayInfo>[] = [
    { key: 'proxyName', title: '代理名称', width: '200px' },
    { key: 'type', title: '类型', width: '100px' },
    { key: 'server', title: '服务器', width: '200px' },
    { key: 'port', title: '端口', width: '100px', render: (value) => value || '-' },
    {
      key: 'actions',
      title: '操作',
      width: '96px',
      render: (_, record) => (
        <Button size="sm" variant="danger" onClick={() => onRemoveProxy(record.proxyId)}>
          删除
        </Button>
      ),
    },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="确认导入以下代理"
      width="700px"
      footer={
        <>
          <Button variant="secondary" onClick={onBack}>
            返回修改
          </Button>
          <Button onClick={onConfirm} loading={importing} disabled={previewList.length === 0}>
            确认导入
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {importMode === 'clash' && importDnsServers.trim() && (
          <p className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)] px-3 py-2 rounded">
            已配置批量 DNS，将应用到以下所有代理
          </p>
        )}
        <p className="text-xs text-[var(--color-text-muted)]">
          保留 {previewList.length} 条，删除 {removedPreviewProxyNames.length} 条。删除项不会进入后续比较环节。
        </p>
        <Table columns={previewColumns} data={previewList} rowKey="proxyId" maxHeight="380px" emptyText="无代理数据" />
      </div>
    </Modal>
  )
}

interface ProxyPoolEditModalProps {
  open: boolean
  saving: boolean
  groups: string[]
  editForm: ProxyEditFormValue
  onClose: () => void
  onSave: () => void
  onChange: (patch: Partial<ProxyEditFormValue>) => void
}

export function ProxyPoolEditModal({
  open,
  saving,
  groups,
  editForm,
  onClose,
  onSave,
  onChange,
}: ProxyPoolEditModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="编辑代理"
      width="500px"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onSave} loading={saving}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormItem label="代理名称" required>
          <Input
            value={editForm.proxyName}
            onChange={(event) => onChange({ proxyName: event.target.value })}
            placeholder="例如：香港节点"
          />
        </FormItem>
        <FormItem label="分组名称（可选）">
          <Input
            value={editForm.groupName}
            onChange={(event) => onChange({ groupName: event.target.value })}
            placeholder="例如：香港、美国"
            list="edit-proxy-groups-datalist"
          />
          <datalist id="edit-proxy-groups-datalist">
            {groups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </FormItem>
        <FormItem label="代理配置">
          <Textarea
            value={editForm.proxyConfig}
            onChange={(event) => onChange({ proxyConfig: event.target.value })}
            rows={10}
            placeholder="支持 Clash YAML、http://、https://、socks5:// 代理配置"
          />
        </FormItem>
        <FormItem label="DNS 服务器（可选）">
          <Textarea
            value={editForm.dnsServers}
            onChange={(event) => onChange({ dnsServers: event.target.value })}
            rows={6}
            placeholder={`dns:\n  enable: true\n  nameserver:\n    - 119.29.29.29\n    - 223.5.5.5`}
          />
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            支持 Clash dns: YAML 格式，主要用于 Clash / 桥接代理；直连 HTTP/SOCKS5 通常不会使用这里的 DNS 配置
          </p>
        </FormItem>
      </div>
    </Modal>
  )
}

interface ProxyPoolIPHealthDetailModalProps {
  open: boolean
  detail: ProxyIPHealthResult | null
  onClose: () => void
}

export function ProxyPoolIPHealthDetailModal({
  open,
  detail,
  onClose,
}: ProxyPoolIPHealthDetailModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="IP健康原始返回"
      width="760px"
      footer={
        <Button variant="secondary" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="space-y-3">
        {detail && (
          <>
            <div className="text-xs text-[var(--color-text-muted)]">
              代理ID：{detail.proxyId} | 来源：{detail.source} | 时间：{detail.updatedAt}
            </div>
            {!detail.ok && <div className="text-sm text-red-500">{detail.error || '检测失败'}</div>}
            <pre className="max-h-[420px] overflow-auto text-xs leading-5 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-3">
              {JSON.stringify(detail.rawData || {}, null, 2)}
            </pre>
          </>
        )}
      </div>
    </Modal>
  )
}
