#!/usr/bin/env bash
#
# 文件作用：模板仓扩展包版本与文档一致性校验（CI / publish 前置；主仓
#          scripts/check-extension-versions.sh 的模板仓适配版：包发现=packages/*/，
#          去掉镜像 NAMESPACE 闸口与 platform/ 树扫描）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-10-06
# 版本：1.0.0
# 修改记录：
#   - 1.0.0 (2026-10-06) 初始创建（模板仓 v2.0.0 工具链）
#
# 版权所有 (C) 2026 CesiumAI 项目
#
# 校验内容（packages/*/ 下 manifest.json 含 track 字段者为受管包）：
#   1. 版本一致：VERSION == manifest.json == frontend/package.json
#      == frontend/src/manifest.ts（如有）== container/*/build.sh SERVICE_VERSION（如有）
#      （组件版本轴例外：container/<svc>/VERSION 存在时该组件走自有版本轴）
#   2. 四必备文件存在：README.md / VERSION / manifest.json / CHANGELOG.md
#   3. DESIGN.md / REPORT.md（如有）文首含「状态：」行
#   4. data/menu.json（如有）经 tools/menujson.py validate 本地校验
#
# 输出逐包结果表；任一校验失败则 exit 1。
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v jq >/dev/null 2>&1; then
    echo "错误：本脚本依赖 jq"
    exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0
DETAILS=""

add_detail() {
    # $1=包名 $2=问题描述
    DETAILS="${DETAILS}  [$1] $2\n"
}

# DESIGN.md / REPORT.md 文首 10 行内含「状态：」行（兼容 **状态**: 写法）
has_status_line() {
    head -10 "$1" | grep -qE '状态\*{0,2}[[:space:]]*[:：]'
}

echo "=============================================="
echo "扩展包版本与文档一致性检查（packages/）"
echo "=============================================="
printf '%-32s %-10s %-8s %-8s %-8s %s\n' "包" "版本一致" "四必备" "状态行" "menu.json" "结论"
printf '%-32s %-10s %-8s %-8s %-8s %s\n' "--------------------------------" "--------" "------" "------" "---------" "--------"

while IFS= read -r manifest_file; do
    pkg_dir="$(dirname "${manifest_file}")"
    pkg_name="${pkg_dir#${REPO_ROOT}/}"
    pkg_version=""
    if [ -f "${pkg_dir}/VERSION" ]; then
        pkg_version="$(tr -d '[:space:]' < "${pkg_dir}/VERSION")"
    fi
    pkg_failed="false"

    # ---- 1. 版本一致 ----
    version_ok="✔"
    manifest_ver=""
    if [ -f "${pkg_dir}/manifest.json" ]; then
        manifest_ver="$(jq -r '.version // empty' "${pkg_dir}/manifest.json")"
        if [ "${manifest_ver}" != "${pkg_version}" ]; then
            version_ok="✘"
            add_detail "${pkg_name}" "版本不一致：VERSION=${pkg_version}，manifest.json=${manifest_ver:-缺失}"
            pkg_failed="true"
        fi
    fi
    if [ -f "${pkg_dir}/frontend/package.json" ]; then
        pkgjson_ver="$(jq -r '.version // empty' "${pkg_dir}/frontend/package.json")"
        if [ "${pkgjson_ver}" != "${pkg_version}" ]; then
            version_ok="✘"
            add_detail "${pkg_name}" "版本不一致：VERSION=${pkg_version}，frontend/package.json=${pkgjson_ver:-缺失}"
            pkg_failed="true"
        fi
    fi
    if [ -f "${pkg_dir}/frontend/src/manifest.ts" ]; then
        ts_ver="$(sed -n "s/^[[:space:]]*version:[[:space:]]*'\([^']*\)'.*/\1/p" "${pkg_dir}/frontend/src/manifest.ts" | head -1)"
        if [ "${ts_ver}" != "${pkg_version}" ]; then
            version_ok="✘"
            add_detail "${pkg_name}" "版本不一致：VERSION=${pkg_version}，frontend/src/manifest.ts=${ts_ver:-未找到}"
            pkg_failed="true"
        fi
    fi
    for build_sh in "${pkg_dir}"/container/*/build.sh; do
        [ -f "${build_sh}" ] || continue
        svc_dir="$(dirname "${build_sh}")"
        sh_ver="$(sed -n 's/^SERVICE_VERSION="\([^"]*\)".*/\1/p' "${build_sh}" | head -1)"
        # 组件版本轴：container/<svc>/VERSION 存在时组件走自有版本轴，build.sh 与其对齐
        if [ -f "${svc_dir}/VERSION" ]; then
            svc_version="$(tr -d '[:space:]' < "${svc_dir}/VERSION")"
            if grep -q '\$(cat VERSION' <<< "${sh_ver}"; then
                sh_ver="${svc_version}"
            fi
            if [ "${sh_ver}" != "${svc_version}" ]; then
                version_ok="✘"
                add_detail "${pkg_name}" "组件版本不一致：container/$(basename "${svc_dir}")/VERSION=${svc_version}，build.sh SERVICE_VERSION=${sh_ver:-未找到}"
                pkg_failed="true"
            fi
        elif [ "${sh_ver}" != "${pkg_version}" ]; then
            version_ok="✘"
            add_detail "${pkg_name}" "版本不一致：VERSION=${pkg_version}，container/$(basename "$(dirname "${build_sh}")")/build.sh SERVICE_VERSION=${sh_ver:-未找到}"
            pkg_failed="true"
        fi
    done

    # ---- 2. 四必备文件 ----
    docs_ok="✔"
    for required in README.md VERSION manifest.json CHANGELOG.md; do
        if [ ! -f "${pkg_dir}/${required}" ]; then
            docs_ok="✘"
            add_detail "${pkg_name}" "缺少必备文件：${required}"
            pkg_failed="true"
        fi
    done

    # ---- 3. DESIGN.md / REPORT.md 状态行（如有）----
    status_ok="-"
    for doc in DESIGN.md REPORT.md; do
        if [ -f "${pkg_dir}/${doc}" ]; then
            status_ok="✔"
            if ! has_status_line "${pkg_dir}/${doc}"; then
                status_ok="✘"
                add_detail "${pkg_name}" "${doc} 文首缺少「状态：」行"
                pkg_failed="true"
            fi
        fi
    done

    # ---- 4. data/menu.json 本地校验（如有）----
    menu_ok="-"
    if [ -f "${pkg_dir}/data/menu.json" ]; then
        menu_ok="✔"
        pkg_id="$(jq -r '.id // empty' "${pkg_dir}/manifest.json")"
        if ! python3 "${SCRIPT_DIR}/menujson.py" validate "${pkg_dir}/data/menu.json" --package "${pkg_id}" >/dev/null 2>&1; then
            menu_ok="✘"
            add_detail "${pkg_name}" "data/menu.json 未通过 tools/menujson.py validate"
            pkg_failed="true"
        fi
    fi

    if [ "${pkg_failed}" = "true" ]; then
        FAIL_COUNT=$((FAIL_COUNT + 1))
        printf '%-32s %-10s %-8s %-8s %-8s %s\n' "${pkg_name}" "${version_ok}" "${docs_ok}" "${status_ok}" "${menu_ok}" "✘ 失败"
    else
        PASS_COUNT=$((PASS_COUNT + 1))
        printf '%-32s %-10s %-8s %-8s %-8s %s\n' "${pkg_name}" "${version_ok}" "${docs_ok}" "${status_ok}" "${menu_ok}" "✔ 通过"
    fi
done < <(find "${REPO_ROOT}/packages" -maxdepth 2 -name manifest.json -not -path "*/node_modules/*" 2>/dev/null | sort | \
    while IFS= read -r mf; do
        if jq -e 'has("track")' "${mf}" >/dev/null 2>&1; then
            echo "${mf}"
        fi
    done)

echo "=============================================="
echo "共 $((PASS_COUNT + FAIL_COUNT)) 个包：通过 ${PASS_COUNT}，失败 ${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -gt 0 ]; then
    echo ""
    echo "失败详情："
    printf '%b' "${DETAILS}"
    exit 1
fi
