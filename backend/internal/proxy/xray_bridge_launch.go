package proxy

import (
	"ant-chrome/backend/internal/config"
	"ant-chrome/backend/internal/logger"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func (m *XrayManager) ensureBridge(proxyConfig string, proxies []config.BrowserProxy, proxyId string, pin bool) (string, string, error) {
	log := logger.New("Xray")
	src := strings.TrimSpace(proxyConfig)
	dnsServers := ""
	if proxyId != "" {
		for _, item := range proxies {
			if strings.EqualFold(item.ProxyId, proxyId) {
				src = strings.TrimSpace(item.ProxyConfig)
				dnsServers = item.DnsServers
				break
			}
		}
	}
	if src == "" {
		return "", "", fmt.Errorf("未找到代理节点")
	}
	src = normalizeNodeScheme(src)
	standardProxy, outbound, err := ParseProxyNode(src)
	if err != nil {
		log.Error("节点解析失败", logger.F("error", err))
		return "", "", err
	}
	if standardProxy != "" {
		return standardProxy, "", nil
	}
	if outbound == nil {
		return "", "", fmt.Errorf("节点解析失败")
	}
	key := computeNodeKey(src + "\x00" + dnsServers)

	if socksURL, reused := m.tryReuseBridge(key, pin); reused {
		log.Info("复用桥接进程", logger.F("key", key), logger.F("socks_url", socksURL))
		return socksURL, key, nil
	}

	binaryPath, err := m.resolveBinary()
	if err != nil {
		log.Error("xray 不可用", logger.F("error", err))
		return "", "", err
	}

	const maxLaunchRetries = 3
	var lastErr error
	for attempt := 1; attempt <= maxLaunchRetries; attempt++ {
		socksURL, bridge, err := m.launchBridgeAttempt(log, key, binaryPath, outbound, dnsServers, pin, attempt)
		if err == nil {
			return socksURL, key, nil
		}
		if bridge != nil && bridge.Running {
			go m.watchBridge(bridge, key)
		}
		lastErr = err
	}
	return "", "", fmt.Errorf("xray 启动失败（已重试 %d 次）: %w", maxLaunchRetries, lastErr)
}

func (m *XrayManager) launchBridgeAttempt(log *logger.Logger, key string, binaryPath string, outbound map[string]interface{}, dnsServers string, pin bool, attempt int) (string, *XrayBridge, error) {
	port, err := nextAvailablePort()
	if err != nil {
		log.Error("端口分配失败", logger.F("error", err), logger.F("attempt", attempt))
		return "", nil, err
	}
	cfgPath, err := m.buildRuntimeConfig(key, outbound, port, dnsServers)
	if err != nil {
		log.Error("xray 配置生成失败", logger.F("error", err))
		return "", nil, err
	}
	cmd := exec.Command(binaryPath, "run", "-c", cfgPath)
	hideWindow(cmd)
	cmd.Dir = filepath.Dir(cfgPath)

	stderrPath := filepath.Join(filepath.Dir(cfgPath), "xray-stderr.log")
	stderrFile, _ := os.Create(stderrPath)
	if stderrFile != nil {
		cmd.Stderr = stderrFile
	}

	if err := cmd.Start(); err != nil {
		if stderrFile != nil {
			stderrFile.Close()
		}
		log.Error("xray 启动失败", logger.F("error", err), logger.F("attempt", attempt))
		return "", nil, err
	}

	bridge := &XrayBridge{
		NodeKey:    key,
		Port:       port,
		Cmd:        cmd,
		Pid:        cmd.Process.Pid,
		Running:    true,
		RefCount:   0,
		LastUsedAt: time.Now(),
	}
	log.Info("xray 启动", logger.F("key", key), logger.F("pid", bridge.Pid), logger.F("port", bridge.Port), logger.F("attempt", attempt))

	if err := m.waitBridgeReady(log, bridge, cfgPath, stderrPath, stderrFile, attempt); err != nil {
		return "", nil, err
	}

	if socksURL, reused := m.registerBridge(key, bridge, pin); reused {
		log.Info("复用已就绪桥接进程", logger.F("key", key), logger.F("socks_url", socksURL))
		bridge.Stopping = true
		m.stopBridgeProcess(bridge)
		return socksURL, nil, nil
	}

	return fmt.Sprintf("socks5://127.0.0.1:%d", port), bridge, nil
}

func (m *XrayManager) waitBridgeReady(log *logger.Logger, bridge *XrayBridge, cfgPath string, stderrPath string, stderrFile *os.File, attempt int) error {
	if err := waitPortReady("127.0.0.1", bridge.Port, 10*time.Second); err != nil {
		if stderrFile != nil {
			stderrFile.Close()
		}
		m.logBridgeStartupError(log, cfgPath, stderrPath)
		bridge.Stopping = true
		m.stopBridgeProcess(bridge)
		bridge.Running = false
		bridge.Pid = 0
		bridge.LastError = err.Error()
		log.Error("xray 端口不可用，重试", logger.F("key", bridge.NodeKey), logger.F("error", err), logger.F("port", bridge.Port), logger.F("attempt", attempt))
		time.Sleep(200 * time.Millisecond)
		return err
	}
	if stderrFile != nil {
		stderrFile.Close()
	}
	return nil
}

func (m *XrayManager) logBridgeStartupError(log *logger.Logger, cfgPath string, stderrPath string) {
	if stderrContent, readErr := os.ReadFile(stderrPath); readErr == nil && len(stderrContent) > 0 {
		log.Error("xray stderr", logger.F("output", string(stderrContent)))
		return
	}

	errLogPath := filepath.Join(filepath.Dir(cfgPath), "xray-error.log")
	if errContent, readErr := os.ReadFile(errLogPath); readErr == nil && len(errContent) > 0 {
		log.Error("xray error.log", logger.F("output", string(errContent)))
	}
}
