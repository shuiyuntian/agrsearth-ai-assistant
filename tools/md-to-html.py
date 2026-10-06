#!/usr/bin/env python3
"""
文件作用：Markdown 转评审/发布用 HTML（公共工具；插件模板仓 tools/ 内为同步副本）
作者：JasonLee <shuiyuntian@foxmail.com>
创建日期：2026-06-27
版本：1.1.0
修改记录：
  - 1.1.0 (2026-09-14) 通用化：页脚参数化（--footer，默认「航遥业务中台」）；用法路径订正为
                       scripts/build/md-to-html.py；按注释头规范补文件头
  - 1.0.0 (2026-06-27) 初始创建（台湾水文模块设计文档评审件生成器，页脚硬编码）

版权所有 (C) 2026 CesiumAI 项目
"""

import argparse
import sys
import markdown
from pathlib import Path

DEFAULT_FOOTER = "航遥业务中台"

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
        :root {
            --bg: #ffffff;
            --fg: #1f2937;
            --muted: #6b7280;
            --border: #e5e7eb;
            --code-bg: #f3f4f6;
            --accent: #2563eb;
            --accent-light: #eff6ff;
            --table-header: #f9fafb;
            --success: #16a34a;
            --warning: #ca8a04;
            --danger: #dc2626;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #0f172a;
                --fg: #e2e8f0;
                --muted: #94a3b8;
                --border: #334155;
                --code-bg: #1e293b;
                --accent: #60a5fa;
                --accent-light: #1e3a8a;
                --table-header: #1e293b;
                --success: #4ade80;
                --warning: #facc15;
                --danger: #f87171;
            }
        }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: var(--bg);
            color: var(--fg);
            line-height: 1.7;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 920px;
            margin: 0 auto;
            padding: 40px 24px;
        }
        .header {
            border-bottom: 1px solid var(--border);
            padding-bottom: 20px;
            margin-bottom: 32px;
        }
        .header h1 {
            margin: 0 0 12px;
            font-size: 32px;
            color: var(--accent);
        }
        .meta {
            color: var(--muted);
            font-size: 14px;
        }
        h1, h2, h3, h4 {
            margin-top: 36px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.3;
        }
        h1 { font-size: 28px; border-bottom: 2px solid var(--border); padding-bottom: 8px; }
        h2 { font-size: 24px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
        h3 { font-size: 20px; }
        h4 { font-size: 17px; }
        p { margin: 12px 0; }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }
        ul, ol { margin: 12px 0; padding-left: 24px; }
        li { margin: 6px 0; }
        code {
            background: var(--code-bg);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
            font-size: 0.9em;
        }
        pre {
            background: var(--code-bg);
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            border: 1px solid var(--border);
        }
        pre code {
            background: transparent;
            padding: 0;
            font-size: 13px;
            line-height: 1.5;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
            font-size: 14px;
        }
        th, td {
            border: 1px solid var(--border);
            padding: 10px 12px;
            text-align: left;
        }
        th {
            background: var(--table-header);
            font-weight: 600;
        }
        tr:nth-child(even) { background: rgba(0,0,0,0.02); }
        blockquote {
            border-left: 4px solid var(--accent);
            background: var(--accent-light);
            margin: 16px 0;
            padding: 12px 16px;
            border-radius: 0 8px 8px 0;
        }
        hr { border: none; border-top: 1px solid var(--border); margin: 32px 0; }
        .toc {
            background: var(--accent-light);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 16px 20px;
            margin: 24px 0;
        }
        .toc ul { margin: 0; padding-left: 18px; }
        .toc li { margin: 4px 0; }
        .toc a { color: var(--accent); }
        .footer {
            margin-top: 48px;
            padding-top: 20px;
            border-top: 1px solid var(--border);
            color: var(--muted);
            font-size: 13px;
            text-align: center;
        }
        @media print {
            body { background: #fff; color: #000; }
            .container { max-width: 100%; padding: 20px; }
        }
        @media (max-width: 640px) {
            .container { padding: 20px 16px; }
            h1 { font-size: 24px; }
            h2 { font-size: 20px; }
            table { font-size: 12px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{title}</h1>
            <div class="meta">Generated from Markdown · {source}</div>
        </div>
        {content}
        <div class="footer">
            AGRSCesiumAI · {footer}
        </div>
    </div>
</body>
</html>
"""


def convert(md_path: str, html_path: str, footer: str = DEFAULT_FOOTER):
    md_file = Path(md_path)
    if not md_file.exists():
        print(f"Error: {md_path} not found")
        sys.exit(1)

    md_text = md_file.read_text(encoding="utf-8")

    # Convert markdown to HTML with fenced code blocks and tables
    html_content = markdown.markdown(
        md_text,
        extensions=[
            "tables",
            "fenced_code",
            "toc",
            "nl2br",
            "codehilite",
        ],
    )

    # Use first H1 as title
    title = md_file.stem
    for line in md_text.splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            break

    html = (
        HTML_TEMPLATE
        .replace("{title}", title)
        .replace("{source}", md_file.name)
        .replace("{content}", html_content)
        .replace("{footer}", footer)
    )

    Path(html_path).write_text(html, encoding="utf-8")
    print(f"Converted: {md_path} -> {html_path}")


def main():
    parser = argparse.ArgumentParser(
        description="将 Markdown 文档转换为带样式的 HTML（评审/发布件）",
        usage="python scripts/build/md-to-html.py <input.md> <output.html> [--footer 页脚文案]",
    )
    parser.add_argument("input", help="输入 Markdown 文件路径")
    parser.add_argument("output", help="输出 HTML 文件路径")
    parser.add_argument(
        "--footer",
        default=DEFAULT_FOOTER,
        help=f"页脚文案（默认：{DEFAULT_FOOTER}）",
    )
    args = parser.parse_args()
    convert(args.input, args.output, footer=args.footer)


if __name__ == "__main__":
    main()
