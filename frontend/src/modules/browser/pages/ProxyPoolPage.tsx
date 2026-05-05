import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmModal, toast } from '../../../shared/components'
import type { SortOrder } from '../../../shared/components/Table'
import type { BrowserProxy, ProxyIPHealthResult } from '../types'
import { fetchBrowserProxies, fetchBrowserProxyGroups, saveBrowserProxies, browserProxyTestSpeed, browserProxyBatchTestSpeed, browserProxyCheckIPHealth, browserProxyBatchCheckIPHealth, fetchClashImportFromURL } from '../api'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import {
  BUILTIN_PROXY_IDS,
  INITIAL_DIRECT_IMPORT_FORM,
  buildDirectImportCandidate,
  buildImportCandidatesFromClash,
  buildImportPreview,
  buildRefreshedSourceProxies,
  collectURLImportSources,
  createExistingProxyIDPicker,
  ensureBuiltinProxies,
  normalizeRefreshIntervalM,
  parseClashImportText,
  parseTimestampMs,
  nextProxyID,
  resolveImportSourceID,
  toDisplayList,
  type DirectImportForm,
  type ProxyDisplayInfo,
  type ProxyImportMode,
  type URLImportSourceMeta,
} from './proxyPool/helpers'
import {
  appendSourceIgnoredProxyNames,
  applyIgnoredProxyNamesForSource,
  readGlobalRefreshConfig,
  readIPHealthCache,
  readLatencyCache,
  readSourceIgnoredProxyNames,
  toLatencyValue,
  writeGlobalRefreshConfig,
  writeIPHealthCache,
  writeLatencyCache,
} from './proxyPool/storage'
import {
  ProxyPoolEditModal,
  ProxyPoolIPHealthDetailModal,
  ProxyPoolImportModal,
  ProxyPoolPreviewModal,
  type ProxyEditFormValue,
} from './proxyPool/ProxyPoolModals'
import { ProxyPoolHeader } from './proxyPool/ProxyPoolHeader'
import { ProxyPoolTableCard } from './proxyPool/ProxyPoolTableCard'

export function ProxyPoolPage() {
  const [proxies, setProxies] = useState<BrowserProxy[]>([])
  const [displayList, setDisplayList] = useState<ProxyDisplayInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<string[]>([])

  const [filterProtocol, setFilterProtocol] = useState<string>('all')
  const [filterKeyword, setFilterKeyword] = useState('')
  const [filterGroup, setFilterGroup] = useState<string>('all')
  const [sortColumn, setSortColumn] = useState<string>('') // 默认不排序
  const [sortOrder, setSortOrder] = useState<SortOrder>(undefined)

  const [latencyMap, setLatencyMap] = useState<Record<string, number>>({})
  const [testingAll, setTestingAll] = useState(false)
  const [ipHealthMap, setIPHealthMap] = useState<Record<string, ProxyIPHealthResult>>({})
  const [checkingIPHealthIds, setCheckingIPHealthIds] = useState<Set<string>>(new Set())
  const [checkingAllIPHealth, setCheckingAllIPHealth] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false)

  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importMode, setImportMode] = useState<ProxyImportMode>('clash')
  const [importUrl, setImportUrl] = useState('')
  const [importResolvedUrl, setImportResolvedUrl] = useState('')
  const [importText, setImportText] = useState('')
  const [importDnsServers, setImportDnsServers] = useState('')
  const [importNamePrefix, setImportNamePrefix] = useState('')
  const [importGroupName, setImportGroupName] = useState('')
  const [directImportForm, setDirectImportForm] = useState<DirectImportForm>(() => ({ ...INITIAL_DIRECT_IMPORT_FORM }))
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewList, setPreviewList] = useState<ProxyDisplayInfo[]>([])
  const [removedPreviewProxyNames, setRemovedPreviewProxyNames] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [fetchingImportUrl, setFetchingImportUrl] = useState(false)
  const [refreshingAllSources, setRefreshingAllSources] = useState(false)
  const [refreshingSourceIds, setRefreshingSourceIds] = useState<Set<string>>(new Set())
  const [globalAutoRefreshEnabled, setGlobalAutoRefreshEnabled] = useState(false)
  const [globalRefreshIntervalM, setGlobalRefreshIntervalM] = useState('60')

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingProxy, setEditingProxy] = useState<BrowserProxy | null>(null)
  const [editForm, setEditForm] = useState<ProxyEditFormValue>({
    proxyName: '',
    proxyConfig: '',
    dnsServers: '',
    groupName: '',
  })
  const [saving, setSaving] = useState(false)

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [ipHealthDetailOpen, setIPHealthDetailOpen] = useState(false)
  const [currentIPHealthDetail, setCurrentIPHealthDetail] = useState<ProxyIPHealthResult | null>(null)
  const proxiesRef = useRef<BrowserProxy[]>([])
  const refreshingSourceIdsRef = useRef<Set<string>>(new Set())
  const autoRefreshRunningRef = useRef(false)
  const globalRefreshInterval = useMemo(() => {
    const interval = normalizeRefreshIntervalM(Number(globalRefreshIntervalM || 0))
    return interval > 0 ? interval : 60
  }, [globalRefreshIntervalM])

  useEffect(() => {
    const cfg = readGlobalRefreshConfig()
    setGlobalAutoRefreshEnabled(cfg.enabled)
    setGlobalRefreshIntervalM(String(cfg.intervalM))
    setLatencyMap(readLatencyCache())
    setIPHealthMap(readIPHealthCache())
    loadProxies()
  }, [])

  useEffect(() => {
    writeLatencyCache(latencyMap)
  }, [latencyMap])

  useEffect(() => {
    writeIPHealthCache(ipHealthMap)
  }, [ipHealthMap])

  useEffect(() => {
    writeGlobalRefreshConfig(globalAutoRefreshEnabled, globalRefreshInterval)
  }, [globalAutoRefreshEnabled, globalRefreshInterval])

  useEffect(() => {
    proxiesRef.current = proxies
  }, [proxies])

  useEffect(() => {
    refreshingSourceIdsRef.current = refreshingSourceIds
  }, [refreshingSourceIds])

  useEffect(() => {
    if (!proxies.length) return
    const validIds = new Set(proxies.map(p => p.proxyId))
    setLatencyMap(prev => {
      let changed = false
      const next: Record<string, number> = {}
      Object.entries(prev).forEach(([proxyId, latency]) => {
        if (validIds.has(proxyId)) {
          next[proxyId] = latency
        } else {
          changed = true
        }
      })
      return changed ? next : prev
    })

    setIPHealthMap(prev => {
      let changed = false
      const next: Record<string, ProxyIPHealthResult> = {}
      Object.entries(prev).forEach(([proxyId, health]) => {
        if (validIds.has(proxyId)) {
          next[proxyId] = health
        } else {
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [proxies])

  const loadProxies = async () => {
    setLoading(true)
    try {
      const raw = await fetchBrowserProxies()
      const proxyList = ensureBuiltinProxies(raw)
      const persistedLatency: Record<string, number> = {}
      const persistedIPHealth: Record<string, ProxyIPHealthResult> = {}
      proxyList.forEach(proxy => {
        if (proxy.lastTestedAt) {
          persistedLatency[proxy.proxyId] = (proxy.lastTestOk ?? false)
            ? (proxy.lastLatencyMs ?? -2)
            : -2
        }
        if (proxy.lastIPHealthJson) {
          try {
            const parsed = JSON.parse(proxy.lastIPHealthJson) as ProxyIPHealthResult
            if (parsed && typeof parsed === 'object' && parsed.proxyId) {
              persistedIPHealth[proxy.proxyId] = parsed
            }
          } catch {
            // ignore bad historical json
          }
        }
      })

      setProxies(proxyList)
      setDisplayList(toDisplayList(proxyList))
      setLatencyMap(prev => ({ ...persistedLatency, ...prev }))
      setIPHealthMap(prev => ({ ...persistedIPHealth, ...prev }))
      const grps = await fetchBrowserProxyGroups()
      setGroups(grps)
    } finally {
      setLoading(false)
    }
  }

  // 直接保存完整列表，内置代理保护由后端负责
  const saveProxies = useCallback(async (list: BrowserProxy[]) => {
    await saveBrowserProxies(list)
    setProxies(list)
    setDisplayList(toDisplayList(list))
    // 刷新分组列表（可能有新分组加入）
    const grps = await fetchBrowserProxyGroups()
    setGroups(grps)
  }, [])

  const sourceMetas = useMemo(() => collectURLImportSources(proxies), [proxies])
  const hasURLImportSources = sourceMetas.length > 0

  const refreshSingleSource = useCallback(async (sourceId: string, silent: boolean) => {
    const currentList = proxiesRef.current
    const metas = collectURLImportSources(currentList)
    const meta = metas.find(item => item.sourceId === sourceId)
    if (!meta) return false

    if (refreshingSourceIdsRef.current.has(sourceId)) return false
    setRefreshingSourceIds(prev => {
      const next = new Set(prev)
      next.add(sourceId)
      return next
    })

    try {
      const result = await fetchClashImportFromURL(meta.sourceUrl)
      const parsed = parseClashImportText(result.content || '')
      if (!parsed.length) {
        throw new Error('订阅内容未解析到可用代理')
      }
      const ignoredNameMap = readSourceIgnoredProxyNames()
      const sourceIgnoredNames = ignoredNameMap[sourceId] || []
      const filteredParsed = applyIgnoredProxyNamesForSource(parsed, meta.sourceNamePrefix, sourceIgnoredNames)

      const latest = proxiesRef.current
      const oldSourceProxies = latest.filter(item => (item.sourceId || '').trim() === sourceId)
      const refreshedAt = new Date().toISOString()
      const effectiveMeta: URLImportSourceMeta = {
        ...meta,
        sourceAutoRefresh: globalAutoRefreshEnabled,
        sourceRefreshIntervalM: globalRefreshInterval,
      }
      const refreshedSourceProxies = buildRefreshedSourceProxies(filteredParsed, oldSourceProxies, effectiveMeta, refreshedAt)

      const merged = latest
        .filter(item => (item.sourceId || '').trim() !== sourceId)
        .concat(refreshedSourceProxies)

      await saveProxies(merged)
      if (!silent) {
        toast.success(`订阅刷新成功：${meta.sourceUrl}（${refreshedSourceProxies.length} 条）`)
      }
      return true
    } catch (error: any) {
      if (!silent) {
        toast.error(error?.message || '订阅刷新失败')
      }
      return false
    } finally {
      setRefreshingSourceIds(prev => {
        const next = new Set(prev)
        next.delete(sourceId)
        return next
      })
    }
  }, [globalAutoRefreshEnabled, globalRefreshInterval, saveProxies])

  const handleRefreshAllSources = useCallback(async (silent = false) => {
    const metas = collectURLImportSources(proxiesRef.current)
    if (metas.length === 0) {
      if (!silent) {
        toast.info('当前没有 URL 导入订阅')
      }
      return
    }

    setRefreshingAllSources(true)
    let successCount = 0
    for (const meta of metas) {
      // 串行刷新，避免并发保存导致覆盖
      // eslint-disable-next-line no-await-in-loop
      const ok = await refreshSingleSource(meta.sourceId, true)
      if (ok) successCount += 1
    }
    setRefreshingAllSources(false)

    if (!silent) {
      if (successCount === metas.length) {
        toast.success(`订阅刷新完成：${successCount}/${metas.length}`)
      } else {
        toast.warning(`订阅刷新完成：成功 ${successCount}/${metas.length}`)
      }
    }
  }, [refreshSingleSource])

  useEffect(() => {
    const runAutoRefresh = async () => {
      if (autoRefreshRunningRef.current || refreshingAllSources) {
        return
      }
      if (!globalAutoRefreshEnabled) {
        return
      }
      const intervalMs = globalRefreshInterval * 60 * 1000
      const metas = collectURLImportSources(proxiesRef.current).filter(meta => {
        if (!meta.sourceUrl.trim()) return false
        const last = parseTimestampMs(meta.sourceLastRefreshAt)
        return last <= 0 || Date.now() - last >= intervalMs
      })
      if (metas.length === 0) {
        return
      }

      autoRefreshRunningRef.current = true
      try {
        for (const meta of metas) {
          // eslint-disable-next-line no-await-in-loop
          await refreshSingleSource(meta.sourceId, true)
        }
      } finally {
        autoRefreshRunningRef.current = false
      }
    }

    void runAutoRefresh()
    const timer = window.setInterval(() => {
      void runAutoRefresh()
    }, 60 * 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [globalAutoRefreshEnabled, globalRefreshInterval, refreshingAllSources, refreshSingleSource])

  const protocolOptions = useMemo(
    () => ['all', ...Array.from(new Set(displayList.map(p => p.type).filter(t => t !== '-')))],
    [displayList]
  )

  const getLatencySortTuple = (proxyId: string): [number, number] => {
    const v = latencyMap[proxyId]
    if (v === undefined) return [4, Number.MAX_SAFE_INTEGER]
    if (v === -1) return [1, Number.MAX_SAFE_INTEGER] // 测试中
    if (v === -2) return [2, Number.MAX_SAFE_INTEGER] // 超时
    if (v === -3) return [3, Number.MAX_SAFE_INTEGER] // 不支持
    return [0, v] // 正常延迟
  }

  const compareText = (a: string, b: string) => a.localeCompare(b, 'zh-CN')

  const compareByColumn = (a: ProxyDisplayInfo, b: ProxyDisplayInfo, column: string) => {
    switch (column) {
      case 'proxyName':
        return compareText(a.proxyName || '', b.proxyName || '')
      case 'groupName':
        return compareText(a.groupName || '', b.groupName || '')
      case 'type':
        return compareText(a.type || '', b.type || '')
      case 'server':
        return compareText(a.server || '', b.server || '')
      case 'port':
        return (a.port || 0) - (b.port || 0)
      case 'latency': {
        const [rankA, valA] = getLatencySortTuple(a.proxyId)
        const [rankB, valB] = getLatencySortTuple(b.proxyId)
        if (rankA !== rankB) return rankA - rankB
        if (valA !== valB) return valA - valB
        return compareText(a.proxyName || '', b.proxyName || '')
      }
      default:
        return 0
    }
  }

  const filteredList = useMemo(() => {
    const filtered = displayList.filter(p => {
      const matchProtocol = filterProtocol === 'all' || p.type === filterProtocol
      const matchKeyword = !filterKeyword || p.proxyName.toLowerCase().includes(filterKeyword.toLowerCase()) || p.server.toLowerCase().includes(filterKeyword.toLowerCase())
      const matchGroup = filterGroup === 'all' || p.groupName === filterGroup
      return matchProtocol && matchKeyword && matchGroup
    })

    if (!sortColumn || !sortOrder) return filtered

    return [...filtered].sort((a, b) => {
      const cmp = compareByColumn(a, b, sortColumn)
      return sortOrder === 'asc' ? cmp : -cmp
    })
  }, [displayList, filterProtocol, filterKeyword, filterGroup, sortColumn, sortOrder, latencyMap])

  const allFilteredSelected = filteredList.length > 0 && filteredList.every(p => selectedIds.has(p.proxyId))
  const someFilteredSelected = filteredList.some(p => selectedIds.has(p.proxyId))

  const handleToggleAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredList.forEach(p => next.delete(p.proxyId))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredList.filter(p => !BUILTIN_PROXY_IDS.has(p.proxyId)).forEach(p => next.add(p.proxyId))
        return next
      })
    }
  }

  const handleToggleOne = (proxyId: string) => {
    if (BUILTIN_PROXY_IDS.has(proxyId)) return
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(proxyId) ? next.delete(proxyId) : next.add(proxyId)
      return next
    })
  }

  const handleBatchDeleteConfirm = async () => {
    try {
      const newProxies = proxies.filter(p => !selectedIds.has(p.proxyId))
      await saveProxies(newProxies)
      toast.success(`已删除 ${selectedIds.size} 个代理`)
      setSelectedIds(new Set())
    } catch (error: any) {
      toast.error(error?.message || '删除失败')
    }
  }

  const handleTestOne = async (record: ProxyDisplayInfo) => {
    if (record.proxyConfig === 'direct://') {
      toast.info('直连模式无需测速')
      return
    }
    setLatencyMap(prev => ({ ...prev, [record.proxyId]: -1 }))
    const result = await browserProxyTestSpeed(record.proxyId)
    const val = toLatencyValue(result.ok, result.latencyMs, result.error)
    setLatencyMap(prev => ({ ...prev, [record.proxyId]: val }))
  }

  const handleTestAll = async () => {
    const testable = filteredList.filter(p => p.proxyConfig !== 'direct://')
    if (testable.length === 0) return
    setTestingAll(true)
    const init: Record<string, number> = {}
    testable.forEach(p => { init[p.proxyId] = -1 })
    setLatencyMap(prev => ({ ...prev, ...init }))

    // 监听后端实时推送的单个测速结果
    const off = EventsOn('proxy:speed:result', (data: { proxyId: string; ok: boolean; latencyMs: number; error: string }) => {
      const val = toLatencyValue(data.ok, data.latencyMs, data.error)
      setLatencyMap(prev => ({ ...prev, [data.proxyId]: val }))
    })

    try {
      const proxyIds = testable.map(p => p.proxyId)
      const results = await browserProxyBatchTestSpeed(proxyIds, 20)
      setLatencyMap(prev => {
        const next = { ...prev }
        results.forEach(result => {
          next[result.proxyId] = toLatencyValue(result.ok, result.latencyMs, result.error)
        })
        return next
      })
    } finally {
      off()
      setTestingAll(false)
    }
  }

  const handleCheckOneIPHealth = async (record: ProxyDisplayInfo) => {
    if (record.proxyConfig === 'direct://') {
      toast.info('直连模式无需检测')
      return
    }
    if (checkingIPHealthIds.has(record.proxyId)) return

    setCheckingIPHealthIds(prev => new Set(prev).add(record.proxyId))
    try {
      const result = await browserProxyCheckIPHealth(record.proxyId)
      setIPHealthMap(prev => ({ ...prev, [record.proxyId]: result }))
      if (!result.ok) {
        toast.error(result.error || `${record.proxyName} 检测失败`)
      }
    } finally {
      setCheckingIPHealthIds(prev => {
        const next = new Set(prev)
        next.delete(record.proxyId)
        return next
      })
    }
  }

  const handleCheckAllIPHealth = async () => {
    const testable = filteredList.filter(p => p.proxyConfig !== 'direct://')
    if (testable.length === 0) return
    setCheckingAllIPHealth(true)

    const ids = testable.map(p => p.proxyId)
    const idSet = new Set(ids)
    setCheckingIPHealthIds(prev => new Set([...Array.from(prev), ...ids]))

    const off = EventsOn('proxy:iphealth:result', (data: ProxyIPHealthResult) => {
      if (!data?.proxyId || !idSet.has(data.proxyId)) return
      setIPHealthMap(prev => ({ ...prev, [data.proxyId]: data }))
      setCheckingIPHealthIds(prev => {
        const next = new Set(prev)
        next.delete(data.proxyId)
        return next
      })
    })

    try {
      const results = await browserProxyBatchCheckIPHealth(ids, 10)
      setIPHealthMap(prev => {
        const next = { ...prev }
        results.forEach(result => {
          if (result?.proxyId && idSet.has(result.proxyId)) {
            next[result.proxyId] = result
          }
        })
        return next
      })
      const failed = results.filter(r => !r.ok).length
      if (failed > 0) {
        toast.info(`IP 健康检测完成：成功 ${results.length - failed}，失败 ${failed}`)
      } else {
        toast.success(`IP 健康检测完成：共 ${results.length} 条`)
      }
    } finally {
      off()
      setCheckingIPHealthIds(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
      setCheckingAllIPHealth(false)
    }
  }

  const openIPHealthDetail = (proxyId: string) => {
    const result = ipHealthMap[proxyId]
    if (!result) return
    setCurrentIPHealthDetail(result)
    setIPHealthDetailOpen(true)
  }

  const handleRemovePreviewProxy = (proxyId: string) => {
    const target = previewList.find(item => item.proxyId === proxyId)
    if (!target) return
    setPreviewList(prev => prev.filter(item => item.proxyId !== proxyId))
    setRemovedPreviewProxyNames(prev => [...prev, target.proxyName])
  }

  const handleEdit = (record: ProxyDisplayInfo) => {
    const proxy = proxies.find(p => p.proxyId === record.proxyId)
    if (proxy) {
      setEditingProxy(proxy)
      setEditForm({ proxyName: proxy.proxyName, proxyConfig: proxy.proxyConfig, dnsServers: proxy.dnsServers || '', groupName: proxy.groupName || '' })
      setEditModalOpen(true)
    }
  }

  const handleSaveProxy = async () => {
    if (!editForm.proxyName.trim()) { toast.error('请输入代理名称'); return }
    if (!editingProxy) return
    setSaving(true)
    try {
      const newProxies = proxies.map(p =>
        p.proxyId === editingProxy.proxyId
          ? { ...p, proxyName: editForm.proxyName, proxyConfig: editForm.proxyConfig, dnsServers: editForm.dnsServers, groupName: editForm.groupName }
          : p
      )
      await saveProxies(newProxies)
      setEditModalOpen(false)
      toast.success('代理已更新')
    } catch (error: any) {
      toast.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteClick = (proxyId: string) => {
    setDeletingId(proxyId)
    setDeleteConfirmOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!deletingId) return
    try {
      const newProxies = proxies.filter(p => p.proxyId !== deletingId)
      await saveProxies(newProxies)
      setSelectedIds(prev => { const next = new Set(prev); next.delete(deletingId); return next })
      toast.success('代理已删除')
    } catch (error: any) {
      toast.error(error?.message || '删除失败')
    }
    setDeletingId(null)
  }

  const handleImportModeChange = (nextMode: ProxyImportMode) => {
    setImportMode(nextMode)
    setImportResolvedUrl('')
    if (nextMode !== 'clash') {
      setImportUrl('')
      setImportDnsServers('')
    }
  }

  const handleImportUrlChange = (nextValue: string) => {
    setImportUrl(nextValue)
    if (importResolvedUrl.trim() && nextValue.trim() !== importResolvedUrl.trim()) {
      setImportResolvedUrl('')
    }
  }

  const handleFetchImportURL = async () => {
    const targetURL = importUrl.trim()
    if (!targetURL) {
      toast.error('请输入订阅 URL')
      return
    }

    setFetchingImportUrl(true)
    try {
      const result = await fetchClashImportFromURL(targetURL)
      const content = (result?.content || '').trim()
      if (!content) {
        throw new Error('订阅内容为空')
      }

      setImportResolvedUrl((result?.url || targetURL).trim())
      setImportText(content)

      if (!importDnsServers.trim() && typeof result?.dnsServers === 'string' && result.dnsServers.trim()) {
        setImportDnsServers(result.dnsServers.trim())
      }
      if (!importGroupName.trim() && typeof result?.suggestedGroup === 'string' && result.suggestedGroup.trim()) {
        setImportGroupName(result.suggestedGroup.trim())
      }

      toast.success(`URL 获取成功，检测到 ${Math.max(0, Number(result?.proxyCount || 0))} 个代理`)
    } catch (error: any) {
      setImportResolvedUrl('')
      toast.error(error?.message || 'URL 获取失败')
    } finally {
      setFetchingImportUrl(false)
    }
  }

  const handleParseImport = () => {
    try {
      const prefix = importNamePrefix.trim()
      const candidates = importMode === 'clash'
        ? buildImportCandidatesFromClash(parseClashImportText(importText), prefix)
        : [buildDirectImportCandidate(directImportForm)]
      if (!candidates.length) {
        toast.error('未解析到可导入代理')
        return
      }
      const preview = buildImportPreview(candidates, importGroupName.trim())
      setRemovedPreviewProxyNames([])
      setPreviewList(preview)
      setImportModalOpen(false)
      setPreviewModalOpen(true)
    } catch (error: any) {
      toast.error(`解析失败: ${error?.message || '未知错误'}`)
    }
  }

  const handleConfirmImport = async () => {
    if (previewList.length === 0) {
      toast.error('请至少保留 1 个代理后再导入')
      return
    }
    setImporting(true)
    try {
      const sourceURL = importMode === 'clash' ? importResolvedUrl.trim() : ''
      const isURLImport = !!sourceURL
      const sourceNamePrefix = importMode === 'clash' ? importNamePrefix.trim() : ''
      const sourceID = isURLImport ? resolveImportSourceID(proxies, sourceURL, sourceNamePrefix) : ''
      const sourceAutoRefresh = isURLImport ? globalAutoRefreshEnabled : false
      const sourceRefreshIntervalM = sourceAutoRefresh ? globalRefreshInterval : 0
      const sourceLastRefreshAt = isURLImport ? new Date().toISOString() : ''
      const oldSourceProxies = isURLImport
        ? proxies.filter(item => (item.sourceId || '').trim() === sourceID)
        : []
      const pickExistingID = createExistingProxyIDPicker(oldSourceProxies)

      const newProxies: BrowserProxy[] = previewList.map((p) => ({
        proxyId: pickExistingID(p.proxyName, p.proxyConfig) || nextProxyID(),
        proxyName: p.proxyName,
        proxyConfig: p.proxyConfig,
        dnsServers: importMode === 'clash' ? importDnsServers.trim() || undefined : undefined,
        groupName: importGroupName.trim() || undefined,
        sourceId: sourceID || undefined,
        sourceUrl: sourceURL || undefined,
        sourceNamePrefix: sourceNamePrefix || undefined,
        sourceAutoRefresh,
        sourceRefreshIntervalM,
        sourceLastRefreshAt: sourceLastRefreshAt || undefined,
      }))
      const allProxies = isURLImport
        ? proxies.filter(item => (item.sourceId || '').trim() !== sourceID).concat(newProxies)
        : [...proxies, ...newProxies]
      await saveProxies(allProxies)
      if (isURLImport && removedPreviewProxyNames.length > 0) {
        appendSourceIgnoredProxyNames(sourceID, removedPreviewProxyNames)
      }
      setPreviewModalOpen(false)
      setImportUrl('')
      setImportResolvedUrl('')
      setImportText('')
      setImportDnsServers('')
      setImportNamePrefix('')
      setImportGroupName('')
      setDirectImportForm({ ...INITIAL_DIRECT_IMPORT_FORM })
      setPreviewList([])
      setRemovedPreviewProxyNames([])
      toast.success(`成功导入 ${newProxies.length} 个代理`)
    } catch (error: any) {
      toast.error(error?.message || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const selectedCount = selectedIds.size
  const canParseImport = importMode === 'clash'
    ? !!importText.trim()
    : !!directImportForm.server.trim() && !!directImportForm.port.trim()

  return (
    <div className="space-y-5 animate-fade-in">
      <ProxyPoolHeader
        checkingAllIPHealth={checkingAllIPHealth}
        hasURLImportSources={hasURLImportSources}
        onCheckAllIPHealth={handleCheckAllIPHealth}
        onOpenImport={() => setImportModalOpen(true)}
        onRefreshAllSources={() => void handleRefreshAllSources(false)}
        onTestAll={() => void handleTestAll()}
        refreshingAllSources={refreshingAllSources}
        testingAll={testingAll}
        totalCount={filteredList.length}
      />

      <ProxyPoolTableCard
        allFilteredSelected={allFilteredSelected}
        checkingIPHealthIds={checkingIPHealthIds}
        data={filteredList}
        filterGroup={filterGroup}
        filterKeyword={filterKeyword}
        filterProtocol={filterProtocol}
        globalAutoRefreshEnabled={globalAutoRefreshEnabled}
        globalRefreshInterval={globalRefreshInterval}
        globalRefreshIntervalM={globalRefreshIntervalM}
        groups={groups}
        ipHealthMap={ipHealthMap}
        latencyMap={latencyMap}
        loading={loading}
        onCheckOneIPHealth={(record) => void handleCheckOneIPHealth(record)}
        onClearFilters={() => {
          setFilterProtocol('all')
          setFilterKeyword('')
          setFilterGroup('all')
        }}
        onDelete={handleDeleteClick}
        onEdit={handleEdit}
        onFilterGroupChange={setFilterGroup}
        onFilterKeywordChange={setFilterKeyword}
        onFilterProtocolChange={setFilterProtocol}
        onGlobalAutoRefreshEnabledChange={setGlobalAutoRefreshEnabled}
        onGlobalRefreshIntervalMChange={setGlobalRefreshIntervalM}
        onOpenBatchDelete={() => setBatchDeleteConfirmOpen(true)}
        onOpenIPHealthDetail={openIPHealthDetail}
        onRefreshSingleSource={(sourceId) => void refreshSingleSource(sourceId, false)}
        onSort={({ column, order }) => {
          setSortColumn(column)
          setSortOrder(order)
        }}
        onTestOne={(record) => void handleTestOne(record)}
        onToggleAll={handleToggleAll}
        onToggleOne={handleToggleOne}
        protocolOptions={protocolOptions}
        refreshingSourceIds={refreshingSourceIds}
        selectedCount={selectedCount}
        selectedIds={selectedIds}
        someFilteredSelected={someFilteredSelected}
        sortColumn={sortColumn}
        sortOrder={sortOrder}
      />

      <ProxyPoolImportModal
        open={importModalOpen}
        groups={groups}
        importMode={importMode}
        importUrl={importUrl}
        importResolvedUrl={importResolvedUrl}
        importText={importText}
        importDnsServers={importDnsServers}
        importNamePrefix={importNamePrefix}
        importGroupName={importGroupName}
        directImportForm={directImportForm}
        fetchingImportUrl={fetchingImportUrl}
        canParseImport={canParseImport}
        onClose={() => setImportModalOpen(false)}
        onParse={handleParseImport}
        onFetchImportUrl={handleFetchImportURL}
        onImportModeChange={handleImportModeChange}
        onImportUrlChange={handleImportUrlChange}
        onImportTextChange={setImportText}
        onImportDnsServersChange={setImportDnsServers}
        onImportNamePrefixChange={setImportNamePrefix}
        onImportGroupNameChange={setImportGroupName}
        onDirectImportFormChange={(patch) => setDirectImportForm((prev) => ({ ...prev, ...patch }))}
      />

      <ProxyPoolPreviewModal
        open={previewModalOpen}
        importMode={importMode}
        importDnsServers={importDnsServers}
        previewList={previewList}
        removedPreviewProxyNames={removedPreviewProxyNames}
        importing={importing}
        onClose={() => setPreviewModalOpen(false)}
        onBack={() => {
          setPreviewModalOpen(false)
          setImportModalOpen(true)
        }}
        onConfirm={handleConfirmImport}
        onRemoveProxy={handleRemovePreviewProxy}
      />

      <ProxyPoolEditModal
        open={editModalOpen}
        saving={saving}
        groups={groups}
        editForm={editForm}
        onClose={() => setEditModalOpen(false)}
        onSave={handleSaveProxy}
        onChange={(patch) => setEditForm((prev) => ({ ...prev, ...patch }))}
      />

      <ProxyPoolIPHealthDetailModal
        open={ipHealthDetailOpen}
        detail={currentIPHealthDetail}
        onClose={() => setIPHealthDetailOpen(false)}
      />

      <ConfirmModal open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} onConfirm={handleDeleteConfirm}
        title="确认删除" content="确定要删除这个代理吗？此操作不可恢复。" confirmText="删除" danger />

      <ConfirmModal open={batchDeleteConfirmOpen} onClose={() => setBatchDeleteConfirmOpen(false)} onConfirm={handleBatchDeleteConfirm}
        title="批量删除" content={`确定要删除选中的 ${selectedCount} 个代理吗？此操作不可恢复。`} confirmText="删除" danger />
    </div>
  )
}
