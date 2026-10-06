#!/usr/bin/env python3
# 文件作用：menu.json 生成/转换/校验工具（菜单 SQL → menu.json 迁移与 publish 前置闸口共用）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-10-04
# 版本：1.0.0
# 修改记录：
#   - 1.0.0 (2026-10-04) 初始创建（批4 publish 链路治理：from-db / from-sql / validate 三子命令）
#
# 版权所有 (C) 2026 CesiumAI 项目
"""
menu.json 工具（批4「publish 链路治理」）

menu.json 是扩展包管理面菜单的声明式事实源（替代 data/ 下菜单登记 SQL），
resource-manager menu-provision 端点按它幂等 upsert sys_menu / sys_role_menu。

schemaVersion 1：
{
  "schemaVersion": 1,
  "packageId": "tide",
  "menus": [
    {
      "menuId": 2001000, "menuName": "潮汐数据", "parentId": 0, "orderNum": 70,
      "path": "tide", "component": null, "query": null, "routeName": null,
      "isFrame": 1, "isCache": 0, "menuType": "M",
      "visible": "0", "status": "0", "perms": "", "icon": "Pouring",
      "remark": "...", "roleIds": [1, 106]
    }
  ]
}

子命令：
  from-db   从 mysqldump TSV 导出（sys_menu / sys_role_menu）生成 menu.json（存量迁移通道，
            以现网实况为准——历史 SQL 经多次迁移/整改后与库态有出入，不以 SQL 反推）
  from-sql  解析菜单登记 SQL（INSERT INTO sys_menu ... VALUES / INSERT [IGNORE] INTO
            sys_role_menu）生成 menu.json（新包脚手架/核对通道；INSERT...SELECT、UPDATE
            类历史整改语句不解析，遇到即告警）
  validate  结构与号段红线校验（publish-extension.sh 统一 pre-check 调用，非零即拒）

TSV 约定（from-db）：NUL 分隔不可用，空值以字面 <NULL> 表示；列序：
  sys_menu: menu_id menu_name parent_id order_num path component query route_name
            is_frame is_cache menu_type visible status perms icon remark
  sys_role_menu: role_id menu_id
号段红线（方案 docs/工作日志/20261001-方案-菜单号段管理/）：1-99999 平台侧、
100000-999999 隔离带永不分配、1000000-9999999 用户侧；menu_id 禁落隔离带、禁超上限。
"""
import argparse
import json
import re
import sys

NULL_SENTINEL = "<NULL>"
ISOLATION_LO, ISOLATION_HI = 100000, 999999
USER_MAX = 9999999
MENU_COLS = ["menuId", "menuName", "parentId", "orderNum", "path", "component", "query",
             "routeName", "isFrame", "isCache", "menuType", "visible", "status",
             "perms", "icon", "remark"]
INT_COLS = {"menuId", "parentId", "orderNum", "isFrame", "isCache"}


def die(msg):
    print(f"错误：{msg}", file=sys.stderr)
    sys.exit(1)


def read_tsv(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if line:
                rows.append(line.split("\t"))
    return rows


def nullify(v):
    return None if v == NULL_SENTINEL else v


def cmd_from_db(args):
    menus = {}
    for parts in read_tsv(args.menus):
        if len(parts) < 16 or not parts[0].isdigit():
            continue
        mid = int(parts[0])
        row = dict(zip(MENU_COLS, parts[:16]))
        for c in ("component", "query", "routeName", "perms", "icon", "remark"):
            row[c] = nullify(row[c])
        for c in INT_COLS:
            row[c] = int(row[c])
        menus[mid] = row
    role_map = {}
    for parts in read_tsv(args.roles):
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            role_map.setdefault(int(parts[1]), set()).add(int(parts[0]))
    ids = parse_id_spec(args.ids)
    missing = [i for i in ids if i not in menus]
    if missing:
        die(f"以下 menu_id 在 sys_menu 导出中不存在：{missing}")
    out_menus = []
    for mid in ids:
        row = {k: menus[mid][k] for k in MENU_COLS}
        row["roleIds"] = sorted(role_map.get(mid, set()))
        out_menus.append(row)
    doc = {"schemaVersion": 1, "packageId": args.package, "menus": out_menus}
    write_doc(doc, args.out)
    errs = validate_doc(doc)
    if errs:
        die("生成结果未通过自检：\n" + "\n".join(errs))
    print(f"OK：{args.out}（{len(out_menus)} 个菜单）")


def parse_id_spec(spec):
    """逗号分隔的 id 或 a-b 区间，如 '5,5000-5046'"""
    ids = []
    for tok in spec.split(","):
        tok = tok.strip()
        if not tok:
            continue
        if "-" in tok:
            lo, hi = tok.split("-", 1)
            ids.extend(range(int(lo), int(hi) + 1))
        else:
            ids.append(int(tok))
    return ids


# ---------------- from-sql ----------------

def split_sql_tuples(s):
    """把 VALUES 后的元组串拆成单条 '(...)'，正确处理引号与 '' 转义"""
    tuples, i, n = [], 0, len(s)
    while i < n:
        if s[i] == "(":
            depth, j = 1, i + 1
            while j < n and depth:
                if s[j] == "'":
                    j += 1
                    while j < n and s[j] != "'":
                        j += 2 if s[j] == "\\" and j + 1 < n else 1
                    # 处理 '' 转义
                    while j + 1 < n and s[j] == "'" and s[j + 1] == "'":
                        j += 2
                        while j < n and s[j] != "'":
                            j += 1
                elif s[j] == "(":
                    depth += 1
                elif s[j] == ")":
                    depth -= 1
                j += 1
            tuples.append(s[i + 1:j - 1])
            i = j
        else:
            i += 1
    return tuples


def split_sql_values(t):
    """拆分单个元组内的值，返回 python 值列表（NULL->None，'str' 去引号，数字转 int）"""
    vals, i, n = [], 0, len(t)
    while i < n:
        while i < n and t[i] in " \t\r\n,":
            i += 1
        if i >= n:
            break
        if t[i] == "'":
            j = i + 1
            buf = []
            while j < n:
                if t[j] == "'":
                    if j + 1 < n and t[j + 1] == "'":
                        buf.append("'")
                        j += 2
                        continue
                    break
                buf.append(t[j])
                j += 1
            vals.append("".join(buf))
            i = j + 1
        else:
            j = i
            while j < n and t[j] != ",":
                j += 1
            tok = t[i:j].strip()
            if tok.upper() == "NULL":
                vals.append(None)
            elif re.fullmatch(r"-?\d+", tok):
                vals.append(int(tok))
            else:
                vals.append(tok)  # NOW() 等表达式原样保留（仅告警用）
            i = j
    return vals


INSERT_MENU_RE = re.compile(
    r"INSERT\s+(?:IGNORE\s+)?INTO\s+sys_menu\s*\(([^)]*)\)\s*VALUES\s*(.*?)(?:ON\s+DUPLICATE|\Z)",
    re.IGNORECASE | re.DOTALL)
INSERT_ROLE_RE = re.compile(
    r"INSERT\s+(?:IGNORE\s+)?INTO\s+sys_role_menu\s*(?:\([^)]*\))?\s*VALUES\s*(.*?);",
    re.IGNORECASE | re.DOTALL)
UNSUPPORTED_RE = re.compile(
    r"INSERT\s+(?:IGNORE\s+)?INTO\s+sys_menu[^;]*\bSELECT\b", re.IGNORECASE | re.DOTALL)


def cmd_from_sql(args):
    menus, role_map, warns = {}, {}, []
    for path in args.sql:
        text = open(path, encoding="utf-8").read()
        # 去注释（-- 行注释与 /* */），避免注释里的示例语句被解析
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        text = re.sub(r"(?m)^\s*--.*$", "", text)
        if UNSUPPORTED_RE.search(text):
            warns.append(f"{path}: 含 INSERT...SELECT 语句，未解析（历史整改语句，需人工核对）")
        for m in INSERT_MENU_RE.finditer(text):
            cols = [c.strip() for c in m.group(1).split(",")]
            for tup in split_sql_tuples(m.group(2)):
                vals = split_sql_values(tup)
                if len(cols) != len(vals):
                    warns.append(f"{path}: 列数({len(cols)})与值数({len(vals)})不符，跳过：{tup[:60]}...")
                    continue
                row = dict(zip(cols, vals))
                if not isinstance(row.get("menu_id"), int):
                    warns.append(f"{path}: menu_id 非常量，跳过：{tup[:60]}...")
                    continue
                mid = row["menu_id"]
                menus[mid] = {
                    "menuId": mid,
                    "menuName": row.get("menu_name"),
                    "parentId": row.get("parent_id", 0),
                    "orderNum": row.get("order_num", 0),
                    "path": row.get("path"),
                    "component": row.get("component"),
                    "query": row.get("query"),
                    "routeName": row.get("route_name"),
                    "isFrame": row.get("is_frame", 1),
                    "isCache": row.get("is_cache", 0),
                    "menuType": row.get("menu_type"),
                    "visible": row.get("visible", "0"),
                    "status": row.get("status", "0"),
                    "perms": row.get("perms"),
                    "icon": row.get("icon"),
                    "remark": row.get("remark"),
                }
        for m in INSERT_ROLE_RE.finditer(text):
            for tup in split_sql_tuples(m.group(1)):
                vals = split_sql_values(tup)
                if len(vals) == 2 and all(isinstance(v, int) for v in vals):
                    role_map.setdefault(vals[1], set()).add(vals[0])
    for w in warns:
        print(f"⚠️  {w}", file=sys.stderr)
    out_menus = []
    for mid in sorted(menus):
        row = menus[mid]
        row["roleIds"] = sorted(role_map.get(mid, set()))
        out_menus.append(row)
    doc = {"schemaVersion": 1, "packageId": args.package, "menus": out_menus}
    errs = validate_doc(doc)
    for e in errs:
        print(f"⚠️  自检告警：{e}", file=sys.stderr)
    write_doc(doc, args.out)
    print(f"OK：{args.out}（{len(out_menus)} 个菜单，{len(warns)} 条告警）")


# ---------------- validate ----------------

def validate_doc(doc):
    errs = []
    if doc.get("schemaVersion") != 1:
        errs.append("schemaVersion 必须为 1")
    if not doc.get("packageId"):
        errs.append("缺少 packageId")
    menus = doc.get("menus")
    if not isinstance(menus, list):
        errs.append("menus 必须为数组")
        return errs
    seen = {}
    ids = set()
    for i, m in enumerate(menus):
        tag = f"menus[{i}](menuId={m.get('menuId')})"
        mid = m.get("menuId")
        if not isinstance(mid, int):
            errs.append(f"{tag}：menuId 缺失或非整数")
            continue
        if mid in seen:
            errs.append(f"{tag}：menuId 重复（首次出现于 menus[{seen[mid]}]）")
        seen[mid] = i
        ids.add(mid)
        if ISOLATION_LO <= mid <= ISOLATION_HI:
            errs.append(f"{tag}：落入 6 位隔离带（{ISOLATION_LO}-{ISOLATION_HI} 永不分配）")
        if mid < 1 or mid > USER_MAX:
            errs.append(f"{tag}：超出合法范围 1-{USER_MAX}")
        for req in ("menuName", "parentId", "orderNum", "menuType"):
            if m.get(req) is None:
                errs.append(f"{tag}：缺少必填字段 {req}")
        if m.get("menuType") not in ("M", "C", "F"):
            errs.append(f"{tag}：menuType 非法（仅 M/C/F）：{m.get('menuType')}")
        if m.get("menuType") in ("M", "C") and not m.get("path"):
            errs.append(f"{tag}：M/C 类菜单 path 必填")
        if m.get("visible", "0") not in ("0", "1"):
            errs.append(f"{tag}：visible 仅允许 '0'/'1'")
        if m.get("status", "0") not in ("0", "1"):
            errs.append(f"{tag}：status 仅允许 '0'/'1'")
        if not isinstance(m.get("roleIds", []), list):
            errs.append(f"{tag}：roleIds 必须为数组")
    for m in menus:
        pid = m.get("parentId")
        if not isinstance(pid, int):
            continue
        # parentId 合法取值：0（顶级）/ 平台侧既有菜单（<100000）/ 本文件内菜单
        if pid != 0 and pid not in ids and pid >= ISOLATION_LO:
            errs.append(f"menuId={m.get('menuId')}：parentId={pid} 既非 0/平台侧（<100000），也不在本包菜单集内")
    return errs


def cmd_validate(args):
    try:
        doc = json.load(open(args.file, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        die(f"menu.json 解析失败：{e}")
    errs = validate_doc(doc)
    if args.package and doc.get("packageId") != args.package:
        errs.append(f"packageId 与包目录不符：menu.json={doc.get('packageId')}，期望={args.package}")
    if errs:
        print(f"menu.json 校验失败（{args.file}）：", file=sys.stderr)
        for e in errs:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)
    print(f"menu.json 校验通过：{args.file}（{len(doc.get('menus', []))} 个菜单）")


def write_doc(doc, out):
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser(description="menu.json 生成/转换/校验工具")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("from-db", help="从 sys_menu/sys_role_menu TSV 导出生成 menu.json")
    p.add_argument("--menus", required=True, help="sys_menu TSV（<NULL> 表示 NULL）")
    p.add_argument("--roles", required=True, help="sys_role_menu TSV")
    p.add_argument("--package", required=True)
    p.add_argument("--ids", required=True, help="menu_id 清单，如 '5,5000-5046'")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_from_db)
    p = sub.add_parser("from-sql", help="解析菜单登记 SQL 生成 menu.json")
    p.add_argument("--package", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("sql", nargs="+")
    p.set_defaults(func=cmd_from_sql)
    p = sub.add_parser("validate", help="结构与号段红线校验")
    p.add_argument("file")
    p.add_argument("--package", default="")
    p.set_defaults(func=cmd_validate)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
