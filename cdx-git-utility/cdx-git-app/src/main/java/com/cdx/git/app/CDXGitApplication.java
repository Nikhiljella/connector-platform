package com.cdx.git.app;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Entry point for the CDX Git Utility Spring Boot application.
 *
 * <p>The component scan covers both {@code com.cdx.git.app} and the
 * {@code com.cdx.git} package in {@code cdx-git-core} so all utility beans
 * and configuration classes are picked up automatically.
 */
@SpringBootApplication(scanBasePackages = "com.cdx.git")
public class CDXGitApplication {

    public static void main(String[] args) {
        SpringApplication.run(CDXGitApplication.class, args);
    }
}
