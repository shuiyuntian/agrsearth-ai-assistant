/**
 * 文件作用：__SVC_ID__ 示例信息控制器（服务自检/版本信息）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：__TODAY__
 * 版本：0.1.0
 * 修改记录：
 *   - 0.1.0 (__TODAY__) 脚手架初始创建（create-extension.sh）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */

package com.ruoyi.__JAVA_DIR__.controller;

import com.ruoyi.common.core.domain.R;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 示例信息控制器：服务自检与版本信息（联通性冒烟用，可按需删除）。
 * <p>
 * 健康检查走 actuator：GET /actuator/health（部署态经网关 /__SVC_ID__/actuator/health，
 * 即 manifest.backendServices[].healthEndpoint 的约定值）。
 * </p>
 */
@RestController
@RequestMapping("/info")
public class SampleController {

    /**
     * 服务信息自检端点
     *
     * @return 服务 id、所属能力包、版本与当前时间
     */
    @GetMapping
    public R<Map<String, Object>> info() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("service", "__SVC_ID__");
        data.put("extension", "__PKG_ID__");
        data.put("version", "0.1.0");
        data.put("time", LocalDateTime.now().toString());
        return R.ok(data);
    }
}
