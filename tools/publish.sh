#!/usr/bin/env bash
#
# 文件作用：模板仓扩展包一键发布脚本（仅插件测试底座）——构建 → MinIO SigV4 直传 →
#          resource-manager API 注册（包→版本→资源→发布），支持 --dev-url HMR 调试回路；
#          从平台仓 scripts/publish-extension.sh 提炼（去目录==track/tier 闸口/号段服务端台账/
#          权限对账/双环境，只打测试底座，prod 一律拒绝）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-10-06
# 版本：1.0.1
# 修改记录：
#   - 1.0.0 (2026-10-06) 初始创建（模板仓 v2.0.0 工具链：测试环境默认值按 DGX 测试底座
#     端点写死、全部可环境变量覆盖；凭据必须经环境变量注入，脚本内无任何默认口令）
#   - 1.0.1 (2026-10-06) 实战检验修复（测试底座不可达场景报错体验）：① s3_upload 增加
#     30s 超时与友好报错——连接失败明确指认「无法连接 MinIO/测试底座 + MINIO_ENDPOINT
#     覆盖指引」，HTTP 4xx/5xx 指认凭据/bucket 权限（不再抛裸 Python traceback）；
#     ② api_call 增加 --connect-timeout 10/--max-time 60 并检测 curl 退出码——RM 不可达
#     时报「无法连接 resource-manager + RM_API_BASE 覆盖指引」（不再空响应泛化报错）
#
# 版权所有 (C) 2026 CesiumAI 项目
#
# 用法：./tools/publish.sh <package-dir> [--skip-build] [--deploy]
#          [--dev-url <url> | --dev-url --reset]
#
# 流程：
#   0. pre-check：manifest id/name/version/track/tier 必填 + delivery 合法 +
#      components 段与实际结构一致性 + data/menu.json 本地校验（tools/menujson.py validate）；
#      无「目录==track/tier」闸口（模板仓布局 packages/<id>/），服务端号段台账/权限对账
#      在主仓侧提测评审时由平台管理员执行
#   1. 构建：frontend/ 与 admin-ui/ 存在则 npm run build（--skip-build 跳过）
#   2. MinIO 上传（SigV4 直传，python3 标准库实现，无新依赖）：
#      {track}/{tier}/{packageId}/{version}/frontend|admin-ui/ + 回填 entries.url 的 manifest.json
#      + data/menu.json → menu.json；纯管理面包 manifest 传 admin-ui/ 下
#   3. resource-manager API 注册（RM_TOKEN 可选，缺省匿名并警告）：
#      包 upsert → 版本（changelog 取 CHANGELOG.md 最新段）→ 依赖声明 → 资源 upsert
#      （前端/管理端/manifest/menu.json/后端镜像按 dependsOn 拓扑序/k8s-bundle）→ 发布版本
#      → menu-provision 幂等布设菜单 → 发布冒烟（artifact_url 可达 + manifest 字段比对）
#   --deploy：追加触发版本部署接口，逐组件打印结果
#   --dev-url <url>：HMR 调试回路——把已发布版本的 manifest.json 中 entries.esm.url 改写为
#      本机 dev server 地址后重传 MinIO（宿主再拉 manifest 即指向本机产物）；
#      --dev-url --reset：按正式产物 URL 重写并重传（恢复线上形态）
#
# 环境变量（测试底座默认值，全部可覆盖）：
#   MINIO_ENDPOINT   http://192.168.1.22:18814
#   MINIO_BUCKET     gis-platform-resources-test
#   MINIO_PUBLIC_URL http://192.168.1.22:18880/plugins
#   RM_API_BASE      http://192.168.1.22:18801/resource-manager/api/v1/package
#   MINIO_ACCESS_KEY / MINIO_SECRET_KEY  必填（无默认值；向平台管理员申请 ext-developer 凭据）
#   RM_TOKEN         管理端登录 token（可选；缺省匿名调用，服务端拒绝时按报错处理）
#   REGISTRY         localhost:32000（自构镜像引用推导用）
#   CHANGELOG        版本变更日志（缺省取 CHANGELOG.md 最新版本段，再无则 manifest description）
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PLUGIN_DIR=""
SKIP_BUILD="false"
DO_DEPLOY="false"
DEV_URL=""
DEV_MODE="false"
DEV_RESET="false"

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build) SKIP_BUILD="true"; shift ;;
        --deploy) DO_DEPLOY="true"; shift ;;
        -h|--help)
            sed -n '2,45p' "${BASH_SOURCE[0]}"
            exit 0
            ;;
        --dev-url)
            DEV_MODE="true"; shift
            if [ $# -gt 0 ] && [ "$1" != "--reset" ] && [[ "$1" != --* ]]; then
                DEV_URL="$1"; shift
            fi
            ;;
        --reset)
            if [ "${DEV_MODE}" = "true" ]; then
                DEV_RESET="true"; shift
            else
                echo "错误：--reset 必须与 --dev-url 连用（--dev-url --reset）"
                exit 1
            fi
            ;;
        --env|--env=*|--prod|prod|test)
            echo "错误：本脚本只打插件测试底座，不接受环境参数：$1"
            echo "      生产发布由平台管理员执行（平台仓 scripts/publish-extension.sh --env prod）"
            exit 1
            ;;
        *)
            if [ -z "${PLUGIN_DIR}" ]; then
                PLUGIN_DIR="$1"
            else
                echo "错误：无法识别的参数：$1"
                exit 1
            fi
            shift
            ;;
    esac
done

if [ -z "${PLUGIN_DIR}" ]; then
    echo "错误：请指定包目录（如 packages/<pkg-id>）"
    echo "用法：$(basename "$0") <package-dir> [--skip-build] [--deploy] [--dev-url <url> | --dev-url --reset]"
    exit 1
fi
if [ "${DEV_MODE}" = "true" ] && [ "${DEV_RESET}" = "false" ] && [ -z "${DEV_URL}" ]; then
    echo "错误：--dev-url 需要 URL 参数（--dev-url http://<ip>:<port>），或 --dev-url --reset 恢复正式产物"
    exit 1
fi

for cmd in jq curl python3; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "错误：本脚本依赖 ${cmd}"
        exit 1
    fi
done

PLUGIN_DIR="$(cd "${PLUGIN_DIR}" && pwd)"
MANIFEST_FILE="${PLUGIN_DIR}/manifest.json"
[ -f "${MANIFEST_FILE}" ] || { echo "错误：未找到 manifest.json"; exit 1; }

PACKAGE_ID=$(jq -r '.id // empty' "${MANIFEST_FILE}")
PACKAGE_NAME=$(jq -r '.name // empty' "${MANIFEST_FILE}")
VERSION=$(jq -r '.version // empty' "${MANIFEST_FILE}")
if [ -z "${PACKAGE_ID}" ] || [ -z "${PACKAGE_NAME}" ] || [ -z "${VERSION}" ]; then
    echo "错误：manifest.json 缺少必填字段 id/name/version"
    exit 1
fi
MANIFEST_TYPE=$(jq -r '.type // "extension"' "${MANIFEST_FILE}")
if [ "${MANIFEST_TYPE}" = "core" ]; then PACKAGE_TYPE="0"; else PACKAGE_TYPE="1"; fi
if [ "${MANIFEST_TYPE}" = "suite" ]; then PACKAGE_TYPE="2"; fi
PKG_DOMAIN=$(jq -r '.domain // ""' "${MANIFEST_FILE}")

# track/tier 显式必填（ADR-010 二维分类；无「目录==track/tier」闸口——模板仓布局为 packages/<id>/）
PKG_TRACK=$(jq -r '.track // empty' "${MANIFEST_FILE}")
if [ -z "${PKG_TRACK}" ]; then
    echo "错误：manifest.json 缺少必填字段 track（tool 工具轨 / system 系统轨）"
    exit 1
fi
case "${PKG_TRACK}" in
    tool|system) ;;
    *) echo "错误：manifest.json 的 track 取值非法：${PKG_TRACK}（仅支持 tool / system）"; exit 1 ;;
esac
PKG_TIER=$(jq -r '.tier // empty' "${MANIFEST_FILE}")
if [ -z "${PKG_TIER}" ]; then
    echo "错误：manifest.json 缺少必填字段 tier（platform 平台归属 / business 业务归属）"
    exit 1
fi
case "${PKG_TIER}" in
    platform|business) ;;
    *) echo "错误：manifest.json 的 tier 取值非法：${PKG_TIER}（仅支持 platform / business）"; exit 1 ;;
esac
PKG_DELIVERY=$(jq -r '.delivery // ""' "${MANIFEST_FILE}")
if [ -n "${PKG_DELIVERY}" ]; then
    case "${PKG_DELIVERY}" in
        bundled|optional) ;;
        *) echo "错误：manifest.json 的 delivery 取值非法：${PKG_DELIVERY}（仅支持 bundled / optional）"; exit 1 ;;
    esac
fi

SCOPE="${PKG_TRACK}/${PKG_TIER}"

# ---------- 0. components 段显式校验（与实际结构一致，禁止推导）----------
COMPONENTS_RAW=$(jq -c '.components // empty' "${MANIFEST_FILE}")
COMPONENTS_JSON=""
PKG_MENU_PATH=""
if [ -n "${COMPONENTS_RAW}" ]; then
    if [ "$(jq -r '.frontend // false' <<< "${COMPONENTS_RAW}")" = "true" ] && [ ! -f "${PLUGIN_DIR}/frontend/package.json" ]; then
        echo "错误：components.frontend=true 但包内无 frontend/package.json"
        exit 1
    fi
    if [ "$(jq -r '.adminUi // false' <<< "${COMPONENTS_RAW}")" = "true" ] && [ ! -f "${PLUGIN_DIR}/admin-ui/package.json" ]; then
        echo "错误：components.adminUi=true 但包内无 admin-ui/package.json"
        exit 1
    fi
    if [ "$(jq -r '.data // false' <<< "${COMPONENTS_RAW}")" = "true" ] && [ ! -d "${PLUGIN_DIR}/data" ]; then
        echo "错误：components.data=true 但包内无 data/ 目录"
        exit 1
    fi
    PKG_MENU_PATH=$(jq -r '.menu.menuPath // ""' <<< "${COMPONENTS_RAW}")
    if [ "$(jq -r '.menu.enabled // false' <<< "${COMPONENTS_RAW}")" = "true" ] && [ -z "${PKG_MENU_PATH}" ]; then
        echo "错误：components.menu.enabled=true 但缺少 components.menu.menuPath"
        exit 1
    fi
    BACKEND_IDS=$(jq -c '.backend // []' <<< "${COMPONENTS_RAW}")
    if [ "$(jq 'length' <<< "${BACKEND_IDS}")" -gt 0 ]; then
        UNKNOWN=$(jq -c --argjson ids "${BACKEND_IDS}" \
            '($ids - ((.backendServices // []) | map(.serviceId)))' "${MANIFEST_FILE}")
        if [ "${UNKNOWN}" != "[]" ]; then
            echo "错误：components.backend 声明了未在 backendServices 登记的服务：${UNKNOWN}"
            exit 1
        fi
    fi
    COMPONENTS_JSON=$(jq -c -n --argjson c "${COMPONENTS_RAW}" '{
        frontend: ($c.frontend // false),
        backend: ($c.backend // []),
        adminUi: ($c.adminUi // false),
        menu: ({enabled: ($c.menu.enabled // false)}
               + (if ($c.menu.menuPath // "") != "" then {menuPath: $c.menu.menuPath} else {} end)),
        data: ($c.data // false)
    }')
    echo "  components 段校验通过：${COMPONENTS_JSON}"
else
    echo "提示：manifest.json 未声明 components 段——建议补齐（显式声明、禁止推导）"
fi

# ---------- 0.c menu.json 本地校验（号段服务端台账在主仓侧提测评审时核对）----------
MENU_JSON_FILE="${PLUGIN_DIR}/data/menu.json"
HAS_MENU_JSON="false"
if [ -f "${MENU_JSON_FILE}" ]; then
    HAS_MENU_JSON="true"
    if ! python3 "${SCRIPT_DIR}/menujson.py" validate "${MENU_JSON_FILE}" --package "${PACKAGE_ID}"; then
        echo "错误：data/menu.json 未通过校验，已拒绝发布——修正后重试（规约见 docs/L6-参考契约.md 菜单章节）"
        exit 1
    fi
else
    if [ -n "${PKG_MENU_PATH}" ]; then
        echo "错误：components.menu.enabled=true 但包内无 data/menu.json——请补菜单声明文件"
        exit 1
    fi
fi

# ---------- 端点（测试底座默认值，全部可环境变量覆盖；凭据必填、无默认口令）----------
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://192.168.1.22:18814}"
MINIO_BUCKET="${MINIO_BUCKET:-gis-platform-resources-test}"
MINIO_PUBLIC_URL="${MINIO_PUBLIC_URL:-http://192.168.1.22:18880/plugins}"
RM_API_BASE="${RM_API_BASE:-http://192.168.1.22:18801/resource-manager/api/v1/package}"
REGISTRY="${REGISTRY:-localhost:32000}"
if [ -z "${MINIO_ACCESS_KEY:-}" ] || [ -z "${MINIO_SECRET_KEY:-}" ]; then
    echo "错误：请经环境变量提供 MinIO 凭据：MINIO_ACCESS_KEY / MINIO_SECRET_KEY"
    echo "      （向平台管理员申请 ext-developer 角色与测试底座凭据，见 test-env/README.md）"
    exit 1
fi
RM_TOKEN="${RM_TOKEN:-}"
if [ -z "${RM_TOKEN}" ]; then
    echo "提示：未提供 RM_TOKEN，resource-manager 调用将以匿名身份进行（服务端拒绝时按报错处理）"
fi

DIST_DIR="${PLUGIN_DIR}/frontend/dist"
OBJECT_PREFIX="${SCOPE}/${PACKAGE_ID}/${VERSION}/frontend"
HAS_FRONTEND="false"
[ -f "${PLUGIN_DIR}/frontend/package.json" ] && HAS_FRONTEND="true"
ADMIN_DIST_DIR="${PLUGIN_DIR}/admin-ui/dist"
ADMIN_OBJECT_PREFIX="${SCOPE}/${PACKAGE_ID}/${VERSION}/admin-ui"
HAS_ADMIN_UI="false"
if [ "${MANIFEST_TYPE}" != "suite" ] && [ -f "${PLUGIN_DIR}/admin-ui/package.json" ]; then
    HAS_ADMIN_UI="true"
fi
HAS_ADMIN_UI_DECL=$(jq -r 'if .adminUi then "true" else "false" end' "${MANIFEST_FILE}")

# ---------- s3_upload：MinIO SigV4 直传（与平台仓 publish-extension.sh 同实现）----------
content_type_of() {
    case "${1##*.}" in
        js|mjs) echo "application/javascript" ;;
        css) echo "text/css" ;;
        json|map) echo "application/json" ;;
        html|htm) echo "text/html" ;;
        svg) echo "image/svg+xml" ;;
        md|markdown) echo "text/markdown; charset=utf-8" ;;
        png) echo "image/png" ;;
        jpg|jpeg) echo "image/jpeg" ;;
        woff|woff2) echo "font/woff2" ;;
        *) echo "application/octet-stream" ;;
    esac
}

artifact_type_of() {
    local lower
    lower=$(tr '[:upper:]' '[:lower:]' <<< "$1")
    case "${lower}" in
        *.css) echo "css" ;;
        *.json) echo "manifest-json" ;;
        *.esm.*|*.mjs) echo "esm-js" ;;
        *.umd.*) echo "umd-js" ;;
        *.js) echo "esm-js" ;;
        *) echo "esm-js" ;;
    esac
}

admin_artifact_type_of() {
    local lower
    lower=$(tr '[:upper:]' '[:lower:]' <<< "$1")
    case "${lower}" in
        *.css) echo "admin-css" ;;
        *.esm.*|*.mjs) echo "admin-esm-js" ;;
        *.umd.*) echo "admin-umd-js" ;;
        *.js) echo "admin-esm-js" ;;
        *) echo "admin-esm-js" ;;
    esac
}

s3_upload() {
    # $1=本地文件 $2=对象 key $3=Content-Type
    local minio_host="${MINIO_ENDPOINT#http://}"
    minio_host="${minio_host#https://}"
    MINIO_HOST="${minio_host}" \
    MINIO_AK="${MINIO_ACCESS_KEY}" MINIO_SK="${MINIO_SECRET_KEY}" MINIO_BUCKET="${MINIO_BUCKET}" \
    MINIO_SCHEME="${MINIO_ENDPOINT%%://*}" \
    python3 - "$1" "$2" "$3" <<'PYEOF'
import os, sys, hashlib, hmac, datetime, urllib.request, urllib.error, socket
from urllib.parse import quote

local_path, object_key, content_type = sys.argv[1], sys.argv[2], sys.argv[3]
host = os.environ["MINIO_HOST"]
scheme = os.environ.get("MINIO_SCHEME", "http")
ak, sk, bucket = os.environ["MINIO_AK"], os.environ["MINIO_SK"], os.environ["MINIO_BUCKET"]
region, service = "us-east-1", "s3"

data = open(local_path, "rb").read()
payload_hash = hashlib.sha256(data).hexdigest()
now = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime("%Y%m%dT%H%M%SZ")
date_stamp = now.strftime("%Y%m%d")

# 非 ASCII 对象名（中文文件名）必须 percent-encode 进 URI，且签名与请求共用同一编码形态
canonical_uri = "/" + bucket + "/" + quote(object_key, safe="/")
canonical_headers = (
    f"content-type:{content_type}\n"
    f"host:{host}\n"
    f"x-amz-content-sha256:{payload_hash}\n"
    f"x-amz-date:{amz_date}\n"
)
signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
canonical_request = "\n".join(["PUT", canonical_uri, "", canonical_headers, signed_headers, payload_hash])
scope = f"{date_stamp}/{region}/{service}/aws4_request"
string_to_sign = "\n".join([
    "AWS4-HMAC-SHA256", amz_date, scope,
    hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
])
def sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
k_date = sign(("AWS4" + sk).encode("utf-8"), date_stamp)
k_region = sign(k_date, region)
k_service = sign(k_region, service)
k_signing = sign(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
auth = (f"AWS4-HMAC-SHA256 Credential={ak}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}")
req = urllib.request.Request(
    f"{scheme}://{host}{canonical_uri}", data=data, method="PUT",
    headers={
        "Content-Type": content_type,
        "X-Amz-Content-Sha256": payload_hash,
        "X-Amz-Date": amz_date,
        "Authorization": auth,
    })

# 友好报错：连接失败指认测试底座可达性（不抛裸栈），HTTP 错指认凭据/bucket
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status >= 300:
            sys.exit(f"MinIO 上传失败（HTTP {resp.status}）：{object_key}")
except urllib.error.HTTPError as e:
    sys.exit(
        f"MinIO 上传被拒（HTTP {e.code} {e.reason}）：{object_key}\n"
        f"  请检查 MINIO_ACCESS_KEY/MINIO_SECRET_KEY 凭据与 bucket（{bucket}）写权限"
    )
except (urllib.error.URLError, socket.timeout, TimeoutError, OSError) as e:
    reason = getattr(e, "reason", e)
    sys.exit(
        f"无法连接 MinIO（{scheme}://{host}）：{reason}\n"
        f"  请确认插件测试底座可达（地址表见 test-env/README.md），或经 MINIO_ENDPOINT 覆盖"
    )
PYEOF
}

# ---------- api_call：resource-manager 统一调用 ----------
AUTH_HEADER=()
if [ -n "${RM_TOKEN}" ]; then
    AUTH_HEADER=(-H "Authorization: Bearer ${RM_TOKEN}")
fi

api_call() {
    # $1=method $2=path $3=json-body(可空)
    local method="$1" path="$2" body="${3:-}"
    local args=(-s -X "${method}" --connect-timeout 10 --max-time 60
        -H "Content-Type: application/json; charset=utf-8")
    if [ -n "${body}" ]; then
        args+=(--data-binary "${body}")
    fi
    local resp curl_rc=0
    resp=$(curl "${args[@]}" ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} "${RM_API_BASE}${path}") || curl_rc=$?
    if [ "${curl_rc}" -ne 0 ]; then
        echo "错误：无法连接 resource-manager（${RM_API_BASE}）：curl 退出码 ${curl_rc}"
        echo "      请确认插件测试底座可达（地址表见 test-env/README.md），或经 RM_API_BASE 覆盖"
        exit 1
    fi
    local code
    code=$(jq -r '.code // empty' <<< "${resp}" 2>/dev/null || true)
    if [ "${code}" != "200" ]; then
        echo "错误：API ${method} ${path} 返回异常：${resp}"
        if grep -q "401" <<< "${resp}"; then
            echo "提示：请经 RM_TOKEN 环境变量提供管理端登录 token（ext-developer 账号）"
        fi
        exit 1
    fi
    echo "${resp}"
}

# dev-url 对象 key 与正式发布一致（manifest.json 固定在版本目录的 frontend|admin-ui 下）
if [ "${HAS_FRONTEND}" = "true" ]; then
    MANIFEST_KEY="${OBJECT_PREFIX}/manifest.json"
else
    MANIFEST_KEY="${ADMIN_OBJECT_PREFIX}/manifest.json"
fi

# ---------- --dev-url 模式：HMR 调试回路（改写已发布 manifest 的 entries.esm.url）----------
if [ "${DEV_MODE}" = "true" ]; then
    echo "=========================================="
    echo "dev-url 模式：${PACKAGE_ID}@${VERSION}"
    if [ "${DEV_RESET}" = "true" ]; then
        echo "动作：恢复正式产物 URL（按 dist 产物重算 entries.url）"
    else
        echo "动作：entries.esm.url → ${DEV_URL}"
    fi
    echo "=========================================="
    DEV_MANIFEST="$(mktemp -t dev-manifest.XXXXXX).json"
    trap 'rm -f "${DEV_MANIFEST}"' EXIT
    cp "${MANIFEST_FILE}" "${DEV_MANIFEST}"
    if [ "${DEV_RESET}" = "false" ]; then
        jq --arg url "${DEV_URL}" '.entries.esm.url = $url' "${DEV_MANIFEST}" > "${DEV_MANIFEST}.tmp" \
            && mv "${DEV_MANIFEST}.tmp" "${DEV_MANIFEST}"
    else
        if [ ! -d "${DIST_DIR}" ] || [ -z "$(ls -A "${DIST_DIR}" 2>/dev/null)" ]; then
            echo "错误：--dev-url --reset 需要正式产物（frontend/dist 为空）——先正常发布或去掉 --skip-build 构建"
            exit 1
        fi
        for file in "${DIST_DIR}"/*; do
            [ -f "${file}" ] || continue
            fname=$(basename "${file}")
            url="${MINIO_PUBLIC_URL}/${OBJECT_PREFIX}/${fname}"
            atype=$(artifact_type_of "${fname}")
            if [ "${atype}" = "esm-js" ]; then
                jq --arg url "${url}" '.entries.esm.url = $url' "${DEV_MANIFEST}" > "${DEV_MANIFEST}.tmp" && mv "${DEV_MANIFEST}.tmp" "${DEV_MANIFEST}"
            elif [ "${atype}" = "umd-js" ]; then
                jq --arg url "${url}" '.entries.umd.url = $url' "${DEV_MANIFEST}" > "${DEV_MANIFEST}.tmp" && mv "${DEV_MANIFEST}.tmp" "${DEV_MANIFEST}"
            elif [ "${atype}" = "css" ]; then
                jq --arg url "${url}" '.entries.css.url = $url' "${DEV_MANIFEST}" > "${DEV_MANIFEST}.tmp" && mv "${DEV_MANIFEST}.tmp" "${DEV_MANIFEST}"
            fi
        done
    fi
    jq --arg v "${VERSION}" '.version = $v' "${DEV_MANIFEST}" > "${DEV_MANIFEST}.tmp" && mv "${DEV_MANIFEST}.tmp" "${DEV_MANIFEST}"
    s3_upload "${DEV_MANIFEST}" "${MANIFEST_KEY}" "application/json"
    echo "  已上传 ${MANIFEST_KEY}"
    # 触达 resource-manager 更新接口（幂等刷新 manifest-json 资源记录，顺带校验连通性/鉴权）
    EXISTING=$(curl -s -H "Content-Type: application/json; charset=utf-8" ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} \
        "${RM_API_BASE}/${PACKAGE_ID}/version/${VERSION}/resource/list" || true)
    ROW=$(jq -c '.data // [] | map(select(.artifactType == "manifest-json")) | .[0] // empty' <<< "${EXISTING}" 2>/dev/null || true)
    if [ -n "${ROW}" ]; then
        MANIFEST_RES_URL=$(jq -r '.artifactUrl' <<< "${ROW}")
        RES_BODY=$(jq -n \
            --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" \
            --arg url "${MANIFEST_RES_URL}" \
            '{packageId: $pid, version: $v, resourceType: "frontend", resourceName: "manifest.json", artifactType: "manifest-json", artifactUrl: $url, required: 1}')
        api_call PUT "/${PACKAGE_ID}/version/${VERSION}/resource" "${RES_BODY}" >/dev/null
        echo "  resource-manager manifest-json 资源记录已刷新"
    else
        echo "提示：未找到 manifest-json 资源记录（该版本可能未发布过）——先正常发布一次再进 dev-url 模式"
    fi
    if [ "${DEV_RESET}" = "false" ]; then
        echo "------------------------------------------"
        echo "HMR 调试回路已建立，宿主端再拉取 manifest 即加载本机产物："
        echo "  1. 前端 watch 构建：cd ${PLUGIN_DIR}/frontend && npm run dev"
        echo "  2. 静态服务产物（示例，端口自定）：cd ${PLUGIN_DIR}/frontend/dist && python3 -m http.server <port>"
        echo "     （本机 IP 需让测试底座球端可直达；跨域受限时以静态服务响应头放行为准）"
        echo "  3. 调试完恢复：./tools/publish.sh ${PLUGIN_DIR#"${REPO_ROOT}/"} --dev-url --reset"
    else
        echo "------------------------------------------"
        echo "已恢复正式产物 URL：${MINIO_PUBLIC_URL}/${OBJECT_PREFIX}/"
    fi
    echo "=========================================="
    exit 0
fi

# ---------- 1. 构建 ----------
echo "=========================================="
echo "发布扩展能力包 ${PACKAGE_ID}@${VERSION}（scope=${SCOPE}，env=test）"
echo "MinIO：${MINIO_ENDPOINT}/${MINIO_BUCKET}/${OBJECT_PREFIX}/"
echo "API：${RM_API_BASE}"
echo "=========================================="

if [ "${MANIFEST_TYPE}" = "suite" ]; then
    echo "[1/5] suite 虚拟聚合包：零产物，跳过构建"
elif [ "${HAS_FRONTEND}" != "true" ]; then
    echo "[1/5] 无 frontend/package.json，跳过前端构建"
elif [ "${SKIP_BUILD}" != "true" ]; then
    echo "[1/5] 构建前端 ..."
    if [ ! -d "${REPO_ROOT}/node_modules" ]; then
        (cd "${REPO_ROOT}" && npm install)
    fi
    (cd "${PLUGIN_DIR}/frontend" && npm run build)
else
    echo "[1/5] --skip-build，跳过前端构建"
fi

if [ "${HAS_FRONTEND}" = "true" ]; then
    if [ ! -d "${DIST_DIR}" ] || [ -z "$(ls -A "${DIST_DIR}" 2>/dev/null)" ]; then
        echo "错误：前端产物目录 ${DIST_DIR} 不存在或为空"
        exit 1
    fi
fi

if [ "${HAS_ADMIN_UI}" = "true" ]; then
    if [ "${SKIP_BUILD}" != "true" ]; then
        echo "[1/5] 构建管理端远程页面（admin-ui） ..."
        if [ ! -d "${REPO_ROOT}/node_modules" ]; then
            (cd "${REPO_ROOT}" && npm install)
        fi
        (cd "${PLUGIN_DIR}/admin-ui" && npm run build)
    else
        echo "[1/5] --skip-build，跳过 admin-ui 构建"
    fi
    if [ ! -d "${ADMIN_DIST_DIR}" ] || [ -z "$(ls -A "${ADMIN_DIST_DIR}" 2>/dev/null)" ]; then
        echo "错误：admin-ui 产物目录 ${ADMIN_DIST_DIR} 不存在或为空"
        exit 1
    fi
fi

# ---------- 2. MinIO 上传 ----------
echo "[2/5] 上传产物到 MinIO ..."
UPLOADED_FILES=()
ADMIN_UPLOADED_FILES=()
if [ "${MANIFEST_TYPE}" != "suite" ]; then
    if [ "${HAS_FRONTEND}" = "true" ]; then
        for file in "${DIST_DIR}"/*; do
            [ -f "${file}" ] || continue
            fname=$(basename "${file}")
            s3_upload "${file}" "${OBJECT_PREFIX}/${fname}" "$(content_type_of "${fname}")"
            echo "  已上传 ${OBJECT_PREFIX}/${fname}"
            UPLOADED_FILES+=("${fname}")
        done
    fi
    if [ "${HAS_ADMIN_UI}" = "true" ]; then
        for file in "${ADMIN_DIST_DIR}"/*; do
            [ -f "${file}" ] || continue
            fname=$(basename "${file}")
            s3_upload "${file}" "${ADMIN_OBJECT_PREFIX}/${fname}" "$(content_type_of "${fname}")"
            echo "  已上传 ${ADMIN_OBJECT_PREFIX}/${fname}"
            ADMIN_UPLOADED_FILES+=("${fname}")
        done
        # 子目录附属资产（如 docs/ 离线文档）：递归上传保留相对路径，不登记资源
        find "${ADMIN_DIST_DIR}" -mindepth 2 -type f | while read -r file; do
            rel="${file#"${ADMIN_DIST_DIR}"/}"
            s3_upload "${file}" "${ADMIN_OBJECT_PREFIX}/${rel}" "$(content_type_of "${rel}")"
            echo "  已上传 ${ADMIN_OBJECT_PREFIX}/${rel}"
        done
    fi

    # 回填 entries.url 的 manifest.json 一并上传（仓库内源文件保持不回填）
    FILLED_MANIFEST="$(mktemp -t manifest.XXXXXX).json"
    CLEANUP_PATHS=("${FILLED_MANIFEST}")
    trap 'rm -rf "${CLEANUP_PATHS[@]}"' EXIT
    cp "${MANIFEST_FILE}" "${FILLED_MANIFEST}"
    if [ "${#UPLOADED_FILES[@]}" -gt 0 ]; then
        for fname in "${UPLOADED_FILES[@]}"; do
            url="${MINIO_PUBLIC_URL}/${OBJECT_PREFIX}/${fname}"
            atype=$(artifact_type_of "${fname}")
            if [ "${atype}" = "esm-js" ]; then
                jq --arg url "${url}" '.entries.esm.url = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
            elif [ "${atype}" = "umd-js" ]; then
                jq --arg url "${url}" '.entries.umd.url = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
            elif [ "${atype}" = "css" ]; then
                jq --arg url "${url}" '.entries.css.url = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
            fi
        done
    fi
    if [ "${HAS_ADMIN_UI_DECL}" = "true" ] && [ "${#ADMIN_UPLOADED_FILES[@]}" -gt 0 ]; then
        for fname in "${ADMIN_UPLOADED_FILES[@]}"; do
            url="${MINIO_PUBLIC_URL}/${ADMIN_OBJECT_PREFIX}/${fname}"
            atype=$(admin_artifact_type_of "${fname}")
            if [ "${atype}" = "admin-esm-js" ]; then
                jq --arg url "${url}" '.adminUi.url = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
            elif [ "${atype}" = "admin-css" ]; then
                jq --arg url "${url}" '.adminUi.cssUrl = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
            fi
        done
    fi
    jq --arg v "${VERSION}" '.version = $v' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
    s3_upload "${FILLED_MANIFEST}" "${MANIFEST_KEY}" "application/json"
    echo "  已上传 ${MANIFEST_KEY}（entries.url 已回填）"

    # menu.json 上传（key 固定版本目录顶层，menu-provision 按资源记录回 MinIO 取件）
    MENU_JSON_KEY="${SCOPE}/${PACKAGE_ID}/${VERSION}/menu.json"
    MENU_JSON_URL="${MINIO_PUBLIC_URL}/${MENU_JSON_KEY}"
    if [ "${HAS_MENU_JSON}" = "true" ]; then
        s3_upload "${MENU_JSON_FILE}" "${MENU_JSON_KEY}" "application/json"
        echo "  已上传 ${MENU_JSON_KEY}"
    fi
else
    echo "[2/5] suite 虚拟聚合包：零产物，跳过 MinIO 上传"
fi

# ---------- 3. resource-manager 注册 ----------
echo "[3/5] 注册到 resource-manager ..."

PKG_DESC=$(jq -r '.description // ""' "${MANIFEST_FILE}")
PKG_ICON=$(jq -r '.icon // ""' "${MANIFEST_FILE}")
PKG_AUTHOR=$(jq -r '.author // ""' "${MANIFEST_FILE}")
if [ -z "${PKG_ICON}" ]; then
    echo "错误：manifest.json 缺少 icon 字段（Element Plus 图标名，如 MapLocation）" >&2
    exit 1
fi
CHECK=$(curl -s -H "Content-Type: application/json; charset=utf-8" ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} "${RM_API_BASE}/${PACKAGE_ID}" || true)
CHECK_CODE=$(jq -r '.code // empty' <<< "${CHECK}" 2>/dev/null || true)
if [ "${CHECK_CODE}" != "200" ]; then
    echo "  创建能力包 ${PACKAGE_ID}（track=${PKG_TRACK} tier=${PKG_TIER}${PKG_DELIVERY:+ delivery=${PKG_DELIVERY}}${PKG_DOMAIN:+ domain=${PKG_DOMAIN}}）..."
    CREATE_BODY=$(jq -n \
        --arg pid "${PACKAGE_ID}" --arg name "${PACKAGE_NAME}" --arg ptype "${PACKAGE_TYPE}" \
        --arg domain "${PKG_DOMAIN}" \
        --arg track "${PKG_TRACK}" --arg tier "${PKG_TIER}" --arg delivery "${PKG_DELIVERY}" \
        --arg desc "${PKG_DESC}" --arg icon "${PKG_ICON}" --arg author "${PKG_AUTHOR}" \
        --arg components "${COMPONENTS_JSON}" --arg menuPath "${PKG_MENU_PATH}" \
        '{packageId: $pid, packageName: $name, packageType: $ptype, track: $track, tier: $tier, description: $desc, icon: $icon, author: $author}
         + (if $domain != "" then {domain: $domain} else {} end)
         + (if $delivery != "" then {delivery: $delivery} else {} end)
         + (if $components != "" then {components: $components} else {} end)
         + (if $menuPath != "" then {menuPath: $menuPath} else {} end)')
    api_call POST "" "${CREATE_BODY}" >/dev/null
else
    echo "  能力包 ${PACKAGE_ID} 已存在，同步基础信息..."
    UPDATE_BODY=$(jq -n \
        --arg pid "${PACKAGE_ID}" --arg name "${PACKAGE_NAME}" --arg ptype "${PACKAGE_TYPE}" \
        --arg domain "${PKG_DOMAIN}" \
        --arg track "${PKG_TRACK}" --arg tier "${PKG_TIER}" --arg delivery "${PKG_DELIVERY}" \
        --arg desc "${PKG_DESC}" --arg icon "${PKG_ICON}" --arg author "${PKG_AUTHOR}" \
        --arg components "${COMPONENTS_JSON}" --arg menuPath "${PKG_MENU_PATH}" \
        '{packageId: $pid, packageName: $name, packageType: $ptype, track: $track, tier: $tier, description: $desc, icon: $icon, author: $author}
         + (if $domain != "" then {domain: $domain} else {} end)
         + (if $delivery != "" then {delivery: $delivery} else {} end)
         + (if $components != "" then {components: $components} else {} end)
         + (if $menuPath != "" then {menuPath: $menuPath} else {} end)')
    api_call PUT "/${PACKAGE_ID}" "${UPDATE_BODY}" >/dev/null
fi

# 3.2 注册版本（changelog：环境变量 > CHANGELOG.md 最新版本段 > manifest description）
CHANGELOG_FROM_FILE=""
PKG_CHANGELOG_FILE="${PLUGIN_DIR}/CHANGELOG.md"
if [ -f "${PKG_CHANGELOG_FILE}" ]; then
    CHANGELOG_FROM_FILE=$(awk '
        /^## \[/ { if (seen) exit; seen = 1; next }
        !seen { next }
        !started && /^[[:space:]]*$/ { next }
        { started = 1; lines[++n] = $0; if ($0 !~ /^[[:space:]]*$/) last = n }
        END { for (i = 1; i <= last; i++) print lines[i] }
    ' "${PKG_CHANGELOG_FILE}")
fi
if [ -n "${CHANGELOG:-}" ]; then
    CHANGELOG_TEXT="${CHANGELOG}"
elif [ -n "${CHANGELOG_FROM_FILE}" ]; then
    CHANGELOG_TEXT="${CHANGELOG_FROM_FILE}"
    echo "  changelog 取自 CHANGELOG.md 最新版本段"
else
    CHANGELOG_TEXT="${PKG_DESC}"
fi
DEFAULT_CONFIG=$(jq -c '.defaultConfig // empty' "${MANIFEST_FILE}")
echo "  注册版本 ${VERSION} ..."
if [ -n "${DEFAULT_CONFIG}" ]; then
    VERSION_BODY=$(jq -n \
        --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" --arg cl "${CHANGELOG_TEXT}" \
        --argjson dc "${DEFAULT_CONFIG}" \
        '{packageId: $pid, version: $v, changelog: $cl, isDefault: 1, defaultConfig: ($dc | tojson)}')
else
    VERSION_BODY=$(jq -n \
        --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" --arg cl "${CHANGELOG_TEXT}" \
        '{packageId: $pid, version: $v, changelog: $cl, isDefault: 1}')
fi
api_call POST "/${PACKAGE_ID}/version" "${VERSION_BODY}" >/dev/null

# 3.2.1 依赖声明登记（suite 取 members 生成 pin 依赖）
if [ "${MANIFEST_TYPE}" = "suite" ]; then
    DEPENDS_ON=$(jq -c '.members // []' "${MANIFEST_FILE}")
    DEP_COUNT=$(jq 'length' <<< "${DEPENDS_ON}")
    if [ "${DEP_COUNT}" -eq 0 ]; then
        echo "错误：suite 包 manifest.json 缺少 members（[{packageId,version}]，至少 1 个成员）"
        exit 1
    fi
    DEP_BODY=$(jq -c '[.[] | {dependsOnPackageId: .packageId, minVersion: .version, maxVersion: .version}]' <<< "${DEPENDS_ON}")
    echo "  登记 suite 成员 pin 依赖（${DEP_COUNT} 个成员）..."
else
    DEPENDS_ON=$(jq -c '.dependsOnPackages // []' "${MANIFEST_FILE}")
    DEP_COUNT=$(jq 'length' <<< "${DEPENDS_ON}")
    DEP_BODY=$(jq -c '[.[] | {dependsOnPackageId: .packageId, minVersion: (.minVersion // null), maxVersion: (.maxVersion // null)}]' <<< "${DEPENDS_ON}")
    echo "  登记依赖声明（${DEP_COUNT} 条）..."
fi
api_call POST "/${PACKAGE_ID}/version/${VERSION}/dependencies" "${DEP_BODY}" >/dev/null

# 3.3-3.5 资源 upsert（非 suite）
if [ "${MANIFEST_TYPE}" != "suite" ]; then
EXISTING=$(curl -s -H "Content-Type: application/json; charset=utf-8" ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} \
    "${RM_API_BASE}/${PACKAGE_ID}/version/${VERSION}/resource/list" || true)

upsert_resource() {
    # $1=resourceName $2=json-body（匹配键含 artifactType，防止 admin-ui 与前端通道同名互吞）
    local name="$1" body="$2"
    local rtype atype row
    rtype=$(jq -r '.resourceType' <<< "${body}")
    atype=$(jq -r '.artifactType' <<< "${body}")
    row=$(jq -c --arg n "${name}" --arg t "${rtype}" --arg a "${atype}" \
        '.data // [] | map(select(.resourceName == $n and .resourceType == $t and (.artifactType // "") == $a)) | .[0] // empty' \
        <<< "${EXISTING}" 2>/dev/null || true)
    if [ -z "${row}" ]; then
        api_call POST "/${PACKAGE_ID}/version/${VERSION}/resource" "${body}" >/dev/null
        echo "  登记资源 ${name}"
        return
    fi
    local diff_fields
    diff_fields=$(jq -nr --argjson cur "${row}" --argjson want "${body}" '
        (["artifactUrl","artifactType","artifactVersion","serviceId","apiPrefix","healthEndpoint"]
            | map(select(($cur[.] // "") != ($want[.] // "")) | .))
        + (["required","sortNo"]
            | map(select((($cur[.] // 0) | tonumber) != (($want[.] // 0) | tonumber)) | .))
        | join(",")
    ' 2>/dev/null || true)
    if [ -z "${diff_fields}" ]; then
        echo "  资源 ${name} 已存在且一致，跳过"
        return
    fi
    api_call PUT "/${PACKAGE_ID}/version/${VERSION}/resource" "${body}" >/dev/null
    echo "  资源 ${name} 已存在，字段有差异（${diff_fields}），已刷新"
}

if [ "${HAS_FRONTEND}" = "true" ]; then
    for fname in "${UPLOADED_FILES[@]}"; do
        url="${MINIO_PUBLIC_URL}/${OBJECT_PREFIX}/${fname}"
        atype=$(artifact_type_of "${fname}")
        RES_BODY=$(jq -n \
            --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" --arg rn "${fname}" \
            --arg at "${atype}" --arg url "${url}" \
            '{packageId: $pid, version: $v, resourceType: "frontend", resourceName: $rn, artifactType: $at, artifactUrl: $url, required: 1}')
        upsert_resource "${fname}" "${RES_BODY}"
    done
    MANIFEST_RES_BODY=$(jq -n \
        --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" \
        --arg url "${MINIO_PUBLIC_URL}/${MANIFEST_KEY}" \
        '{packageId: $pid, version: $v, resourceType: "frontend", resourceName: "manifest.json", artifactType: "manifest-json", artifactUrl: $url, required: 1}')
    upsert_resource "manifest.json" "${MANIFEST_RES_BODY}"
fi

if [ "${HAS_ADMIN_UI}" = "true" ]; then
    for fname in "${ADMIN_UPLOADED_FILES[@]}"; do
        url="${MINIO_PUBLIC_URL}/${ADMIN_OBJECT_PREFIX}/${fname}"
        atype=$(admin_artifact_type_of "${fname}")
        RES_BODY=$(jq -n \
            --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" --arg rn "${fname}" \
            --arg at "${atype}" --arg url "${url}" \
            '{packageId: $pid, version: $v, resourceType: "frontend", resourceName: $rn, artifactType: $at, artifactUrl: $url, required: 1}')
        upsert_resource "${fname}" "${RES_BODY}"
    done
    if [ "${HAS_FRONTEND}" != "true" ]; then
        MANIFEST_RES_BODY=$(jq -n \
            --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" \
            --arg url "${MINIO_PUBLIC_URL}/${MANIFEST_KEY}" \
            '{packageId: $pid, version: $v, resourceType: "frontend", resourceName: "manifest.json", artifactType: "manifest-json", artifactUrl: $url, required: 1}')
        upsert_resource "manifest.json" "${MANIFEST_RES_BODY}"
    fi
fi

if [ "${HAS_MENU_JSON}" = "true" ]; then
    MENU_RES_BODY=$(jq -n \
        --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" --arg url "${MENU_JSON_URL}" \
        '{packageId: $pid, version: $v, resourceType: "data", resourceName: "menu.json", artifactType: "menu-json", artifactUrl: $url, required: 1}')
    upsert_resource "menu.json" "${MENU_RES_BODY}"
fi

# 3.4 后端服务镜像资源（imageSource=self 按约定推导；upstream 原样登记；
#     dependsOn 拓扑序决定 sort_no——实现同平台仓 publish-extension.sh）
topo_sort_services() {
    local json="$1"
    local n i j
    n=$(jq 'length' <<< "${json}")
    [ "${n}" -eq 0 ] && return 0
    local deps_tsv
    if ! deps_tsv=$(jq -r '
        (map(.serviceId)) as $ids
        | .[] | . as $s
        | (($s.dependsOn // []) - $ids) as $unknown
        | if ($unknown | length) > 0 then
            "服务 \($s.serviceId) 的 dependsOn 引用了未声明服务：\($unknown | join(", "))" | error
          else
            "\($s.serviceId)\t\((($s.dependsOn // []) | join(" ")))"
          end
    ' <<< "${json}"); then
        return 1
    fi
    local -a ids=() deps=()
    local sid rest d
    while IFS=$'\t' read -r sid rest; do
        ids+=("${sid}")
        deps+=("${rest}")
    done <<< "${deps_tsv}"
    local -a state=() order=()
    for ((i = 0; i < n; i++)); do state[$i]=""; done
    local remaining="${n}" progressed ready
    while [ "${remaining}" -gt 0 ]; do
        progressed="false"
        for ((i = 0; i < n; i++)); do
            [ -n "${state[$i]:-}" ] && continue
            ready="true"
            for d in ${deps[$i]:-}; do
                for ((j = 0; j < n; j++)); do
                    if [ "${ids[$j]}" = "${d}" ] && [ -z "${state[$j]:-}" ]; then
                        ready="false"
                        break
                    fi
                done
                [ "${ready}" = "false" ] && break
            done
            if [ "${ready}" = "true" ]; then
                order+=("${ids[$i]}")
                state[$i]="1"
                remaining=$((remaining - 1))
                progressed="true"
            fi
        done
        if [ "${progressed}" != "true" ]; then
            echo "错误：backendServices 的 dependsOn 存在循环依赖，请检查 manifest.json" >&2
            return 1
        fi
    done
    printf '%s\n' "${order[@]}"
}

BACKEND_SERVICES_JSON=$(jq -c '.backendServices // []' "${MANIFEST_FILE}")
SVC_COUNT=$(jq 'length' <<< "${BACKEND_SERVICES_JSON}")
if [ "${SVC_COUNT}" -gt 0 ]; then
    SORTED_SVC_IDS=$(topo_sort_services "${BACKEND_SERVICES_JSON}")
    SORT_NO=0
    while IFS= read -r SVC_ID; do
        [ -z "${SVC_ID}" ] && continue
        SORT_NO=$((SORT_NO + 1))
        row=$(jq -c --arg sid "${SVC_ID}" '.[] | select(.serviceId == $sid)' <<< "${BACKEND_SERVICES_JSON}")
        SVC_NAME=$(jq -r '.name // .serviceId' <<< "${row}")
        SVC_PREFIX=$(jq -r '.apiPrefix // ""' <<< "${row}")
        SVC_HEALTH=$(jq -r '.healthEndpoint // ""' <<< "${row}")
        SVC_MINVER=$(jq -r '.minVersion // ""' <<< "${row}")
        SVC_REQUIRED=$(jq -r 'if .required then 1 else 0 end' <<< "${row}")
        IMAGE_SOURCE=$(jq -r '.imageSource // "self"' <<< "${row}")
        case "${IMAGE_SOURCE}" in
            self)
                SVC_VERSION_FILE="${PLUGIN_DIR}/container/${SVC_ID}/VERSION"
                if [ -f "${SVC_VERSION_FILE}" ]; then
                    SVC_VERSION=$(tr -d '[:space:]' < "${SVC_VERSION_FILE}")
                    [ -z "${SVC_VERSION}" ] && { echo "错误：${SVC_VERSION_FILE} 内容为空"; exit 1; }
                else
                    SVC_VERSION="${VERSION}"
                fi
                IMAGE_REF="${REGISTRY}/gis-platform/${SCOPE}/${PACKAGE_ID}/${SVC_ID}:${SVC_VERSION}"
                ;;
            upstream)
                IMAGE_REF=$(jq -r '.image // ""' <<< "${row}")
                if [ -z "${IMAGE_REF}" ]; then
                    echo "错误：backendServices[${SVC_ID}] imageSource=upstream 但未声明 image 字段"
                    exit 1
                fi
                ;;
            *)
                echo "错误：backendServices[${SVC_ID}] imageSource 取值非法：${IMAGE_SOURCE}（仅支持 self/upstream）"
                exit 1
                ;;
        esac
        RES_BODY=$(jq -n \
            --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" --arg rn "${SVC_NAME}" \
            --arg url "${IMAGE_REF}" --arg sid "${SVC_ID}" --arg ap "${SVC_PREFIX}" \
            --arg he "${SVC_HEALTH}" --arg av "${SVC_MINVER}" --argjson req "${SVC_REQUIRED}" \
            --argjson sn "${SORT_NO}" \
            '{packageId: $pid, version: $v, resourceType: "backend", resourceName: $rn, artifactType: "docker-image", artifactUrl: $url, artifactVersion: $av, serviceId: $sid, apiPrefix: $ap, healthEndpoint: $he, required: $req, sortNo: $sn}')
        upsert_resource "${SVC_NAME}" "${RES_BODY}"
    done <<< "${SORTED_SVC_IDS}"
fi

# 3.5 k8s 部署包（deploy/k8s/ 存在时）：拍平打包上传登记
BUNDLE_DIR="${PLUGIN_DIR}/deploy/k8s"
K8S_BUNDLE_ENABLED=$(jq -r 'if .k8sBundle == false then "false" else "true" end' "${MANIFEST_FILE}")
if [ -d "${BUNDLE_DIR}" ] && [ "${K8S_BUNDLE_ENABLED}" = "true" ]; then
    echo "  检测到 deploy/k8s/，打包 k8s-bundle ..."
    BUNDLE_TMP="$(mktemp -d -t k8s-bundle.XXXXXX)"
    CLEANUP_PATHS+=("${BUNDLE_TMP}")
    BUNDLE_YAML="${BUNDLE_TMP}/k8s-bundle.yaml"
    if [ -f "${BUNDLE_DIR}/kustomization.yaml" ] || [ -f "${BUNDLE_DIR}/kustomization.yml" ]; then
        if ! command -v kubectl >/dev/null 2>&1; then
            echo "错误：deploy/k8s/ 含 kustomization.yaml，需要 kubectl 拍平，但本机未安装 kubectl"
            exit 1
        fi
        kubectl kustomize "${BUNDLE_DIR}" > "${BUNDLE_YAML}"
    else
        shopt -s nullglob
        YAML_FILES=("${BUNDLE_DIR}"/*.yaml)
        shopt -u nullglob
        if [ "${#YAML_FILES[@]}" -eq 0 ]; then
            echo "错误：deploy/k8s/ 既无 kustomization.yaml 也无 *.yaml 文件"
            exit 1
        fi
        : > "${BUNDLE_YAML}"
        FIRST_DOC="true"
        for f in "${YAML_FILES[@]}"; do
            if [ "${FIRST_DOC}" != "true" ] \
                && [ "$(tail -n 1 "${BUNDLE_YAML}" | tr -d '[:space:]')" != "---" ] \
                && [ "$(grep -m 1 -v '^[[:space:]]*$' "${f}" | tr -d '[:space:]')" != "---" ]; then
                echo "---" >> "${BUNDLE_YAML}"
            fi
            cat "${f}" >> "${BUNDLE_YAML}"
            [ -n "$(tail -c 1 "${BUNDLE_YAML}")" ] && echo "" >> "${BUNDLE_YAML}"
            FIRST_DOC="false"
        done
    fi
    tar -czf "${BUNDLE_TMP}/k8s-bundle.tar.gz" -C "${BUNDLE_TMP}" k8s-bundle.yaml
    BUNDLE_KEY="${SCOPE}/${PACKAGE_ID}/${VERSION}/k8s-bundle.tar.gz"
    s3_upload "${BUNDLE_TMP}/k8s-bundle.tar.gz" "${BUNDLE_KEY}" "application/gzip"
    echo "  已上传 ${BUNDLE_KEY}"
    BUNDLE_RES_BODY=$(jq -n \
        --arg pid "${PACKAGE_ID}" --arg v "${VERSION}" \
        --arg url "${MINIO_PUBLIC_URL}/${BUNDLE_KEY}" \
        '{packageId: $pid, version: $v, resourceType: "backend", resourceName: "k8s-bundle", artifactType: "k8s-bundle", artifactUrl: $url, required: 1}')
    upsert_resource "k8s-bundle" "${BUNDLE_RES_BODY}"
fi
fi # /3.3-3.5 非 suite

# 3.6 发布版本
echo "  发布版本 ${VERSION} ..."
api_call PUT "/${PACKAGE_ID}/version/${VERSION}/publish" '{"publishStatus": 1}' >/dev/null

# 3.7 菜单布设（menu-provision，服务端幂等 upsert）
MENU_PROVISION_OK="false"
if [ "${MANIFEST_TYPE}" != "suite" ] && [ "${HAS_MENU_JSON}" = "true" ]; then
    echo "  菜单布设（menu-provision，version=${VERSION}）..."
    PROV_RESP=$(api_call POST "/${PACKAGE_ID}/menu-provision" "$(jq -n --arg v "${VERSION}" '{version: $v}')")
    MENU_PROVISION_OK="true"
    echo "  菜单布设完成：total=$(jq -r '.data.total' <<< "${PROV_RESP}")" \
        "inserted=$(jq -r '.data.inserted' <<< "${PROV_RESP}")" \
        "updated=$(jq -r '.data.updated' <<< "${PROV_RESP}")" \
        "unchanged=$(jq -r '.data.unchanged' <<< "${PROV_RESP}")" \
        "roleBindingsAdded=$(jq -r '.data.roleBindingsAdded' <<< "${PROV_RESP}")"
    PROV_WARNINGS=$(jq -r '.data.warnings // [] | .[]' <<< "${PROV_RESP}" 2>/dev/null || true)
    if [ -n "${PROV_WARNINGS}" ]; then
        while IFS= read -r w; do echo "  ⚠️  menu-provision 告警：${w}"; done <<< "${PROV_WARNINGS}"
    fi
fi

# ---------- 4. 可选部署 ----------
if [ "${DO_DEPLOY}" = "true" ]; then
    echo "[4/5] 触发版本部署 ..."
    DEPLOY_RESP=$(api_call POST "/${PACKAGE_ID}/version/${VERSION}/deploy" "")
    if jq -e '.data.results | type == "array"' <<< "${DEPLOY_RESP}" >/dev/null 2>&1; then
        BUNDLE_APPLIED=$(jq -r '.data.bundleApplied // false' <<< "${DEPLOY_RESP}")
        BUNDLE_MSG=$(jq -r '.data.bundleMessage // ""' <<< "${DEPLOY_RESP}")
        [ -n "${BUNDLE_MSG}" ] && echo "  k8s-bundle：${BUNDLE_MSG}"
        DEPLOY_FAILED="false"
        while IFS= read -r comp; do
            C_SVC=$(jq -r '.serviceId // "-"' <<< "${comp}")
            C_STATUS=$(jq -r '.status // "unknown"' <<< "${comp}")
            C_MSG=$(jq -r '.message // ""' <<< "${comp}")
            case "${C_STATUS}" in
                success) C_MARK="✅" ;;
                failed)  C_MARK="❌"; DEPLOY_FAILED="true" ;;
                *)       C_MARK="⏭️" ;;
            esac
            echo "  ${C_MARK} ${C_SVC}: ${C_STATUS}${C_MSG:+（${C_MSG}）}"
        done < <(jq -c '.data.results[]' <<< "${DEPLOY_RESP}")
        if [ "${DEPLOY_FAILED}" = "true" ]; then
            echo "错误：部署存在失败组件（后续组件已中止）"
            exit 1
        fi
        echo "  部署完成（全部组件成功或跳过）"
    else
        echo "  部署任务已提交"
    fi
else
    echo "[4/5] 未指定 --deploy，跳过部署"
fi

# ---------- 5. 发布冒烟 ----------
echo "[5/5] 发布冒烟 ..."
SMOKE_FAILURES=()
SMOKE_RES_LIST=$(curl -s -H "Content-Type: application/json; charset=utf-8" ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} \
    "${RM_API_BASE}/${PACKAGE_ID}/version/${VERSION}/resource/list" || true)
if ! jq -e '.code == 200' <<< "${SMOKE_RES_LIST}" >/dev/null 2>&1; then
    SMOKE_FAILURES+=("资源清单拉取失败（resource/list 非 200）——resource-manager 异常或鉴权失效")
fi

SMOKE_URL_COUNT=0
while IFS=$'\t' read -r rname rurl; do
    [ -z "${rurl}" ] && continue
    SMOKE_URL_COUNT=$((SMOKE_URL_COUNT + 1))
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${rurl}" || echo "000")
    if [ "${HTTP_CODE}" != "200" ]; then
        SMOKE_FAILURES+=("artifact_url 不可达（HTTP ${HTTP_CODE}）：${rname} -> ${rurl}")
    fi
done < <(jq -r '.data // [] | map(select((.artifactUrl // "") | startswith("http")) | [.resourceName, .artifactUrl] | @tsv) | .[]' <<< "${SMOKE_RES_LIST}" 2>/dev/null)
echo "  artifact_url 可达性：${SMOKE_URL_COUNT} 个 http 资源已逐一 curl 校验"

if [ "${MANIFEST_TYPE}" != "suite" ]; then
    SMOKE_MANIFEST_URL=$(jq -r '.data // [] | map(select(.artifactType == "manifest-json")) | .[0].artifactUrl // ""' <<< "${SMOKE_RES_LIST}" 2>/dev/null)
    if [ -z "${SMOKE_MANIFEST_URL}" ]; then
        SMOKE_FAILURES+=("资源清单中未找到 manifest-json 资源——前端/manifest 登记缺失")
    else
        SMOKE_MANIFEST=$(curl -s --max-time 20 "${SMOKE_MANIFEST_URL}" || true)
        if ! jq -e . >/dev/null 2>&1 <<< "${SMOKE_MANIFEST}"; then
            SMOKE_FAILURES+=("manifest.json 拉取或解析失败：${SMOKE_MANIFEST_URL}")
        else
            for field in id version track tier; do
                case "${field}" in
                    id)      EXPECT="${PACKAGE_ID}" ;;
                    version) EXPECT="${VERSION}" ;;
                    track)   EXPECT="${PKG_TRACK}" ;;
                    tier)    EXPECT="${PKG_TIER}" ;;
                esac
                ACTUAL=$(jq -r ".${field} // \"\"" <<< "${SMOKE_MANIFEST}")
                if [ "${ACTUAL}" != "${EXPECT}" ]; then
                    SMOKE_FAILURES+=("manifest.json 字段不一致：${field} 发布侧=${ACTUAL}，发布参数=${EXPECT}")
                fi
            done
            echo "  manifest.json 字段比对：id/version/track/tier 已核对"
        fi
    fi
fi

if [ "${MANIFEST_TYPE}" != "suite" ] && [ "${HAS_MENU_JSON}" = "true" ] && [ "${MENU_PROVISION_OK}" != "true" ]; then
    SMOKE_FAILURES+=("menu-provision 未成功执行（data/menu.json 存在）——菜单未布设")
fi

if [ "${#SMOKE_FAILURES[@]}" -gt 0 ]; then
    echo "==========================================" >&2
    echo "错误：发布冒烟未通过（${#SMOKE_FAILURES[@]} 项）：" >&2
    for f in "${SMOKE_FAILURES[@]}"; do echo "  ❌ ${f}" >&2; done
    echo "修完后重跑本发布脚本即可（资源/菜单均幂等）" >&2
    exit 1
fi
echo "  冒烟通过 ✅"

echo "=========================================="
echo "发布完成：${PACKAGE_ID}@${VERSION}（测试底座）"
echo "  入口：${MINIO_PUBLIC_URL}/${OBJECT_PREFIX}/"
[ "${HAS_ADMIN_UI}" = "true" ] && echo "  管理端远程页面：${MINIO_PUBLIC_URL}/${ADMIN_OBJECT_PREFIX}/"
[ "${DO_DEPLOY}" != "true" ] && echo "  提示：联调部署可加 --deploy；HMR 调试回路见 --dev-url"
echo "  生产发布由平台管理员执行（本脚本不触达生产）"
echo "=========================================="
