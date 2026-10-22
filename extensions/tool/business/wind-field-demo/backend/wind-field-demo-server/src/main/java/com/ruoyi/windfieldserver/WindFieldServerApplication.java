/**
 * 文件作用：风场 后端微服务启动类
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：0.1.0
 * 修改记录：
 *   - 0.1.0 (2026-10-06) 脚手架初始创建（create-extension.sh）
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

package com.ruoyi.windfieldserver;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * 风场 后端微服务启动类
 * <p>
 * Nacos 注册名取 spring.application.name（= manifest.backendServices[].serviceId = wind-field-demo-server）。
 * scanBasePackages 保留 com.ruoyi 以装入 ruoyi-common-* 的自动配置 Bean。
 * ruoyi-common-security 传递引入 mybatis/HikariCP——本服务无数据库，排除
 * DataSourceAutoConfiguration（否则启动失败：Failed to determine a suitable driver class）。
 * </p>
 */
@EnableDiscoveryClient
@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class}, scanBasePackages = {"com.ruoyi"})
public class WindFieldServerApplication {

    private static final Logger log = LoggerFactory.getLogger(WindFieldServerApplication.class);

    public static void main(String[] args) {
        SpringApplication.run(WindFieldServerApplication.class, args);
        log.info("=== wind-field-demo-server started ===");
    }
}
