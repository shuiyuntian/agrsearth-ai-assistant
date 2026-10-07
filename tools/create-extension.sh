#!/usr/bin/env bash
#
# 文件作用：模板仓本地脚手架——从 skeletons 生成插件包到 packages/<id>/（外部团队独立仓自用，
#          从平台仓 scripts/create-extension.sh 提炼：布局适配 packages/<id>/ + 后端 pom 改造
#          指向 vendored maven-repo）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-10-06
# 版本：1.0.2
# 修改记录：
#   - 1.0.0 (2026-10-06) 初始创建（模板仓 v2.0.0 工具链：占位符替换与 skeleton 实际占位符全集
#     对齐；backend 从 backend/svc-placeholder 实例化并改造 pom：relativePath 置空 +
#     <repositories> 指向 file://${project.basedir}/../../../../maven-repo）
#   - 1.0.1 (2026-10-06) 实战检验修复：① manifest.json description 骨架文案纳入占位符替换
#     （工具轨/系统轨两句长 token），消除「包清单描述残留骨架句」；② 实例化 pom 时同步改写
#     「集成约定」注释（模板仓 vendored 形态 4 层，原注释残留平台仓 6 层表述误导）+ 改写校验
#   - 1.0.2 (2026-10-07) tool 轨 --with-backend 同步带出 deploy/k8s 部署样例（skeletons/tool
#     随骨架复制进包；example-server 资源名/文件名对齐 --backend 服务 id，镜像路径 track/tier
#     段按入参覆写；无后端的包移除 deploy/ 目录）
#
# 版权所有 (C) 2026 CesiumAI 项目
#
# 用法：./tools/create-extension.sh <pkg-id> --track tool|system --tier platform|business
#          [--delivery bundled|optional] [--name <中文名>] [--icon <图标>]
#          [--with-backend] [--backend <service-id>]（可重复；tool 轨至多 1 个）
#          [--with-admin-ui]
#
# 生成位置：packages/<pkg-id>/（与 @cesiumai/* 平台供给包同处 packages/，勿改 @cesiumai 前缀目录）
# 生成后：npm install（根 workspace glob 自动覆盖新包）→ 开发 → tools/check-extension-versions.sh
#         → tools/publish.sh packages/<pkg-id>（仅测试底座）
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PKG_ID=""
TRACK=""
TIER=""
DELIVERY=""
PKG_NAME=""
PKG_ICON="MapLocation"
WITH_BACKEND=0
WITH_ADMIN_UI=0
BACKEND_SVCS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --track) TRACK="$2"; shift 2 ;;
        --tier) TIER="$2"; shift 2 ;;
        --delivery) DELIVERY="$2"; shift 2 ;;
        --name) PKG_NAME="$2"; shift 2 ;;
        --icon) PKG_ICON="$2"; shift 2 ;;
        --with-backend) WITH_BACKEND=1; shift ;;
        --with-admin-ui) WITH_ADMIN_UI=1; shift ;;
        --backend) BACKEND_SVCS+=("$2"); shift 2 ;;
        -*)
            echo "错误：无法识别的参数：$1"
            exit 1
            ;;
        *)
            if [ -z "${PKG_ID}" ]; then PKG_ID="$1"; else echo "错误：多余的参数：$1"; exit 1; fi
            shift
            ;;
    esac
done

if [ -z "${PKG_ID}" ] || [ -z "${TRACK}" ] || [ -z "${TIER}" ]; then
    echo "用法：$(basename "$0") <pkg-id> --track tool|system --tier platform|business [--delivery bundled|optional] [--name <中文名>] [--icon <图标>] [--with-backend] [--backend <service-id>] [--with-admin-ui]"
    exit 1
fi
if ! [[ "${PKG_ID}" =~ ^[a-z0-9-]+$ ]]; then
    echo "错误：pkg-id 只能包含小写字母、数字和中划线：${PKG_ID}"
    exit 1
fi
if [ "${TRACK}" != "tool" ] && [ "${TRACK}" != "system" ]; then
    echo "错误：--track 仅支持 tool（工具轨）/ system（系统轨）"
    exit 1
fi
if [ "${TIER}" != "platform" ] && [ "${TIER}" != "business" ]; then
    echo "错误：--tier 仅支持 platform（平台归属）/ business（业务归属）"
    exit 1
fi
if [ "${TRACK}" = "tool" ] && [ "${TIER}" = "business" ]; then
    DELIVERY="${DELIVERY:-optional}"
    if [ "${DELIVERY}" != "bundled" ] && [ "${DELIVERY}" != "optional" ]; then
        echo "错误：--delivery 仅支持 bundled（标配）/ optional（选装）：${DELIVERY}"
        exit 1
    fi
else
    if [ -n "${DELIVERY}" ]; then
        echo "错误：--delivery 仅适用于 --track tool --tier business 组合"
        exit 1
    fi
fi
if [ "${TRACK}" = "tool" ] && [ "${#BACKEND_SVCS[@]}" -gt 1 ]; then
    echo "错误：工具轨（tool）至多一个后台微服务（--backend 重复 ${#BACKEND_SVCS[@]} 次）——多服务体量请归系统轨（--track system）"
    exit 1
fi
if [ "${WITH_BACKEND}" -eq 1 ] && [ "${#BACKEND_SVCS[@]}" -eq 0 ]; then
    BACKEND_SVCS=("${PKG_ID}-server")
fi
if [ "${TRACK}" = "system" ] && [ "${#BACKEND_SVCS[@]}" -eq 0 ]; then
    # 系统轨默认沿用骨架示例：主服务 + 工作组件
    BACKEND_SVCS=("${PKG_ID}-server" "${PKG_ID}-worker")
fi
for svc in "${BACKEND_SVCS[@]+"${BACKEND_SVCS[@]}"}"; do
    if ! [[ "${svc}" =~ ^[a-z0-9-]+$ ]]; then
        echo "错误：--backend service-id 只能包含小写字母、数字和中划线：${svc}"
        exit 1
    fi
done
[ -z "${PKG_NAME}" ] && PKG_NAME="${PKG_ID}"

for cmd in jq; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "错误：本脚本依赖 ${cmd}"
        exit 1
    fi
done

PKG_DIR="${REPO_ROOT}/packages/${PKG_ID}"
if [ -e "${PKG_DIR}" ]; then
    echo "错误：目录已存在：packages/${PKG_ID}"
    exit 1
fi
mkdir -p "${PKG_DIR}"

TODAY="$(date +%F)"
GLOBAL_NAME="Capability_$(tr '-' '_' <<< "${PKG_ID}")"
# admin-ui UMD 全局名约定：AdminUI_<packageId 去非字母数字>
ADMIN_GLOBAL_NAME="AdminUI_$(tr -cd '[:alnum:]' <<< "${PKG_ID}")"

# macOS(BSD) sed 需要 -i ''，GNU sed 需要 -i（与平台仓 scripts/bump-version.sh 同款移植写法）
sed_i() {
    if sed --version >/dev/null 2>&1; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

# 包树内统一占位符替换（token 全集 = skeletons 实际占位值 + backend/container 模板 __TOKEN__）
replace_tokens() {
    # $1=目标树根；其余为 sed 表达式对已生成文件的批量替换
    local root="$1"; shift
    local f
    find "${root}" -type f \( -name '*.json' -o -name '*.ts' -o -name '*.md' -o -name '*.yaml' -o -name '*.yml' -o -name '*.sh' -o -name 'Dockerfile' \) | while IFS= read -r f; do
        sed_i "$@" "${f}"
    done
}

# 后端骨架实例化（backend/svc-placeholder + container/svc-placeholder），pom 改造指向 vendored maven-repo
# 用法：instantiate_backend_skeleton <svc-id> <svc-port>
instantiate_backend_skeleton() {
    local svc_id="$1" svc_port="$2"
    local tpl_backend="${REPO_ROOT}/backend/svc-placeholder"
    local tpl_container="${REPO_ROOT}/container/svc-placeholder"
    local backend_dir="${PKG_DIR}/backend/${svc_id}"
    local container_dir="${PKG_DIR}/container/${svc_id}"

    if [ ! -d "${tpl_backend}" ] || [ ! -d "${tpl_container}" ]; then
        echo "错误：后端骨架模板缺失（${tpl_backend} / ${tpl_container}）"
        exit 1
    fi

    # 派生值：Java 包段（服务 id 去中划线）/ 启动类名（帕斯卡+Application）/ 环境变量写法（大写下划线）
    local java_dir app_class svc_env part
    java_dir="$(tr -d '-' <<< "${svc_id}")"
    app_class=""
    local -a part_arr=()
    IFS='-' read -ra part_arr <<< "${svc_id}"
    for part in "${part_arr[@]}"; do
        app_class+="$(tr '[:lower:]' '[:upper:]' <<< "${part:0:1}")${part:1}"
    done
    app_class+="Application"
    svc_env="$(tr 'a-z-' 'A-Z_' <<< "${svc_id}")"

    mkdir -p "${backend_dir}" "${container_dir}"
    cp -R "${tpl_backend}/." "${backend_dir}/"
    rm -f "${backend_dir}/README.md"
    cp -R "${tpl_container}/." "${container_dir}/"
    rm -f "${container_dir}/README.md"
    chmod +x "${container_dir}/build.sh"

    # 目录/文件名占位符：Java 包目录与启动类文件改名
    mv "${backend_dir}/src/main/java/com/ruoyi/__JAVA_DIR__" \
       "${backend_dir}/src/main/java/com/ruoyi/${java_dir}"
    mv "${backend_dir}/src/main/java/com/ruoyi/${java_dir}/__APP_CLASS__.java" \
       "${backend_dir}/src/main/java/com/ruoyi/${java_dir}/${app_class}.java"

    # 内容占位符替换（token 全集见 backend/svc-placeholder/README.md 占位符表）
    local f
    find "${backend_dir}" "${container_dir}" -type f | while IFS= read -r f; do
        sed_i \
            -e "s|__SVC_ENV__|${svc_env}|g" \
            -e "s|__SVC_PORT__|${svc_port}|g" \
            -e "s|__SVC_ID__|${svc_id}|g" \
            -e "s|__APP_CLASS__|${app_class}|g" \
            -e "s|__JAVA_DIR__|${java_dir}|g" \
            -e "s|__PKG_ID__|${PKG_ID}|g" \
            -e "s|__PKG_NAME__|${PKG_NAME}|g" \
            -e "s|__TRACK__|${TRACK}|g" \
            -e "s|__TIER__|${TIER}|g" \
            -e "s|__TODAY__|${TODAY}|g" \
            "${f}"
    done

    # pom 改造（模板仓关键差异，platform 仓实例化为 6 层 relativePath 指回主仓）：
    #   ① parent relativePath 直指 vendored 根 pom 文件（相对模块目录定位，免表达式免仓库解析——
    #     parent 解析阶段 ${project.basedir} 尚未插值，仓库 URL 里的表达式此时不可用）；
    #   ② 注入 <repositories> 指向 vendored file:// 仓（依赖解析期插值生效，供传递 com.ruoyi 构件；
    #     basedir=<pkg>/backend/<svc>，四层到仓根）
    local pom="${backend_dir}/pom.xml"
    python3 - "${pom}" <<'PYEOF'
import re
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = re.sub(
    r'<relativePath>[^<]*</relativePath>',
    '<relativePath>../../../../maven-repo/com/ruoyi/ruoyi/3.6.8/ruoyi-3.6.8.pom</relativePath>',
    s,
)
# ③ 同步改写集成约定注释：模板仓形态为 vendored 根 pom（4 层），不再保留骨架的
#    「relativePath 固定 6 层 / extensions/<track>/<tier>」平台仓表述（防误导）
s = re.sub(
    r'  - parent 对齐平台 platform/backend/ruoyi-cloud/pom\.xml；relativePath 固定 6 层，\n'
    r'    对应仓内布局 extensions/<track>/<tier>/<pkg>/backend/<svc>/pom\.xml（目录唯一规则，ADR-010）',
    '  - parent 指向 vendored 根 pom（file://maven-repo，相对本 pom 四层到仓根）——模板仓实例化形态，\n'
    '    独立构建不依赖平台仓（平台仓内实例化才是 6 层 relativePath 回 platform/backend/ruoyi-cloud）',
    s,
)
repos = (
    "    <repositories>\n"
    "        <repository>\n"
    "            <id>cesiumai-vendored</id>\n"
    "            <name>CesiumAI vendored com.ruoyi artifacts</name>\n"
    "            <url>file://${project.basedir}/../../../../maven-repo</url>\n"
    "        </repository>\n"
    "    </repositories>\n"
    "\n"
    "</project>"
)
if 'cesiumai-vendored' not in s:
    if '</project>' not in s:
        sys.exit(f'错误：pom 缺少 </project> 结束标签：{p}')
    s = s.replace('</project>', repos, 1)
open(p, 'w', encoding='utf-8').write(s)
PYEOF
    if ! grep -q 'cesiumai-vendored' "${pom}" || ! grep -q 'maven-repo/com/ruoyi/ruoyi' "${pom}"; then
        echo "错误：pom 改造失败（relativePath 直指 vendored 根 pom / repositories 注入）：${pom}"
        exit 1
    fi
    if grep -q 'relativePath 固定 6 层' "${pom}"; then
        echo "错误：pom 集成约定注释改写失败（仍残留平台仓 6 层表述）：${pom}"
        exit 1
    fi
}

# ---------- 复制骨架 + 占位符替换 ----------
if [ "${TRACK}" = "tool" ]; then
    cp -R "${REPO_ROOT}/skeletons/tool/." "${PKG_DIR}/"
    # 骨架预置的示例产物与文档不随包带走（构建期重新生成）
    rm -rf "${PKG_DIR}/frontend/dist"
    # 骨架示例值 → 本包值（顺序敏感：长 token 先替换）
    replace_tokens "${PKG_DIR}" \
        -e "s|工具轨能力包最小骨架：球端面板，可选管理页/薄后端；复制本骨架改名即用|${PKG_NAME}（工具轨能力包）|g" \
        -e "s|示例工具（骨架）|${PKG_NAME}|g" \
        -e "s|示例工具|${PKG_NAME}|g" \
        -e "s|example-tool|${PKG_ID}|g" \
        -e "s|example:data|${PKG_ID}:data|g" \
        -e "s|cesiumai-plugin-tool-example|@agrscesiumai/ext-${PKG_ID}|g" \
        -e "s|Capability_example|${GLOBAL_NAME}|g" \
        -e "s|工具轨能力包骨架（复制后修改）|${PKG_NAME}（工具轨能力包）|g"
    if [ "${WITH_ADMIN_UI}" -eq 1 ]; then
        cp -R "${REPO_ROOT}/skeletons/admin-ui" "${PKG_DIR}/admin-ui"
        rm -rf "${PKG_DIR}/admin-ui/dist"
        replace_tokens "${PKG_DIR}/admin-ui" \
            -e "s|cesiumai-plugin-admin-ui-example|@agrscesiumai/ext-${PKG_ID}-admin|g" \
            -e "s|AdminUI_example|${ADMIN_GLOBAL_NAME}|g"
        # admin-ui 入口 manifest 同步本包 id/中文名
        sed_i \
            -e "s|id: 'example-tool'|id: '${PKG_ID}'|" \
            -e "s|name: '示例工具（管理页）'|name: '${PKG_NAME}（管理页）'|" \
            "${PKG_DIR}/admin-ui/src/index.ts"
        # manifest components.adminUi 显式置真（admin-ui 通道契约，禁止推导）
        jq '.components.adminUi = true' "${PKG_DIR}/manifest.json" > "${PKG_DIR}/manifest.json.tmp" \
            && mv "${PKG_DIR}/manifest.json.tmp" "${PKG_DIR}/manifest.json"
    fi
    if [ "${#BACKEND_SVCS[@]}" -gt 0 ]; then
        instantiate_backend_skeleton "${BACKEND_SVCS[0]}" "8080"
        # deploy/k8s 样例随骨架复制进包（skeletons/tool/deploy/k8s/，包级替换已改 example-tool）：
        # 资源名/文件名对齐 --backend 服务 id，镜像路径 track/tier 段按入参覆写
        k8s_skel="${PKG_DIR}/deploy/k8s/10-example-server.yaml"
        sed_i \
            -e "s|example-server|${BACKEND_SVCS[0]}|g" \
            -e "s|gis-platform/tool/business/|gis-platform/${TRACK}/${TIER}/|g" \
            "${k8s_skel}"
        mv "${k8s_skel}" "${PKG_DIR}/deploy/k8s/10-${BACKEND_SVCS[0]}.yaml"
        # manifest components.backend / backendServices 与骨架服务一致
        jq --arg sid "${BACKEND_SVCS[0]}" \
            '.components.backend = [$sid]
             | .backendServices = [{serviceId: $sid, name: ($sid + " 服务"), required: true,
                                    apiPrefix: ("/" + $sid), healthEndpoint: ("/" + $sid + "/actuator/health"),
                                    imageSource: "self"}]' \
            "${PKG_DIR}/manifest.json" > "${PKG_DIR}/manifest.json.tmp" \
            && mv "${PKG_DIR}/manifest.json.tmp" "${PKG_DIR}/manifest.json"
    else
        # 无后端的工具包不带部署样例（deploy/ 仅随后端出现）
        rm -rf "${PKG_DIR}/deploy"
    fi
else
    cp -R "${REPO_ROOT}/skeletons/system/." "${PKG_DIR}/"
    # 骨架示例值 → 本包值（顺序敏感：service 名先于包名；长 token 先替换）
    replace_tokens "${PKG_DIR}" \
        -e "s|系统轨能力包最小骨架：管理面远程页 + 多后端服务 + k8s-bundle；复制本骨架改名即用|${PKG_NAME}（系统轨能力包）|g" \
        -e "s|示例系统（骨架）|${PKG_NAME}|g" \
        -e "s|示例系统|${PKG_NAME}|g" \
        -e "s|示例主服务|${PKG_NAME}主服务|g" \
        -e "s|示例工作器|${PKG_NAME}工作器|g" \
        -e "s|example-system|${PKG_ID}|g" \
        -e "s|example-server|${PKG_ID}-server|g" \
        -e "s|example-worker|${PKG_ID}-worker|g"
    # 目录/文件名占位符（container 组件目录与 k8s 工作负载文件名）
    mv "${PKG_DIR}/container/example-server" "${PKG_DIR}/container/${PKG_ID}-server"
    mv "${PKG_DIR}/deploy/k8s/10-example-server.yaml" "${PKG_DIR}/deploy/k8s/10-${PKG_ID}-server.yaml"
    mv "${PKG_DIR}/deploy/k8s/20-example-worker.yaml" "${PKG_DIR}/deploy/k8s/20-${PKG_ID}-worker.yaml"
    # admin-ui：系统轨骨架声明 adminUi=true，复制远程页骨架
    cp -R "${REPO_ROOT}/skeletons/admin-ui" "${PKG_DIR}/admin-ui"
    rm -rf "${PKG_DIR}/admin-ui/dist"
    replace_tokens "${PKG_DIR}/admin-ui" \
        -e "s|cesiumai-plugin-admin-ui-example|@agrscesiumai/ext-${PKG_ID}-admin|g" \
        -e "s|AdminUI_example|${ADMIN_GLOBAL_NAME}|g"
    sed_i \
        -e "s|id: 'example-tool'|id: '${PKG_ID}'|" \
        -e "s|name: '示例工具（管理页）'|name: '${PKG_NAME}（管理页）'|" \
        "${PKG_DIR}/admin-ui/src/index.ts"
    # 后端多组件实例化（端口 8080/8081…，与 skeleton deploy 样例 containerPort 一致）
    SVC_INDEX=0
    for SVC_ID in "${BACKEND_SVCS[@]}"; do
        SVC_INDEX=$((SVC_INDEX + 1))
        instantiate_backend_skeleton "${SVC_ID}" "$((8080 + SVC_INDEX - 1))"
    done
fi

# 骨架/模板目录可能带 macOS 系统垃圾 .DS_Store，不随包带走
find "${PKG_DIR}" -name '.DS_Store' -delete

# ---------- 包 README / CHANGELOG ----------
cat > "${PKG_DIR}/README.md" <<EOF
# ${PKG_NAME}（${PKG_ID}）

${TRACK} 轨能力包（track: ${TRACK}，tier: ${TIER}${DELIVERY:+，delivery: ${DELIVERY}}）。
脚手架由 tools/create-extension.sh 生成（模板仓）。

## 目录

- manifest.json      能力包清单（track/tier${DELIVERY:+/delivery}+components 显式段；发布时 entries.url 自动回填）
- VERSION            包版本唯一事实源
- frontend/          球端 Capability 工程（cd frontend && npm run build）
$(if [ "${WITH_ADMIN_UI}" -eq 1 ] || [ "${TRACK}" = "system" ]; then echo "- admin-ui/          管理面远程页（cd admin-ui && npm run build）"; fi)
$(if [ "${#BACKEND_SVCS[@]}" -gt 0 ]; then echo "- backend/<svc>/     后端微服务（mvn package；com.ruoyi 构件由仓根 maven-repo/ 供给）"; echo "- container/<svc>/   镜像构建（Dockerfile+build.sh+VERSION 组件版本轴）"; fi)
$(if [ "${TRACK}" = "system" ] || [ "${#BACKEND_SVCS[@]}" -gt 0 ]; then echo "- deploy/k8s/        k8s-bundle（publish 打包一键安装）"; fi)
- data/menu.json     管理面菜单声明样例（号段向平台方申请后替换；tools/menujson.py validate 本地校验）

## 开发 → 发布

1. 仓根 npm install（workspace glob 自动覆盖本包 frontend/admin-ui）
2. 开发自测（RELEASE_CHECKLIST.md）
3. ./tools/check-extension-versions.sh
4. ./tools/publish.sh packages/${PKG_ID}（仅测试底座；生产发布由平台管理员执行）
EOF

cat > "${PKG_DIR}/CHANGELOG.md" <<EOF
# ${PKG_NAME} 变更记录

## [0.1.0] - ${TODAY}

- 初始脚手架（tools/create-extension.sh 生成，${TRACK} 轨）
EOF

echo "=========================================="
echo "脚手架已生成：packages/${PKG_ID}（${TRACK} 轨）"
find "${PKG_DIR}" -type f | sed "s|${REPO_ROOT}/||" | sort | sed 's/^/  /'
echo "------------------------------------------"
echo "下一步："
echo "  1. 完善实现（契约见 docs/L4-概念手册.md / L6-参考契约.md）"
echo "  2. 仓根 npm install && ./tools/check-extension-versions.sh"
echo "  3. 发布：./tools/publish.sh packages/${PKG_ID}"
echo "=========================================="
