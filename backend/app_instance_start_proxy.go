package backend

import (
	"ant-chrome/backend/internal/logger"
	"ant-chrome/backend/internal/proxy"
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) resolveBrowserStartProxy(profileID string, profile *BrowserProfile) (string, string, bool, error) {
	log := logger.New("Browser")
	proxies := a.getLatestProxies()

	resolvedProxyConfig := strings.TrimSpace(profile.ProxyConfig)
	if profile.ProxyId != "" {
		for _, item := range proxies {
			if strings.EqualFold(item.ProxyId, profile.ProxyId) {
				resolvedProxyConfig = strings.TrimSpace(item.ProxyConfig)
				break
			}
		}
	}

	log.Info("代理配置检查",
		logger.F("profile_id", profileID),
		logger.F("proxy_id", profile.ProxyId),
		logger.F("profile_proxy_config", profile.ProxyConfig),
		logger.F("resolved_proxy_config", resolvedProxyConfig),
	)
	if supported, errorMsg := proxy.ValidateProxyConfig(resolvedProxyConfig, proxies, profile.ProxyId); !supported {
		startErr := fmt.Errorf("实例启动失败：%s", errorMsg)
		profile.LastError = startErr.Error()
		log.Error("代理配置无效",
			logger.F("profile_id", profileID),
			logger.F("proxy_id", profile.ProxyId),
			logger.F("error", errorMsg),
			logger.F("reason", startErr.Error()),
		)
		return "", "", false, startErr
	}

	if proxy.IsSingBoxProtocol(resolvedProxyConfig) {
		socksURL, bridgeErr := a.singboxMgr.EnsureBridge(resolvedProxyConfig, proxies, profile.ProxyId)
		if bridgeErr != nil {
			startErr := fmt.Errorf("实例启动失败：代理桥接启动失败（sing-box）。原因：%v。请检查代理节点配置、sing-box 可执行文件是否存在，以及本地端口是否被占用。", bridgeErr)
			log.Error("代理桥接失败(sing-box)",
				logger.F("error", bridgeErr.Error()),
				logger.F("reason", startErr.Error()),
			)
			profile.LastError = startErr.Error()
			a.emitBrowserStartBridgeFailure(profileID, profile.ProfileName, startErr.Error())
			return "", "", false, startErr
		}
		log.Info("sing-box 桥接成功", logger.F("socks_url", socksURL))
		return socksURL, "", false, nil
	}

	if proxy.RequiresBridge(resolvedProxyConfig, proxies, profile.ProxyId) {
		socksURL, bridgeKey, bridgeErr := a.xrayMgr.AcquireBridge(resolvedProxyConfig, proxies, profile.ProxyId)
		if bridgeErr != nil {
			startErr := fmt.Errorf("实例启动失败：代理桥接启动失败（xray）。原因：%v。请检查代理节点配置、xray 可执行文件是否存在，以及本地端口是否被占用。", bridgeErr)
			log.Error("代理桥接失败(xray)",
				logger.F("error", bridgeErr.Error()),
				logger.F("reason", startErr.Error()),
			)
			profile.LastError = startErr.Error()
			a.emitBrowserStartBridgeFailure(profileID, profile.ProfileName, startErr.Error())
			return "", "", false, startErr
		}
		log.Info("xray 桥接成功", logger.F("socks_url", socksURL))
		return socksURL, bridgeKey, bridgeKey != "", nil
	}

	return resolvedProxyConfig, "", false, nil
}

func (a *App) emitBrowserStartBridgeFailure(profileID string, profileName string, errorText string) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "proxy:bridge:failed", map[string]interface{}{
		"profileId":   profileID,
		"profileName": profileName,
		"error":       errorText,
	})
}
