package proxy

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

func proxyConfigToMapping(src string) (map[string]any, error) {
	src = strings.TrimSpace(src)
	l := strings.ToLower(src)

	if strings.HasPrefix(l, "http://") || strings.HasPrefix(l, "https://") {
		return parseStandardProxy(src, "http")
	}
	if strings.HasPrefix(l, "socks5://") {
		return parseStandardProxy(src, "socks5")
	}

	if strings.Contains(l, "://") && !strings.Contains(l, "type:") {
		return nil, fmt.Errorf("URI 格式暂不支持: %s", l[:min(30, len(l))])
	}

	return parseClashYAMLToMapping(src)
}

func parseStandardProxy(src string, proxyType string) (map[string]any, error) {
	rest := src[strings.Index(src, "://")+3:]

	var username, password, hostport string
	if atIdx := strings.LastIndex(rest, "@"); atIdx >= 0 {
		userInfo := rest[:atIdx]
		hostport = rest[atIdx+1:]
		parts := strings.SplitN(userInfo, ":", 2)
		username = parts[0]
		if len(parts) > 1 {
			password = parts[1]
		}
	} else {
		hostport = rest
	}
	hostport = strings.SplitN(hostport, "/", 2)[0]

	host, port := splitHostPort(hostport)
	if host == "" || port == 0 {
		return nil, fmt.Errorf("无法解析地址: %s", src)
	}

	mapping := map[string]any{
		"name":   "speedtest-proxy",
		"type":   proxyType,
		"server": host,
		"port":   port,
	}
	if username != "" {
		mapping["username"] = username
		mapping["password"] = password
	}
	return mapping, nil
}

func parseClashYAMLToMapping(src string) (map[string]any, error) {
	var payload interface{}
	if err := yaml.Unmarshal([]byte(src), &payload); err != nil {
		return nil, fmt.Errorf("YAML 解析失败: %v", err)
	}

	node := pickClashNode(payload)
	if node == nil {
		return nil, fmt.Errorf("无法提取 Clash 节点")
	}

	if _, ok := node["name"]; !ok {
		node["name"] = "speedtest-proxy"
	}

	return node, nil
}

func splitHostPort(hostport string) (string, int) {
	if strings.HasPrefix(hostport, "[") {
		if idx := strings.LastIndex(hostport, "]:"); idx >= 0 {
			host := hostport[1:idx]
			port := 0
			fmt.Sscanf(hostport[idx+2:], "%d", &port)
			return host, port
		}
		return strings.Trim(hostport, "[]"), 0
	}
	idx := strings.LastIndex(hostport, ":")
	if idx < 0 {
		return hostport, 0
	}
	host := hostport[:idx]
	port := 0
	fmt.Sscanf(hostport[idx+1:], "%d", &port)
	return host, port
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
