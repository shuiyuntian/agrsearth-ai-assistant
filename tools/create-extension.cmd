@echo off
rem 文件作用：create-extension.sh 的 Windows 薄 shim（与 publish.cmd 同风格）——经 Git Bash 调起
rem          脚手架；找不到 bash 时打印工具链指引而非静默失败。
rem          注意：dev-mcp package_scaffold 在 Windows 同样经 bash.exe 执行（server.mjs bashCommand），
rem          Git Bash 为 Windows 开发必装项，完整工具链要求见 docs/L2-接入准备-SSO与开发环境.md 2.4 节。
rem 作者：JasonLee <shuiyuntian@foxmail.com>
rem 创建日期：2026-11-07
rem 版本：1.0.0
rem 版权所有 (C) 2026 AGRSEarth 项目
chcp 65001 >nul 2>nul
setlocal
set "BASH=%AGRSEARTH_BASH%"
if not defined BASH set "BASH=bash.exe"
"%BASH%" --version >nul 2>nul
if errorlevel 1 (
  echo 错误：未找到可用的 bash（探测 %BASH% --version 失败）。
  echo Windows 建包依赖 Git Bash + jq + 真实 Python ^>=3.9（勿用 Microsoft Store 占位版），
  echo 安装指引见 docs\L2-接入准备-SSO与开发环境.md 2.4 节；亦可用 AGRSEARTH_BASH 指定 bash 完整路径。
  exit /b 1
)
"%BASH%" "%~dp0create-extension.sh" %*
