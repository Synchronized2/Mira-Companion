# Tailscale Funnel 安装与使用

Tailscale Funnel 可以把本机服务映射为公网 HTTPS 地址，无需公网 IP、路由器端口转发或自行申请 HTTPS 证书。

例如，本机服务运行在：

```text
http://127.0.0.1:5180
```

启用 Funnel 后，可以获得类似下面的公网地址：

```text
https://设备名.网络名.ts.net
```

电脑需要保持开机和联网，本机服务及 Tailscale 也需要保持运行。

## Windows

### 1. 安装

打开官方下载页面：

<https://tailscale.com/download/windows>

下载并运行 Windows 安装程序。安装完成后，在系统托盘打开 Tailscale，点击登录，并在浏览器中完成账户授权。

### 2. 检查连接状态

打开 PowerShell：

```powershell
tailscale status
```

如果提示找不到命令，使用完整路径：

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" status
```

### 3. 启动 Funnel

确保需要公开的本机服务已经运行，然后执行：

```powershell
tailscale funnel --bg 5180
```

`5180` 是本机服务的端口，可替换为其他端口。

首次启用时，终端可能显示一个授权链接。打开该链接，在 Tailscale 管理页面允许 Funnel。

### 4. 查看公网地址

```powershell
tailscale funnel status
```

输出中会显示 `https://...ts.net` 公网地址及其转发目标。

### 5. 停止 Funnel

```powershell
tailscale funnel reset
```

该命令会清除当前设备上的 Funnel 配置。

## Linux

### 1. 安装

Ubuntu、Debian、Fedora 等常见发行版可以运行官方安装脚本：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

启动服务并设置开机启动：

```bash
sudo systemctl enable --now tailscaled
```

### 2. 登录

```bash
sudo tailscale up
```

终端会显示一个授权地址。在浏览器中打开它并登录 Tailscale。

检查连接状态：

```bash
tailscale status
```

### 3. 启动 Funnel

确保需要公开的本机服务已经运行，然后执行：

```bash
sudo tailscale funnel --bg 5180
```

首次使用时，根据终端提示打开授权链接并允许 Funnel。

### 4. 查看公网地址

```bash
sudo tailscale funnel status
```

### 5. 停止 Funnel

```bash
sudo tailscale funnel reset
```

### 6. 可选：允许当前用户不使用 sudo

```bash
sudo tailscale set --operator="$USER"
```

重新登录终端后，可以直接执行 `tailscale funnel` 命令。

## 前台与后台运行

前台运行：

```text
tailscale funnel 5180
```

关闭终端或按 `Ctrl+C` 后停止。

后台运行：

```text
tailscale funnel --bg 5180
```

关闭终端后仍由 Tailscale 后台服务维护转发。本机被映射的服务仍必须保持运行。

## 常用命令

检查 Tailscale 连接：

```text
tailscale status
```

后台公开本机 `5180` 端口：

```text
tailscale funnel --bg 5180
```

查看 Funnel 状态和地址：

```text
tailscale funnel status
```

清除 Funnel 配置：

```text
tailscale funnel reset
```

## 常见问题

### 本机可以访问，公网地址打不开

检查：

- 本机服务是否仍在运行。
- 端口是否填写正确。
- `tailscale status` 是否显示已连接。
- `tailscale funnel status` 是否存在有效转发。
- 首次启用 Funnel 时是否完成了网页授权。

### 公网地址显示 502 或连接失败

通常表示 Tailscale 已接收到公网请求，但无法连接本机服务。确认本机服务正在监听对应端口。

### 重启电脑后无法访问

确认 Tailscale 后台服务已启动，并确认被映射的本机服务也已重新启动。使用下面的命令重新检查：

```text
tailscale status
tailscale funnel status
```

### 是否需要开放路由器端口

不需要。Funnel 通过 Tailscale 建立出站连接。

### Funnel 和 Serve 有什么区别

- Funnel 面向整个互联网，任何获得地址的人都可能访问。
- Serve 只允许同一个 Tailscale 网络内的设备访问。

只需要自己的设备远程访问时，可以改用：

```text
tailscale serve --bg 5180
```

## 官方资料

- Funnel：<https://tailscale.com/kb/1223/funnel>
- Windows 下载：<https://tailscale.com/download/windows>
- Linux 下载：<https://tailscale.com/download/linux>

