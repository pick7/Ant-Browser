package proxy

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"ant-chrome/backend/internal/config"
	xproxy "golang.org/x/net/proxy"
)

// TestConnectivity 通过 TCP 握手测试代理服务器的可达性和延迟
// 直接对 server:port 建立 TCP 连接测量 RTT，无需启动外部进程
func TestConnectivity(proxyId string, proxyConfig string, proxies []config.BrowserProxy, _ interface{}) TestResult {
	src := strings.TrimSpace(proxyConfig)
	if proxyId != "" {
		for _, item := range proxies {
			if strings.EqualFold(item.ProxyId, proxyId) {
				src = strings.TrimSpace(item.ProxyConfig)
				break
			}
		}
	}
	if src == "" {
		return TestResult{ProxyId: proxyId, Ok: false, Error: "代理配置为空"}
	}

	endpoint, err := proxyEndpoint(src)
	if err != nil {
		return TestResult{ProxyId: proxyId, Ok: false, Error: fmt.Sprintf("地址解析失败: %v", err)}
	}

	start := time.Now()
	conn, err := net.DialTimeout("tcp", endpoint, 10*time.Second)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		return TestResult{ProxyId: proxyId, Ok: false, LatencyMs: latency, Error: err.Error()}
	}
	conn.Close()
	return TestResult{ProxyId: proxyId, Ok: true, LatencyMs: latency}
}

// TestRealConnectivity 通过代理链路发起真实 HTTP 请求测量端到端延迟。
// - DirectProxy (http/https/socks5)：直接通过该代理发送请求
// - BridgeProxy (vmess/vless/Clash)：调用 EnsureBridge 获取 socks5 地址后发送请求
// - SingBoxProxy (hysteria2/tuic)：调用 SingBoxManager.EnsureBridge 后发送请求
func TestRealConnectivity(
	proxyId string,
	proxies []config.BrowserProxy,
	xrayMgr *XrayManager,
) TestResult {
	return TestRealConnectivityWithSingBox(proxyId, proxies, xrayMgr, nil)
}

// TestRealConnectivityWithSingBox 支持 sing-box 的真实连通性测试
func TestRealConnectivityWithSingBox(
	proxyId string,
	proxies []config.BrowserProxy,
	xrayMgr *XrayManager,
	singboxMgr *SingBoxManager,
) TestResult {
	src := ""
	for _, item := range proxies {
		if strings.EqualFold(item.ProxyId, proxyId) {
			src = strings.TrimSpace(item.ProxyConfig)
			break
		}
	}
	if src == "" {
		return TestResult{ProxyId: proxyId, Ok: false, Error: "代理配置为空"}
	}

	const targetURL = "http://www.gstatic.com/generate_204"
	const timeout = 15 * time.Second

	var client *http.Client

	if IsSingBoxProtocol(src) {
		if singboxMgr == nil {
			return TestResult{ProxyId: proxyId, Ok: false, Error: "sing-box 管理器未初始化，无法测试 hysteria2"}
		}
		socks5Addr, err := singboxMgr.EnsureBridge(src, proxies, proxyId)
		if err != nil {
			return TestResult{ProxyId: proxyId, Ok: false, Error: fmt.Sprintf("sing-box 桥接启动失败: %v", err)}
		}
		socks5Host := strings.TrimPrefix(socks5Addr, "socks5://")
		dialer, err := xproxy.SOCKS5("tcp", socks5Host, nil, xproxy.Direct)
		if err != nil {
			return TestResult{ProxyId: proxyId, Ok: false, Error: fmt.Sprintf("SOCKS5 dialer 创建失败: %v", err)}
		}
		contextDialer, ok := dialer.(xproxy.ContextDialer)
		if !ok {
			return TestResult{ProxyId: proxyId, Ok: false, Error: "SOCKS5 dialer 不支持 ContextDialer"}
		}
		transport := &http.Transport{DialContext: contextDialer.DialContext}
		client = &http.Client{Transport: transport, Timeout: timeout}
	} else if RequiresBridge(src, proxies, proxyId) {
		if xrayMgr == nil {
			return TestResult{ProxyId: proxyId, Ok: false, Error: "xray 管理器未初始化"}
		}
		socks5Addr, err := xrayMgr.EnsureBridge(src, proxies, proxyId)
		if err != nil {
			return TestResult{ProxyId: proxyId, Ok: false, Error: fmt.Sprintf("桥接启动失败: %v", err)}
		}
		socks5Host := strings.TrimPrefix(socks5Addr, "socks5://")
		dialer, err := xproxy.SOCKS5("tcp", socks5Host, nil, xproxy.Direct)
		if err != nil {
			return TestResult{ProxyId: proxyId, Ok: false, Error: fmt.Sprintf("SOCKS5 dialer 创建失败: %v", err)}
		}
		contextDialer, ok := dialer.(xproxy.ContextDialer)
		if !ok {
			return TestResult{ProxyId: proxyId, Ok: false, Error: "SOCKS5 dialer 不支持 ContextDialer"}
		}
		transport := &http.Transport{DialContext: contextDialer.DialContext}
		client = &http.Client{Transport: transport, Timeout: timeout}
	} else {
		proxyURL, err := url.Parse(src)
		if err != nil {
			return TestResult{ProxyId: proxyId, Ok: false, Error: fmt.Sprintf("代理地址解析失败: %v", err)}
		}
		transport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
		client = &http.Client{Transport: transport, Timeout: timeout}
	}

	start := time.Now()
	resp, err := client.Get(targetURL)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return TestResult{ProxyId: proxyId, Ok: false, LatencyMs: latency, Error: err.Error()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		return TestResult{ProxyId: proxyId, Ok: false, LatencyMs: latency, Error: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}
	return TestResult{ProxyId: proxyId, Ok: true, LatencyMs: latency}
}
