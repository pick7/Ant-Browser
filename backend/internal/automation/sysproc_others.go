//go:build !windows
// +build !windows

package automation

import "os/exec"

func hideWindow(cmd *exec.Cmd) {
}
