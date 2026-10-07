/**
 * 文件作用：风场样例数据控制器（/wind/sample-meta 返回 classpath 下 wind-sample.json 的元信息；
 *          与前端包内 assets/wind-sample.json 同源——两份由同一生成脚本产出）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：0.1.0
 * 修改记录：
 *   - 0.1.0 (2026-10-06) 风场插件初始版本
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */

package com.ruoyi.windfieldserver.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ruoyi.common.core.domain.R;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

/**
 * 风场样例数据元信息端点（管理页「数据更新时间」等展示的数据源）。
 * <p>
 * 纯只读、无敏感数据，不做权限注解（等保豁免形态：辅助只读）；
 * 元信息为合成样例数据的描述段（meta），不返回全量 u/v 场。
 * </p>
 */
@RestController
@RequestMapping("/wind")
public class WindSampleController {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 样例数据元信息（网格尺寸/时间范围/风速范围）
     *
     * @return meta 段：name/source/validTime/unit/grid/speedRange
     */
    @GetMapping("/sample-meta")
    public R<Map<String, Object>> sampleMeta() {
        ClassPathResource resource = new ClassPathResource("wind-sample.json");
        try (InputStream in = resource.getInputStream()) {
            JsonNode root = objectMapper.readTree(in);
            // 平台为 Spring Boot 4（MVC 序列化走 Jackson 3），Jackson 2 的 JsonNode
            // 会被当 POJO 输出 nodeType 等垃圾字段——必须先转成 Map 再出参
            return R.ok(objectMapper.convertValue(root.get("meta"), Map.class));
        } catch (IOException e) {
            return R.fail("样例数据读取失败：" + e.getMessage());
        }
    }
}
