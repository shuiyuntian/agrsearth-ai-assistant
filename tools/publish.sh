#!/usr/bin/env bash
#
# 文件作用：模板仓扩展包一键发布脚本（仅插件测试底座）——构建 → developer-center 控制 API
#          （release-prepare → 逐文件 upload-sessions 换取 postUrl/formFields → curl multipart
#          直传 MinIO（服务端 PostPolicy 预签名，禁止客户端自签 SigV4）→ upload-sessions 完成 →
#          全部成功后 release-complete 发布）；禁止 RM 直连；支持 --dev-url HMR 调试回路；
#          从平台仓 scripts/publish-extension.sh 提炼（去目录==track/tier 闸口/号段服务端台账/
#          权限对账/双环境，只打测试底座，prod 一律拒绝）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-10-06
# 版本：1.3.0
# 修改记录：
#   - 1.3.0 (2026-11-02) 默认开发支撑环境切换 aiearth01（LAN 10.82.11.51）；
#     aiearth02 保留部署测试用途；DC_API_BASE 仍可环境变量覆盖
#   - 1.0.0 (2026-10-06) 初始创建（模板仓 v2.0.0 工具链：测试环境默认值按 DGX 测试底座
#     端点写死、全部可环境变量覆盖；凭据必须经环境变量注入，脚本内无任何默认口令）
#   - 1.0.1 (2026-10-06) 实战检验修复（测试底座不可达场景报错体验）：① s3_upload 增加
#     30s 超时与友好报错——连接失败明确指认「无法连接 MinIO/测试底座 + MINIO_ENDPOINT
#     覆盖指引」，HTTP 4xx/5xx 指认凭据/bucket 权限（不再抛裸 Python traceback）；
#     ② api_call 增加 --connect-timeout 10/--max-time 60 并检测 curl 退出码——RM 不可达
#     时报「无法连接 resource-manager + RM_API_BASE 覆盖指引」（不再空响应泛化报错）
#   - 1.1.0 (2026-10-22) 默认端点改指 aiearth02 共享开发调试环境（公司网 LAN
#     10.82.11.52，bucket gis-platform-resources-dev；双 MCP 体系 M3 批，原 DGX
#     ext-test 默认值废止——DGX 为业主家庭网预发位，不对团队开放）
#   - 1.2.0 (2026-10-24) 控制面全量切 developer-center（禁 RM 直连、禁 MinIO 自签 SigV4）：
#     ① 发布流改为 release-prepare（包元数据+version）→ 逐文件 upload-sessions
#     （version/filename/sizeBytes/sha256/artifactType/networkProfile）获 postUrl/formFields
#     → curl multipart 直传 MinIO（PostPolicy 精确 key+content-length-range 锁定）
#     → upload-sessions/{uploadId}/complete（服务端流式复核 size+sha256 后幂等登记）
#     → 全部成功后 release-complete（version/dependencies/menuJson/deploy）；
#     ② 认证统一 AGRSEARTH_TOKEN（RM_TOKEN 过渡映射并告警），不再接受匿名调用；
#     ③ 删除 MINIO_ACCESS_KEY/MINIO_SECRET_KEY/MINIO_ENDPOINT/MINIO_PUBLIC_URL/RM_API_BASE
#     全部环境与 s3_upload 自签实现——上传 host 由服务端按 networkProfile 下发，客户端
#     不得改写；networkProfile 按网关 IP 推导（100.64.*=tailscale，内网私网段=lan）或
#     AGRSEARTH_NETWORK 显式指定；④ 失败语义：任一步失败即非零退出并明确指认，任一文件
#     complete 失败即中止且绝不执行 release-complete，release-complete 失败即发布未完成；
#     ⑤ --dev-url/--reset 改走 DC dev-url 端点（服务端改写已发布 manifest，已发布版本产物
#     客户端通道不可变）；对象 key 按服务端规范平铺 {track}/{tier}/{pkg}/{version}/{filename}
#   - 1.2.1 (2026-10-24) 契约对齐 RM/DC 已实现端点（读实际 VO/DTO 修正，非猜测）：
#     ① release-prepare 请求体改 DC 门面结构 {version, metadata:{...}}——metadata 键名与 RM
#     ReleasePrepareDTO 字段一一对应（components 改对象型；身份字段 packageName/track/tier/
#     delivery/ownerTeam 由 DC 以 dc_package_owner 权威覆盖，客户端值仅补充）；响应读
#     .data.packageCreated/packageUpdated/versionCreated/versionUpdated/publishStatus；
#     ② release-complete 响应读 .data.menuResult（total/inserted/updated/unchanged/
#     roleBindingsAdded/warnings）与 .data.bundleResult（passed/message/docCount/errors/docs
#     逐文档报告），不再猜 deployResults/results；bundleResult.passed=false 即非零退出；
#     ③ dev-url 响应读 .data.esmUrl/reset/changed/previousUrl/objectKey；请求 reset 显式
#     boolean；④ 重跑提示修正：release-complete
#     失败=版本保持草稿态可重放；冒烟失败=版本已发布，重跑会被「发布不可变」拒绝，须升版本号
#   - 1.2.3 (2026-10-25) bundle 改 Python tarfile 生成 USTAR 纯文件项，避免 macOS bsdtar 的
#     AppleDouble/PAX/xattr 被 RM 当作 YAML 解析；局域网全链发布、HMR 改写/reset 实测
#   - 1.2.2 (2026-10-24) backendResources 对齐 RM 1.1.0：后端镜像声明从 metadata 迁至请求顶层
#     backendResources 数组（RM ReleasePrepareDTO.backendResources = List<PackageResourceDTO>
#     显式透传位），元素字段严格按 RM（resourceType=backend/resourceName/artifactType=
#     docker-image/artifactUrl/artifactVersion/serviceId/apiPrefix/healthEndpoint/required/sortNo）；
#     metadata 不再携带该声明，删除「无通道」告警
#
# 版权所有 (C) 2026 AGRSEarth 项目
#
# 用法：./tools/publish.sh <package-dir> [--skip-build] [--deploy]
#          [--dev-url <url> | --dev-url --reset]
#
# 流程：
#   0. pre-check：manifest id/name/version/track/tier 必填 + delivery 合法 +
#      components 段与实际结构一致性 + data/menu.json 本地校验（tools/menujson.py validate）；
#      含「目录==track/tier」闸口（模板仓布局 extensions/<track>/<tier>/<id>/），服务端号段台账/权限对账
#      在主仓侧提测评审时由平台管理员执行
#   1. 构建：frontend/ 与 admin-ui/ 存在则 npm run build（--skip-build 跳过）
#   2. release-prepare：DC 门面请求体 {version, metadata, backendResources?}——metadata 为
#      RM ReleasePrepareDTO 补充位（packageType/domain/description/icon/author/menuPath/
#      components(对象)/changelog/isDefault/defaultConfig 等；packageName/track/tier/
#      delivery/ownerTeam 由 DC 权威覆盖）；backendResources（有后端服务时）为顶层数组，
#      元素字段严格按 RM PackageResourceDTO（resourceType=backend 等十字段）；
#      响应 .data.packageCreated/versionCreated/publishStatus(0=草稿)
#   3. 产物上传：逐文件 upload-sessions（声明 sizeBytes+sha256 双因子）→ curl multipart
#      直传 MinIO（postUrl/formFields 原样使用，禁改 host）→ complete（服务端复核登记
#      rm_package_resource，artifactUrl 由 complete 返回）；前端 dist / admin-ui dist（平铺，
#      子目录资产不支持本通道）/ k8s-bundle.tar.gz / 回填 entries.url 的 manifest.json /
#      menu.json；文件名跨组重名即拒（对象 key 平铺）
#   4. release-complete：version + dependencies（suite 取 members pin / dependsOnPackages 区间；
#      null=不动/空数组=清空）+ menuJson（data/menu.json 内容，服务端随发布幂等布设）+
#      deploy（--deploy 时严格 bundle 部署）；响应 .data.menuResult / .data.bundleResult
#      （passed/message/docs 逐文档报告）；发布为最后提交点，前置失败版本保持草稿态可重放
#   5. 发布冒烟：全部 artifactUrl 可达 + manifest.json 字段比对（id/version/track/tier）；
#      冒烟失败=版本已发布，重跑会被「发布不可变」拒绝——更新产物须升版本号
#   --dev-url <url>：HMR 调试回路——DC 服务端把已发布版本的 manifest.json 的 entries.esm.url
#      改写为本机 dev server 地址（宿主再拉 manifest 即指向本机产物）；
#      --dev-url --reset：服务端复位正式产物 URL（reset 与 esmUrl 互斥，RM 侧契约）
#
# 环境变量（aiearth01 开发支撑环境默认值，全部可覆盖）：
#   DC_API_BASE   http://10.82.11.51:18801/developer-center/api/v1
#   AGRSEARTH_TOKEN  必填（团队 token；RM_TOKEN 可过渡映射，兼容期后移除）
#   AGRSEARTH_NETWORK  可选：lan / tailscale——缺省按 DC_API_BASE 网关 IP 推导
#                      （100.64.* → tailscale；10.* / 192.168.* / 172.16-31.* → lan；
#                      其他地址必须显式指定，禁止猜测签名 host）
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
            sed -n '2,94p' "${BASH_SOURCE[0]}"
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
    echo "错误：请指定包目录（如 extensions/<track>/<tier>/<pkg-id>）"
    echo "用法：$(basename "$0") extensions/<track>/<tier>/<pkg-id> [--skip-build] [--deploy] [--dev-url <url> | --dev-url --reset]"
    exit 1
fi
if [ "${DEV_MODE}" = "true" ] && [ "${DEV_RESET}" = "false" ] && [ -z "${DEV_URL}" ]; then
    echo "错误：--dev-url 需要 URL 参数（--dev-url http://<ip>:<port>），或 --dev-url --reset 恢复正式产物"
    exit 1
fi

for cmd in jq curl; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "错误：本脚本依赖 ${cmd}"
        exit 1
    fi
done
if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    echo "错误：本脚本依赖 shasum（macOS）或 sha256sum（Linux）计算 SHA-256"
    exit 1
fi

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

# track/tier 显式必填（ADR-010 二维分类）+「目录==track/tier」闸口（模板仓布局 extensions/<track>/<tier>/<id>/，与平台仓同构）
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

# 目录闸口：包目录必须位于 extensions/<track>/<tier>/<pkg-id>/（与 manifest 显式值一致）
REL_DIR="${PLUGIN_DIR#"${REPO_ROOT}/"}"
EXPECTED_DIR="extensions/${PKG_TRACK}/${PKG_TIER}/${PACKAGE_ID}"
if [ "${REL_DIR}" != "${EXPECTED_DIR}" ]; then
    echo "错误：目录==track/tier 闸口未通过——包目录应为 ${EXPECTED_DIR}，实际为 ${REL_DIR}"
    echo "      （manifest track=${PKG_TRACK} tier=${PKG_TIER} id=${PACKAGE_ID}；目录三段必须与之逐段一致）"
    exit 1
fi
# demo 包提示：官方演示包允许发布到测试底座体验通路，但禁止作为提测交付
case "${PACKAGE_ID}" in
    *-demo) echo "提示：${PACKAGE_ID} 为官方演示包（*-demo），仅用于环境通路验证，禁止提测" ;;
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

# ---------- 端点与凭据（测试底座默认值，全部可环境变量覆盖；凭据必填、无默认口令）----------
DC_API_BASE="${DC_API_BASE:-http://10.82.11.51:18801/developer-center/api/v1}"
REGISTRY="${REGISTRY:-localhost:32000}"

TOKEN="${AGRSEARTH_TOKEN:-}"
if [ -z "${TOKEN}" ] && [ -n "${RM_TOKEN:-}" ]; then
    TOKEN="${RM_TOKEN}"
    echo "提示：RM_TOKEN 已过渡映射为 AGRSEARTH_TOKEN——请尽快改用 AGRSEARTH_TOKEN（兼容期后移除）"
fi
if [ -z "${TOKEN}" ]; then
    echo "错误：请经环境变量提供 AGRSEARTH_TOKEN（团队 token，申请方式见 test-env/README.md §2）"
    exit 1
fi

# networkProfile：显式指定优先，否则按网关 IP 推导；推导不出即拒绝（禁止猜测签名 host）
resolve_network_profile() {
    if [ -n "${AGRSEARTH_NETWORK:-}" ]; then
        case "${AGRSEARTH_NETWORK}" in
            lan|tailscale) echo "${AGRSEARTH_NETWORK}"; return 0 ;;
            *)
                echo "错误：AGRSEARTH_NETWORK 仅支持 lan / tailscale：${AGRSEARTH_NETWORK}" >&2
                return 1
                ;;
        esac
    fi
    local host
    host="$(sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:]+).*#\1#' <<< "${DC_API_BASE}")"
    case "${host}" in
        100.64.*) echo "tailscale"; return 0 ;;
        10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) echo "lan"; return 0 ;;
        *)
            echo "错误：无法从网关地址推导 networkProfile（host=${host}）——请显式设置 AGRSEARTH_NETWORK=lan|tailscale" >&2
            return 1
            ;;
    esac
}
NETWORK_PROFILE="$(resolve_network_profile)" || exit 1

DIST_DIR="${PLUGIN_DIR}/frontend/dist"
HAS_FRONTEND="false"
[ -f "${PLUGIN_DIR}/frontend/package.json" ] && HAS_FRONTEND="true"
ADMIN_DIST_DIR="${PLUGIN_DIR}/admin-ui/dist"
HAS_ADMIN_UI="false"
if [ "${MANIFEST_TYPE}" != "suite" ] && [ -f "${PLUGIN_DIR}/admin-ui/package.json" ]; then
    HAS_ADMIN_UI="true"
fi
HAS_ADMIN_UI_DECL=$(jq -r 'if .adminUi then "true" else "false" end' "${MANIFEST_FILE}")

# ---------- artifactType 推导（与 RM 内部上传通道 resourceType 推导口径一致）----------
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

sha256_of() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        sha256sum "$1" | awk '{print $1}'
    fi
}

file_size_of() {
    if stat -f%z "$1" >/dev/null 2>&1; then
        stat -f%z "$1"
    else
        stat -c%s "$1"
    fi
}

# ---------- api_call：developer-center 控制 API 统一调用（Bearer 团队 token）----------
api_call() {
    # $1=method $2=path $3=json-body(可空)
    local method="$1" path="$2" body="${3:-}"
    local args=(-s -X "${method}" --connect-timeout 10 --max-time 120
        -H "Content-Type: application/json; charset=utf-8"
        -H "Authorization: Bearer ${TOKEN}")
    if [ -n "${body}" ]; then
        args+=(--data-binary "${body}")
    fi
    local resp curl_rc=0
    resp=$(curl "${args[@]}" "${DC_API_BASE}${path}") || curl_rc=$?
    if [ "${curl_rc}" -ne 0 ]; then
        echo "错误：无法连接 developer-center（${DC_API_BASE}）：curl 退出码 ${curl_rc}" >&2
        echo "      请确认插件测试底座可达（地址表见 test-env/README.md），或经 DC_API_BASE 覆盖" >&2
        exit 1
    fi
    local code
    code=$(jq -r '.code // empty' <<< "${resp}" 2>/dev/null || true)
    if [ "${code}" != "200" ]; then
        echo "错误：API ${method} ${path} 返回异常：${resp}" >&2
        if grep -q "401" <<< "${resp}"; then
            echo "提示：请经 AGRSEARTH_TOKEN 环境变量提供团队 token（申请方式见 test-env/README.md §2）" >&2
        fi
        exit 1
    fi
    echo "${resp}"
}

# ---------- upload_artifact：upload-sessions → MinIO multipart 直传 → complete ----------
# $1=本地文件 $2=artifactType $3=逻辑文件名（对象 key 末段，须为纯文件名）；成功后在 ${ARTIFACTS_TSV} 追加一行：filename \t artifactType \t artifactUrl
ARTIFACTS_TSV=""
upload_artifact() {
    local file="$1" atype="$2" fname="$3" size sha body resp
    size=$(file_size_of "${file}")
    sha=$(sha256_of "${file}")
    body=$(jq -n \
        --arg v "${VERSION}" --arg fn "${fname}" --argjson sz "${size}" \
        --arg sha "${sha}" --arg at "${atype}" --arg np "${NETWORK_PROFILE}" \
        '{version: $v, filename: $fn, sizeBytes: $sz, sha256: $sha, artifactType: $at, networkProfile: $np}')
    resp=$(api_call POST "/packages/${PACKAGE_ID}/upload-sessions" "${body}")
    local upload_id post_url
    upload_id=$(jq -r '.data.uploadId // empty' <<< "${resp}")
    post_url=$(jq -r '.data.postUrl // empty' <<< "${resp}")
    if [ -z "${upload_id}" ] || [ -z "${post_url}" ]; then
        echo "错误：upload-sessions 未返回 uploadId/postUrl：${resp}"
        echo "      发布已中止（不会执行 release-complete）——版本仍为草稿态，修复后重跑即可"
        exit 1
    fi

    # MinIO PostPolicy multipart 直传：formFields 原样使用——签名 host 由服务端按
    # networkProfile 下发，客户端不得改写/替换（含禁止任何 MINIO_ENDPOINT 类覆盖）
    local curl_args=(-s -o /dev/null -w "%{http_code}" -X POST --connect-timeout 10 --max-time 300)
    local k v
    while IFS=$'\t' read -r k v; do
        [ -n "${k}" ] && curl_args+=(-F "${k}=${v}")
    done < <(jq -r '.data.formFields | to_entries[] | "\(.key)\t\(.value)"' <<< "${resp}")
    curl_args+=(-F "file=@${file}")
    local http_code curl_rc=0
    http_code=$(curl "${curl_args[@]}" "${post_url}") || curl_rc=$?
    if [ "${curl_rc}" -ne 0 ]; then
        echo "错误：无法连接 MinIO 上传端（${post_url}）：curl 退出码 ${curl_rc}"
        echo "      上传端由 developer-center 按 networkProfile=${NETWORK_PROFILE} 下发，请核对该网络可达性；发布已中止（不会执行 release-complete）——版本仍为草稿态，修复后重跑即可"
        exit 1
    fi
    case "${http_code}" in
        2*) ;;
        *)
            echo "错误：MinIO 直传失败（HTTP ${http_code}）：${fname}——会话 ${upload_id} 未 complete，发布已中止（不会执行 release-complete）——版本仍为草稿态，修复后重跑即可"
            exit 1
            ;;
    esac

    # complete：服务端二次校验（流式重算 size+sha256）后幂等登记资源，返回正式 artifactUrl
    local comp artifact_url
    comp=$(api_call POST "/packages/${PACKAGE_ID}/upload-sessions/${upload_id}/complete" "")
    artifact_url=$(jq -r '.data.artifactUrl // empty' <<< "${comp}")
    if [ -z "${artifact_url}" ]; then
        echo "错误：upload-sessions/${upload_id}/complete 未返回 artifactUrl：${comp}"
        echo "      发布已中止（不会执行 release-complete）——版本仍为草稿态，修复后重跑即可"
        exit 1
    fi
    printf '%s\t%s\t%s\n' "${fname}" "${atype}" "${artifact_url}" >> "${ARTIFACTS_TSV}"
    echo "  已上传 ${fname}（${atype}，${size} 字节）→ ${artifact_url}"
}

# ---------- --dev-url 模式：HMR 调试回路（DC 服务端改写已发布 manifest 的 entries.esm.url）----------
if [ "${DEV_MODE}" = "true" ]; then
    echo "=========================================="
    echo "dev-url 模式：${PACKAGE_ID}@${VERSION}"
    if [ "${DEV_RESET}" = "true" ]; then
        echo "动作：恢复正式产物 URL（DC 服务端按登记资源重写 entries.url）"
    else
        echo "动作：entries.esm.url → ${DEV_URL}"
    fi
    echo "=========================================="
    if [ "${DEV_RESET}" = "false" ]; then
        # DC 契约 body version/esmUrl/reset（reset 显式 boolean）
        DEV_BODY=$(jq -n --arg v "${VERSION}" --arg url "${DEV_URL}" '{version: $v, esmUrl: $url, reset: false}')
    else
        # RM 契约：reset 与 esmUrl 互斥（复位时不得携带 esmUrl）——reset=true 省略 esmUrl
        # （DC 门面已支持 reset 免 esmUrl，无需占位值）
        DEV_BODY=$(jq -n --arg v "${VERSION}" '{version: $v, reset: true}')
    fi
    DEV_RESP=$(api_call POST "/packages/${PACKAGE_ID}/dev-url" "${DEV_BODY}")
    DEV_CHANGED=$(jq -r '.data.changed // empty' <<< "${DEV_RESP}")
    DEV_PREVIOUS=$(jq -r '.data.previousUrl // ""' <<< "${DEV_RESP}")
    DEV_ESM=$(jq -r '.data.esmUrl // ""' <<< "${DEV_RESP}")
    DEV_KEY=$(jq -r '.data.objectKey // ""' <<< "${DEV_RESP}")
    if [ "${DEV_RESET}" = "false" ]; then
        if [ "${DEV_CHANGED}" = "false" ]; then
            echo "  幂等短路：entries.esm.url 已是 ${DEV_ESM}（零重传零登记）"
        else
            echo "  改写完成：${DEV_PREVIOUS:-∅} → ${DEV_ESM}"
        fi
    else
        if [ "${DEV_CHANGED}" = "false" ]; then
            echo "  幂等短路：entries.esm.url 已是正式产物地址 ${DEV_ESM}"
        else
            echo "  已复位正式产物 URL：${DEV_ESM}"
        fi
    fi
    [ -n "${DEV_KEY}" ] && echo "  manifest 对象：${DEV_KEY}"
    if [ "${DEV_RESET}" = "false" ]; then
        echo "------------------------------------------"
        echo "HMR 调试回路已建立，宿主端再拉取 manifest 即加载本机产物："
        echo "  1. 前端 watch 构建：cd ${PLUGIN_DIR}/frontend && npm run dev"
        echo "  2. 静态服务产物（示例，端口自定）：cd ${PLUGIN_DIR}/frontend/dist && python3 -m http.server <port>"
        echo "     （本机 IP 需让测试底座球端可直达；跨域受限时以静态服务响应头放行为准）"
        echo "  3. 调试完恢复：./tools/publish.sh ${REL_DIR} --dev-url --reset"
    else
        echo "------------------------------------------"
        echo "已恢复正式产物 URL（服务端按登记资源重写）"
    fi
    echo "=========================================="
    exit 0
fi

# ---------- 1. 构建 ----------
echo "=========================================="
echo "发布扩展能力包 ${PACKAGE_ID}@${VERSION}（scope=${SCOPE}，env=test）"
echo "控制 API：${DC_API_BASE}（networkProfile=${NETWORK_PROFILE}）"
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

# ---------- 2. release-prepare（包元数据 + version + 后端镜像资源声明）----------
echo "[2/5] release-prepare（developer-center 注册包/版本）..."

PKG_DESC=$(jq -r '.description // ""' "${MANIFEST_FILE}")
PKG_ICON=$(jq -r '.icon // ""' "${MANIFEST_FILE}")
PKG_AUTHOR=$(jq -r '.author // ""' "${MANIFEST_FILE}")
if [ -z "${PKG_ICON}" ]; then
    echo "错误：manifest.json 缺少 icon 字段（Element Plus 图标名，如 MapLocation）" >&2
    exit 1
fi

# changelog：环境变量 > CHANGELOG.md 最新版本段 > manifest description
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

# 后端镜像资源声明（imageSource=self 按约定推导；upstream 原样登记；
# dependsOn 拓扑序决定 sortNo——实现同平台仓 publish-extension.sh）
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
BACKEND_RESOURCES="[]"
if [ "${SVC_COUNT}" -gt 0 ]; then
    SORTED_SVC_IDS=$(topo_sort_services "${BACKEND_SERVICES_JSON}")
    SORT_NO=0
    BACKEND_RESOURCES="["
    FIRST_RES="true"
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
        RES_JSON=$(jq -n -c \
            --arg rt "backend" --arg rn "${SVC_NAME}" --arg at "docker-image" \
            --arg url "${IMAGE_REF}" --arg sid "${SVC_ID}" \
            --arg ap "${SVC_PREFIX}" --arg he "${SVC_HEALTH}" --arg av "${SVC_MINVER}" \
            --argjson req "${SVC_REQUIRED}" --argjson sn "${SORT_NO}" \
            '{resourceType: $rt, resourceName: $rn, artifactType: $at, artifactUrl: $url, artifactVersion: $av, serviceId: $sid, apiPrefix: $ap, healthEndpoint: $he, required: $req, sortNo: $sn}')
        if [ "${FIRST_RES}" = "true" ]; then
            BACKEND_RESOURCES+="${RES_JSON}"
            FIRST_RES="false"
        else
            BACKEND_RESOURCES+=",${RES_JSON}"
        fi
    done <<< "${SORTED_SVC_IDS}"
    BACKEND_RESOURCES+="]"
fi

PREPARE_METADATA=$(jq -n \
    --arg name "${PACKAGE_NAME}" --arg ptype "${PACKAGE_TYPE}" \
    --arg domain "${PKG_DOMAIN}" \
    --arg track "${PKG_TRACK}" --arg tier "${PKG_TIER}" --arg delivery "${PKG_DELIVERY}" \
    --arg desc "${PKG_DESC}" --arg icon "${PKG_ICON}" --arg author "${PKG_AUTHOR}" \
    --arg menuPath "${PKG_MENU_PATH}" \
    --arg cl "${CHANGELOG_TEXT}" \
    '({packageName: $name, packageType: $ptype, track: $track, tier: $tier, description: $desc, icon: $icon, author: $author, changelog: $cl, isDefault: 1}
     + (if $domain != "" then {domain: $domain} else {} end)
     + (if $delivery != "" then {delivery: $delivery} else {} end)
     + (if $menuPath != "" then {menuPath: $menuPath} else {} end))')
# components 为对象型（RM ReleasePrepareDTO.components 为 Map，非 JSON 字符串）
if [ -n "${COMPONENTS_JSON}" ]; then
    PREPARE_METADATA=$(jq -c --argjson components "${COMPONENTS_JSON}" '. + {components: $components}' <<< "${PREPARE_METADATA}")
fi
# defaultConfig 为 JSON 序列化文本（RM DTO 为 String）；platformMin/MaxVersion、repoUrl、
# aiCapabilities  manifest 有声明才带（RM DTO 同名字段补充位）
if [ -n "${DEFAULT_CONFIG}" ]; then
    PREPARE_METADATA=$(jq -c --arg dc "$(jq -c . <<< "${DEFAULT_CONFIG}")" '. + {defaultConfig: $dc}' <<< "${PREPARE_METADATA}")
fi
for field in platformMinVersion platformMaxVersion repoUrl; do
    FIELD_VALUE=$(jq -r ".${field} // \"\"" "${MANIFEST_FILE}")
    if [ -n "${FIELD_VALUE}" ]; then
        PREPARE_METADATA=$(jq -c --arg fv "${FIELD_VALUE}" ". + {${field}: \$fv}" <<< "${PREPARE_METADATA}")
    fi
done
AI_CAPS=$(jq -r 'if .aiCapabilities then (.aiCapabilities | if type == "string" then . else tojson end) else empty end' "${MANIFEST_FILE}" 2>/dev/null || true)
if [ -n "${AI_CAPS}" ]; then
    PREPARE_METADATA=$(jq -c --arg ac "${AI_CAPS}" '. + {aiCapabilities: $ac}' <<< "${PREPARE_METADATA}")
fi
# DC 门面请求体：{version, metadata, backendResources?}——metadata 键名与 RM ReleasePrepareDTO 一致；
# packageName/track/tier/delivery/ownerTeam 由 DC 以 dc_package_owner 权威覆盖（防跨包伪造）；
# backendResources 为顶层显式透传位（RM ReleasePrepareDTO.backendResources = List<PackageResourceDTO>，
# 元素字段严格按 RM：resourceType/resourceName/artifactType/artifactUrl/artifactVersion/serviceId/
# apiPrefix/healthEndpoint/required/sortNo），仅在有后端服务时携带
PREPARE_BODY=$(jq -n --arg v "${VERSION}" --argjson metadata "${PREPARE_METADATA}" \
    --argjson backendResources "${BACKEND_RESOURCES}" \
    '{version: $v, metadata: $metadata}
     + (if ($backendResources | length) > 0 then {backendResources: $backendResources} else {} end)')
PREPARE_RESP=$(api_call POST "/packages/${PACKAGE_ID}/release-prepare" "${PREPARE_BODY}")
PKG_CREATED=$(jq -r '.data.packageCreated // false' <<< "${PREPARE_RESP}")
PKG_UPDATED=$(jq -r '.data.packageUpdated // false' <<< "${PREPARE_RESP}")
VER_CREATED=$(jq -r '.data.versionCreated // false' <<< "${PREPARE_RESP}")
VER_UPDATED=$(jq -r '.data.versionUpdated // false' <<< "${PREPARE_RESP}")
PREPARE_STATUS=$(jq -r '.data.publishStatus // "?"' <<< "${PREPARE_RESP}")
echo "  release-prepare 完成：packageCreated=${PKG_CREATED} packageUpdated=${PKG_UPDATED}" \
    "versionCreated=${VER_CREATED} versionUpdated=${VER_UPDATED} publishStatus=${PREPARE_STATUS}（0=草稿）"
if [ "${SVC_COUNT}" -gt 0 ]; then
    echo "  后端镜像资源声明 ${SVC_COUNT} 条已随 release-prepare 登记（resourceType=backend，拓扑序 sortNo）"
fi

# ---------- 3. 产物上传（upload-sessions → MinIO multipart → complete）----------
ARTIFACTS_TSV="$(mktemp -t publish-artifacts.XXXXXX).tsv"
CLEANUP_PATHS=("${ARTIFACTS_TSV}")
trap 'rm -rf "${CLEANUP_PATHS[@]}"' EXIT

if [ "${MANIFEST_TYPE}" != "suite" ]; then
    echo "[3/5] 产物上传（developer-center upload-sessions + MinIO 直传）..."

    # 对象 key 平铺 {track}/{tier}/{pkg}/{version}/{filename}：跨组重名即拒（frontend/admin-ui/manifest/menu/bundle 互相覆盖）
    # （macOS 自带 bash 3.2 无关联数组，用线性表——产物文件数量级小，足够）
    SEEN_NAMES=()
    reserve_name() {
        local fname="$1" owner="$2" entry
        for entry in "${SEEN_NAMES[@]:-}"; do
            if [ "${entry%%$'\t'*}" = "${fname}" ]; then
                echo "错误：产物文件名跨组重名「${fname}」（${entry#*$'\t'} 与 ${owner}）——新上传通道对象 key 平铺，禁止覆盖；请调整构建产物命名"
                exit 1
            fi
        done
        SEEN_NAMES+=("${fname}"$'\t'"${owner}")
    }
    reserve_name "manifest.json" "内置 manifest"
    if [ "${HAS_MENU_JSON}" = "true" ]; then
        reserve_name "menu.json" "内置 menu.json"
    fi

    # 3.1 前端 dist
    FRONTEND_FILES=()
    if [ "${HAS_FRONTEND}" = "true" ]; then
        for file in "${DIST_DIR}"/*; do
            [ -f "${file}" ] || continue
            fname=$(basename "${file}")
            reserve_name "${fname}" "frontend/dist"
            FRONTEND_FILES+=("${file}")
        done
        for file in "${FRONTEND_FILES[@]}"; do
            upload_artifact "${file}" "$(artifact_type_of "$(basename "${file}")")" "$(basename "${file}")"
        done
    fi

    # 3.2 admin-ui dist（本通道仅支持平铺文件名；子目录资产不支持，见 docs/L8）
    ADMIN_FILES=()
    if [ "${HAS_ADMIN_UI}" = "true" ]; then
        NESTED=$(find "${ADMIN_DIST_DIR}" -mindepth 2 -type f | head -1)
        if [ -n "${NESTED}" ]; then
            echo "错误：admin-ui 产物含子目录资产（如 ${NESTED#"${ADMIN_DIST_DIR}/"}）——upload-sessions 通道仅支持平铺文件名，请将附属资产拍平到产物根或联系平台方"
            exit 1
        fi
        for file in "${ADMIN_DIST_DIR}"/*; do
            [ -f "${file}" ] || continue
            fname=$(basename "${file}")
            reserve_name "${fname}" "admin-ui/dist"
            ADMIN_FILES+=("${file}")
        done
        for file in "${ADMIN_FILES[@]}"; do
            upload_artifact "${file}" "$(admin_artifact_type_of "$(basename "${file}")")" "$(basename "${file}")"
        done
    fi

    # 3.3 k8s 部署包（deploy/k8s/ 存在时）：拍平打包上传
    BUNDLE_DIR="${PLUGIN_DIR}/deploy/k8s"
    K8S_BUNDLE_ENABLED=$(jq -r 'if .k8sBundle == false then "false" else "true" end' "${MANIFEST_FILE}")
    BUNDLE_FILE=""
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
        # macOS bsdtar 会携带 xattr/AppleDouble/PAX 扩展头；RM 极简解析器只接受 USTAR 纯文件项
        python3 - "${BUNDLE_YAML}" "${BUNDLE_TMP}/k8s-bundle.tar.gz" <<'PYEOF'
import io, sys, tarfile
src, dst = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
with tarfile.open(dst, "w:gz", format=tarfile.USTAR_FORMAT) as t:
    ti = tarfile.TarInfo("k8s-bundle.yaml")
    ti.size = len(data)
    ti.mode = 0o644
    t.addfile(ti, io.BytesIO(data))
PYEOF
        BUNDLE_FILE="${BUNDLE_TMP}/k8s-bundle.tar.gz"
    fi

    # 3.4 回填 entries.url 的 manifest.json（URL 取各自 complete 返回的 artifactUrl）
    FILLED_MANIFEST="$(mktemp -t manifest.XXXXXX).json"
    CLEANUP_PATHS+=("${FILLED_MANIFEST}")
    cp "${MANIFEST_FILE}" "${FILLED_MANIFEST}"
    if [ -s "${ARTIFACTS_TSV}" ]; then
        while IFS=$'\t' read -r art_fname art_type art_url; do
            case "${art_type}" in
                esm-js)
                    jq --arg url "${art_url}" '.entries.esm.url = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
                    ;;
                umd-js)
                    jq --arg url "${art_url}" '.entries.umd.url = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
                    ;;
                css)
                    jq --arg url "${art_url}" '.entries.css.url = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
                    ;;
                admin-esm-js)
                    if [ "${HAS_ADMIN_UI_DECL}" = "true" ]; then
                        jq --arg url "${art_url}" '.adminUi.url = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
                    fi
                    ;;
                admin-css)
                    if [ "${HAS_ADMIN_UI_DECL}" = "true" ]; then
                        jq --arg url "${art_url}" '.adminUi.cssUrl = $url' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
                    fi
                    ;;
            esac
        done < "${ARTIFACTS_TSV}"
    fi
    jq --arg v "${VERSION}" '.version = $v' "${FILLED_MANIFEST}" > "${FILLED_MANIFEST}.tmp" && mv "${FILLED_MANIFEST}.tmp" "${FILLED_MANIFEST}"
    upload_artifact "${FILLED_MANIFEST}" "manifest-json" "manifest.json"
    echo "  manifest.json 已回填 entries.url（artifactUrl 取 complete 返回值）"

    # 3.5 k8s-bundle 上传（manifest 之后，避免与 dist 文件竞争命名）
    if [ -n "${BUNDLE_FILE}" ]; then
        upload_artifact "${BUNDLE_FILE}" "k8s-bundle" "k8s-bundle.tar.gz"
    fi

    # 3.6 menu.json 上传（服务端随 release-complete 按登记资源布设菜单）
    if [ "${HAS_MENU_JSON}" = "true" ]; then
        upload_artifact "${MENU_JSON_FILE}" "menu-json" "menu.json"
    fi
else
    echo "[3/5] suite 虚拟聚合包：零产物，跳过上传"
fi

# ---------- 4. release-complete（version + dependencies + menuJson + deploy）----------
echo "[4/5] release-complete（发布版本）..."

# 依赖声明（suite 取 members 生成 pin 依赖）
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

if [ "${HAS_MENU_JSON}" = "true" ]; then
    MENU_JSON_CONTENT=$(jq -c . "${MENU_JSON_FILE}")
else
    MENU_JSON_CONTENT="null"
fi
if [ "${DO_DEPLOY}" = "true" ]; then DEPLOY_FLAG="true"; else DEPLOY_FLAG="false"; fi

COMPLETE_BODY=$(jq -n \
    --arg v "${VERSION}" --argjson deps "${DEP_BODY}" \
    --argjson menuJson "${MENU_JSON_CONTENT}" --argjson deploy "${DEPLOY_FLAG}" \
    '{version: $v, dependencies: $deps, menuJson: $menuJson, deploy: $deploy}')
if ! COMPLETE_RESP=$(api_call POST "/packages/${PACKAGE_ID}/release-complete" "${COMPLETE_BODY}"); then
    echo "错误：release-complete 失败——发布为最后提交点，前置失败时版本保持草稿态（未发布）可重放：修复问题后重跑本脚本（release-prepare/upload-sessions 对草稿版本幂等）"
    exit 1
fi
PUB_STATUS=$(jq -r '.data.publishStatus // "?"' <<< "${COMPLETE_RESP}")
DEPS_REG=$(jq -r '.data.dependenciesRegistered // "?"' <<< "${COMPLETE_RESP}")
echo "  版本 ${VERSION} 已发布（publishStatus=${PUB_STATUS}，dependenciesRegistered=${DEPS_REG}）"

# 菜单布设结果（MenuProvisionResultVO：total/inserted/updated/unchanged/roleBindingsAdded/warnings）
MENU_RESULT=$(jq -c '.data.menuResult // empty' <<< "${COMPLETE_RESP}" 2>/dev/null || true)
if [ -n "${MENU_RESULT}" ] && [ "${MENU_RESULT}" != "null" ]; then
    echo "  菜单布设结果：total=$(jq -r '.total' <<< "${MENU_RESULT}")" \
        "inserted=$(jq -r '.inserted' <<< "${MENU_RESULT}")" \
        "updated=$(jq -r '.updated' <<< "${MENU_RESULT}")" \
        "unchanged=$(jq -r '.unchanged' <<< "${MENU_RESULT}")" \
        "roleBindingsAdded=$(jq -r '.roleBindingsAdded' <<< "${MENU_RESULT}")"
    MENU_WARNINGS=$(jq -r '.warnings // [] | .[]' <<< "${MENU_RESULT}" 2>/dev/null || true)
    if [ -n "${MENU_WARNINGS}" ]; then
        while IFS= read -r w; do echo "  ⚠️  菜单布设告警：${w}"; done <<< "${MENU_WARNINGS}"
    fi
fi

# --deploy：严格 bundle 部署结果（BundleDeployCheckVO：passed/message/docCount/errors/docs 逐文档报告）
if [ "${DO_DEPLOY}" = "true" ]; then
    BUNDLE_RESULT=$(jq -c '.data.bundleResult // empty' <<< "${COMPLETE_RESP}" 2>/dev/null || true)
    if [ -n "${BUNDLE_RESULT}" ] && [ "${BUNDLE_RESULT}" != "null" ]; then
        BUNDLE_PASSED=$(jq -r '.passed' <<< "${BUNDLE_RESULT}")
        BUNDLE_MSG=$(jq -r '.message // ""' <<< "${BUNDLE_RESULT}")
        BUNDLE_DOCS=$(jq -r '.docCount // 0' <<< "${BUNDLE_RESULT}")
        BUNDLE_NS=$(jq -r '.namespace // ""' <<< "${BUNDLE_RESULT}")
        case "${BUNDLE_PASSED}" in
            true)  echo "  ✅ bundle 部署通过：${BUNDLE_MSG}（namespace=${BUNDLE_NS}，docs=${BUNDLE_DOCS}）" ;;
            false)
                echo "  ❌ bundle 部署未通过：${BUNDLE_MSG}（namespace=${BUNDLE_NS}，docs=${BUNDLE_DOCS}）"
                BUNDLE_ERRORS=$(jq -r '.errors // [] | .[]' <<< "${BUNDLE_RESULT}" 2>/dev/null || true)
                if [ -n "${BUNDLE_ERRORS}" ]; then
                    while IFS= read -r e; do echo "     错误：${e}"; done <<< "${BUNDLE_ERRORS}"
                fi
                echo "错误：bundle 部署失败——版本发布态与部署结果以服务端为准，请联系平台方核对"
                exit 1
                ;;
            *) echo "  bundle 部署结果：${BUNDLE_MSG}" ;;
        esac
        # 逐文档安全报告（BundleDocReport：kind/name/error 阻断项/warnings 兼容告警——按 VO 字段原样透出）
        DOC_REPORTS=$(jq -c '.docs // empty' <<< "${BUNDLE_RESULT}" 2>/dev/null || true)
        if [ -n "${DOC_REPORTS}" ] && [ "${DOC_REPORTS}" != "null" ] && [ "${DOC_REPORTS}" != "[]" ]; then
            while IFS= read -r doc; do
                D_KIND=$(jq -r '.kind // "-"' <<< "${doc}")
                D_NAME=$(jq -r '.name // "-"' <<< "${doc}")
                D_ERROR=$(jq -r '.error // ""' <<< "${doc}")
                D_WARNINGS=$(jq -r '.warnings // [] | .[]' <<< "${doc}" 2>/dev/null || true)
                if [ -n "${D_ERROR}" ]; then
                    echo "     📄 ${D_KIND}/${D_NAME}: ❌ ${D_ERROR}"
                else
                    echo "     📄 ${D_KIND}/${D_NAME}: ✅"
                fi
                if [ -n "${D_WARNINGS}" ]; then
                    while IFS= read -r w; do echo "        ⚠️  ${w}"; done <<< "${D_WARNINGS}"
                fi
            done < <(jq -c '.[]' <<< "${DOC_REPORTS}")
        fi
    else
        echo "  未指定 --deploy 或服务端未执行部署段（bundleResult=null）"
    fi
else
    echo "  未指定 --deploy，跳过部署"
fi

# ---------- 5. 发布冒烟 ----------
echo "[5/5] 发布冒烟 ..."
SMOKE_FAILURES=()

if [ ! -s "${ARTIFACTS_TSV}" ]; then
    if [ "${MANIFEST_TYPE}" != "suite" ]; then
        SMOKE_FAILURES+=("无产物上传记录——发布流程异常")
    fi
fi

SMOKE_URL_COUNT=0
if [ -s "${ARTIFACTS_TSV}" ]; then
    while IFS=$'\t' read -r art_fname art_type art_url; do
        [ -z "${art_url}" ] && continue
        SMOKE_URL_COUNT=$((SMOKE_URL_COUNT + 1))
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${art_url}" || echo "000")
        if [ "${HTTP_CODE}" != "200" ]; then
            SMOKE_FAILURES+=("artifact_url 不可达（HTTP ${HTTP_CODE}）：${art_fname} -> ${art_url}")
        fi
    done < "${ARTIFACTS_TSV}"
fi
echo "  artifact_url 可达性：${SMOKE_URL_COUNT} 个产物已逐一 curl 校验"

if [ "${MANIFEST_TYPE}" != "suite" ]; then
    SMOKE_MANIFEST_URL=$(awk -F'\t' '$2 == "manifest-json" {print $3; exit}' "${ARTIFACTS_TSV}" 2>/dev/null || true)
    if [ -z "${SMOKE_MANIFEST_URL}" ]; then
        SMOKE_FAILURES+=("产物清单中未找到 manifest-json——manifest 上传缺失")
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

if [ "${#SMOKE_FAILURES[@]}" -gt 0 ]; then
    echo "==========================================" >&2
    echo "错误：发布冒烟未通过（${#SMOKE_FAILURES[@]} 项）：" >&2
    for f in "${SMOKE_FAILURES[@]}"; do echo "  ❌ ${f}" >&2; done
    echo "注意：版本已置发布态（发布不可变）——重跑本脚本会在 release-prepare 被拒绝；" >&2
    echo "如确需更新产物，请递增版本号后重发；若只是底座可达性等环境抖动，修复后直接复验上述 URL 即可" >&2
    exit 1
fi
echo "  冒烟通过 ✅"

echo "=========================================="
echo "发布完成：${PACKAGE_ID}@${VERSION}（测试底座）"
if [ -s "${ARTIFACTS_TSV}" ]; then
    MANIFEST_ARTIFACT_URL=$(awk -F'\t' '$2 == "manifest-json" {print $3; exit}' "${ARTIFACTS_TSV}")
    [ -n "${MANIFEST_ARTIFACT_URL}" ] && echo "  manifest：${MANIFEST_ARTIFACT_URL}"
fi
[ "${DO_DEPLOY}" != "true" ] && echo "  提示：联调部署可加 --deploy；HMR 调试回路见 --dev-url"
echo "  生产发布由平台管理员执行（本脚本不触达生产）"
echo "=========================================="
