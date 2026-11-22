package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

//go:embed payload.zip
var payload []byte

const runtimeName = "amicur-runtime.exe"

func main() {
	if err := run(); err != nil {
		message, _ := syscall.UTF16PtrFromString(err.Error())
		title, _ := syscall.UTF16PtrFromString("Amicur Launcher")
		proc := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
		_, _, _ = proc.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x10)
		os.Exit(1)
	}
}

func run() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(executable)
	data := filepath.Join(root, "data-launcher")
	temporary := filepath.Join(data, "temp")
	library := filepath.Join(data, "lib")
	for _, folder := range []string{data, temporary, library} {
		if err := os.Mkdir(folder, 0755); err != nil && !os.IsExist(err) {
			return err
		}
		info, err := os.Lstat(folder)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("Invalid portable folder: %s", folder)
		}
	}

	hash := sha256.Sum256(payload)
	target := filepath.Join(library, fmt.Sprintf("runtime-%x", hash[:8]))
	if !installed(target) {
		if err := extractRuntime(temporary, target); err != nil {
			return err
		}
	}

	command := exec.Command(filepath.Join(target, runtimeName))
	command.Dir = root
	command.Env = append(os.Environ(), "AMICUR_ROOT="+root, "TEMP="+temporary, "TMP="+temporary, "TMPDIR="+temporary)
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

func installed(directory string) bool {
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return false
	}
	for _, relative := range []string{runtimeName, ".complete"} {
		info, err := os.Lstat(filepath.Join(directory, relative))
		if err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}

func extractRuntime(temporary, target string) error {
	stage, err := os.MkdirTemp(temporary, "runtime-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)

	archive, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return err
	}
	for _, item := range archive.File {
		raw := strings.TrimPrefix(item.Name, "./")
		if raw == "" {
			continue
		}
		name := filepath.FromSlash(strings.TrimSuffix(raw, "/"))
		if !filepath.IsLocal(name) || filepath.Clean(name) != name || strings.ContainsAny(raw, "\\:") {
			return fmt.Errorf("Invalid runtime entry: %s", item.Name)
		}
		destination := filepath.Join(stage, name)
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(destination, 0755); err != nil {
				return err
			}
			continue
		}
		if !item.Mode().IsRegular() {
			return fmt.Errorf("Unsupported runtime entry: %s", item.Name)
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
			return err
		}
		if err := extractFile(item, destination); err != nil {
			return err
		}
	}
	if err := os.WriteFile(filepath.Join(stage, ".complete"), nil, 0644); err != nil {
		return err
	}
	if !installed(stage) {
		return fmt.Errorf("The embedded Electron runtime is incomplete")
	}
	if err := os.Rename(stage, target); err != nil && !installed(target) {
		return err
	}
	return nil
}

func extractFile(item *zip.File, destination string) error {
	source, err := item.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, copyError := io.Copy(out, source)
	closeError := out.Close()
	if copyError != nil {
		return copyError
	}
	return closeError
}
